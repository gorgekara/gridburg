import { GRID, MAX_CARS, N_TILES, START_MONEY, isService, isZone } from './constants';
import { Network, KIND_AVENUE } from './roads/network';
import { rasterize } from './roads/raster';
import type { Raster } from './roads/raster';
import { generateTerrain } from './terrain';
import type { Terrain } from './terrain';
import { emptyStats } from './sim/messages';
import type { EditPayload, MainToWorker, Stats, WorkerToMain } from './sim/messages';
import type { SaveData } from './save';

/** Main-thread mirror of the city plus the bridge to the simulation worker. */
export class Game {
  seed = 1;
  terrain: Terrain = generateTerrain(1);
  net = new Network();
  raster: Raster = rasterize(this.net);
  kind = new Uint8Array(N_TILES);
  level = new Uint8Array(N_TILES);
  flags: Uint8Array = new Uint8Array(N_TILES);
  pollution: Uint8Array = new Uint8Array(N_TILES);
  riverPollution: Uint8Array = new Uint8Array(0);
  stats: Stats = emptyStats(START_MONEY);
  tax = 10;
  speed = 1;
  simTime = 0;
  /** A scenario city: buildings are fixed, the budget never earns, and nothing may be demolished. */
  frozen = false;
  /** Segment ids in the order last sent to the worker; congestion frames are indexed the same way. */
  segOrder: number[] = [];
  segCong: Uint8Array = new Uint8Array(0);
  carsPrev: Float32Array = new Float32Array(MAX_CARS * 4);
  carsNext: Float32Array = new Float32Array(MAX_CARS * 4);
  prevTime = 0;
  nextTime = 0;

  onState: (() => void) | null = null;
  onEdit: (() => void) | null = null;
  onTerrain: (() => void) | null = null;
  onFrame: (() => void) | null = null;

  private worker: Worker;
  private pendingSpent = 0;
  private dirty = false;
  private serial = 0;
  private rasterVersion = -1;

  constructor() {
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const m = ev.data;
      if (m.type === 'state') {
        this.level.set(m.level);
        this.flags = m.flags;
        this.pollution = m.pollution;
        this.riverPollution = m.riverPollution;
        this.stats = m.stats;
        this.onState?.();
      } else {
        this.carsPrev = this.carsNext;
        this.carsNext = m.cars;
        this.prevTime = this.nextTime;
        this.nextTime = performance.now();
        this.simTime = m.simTime;
        if (m.serial === this.serial) this.segCong = m.segCong;
        this.onFrame?.();
      }
    };
  }

  private send(m: MainToWorker): void {
    this.worker.postMessage(m);
  }

  canAfford(cost: number): boolean {
    return this.stats.money - this.pendingSpent >= cost;
  }

  spend(cost: number): void {
    this.pendingSpent += cost;
    this.dirty = true;
  }

  /** Can something be placed on this tile at all? */
  buildable(i: number): boolean {
    return !this.terrain.water[i] && !this.raster.cover[i];
  }

  /** Change a tile's kind. Returns false if unchanged. */
  setKind(i: number, k: number, cost: number): boolean {
    if (this.frozen || this.kind[i] === k) return false;
    this.kind[i] = k;
    this.level[i] = isService(k) ? 1 : 0;
    this.pendingSpent += cost;
    this.dirty = true;
    return true;
  }

  private payload(): EditPayload {
    if (this.rasterVersion !== this.net.version) {
      this.raster = rasterize(this.net);
      this.rasterVersion = this.net.version;
      // Roads pave over whatever was on the tile.
      for (let i = 0; i < N_TILES; i++) {
        if (this.raster.cover[i] && (isZone(this.kind[i]) || isService(this.kind[i]))) {
          this.kind[i] = 0;
          this.level[i] = 0;
        }
      }
    }
    const net = this.net.toPlain();
    this.segOrder = net.segs.map((s) => s[0]);
    this.serial++;
    this.segCong = new Uint8Array(this.segOrder.length);
    return {
      kind: this.kind.slice(), net, serial: this.serial,
      cover: this.raster.cover.slice(), accSeg: this.raster.accSeg.slice(), accS: this.raster.accS.slice(),
    };
  }

  /** Push accumulated edits to the worker. */
  flush(): void {
    if (!this.dirty && this.rasterVersion === this.net.version) return;
    this.send({ type: 'edit', spent: this.pendingSpent, ...this.payload() });
    this.stats.money -= this.pendingSpent;
    this.pendingSpent = 0;
    this.dirty = false;
    this.onEdit?.();
  }

  load(d: SaveData, frozen = false): void {
    this.frozen = frozen;
    this.seed = d.seed;
    this.terrain = generateTerrain(d.seed);
    this.net = Network.fromPlain(d.net);
    this.rasterVersion = -1;
    this.kind.set(d.kind);
    this.level.set(d.level);
    this.flags = new Uint8Array(N_TILES);
    this.pollution = new Uint8Array(N_TILES);
    this.riverPollution = new Uint8Array(this.terrain.river.length);
    this.tax = d.tax;
    this.stats = emptyStats(d.money);
    this.stats.tick = d.tick;
    this.pendingSpent = 0;
    this.dirty = false;
    this.carsPrev = new Float32Array(MAX_CARS * 4);
    this.carsNext = new Float32Array(MAX_CARS * 4);
    const payload = this.payload();
    this.send({ type: 'load', seed: d.seed, level: this.level.slice(), money: d.money, tick: d.tick, tax: d.tax, frozen, ...payload });
    this.onTerrain?.();
    this.onEdit?.();
  }

  snapshot(): SaveData {
    return {
      seed: this.seed, kind: this.kind, level: this.level, net: this.net.toPlain(),
      money: this.stats.money, tick: this.stats.tick, tax: this.tax,
    };
  }

  setSpeed(v: number): void {
    this.speed = v;
    this.send({ type: 'speed', value: v });
  }

  setTax(v: number): void {
    this.tax = v;
    this.send({ type: 'tax', value: v });
  }

  /** Fast-forward: growth ticks, or whole seconds of traffic when `traffic` is set. */
  warm(ticks: number, traffic = false): void {
    this.send({ type: 'warm', ticks, traffic });
  }

  /** Scale how many trips the city generates. A scenario's rush hour turns this up wave by wave. */
  setDemand(value: number): void {
    this.send({ type: 'demand', value });
  }

  /** Pay an instalment of a scenario's budget into the city's money. */
  grant(amount: number): void {
    this.stats.money += amount;
    this.send({ type: 'grant', amount });
  }
}

/** A fresh map: a seeded river and the fixed highway stub that connects the city to the outside. */
export function newCity(seed: number): SaveData {
  const terrain = generateTerrain(seed);
  const net = new Network();
  const e = terrain.entry;
  const a = net.addNode(e.x, e.z);
  a.entry = true;
  a.fixed = true;
  const len = 7;
  const bx = Math.max(1, Math.min(GRID - 1, e.x + e.dx * len));
  const bz = Math.max(1, Math.min(GRID - 1, e.z + e.dz * len));
  const b = net.addNode(bx, bz);
  b.fixed = true;
  net.addSeg(a.id, b.id, (a.x + b.x) / 2, (a.z + b.z) / 2, KIND_AVENUE, false, true);
  return {
    seed, kind: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES), net: net.toPlain(),
    money: START_MONEY, tick: 0, tax: 10,
  };
}

export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xfffffff) + 1) >>> 0;
}
