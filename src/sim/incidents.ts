import { GRID, N_TILES, T_COM, T_OFFICE, isZone } from '../constants';
export interface Fire { tile: number; age: number }
/** A robbery in progress: the crew get away with the takings unless the police arrive in time. */
export interface Heist { tile: number; age: number }
export const HEIST_LIMIT = 90; // seconds before the crew is gone
export interface Crash { id: number; x: number; z: number; y?: number; remaining: number; slots: number[]; tile: number }
export interface IncidentSnapshot { fires: Fire[]; crime: [number, number][]; patrol: [number, number][] }
export interface IncidentView { fires: Fire[]; heists: Heist[]; crashes: { id: number; x: number; z: number; y?: number; remaining: number }[]; crime: number[]; patrol: number[] }

export class Incidents {
  readonly fires = new Map<number, Fire>();
  readonly heists = new Map<number, Heist>();
  robbed = 0; foiled = 0;
  readonly crashes = new Map<number, Crash>();
  readonly crime = new Float32Array(N_TILES);
  readonly patrol = new Float32Array(N_TILES);
  prevented = 0; extinguished = 0; damaged = 0;
  private nextCrash = 1;
  clear(): void {
    this.fires.clear(); this.heists.clear(); this.crashes.clear(); this.crime.fill(0); this.patrol.fill(0);
    this.prevented = 0; this.extinguished = 0; this.damaged = 0; this.robbed = 0; this.foiled = 0;
  }
  rob(tile: number): void { if (!this.heists.has(tile)) this.heists.set(tile, { tile, age: 0 }); }
  /** The police reached the scene in time. */
  foil(tile: number): void { if (this.heists.delete(tile)) this.foiled++; }
  ignite(tile: number): void { if (!this.fires.has(tile)) this.fires.set(tile, { tile, age: 0 }); }
  visit(tile: number): void {
    for (let i = 0; i < N_TILES; i++) if (Math.hypot(i % GRID - tile % GRID, Math.floor(i / GRID) - Math.floor(tile / GRID)) <= 7) {
      this.patrol[i] = 180; this.crime[i] = Math.max(0, this.crime[i] - 65);
    }
  }
  extinguish(tile: number): void { if (this.fires.delete(tile)) this.extinguished++; }
  crash(x: number, z: number, slots: number[], tile: number, y = 0): number {
    const id = this.nextCrash++; this.crashes.set(id, { id, x, z, y, slots, tile, remaining: 35 }); return id;
  }
  /** `risk` carries the city's standing policies: 1 is the untouched rate, lower means fewer incidents. */
  step(kind: Uint8Array, level: Uint8Array, population: number, cityLevel: number, rng: () => number, risk: { fire: number; crime: number }, damage: (tile: number) => void): void {
    const buildings: number[] = [];
    for (let i = 0; i < N_TILES; i++) {
      this.patrol[i] = Math.max(0, this.patrol[i] - 1);
      this.crime[i] = Math.max(0, this.crime[i] - 0.35);
      if (isZone(kind[i]) && level[i]) buildings.push(i);
      else { this.crime[i] = 0; this.fires.delete(i); }
    }
    for (const [id, c] of this.crashes) if (--c.remaining <= 0) this.crashes.delete(id);
    for (const [tile, f] of this.fires) {
      if (++f.age >= 120) { damage(tile); this.damaged++; this.fires.delete(tile); }
    }
    for (const [tile, h] of this.heists) {
      if (kind[tile] !== T_COM && kind[tile] !== T_OFFICE) { this.heists.delete(tile); continue; }
      if (++h.age >= HEIST_LIMIT) { this.robbed++; this.heists.delete(tile); }
    }
    if (!buildings.length || cityLevel < 2) return;
    if (this.fires.size < 3 && rng() < Math.min(0.045, 0.01 + population / 180000) * risk.fire) this.ignite(buildings[Math.floor(rng() * buildings.length)]);
    // A bank job needs somewhere worth robbing and a city big enough to have one.
    if (cityLevel >= 3 && !this.heists.size && rng() < Math.min(0.02, 0.004 + population / 500000) * risk.crime) {
      const tills = buildings.filter(i => kind[i] === T_COM || kind[i] === T_OFFICE);
      if (tills.length) this.rob(tills[Math.floor(rng() * tills.length)]);
    }
    if (rng() < Math.min(0.09, 0.02 + population / 100000) * risk.crime) {
      const tile = buildings[Math.floor(rng() * buildings.length)];
      if (this.patrol[tile] > 0 && rng() < 0.85) this.prevented++;
      else this.crime[tile] = Math.min(100, this.crime[tile] + 50);
    }
  }
  view(): IncidentView {
    return { fires: [...this.fires.values()], heists: [...this.heists.values()].map(h => ({ ...h })), crashes: [...this.crashes.values()].map(({ id, x, z, y, remaining }) => ({ id, x, z, y, remaining })), crime: Array.from(this.crime, (v, i) => v > 20 ? i : -1).filter(i => i >= 0), patrol: Array.from(this.patrol, (v, i) => v > 165 ? i : -1).filter(i => i >= 0) };
  }
  snapshot(): IncidentSnapshot {
    return { fires: [...this.fires.values()].map(f => ({ ...f })), crime: Array.from(this.crime, (v, i) => [i, Math.round(v)] as [number, number]).filter(([, v]) => v > 0), patrol: Array.from(this.patrol, (v, i) => [i, Math.round(v)] as [number, number]).filter(([, v]) => v > 0) };
  }
  load(snapshot?: IncidentSnapshot): void {
    this.clear(); if (!snapshot) return;
    for (const f of snapshot.fires) this.fires.set(f.tile, { ...f });
    for (const [i, v] of snapshot.crime) this.crime[i] = v;
    for (const [i, v] of snapshot.patrol) this.patrol[i] = v;
  }
}
