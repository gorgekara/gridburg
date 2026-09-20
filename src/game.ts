import type { IncidentSnapshot, IncidentView } from './sim/incidents';
import { footprint, siteOwners } from './sites';
import { defaultFunding } from './management';
import { noPolicies } from './policies';
import type { PolicyId } from './policies';
import type { FundingKey } from './management';
import { levelForPopulation } from './progression';
import { RES_POP, T_RES, GRID, MAX_CARS, N_TILES, START_MONEY, isService, isZone } from './constants';
import { Network, KIND_AVENUE } from './roads/network';
import { ensureApproaches } from './roads/entries';
import { rasterize } from './roads/raster';
import type { Raster } from './roads/raster';
import { generateTerrain } from './terrain';
import type { Terrain } from './terrain';
import { emptyStats } from './sim/messages';
import type { EditPayload, MainToWorker, Stats, WorkerToMain, TileReport } from './sim/messages';

import type { SaveData } from './save';

const CHEAT_FLOOR = 1_000_000;

/** Main-thread mirror of the city plus the bridge to the simulation worker. */
export class Game {
  incidents: IncidentView = { fires: [], crashes: [], crime: [], patrol: [] };
  incidentSave?: IncidentSnapshot;
  seed = 1;
  terrain: Terrain = generateTerrain(1);
  net = new Network();
  raster: Raster = rasterize(this.net);
  kind = new Uint8Array(N_TILES);
  owners: Int32Array = new Int32Array(N_TILES).fill(-1);
  level = new Uint8Array(N_TILES);
  neglect = new Uint8Array(N_TILES);
  flags: Uint8Array = new Uint8Array(N_TILES);
  pollution: Uint8Array = new Uint8Array(N_TILES);
  riverPollution: Uint8Array = new Uint8Array(0);
  stats: Stats = emptyStats(START_MONEY);
  tax = 10;
  speed = 1;
  carHeights: Float32Array = new Float32Array(MAX_CARS);
  prevCarHeights: Float32Array = new Float32Array(MAX_CARS);
  carPitch: Float32Array = new Float32Array(MAX_CARS);
  simTime = 0;
  cityTime = 0;
  /** Segment ids in the order last sent to the worker; congestion frames are indexed the same way. */
  segOrder: number[] = [];
  segCong: Uint8Array = new Uint8Array(0);
  carIdsPrev: Uint32Array = new Uint32Array(MAX_CARS);
  carIdsNext: Uint32Array = new Uint32Array(MAX_CARS);
  carsPrev: Float32Array = new Float32Array(MAX_CARS * 4);
  carsNext: Float32Array = new Float32Array(MAX_CARS * 4);
  prevTime = 0;
  nextTime = 0;

  onInspection: ((report: TileReport | null) => void) | null = null;
  onNotice: ((message: string) => void) | null = null;
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
        this.incidents = m.incidents; this.incidentSave = m.incidentSave;
        this.level.set(m.level);
        this.neglect.set(m.neglect);
        this.flags = m.flags;
        this.pollution = m.pollution;
        this.riverPollution = m.riverPollution;
        this.stats = m.stats;
        this.cityTime = Math.max(this.cityTime, m.stats.tick);
        this.onState?.();
      } else if (m.type === 'inspection') {
        this.onInspection?.(m.report);
      } else if (m.type === 'notice') {
        this.onNotice?.(m.message);
      } else {
        this.carIdsPrev = this.carIdsNext; this.carIdsNext = m.carIds;
        this.carsPrev = this.carsNext;
        this.carsNext = m.cars;
        this.prevTime = this.nextTime;
        this.nextTime = performance.now();
        this.prevCarHeights = this.carHeights; this.carHeights = m.carHeights; this.carPitch = m.carPitch;
        this.simTime = m.simTime;
        this.cityTime = m.cityTime;
        if (m.serial === this.serial) this.segCong = m.segCong;
        this.onFrame?.();
      }
    };
  }

  private send(m: MainToWorker): void {
    this.worker.postMessage(m);
  }

  /** Cheat: building is free and the treasury is topped up to CHEAT_FLOOR on every edit. */
  infiniteMoney = false;

  setInfiniteMoney(on: boolean): void {
    this.infiniteMoney = on;
    if (on) { this.dirty = true; this.flush(); }
  }

  canAfford(cost: number): boolean {
    if (this.infiniteMoney) return true;
    return this.stats.money - this.pendingSpent >= cost;
  }

  spend(cost: number): void {
    this.pendingSpent += cost;
    this.dirty = true;
  }

  /** Can something be placed on this tile at all? */
  /**
   * Dry, unpaved, unclaimed ground. The shore strip counts as wet: it is drawn under the water even
   * though the tile mask calls it land, so nothing may stand there. Waterside works are the exception —
   * a pump or an outlet belongs on the bank.
   */
  buildable(i: number, bank = false): boolean {
    if (this.terrain.water[i] || this.raster.cover[i] || this.owners[i] >= 0) return false;
    return bank || !this.terrain.shore[i];
  }

  /** Change a tile's kind. Returns false if unchanged. */
  setKind(i: number, k: number, cost: number): boolean {
    if (this.owners[i] >= 0) i = this.owners[i];
    if (this.kind[i] === k) return false;
    this.kind[i] = k;
    this.owners = siteOwners(this.kind);
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
        if ((isZone(this.kind[i]) || isService(this.kind[i])) && footprint(i, this.kind[i]).some(t => this.raster.cover[t])) {
          this.kind[i] = 0;
          this.level[i] = 0;
        }
      }
    }
    this.owners = siteOwners(this.kind);
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
    // A negative spend tops the worker's treasury back up.
    if (this.infiniteMoney) this.pendingSpent = Math.min(0, this.stats.money - CHEAT_FLOOR);
    this.send({ type: 'edit', spent: this.pendingSpent, ...this.payload() });
    this.stats.money -= this.pendingSpent;
    this.pendingSpent = 0;
    this.dirty = false;
    this.onEdit?.();
  }

  load(d: SaveData): void {
    this.incidentSave = d.incidents;
    this.incidents = { fires: d.incidents?.fires ?? [], crashes: [], crime: [], patrol: [] };
    this.seed = d.seed;
    this.terrain = generateTerrain(d.seed);
    this.net = Network.fromPlain(d.net);
    ensureApproaches(this.net); // older cities and shared links stop at the map edge
    this.rasterVersion = -1;
    this.kind.set(d.kind);
    this.level.set(d.level);
    this.neglect.set(d.neglect ?? new Uint8Array(N_TILES));
    this.flags = new Uint8Array(N_TILES);
    this.pollution = new Uint8Array(N_TILES);
    this.riverPollution = new Uint8Array(this.terrain.river.length);
    this.tax = d.tax;
    const money = this.infiniteMoney ? Math.max(d.money, CHEAT_FLOOR) : d.money;
    this.stats = emptyStats(money);
    this.stats.tick = d.tick;
    this.cityTime = d.tick;
    this.stats.funding = { ...defaultFunding(), ...d.funding };
    this.stats.policies = { ...noPolicies(), ...d.policies };
    this.stats.debt = d.debt ?? 0;
    this.stats.cityLevel = d.cityLevel ?? levelForPopulation(d.kind.reduce((n, k, i) => n + (k === T_RES ? RES_POP[d.level[i]] : 0), 0));
    this.pendingSpent = 0;
    this.dirty = false;
    this.carIdsPrev = new Uint32Array(MAX_CARS); this.carIdsNext = new Uint32Array(MAX_CARS);
    this.prevCarHeights.fill(0); this.carHeights.fill(0); this.carPitch.fill(0);
    this.carsPrev = new Float32Array(MAX_CARS * 4);
    this.carsNext = new Float32Array(MAX_CARS * 4);
    const payload = this.payload();
    this.send({ type: 'load', incidents: d.incidents, policies: this.stats.policies, funding: this.stats.funding, debt: this.stats.debt, neglect: this.neglect.slice(), cityLevel: this.stats.cityLevel, seed: d.seed, level: this.level.slice(), money, tick: d.tick, tax: d.tax, ...payload });
    this.onTerrain?.();
    this.onEdit?.();
  }

  snapshot(): SaveData {
    return {
      incidents: this.incidentSave, seed: this.seed, kind: this.kind, level: this.level, net: this.net.toPlain(),
      funding: this.stats.funding, policies: this.stats.policies, debt: this.stats.debt, neglect: this.neglect, cityLevel: this.stats.cityLevel, money: this.stats.money, tick: this.stats.tick, tax: this.tax,
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

  setFunding(key: FundingKey, value: number): void {
    this.flush();
    this.send({ type: 'funding', key, value });
  }

  setPolicy(id: PolicyId, on: boolean): void {
    this.flush();
    this.stats.policies = { ...this.stats.policies, [id]: on };
    this.send({ type: 'policy', id, on });
  }

  loan(action: 'take' | 'repay'): void {
    this.flush();
    this.send({ type: 'loan', action });
  }

  inspect(tile: number): void {
    this.flush();
    this.send({ type: 'inspect', tile });
  }

  warm(ticks: number): void {
    this.send({ type: 'warm', ticks });
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
  // The stub ends on a tile centre so roads drawn from it stay on the grid of squares.
  const len = 7.5;
  const bx = Math.max(0.5, Math.min(GRID - 0.5, e.x + e.dx * len));
  const bz = Math.max(0.5, Math.min(GRID - 0.5, e.z + e.dz * len));
  const b = net.addNode(bx, bz);
  b.fixed = true;
  net.addSeg(a.id, b.id, (a.x + b.x) / 2, (a.z + b.z) / 2, KIND_AVENUE, false, true);
  ensureApproaches(net);
  return {
    seed, kind: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES), net: net.toPlain(),
    money: START_MONEY, tick: 0, tax: 10,
  };
}

export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xfffffff) + 1) >>> 0;
}
