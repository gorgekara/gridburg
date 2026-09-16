import { MAX_CARS, N_TILES, START_MONEY } from './constants';
import { emptyStats } from './sim/messages';
import type { MainToWorker, Stats, WorkerToMain } from './sim/messages';

/** Main-thread mirror of the city plus the bridge to the simulation worker. */
export class Game {
  kind = new Uint8Array(N_TILES);
  level = new Uint8Array(N_TILES);
  stats: Stats = emptyStats(START_MONEY);
  tax = 10;
  speed = 1;
  congestion: Uint8Array = new Uint8Array(N_TILES);
  carsPrev: Float32Array = new Float32Array(MAX_CARS * 4);
  carsNext: Float32Array = new Float32Array(MAX_CARS * 4);
  prevTime = 0;
  nextTime = 0;

  onState: (() => void) | null = null;
  onEdit: (() => void) | null = null;
  onFrame: (() => void) | null = null;

  private worker: Worker;
  private pendingSpent = 0;
  private dirty = false;

  constructor() {
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const m = ev.data;
      if (m.type === 'state') {
        this.level.set(m.level);
        this.stats = m.stats;
        this.onState?.();
      } else {
        this.carsPrev = this.carsNext;
        this.carsNext = m.cars;
        this.prevTime = this.nextTime;
        this.nextTime = performance.now();
        this.congestion = m.congestion;
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

  /** Change a tile's kind. Returns false if unchanged. */
  setKind(i: number, k: number, cost: number): boolean {
    if (this.kind[i] === k) return false;
    this.kind[i] = k;
    this.level[i] = 0;
    this.pendingSpent += cost;
    this.dirty = true;
    return true;
  }

  /** Push accumulated edits to the worker. */
  flush(): void {
    if (!this.dirty) return;
    this.send({ type: 'kind', kind: this.kind.slice(), spent: this.pendingSpent });
    this.stats.money -= this.pendingSpent;
    this.pendingSpent = 0;
    this.dirty = false;
    this.onEdit?.();
  }

  load(kind: Uint8Array, level: Uint8Array, money: number, tick: number, tax: number): void {
    this.kind.set(kind);
    this.level.set(level);
    this.tax = tax;
    this.stats = emptyStats(money);
    this.stats.tick = tick;
    this.pendingSpent = 0;
    this.dirty = false;
    this.carsPrev.fill(0);
    this.carsNext.fill(0);
    this.send({ type: 'load', kind: kind.slice(), level: level.slice(), money, tick, tax });
    this.onEdit?.();
  }

  clear(): void {
    this.load(new Uint8Array(N_TILES), new Uint8Array(N_TILES), START_MONEY, 0, 10);
  }

  setSpeed(v: number): void {
    this.speed = v;
    this.send({ type: 'speed', value: v });
  }

  setTax(v: number): void {
    this.tax = v;
    this.send({ type: 'tax', value: v });
  }

  warm(ticks: number): void {
    this.send({ type: 'warm', ticks });
  }
}
