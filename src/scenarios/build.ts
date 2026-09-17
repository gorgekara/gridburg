import { GRID, N_TILES, idx, isService, isZone } from '../constants';
import { Network, KIND_AVENUE } from '../roads/network';
import { rasterize } from '../roads/raster';
import { generateTerrain } from '../terrain';
import type { Terrain } from '../terrain';
import type { SaveData } from '../save';

/**
 * Scenarios are authored in the highway's frame rather than in map coordinates: `along` counts
 * tiles inward from the entry and `side` counts tiles across it. A level laid out this way lands
 * the same way up whichever edge the seed put the highway on.
 */
export interface Point { x: number; z: number }

export class Site {
  readonly terrain: Terrain;
  readonly net = new Network();
  /** Money the city should start with. The playtest harness spends from it; the game sets the budget. */
  budgetLeft = 0;
  readonly kind = new Uint8Array(N_TILES);
  readonly level = new Uint8Array(N_TILES);
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    this.terrain = generateTerrain(seed);
    // The highway stub: one fixed avenue in from the edge, exactly as a fresh city starts.
    const e = this.terrain.entry;
    const a = this.net.addNode(e.x, e.z);
    a.entry = true;
    a.fixed = true;
    const b = this.net.addNode(
      Math.max(1, Math.min(GRID - 1, e.x + e.dx * 7)),
      Math.max(1, Math.min(GRID - 1, e.z + e.dz * 7)),
    );
    b.fixed = true;
    this.net.addSeg(a.id, b.id, (a.x + b.x) / 2, (a.z + b.z) / 2, KIND_AVENUE, false, true);
  }

  /** A point `along` tiles in from the highway and `side` tiles across it, kept on the map. */
  at(along: number, side: number): Point {
    const e = this.terrain.entry;
    return {
      x: Math.max(1.2, Math.min(GRID - 1.2, e.x + e.dx * along - e.dz * side)),
      z: Math.max(1.2, Math.min(GRID - 1.2, e.z + e.dz * along + e.dx * side)),
    };
  }

  /** Where a tile sits in the highway's frame. */
  frameOf(i: number): { along: number; side: number } {
    const e = this.terrain.entry;
    const px = (i % GRID) + 0.5 - e.x;
    const pz = ((i / GRID) | 0) + 0.5 - e.z;
    return { along: px * e.dx + pz * e.dz, side: -px * e.dz + pz * e.dx };
  }

  /** Lay a street through the given frame points. */
  road(points: [number, number][], kind: number, oneway = false): this {
    this.net.insertPath(points.map(([a, s]) => this.at(a, s)), kind, oneway);
    return this;
  }

  /** Put a signal on the junction nearest a frame point. */
  signal(along: number, side: number): this {
    const p = this.at(along, side);
    const n = this.net.nearestNode(p.x, p.z, 1.2);
    if (n && this.net.degree(n.id) >= 3) n.light = true;
    return this;
  }

  /**
   * Fill a frame rectangle with standing buildings of one kind and level. Only tiles that are dry,
   * unpaved and within reach of a street take a building, so a district follows its own streets.
   */
  district(kind: number, level: number, along: [number, number], side: [number, number]): this {
    const ras = rasterize(this.net);
    for (let i = 0; i < N_TILES; i++) {
      if (this.terrain.water[i] || ras.cover[i] || ras.accSeg[i] < 0) continue;
      if (this.kind[i] !== 0) continue;
      const f = this.frameOf(i);
      if (f.along < along[0] || f.along > along[1] || f.side < side[0] || f.side > side[1]) continue;
      this.kind[i] = kind;
      this.level[i] = level;
    }
    return this;
  }

  /** Clear buildings from a frame rectangle, to open up a park or a gap. */
  clear(along: [number, number], side: [number, number]): this {
    for (let i = 0; i < N_TILES; i++) {
      const f = this.frameOf(i);
      if (f.along < along[0] || f.along > along[1] || f.side < side[0] || f.side > side[1]) continue;
      this.kind[i] = 0;
      this.level[i] = 0;
    }
    return this;
  }

  /** How many building tiles the site ended up with, for sanity-checking a level. */
  count(kind: number): number {
    let n = 0;
    for (let i = 0; i < N_TILES; i++) if (this.kind[i] === kind) n++;
    return n;
  }

  /** The finished city, with the scenario's budget as its money. */
  toSave(budget: number): SaveData {
    // Streets laid after a district was filled can pave over its buildings.
    const ras = rasterize(this.net);
    for (let i = 0; i < N_TILES; i++) {
      if (ras.cover[i] && (isZone(this.kind[i]) || isService(this.kind[i]))) {
        this.kind[i] = 0;
        this.level[i] = 0;
      }
    }
    return {
      seed: this.seed, kind: this.kind, level: this.level, net: this.net.toPlain(),
      money: budget, tick: 0, tax: 10,
    };
  }
}

/** Is every tile of a frame rectangle dry land? Used to pick seeds whose river stays out of the way. */
export function isDry(terrain: Terrain, along: [number, number], side: [number, number]): boolean {
  const e = terrain.entry;
  for (let a = along[0]; a <= along[1]; a += 0.5) {
    for (let s = side[0]; s <= side[1]; s += 0.5) {
      const x = Math.floor(e.x + e.dx * a - e.dz * s);
      const z = Math.floor(e.z + e.dz * a + e.dx * s);
      if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
      if (terrain.water[idx(x, z)]) return false;
    }
  }
  return true;
}

/** How far in from the highway the river crosses the middle of the corridor, or -1 if it does not. */
export function riverAlong(terrain: Terrain, side = 0): number {
  const e = terrain.entry;
  for (let a = 4; a < GRID; a += 0.25) {
    const x = Math.floor(e.x + e.dx * a - e.dz * side);
    const z = Math.floor(e.z + e.dz * a + e.dx * side);
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return -1;
    if (terrain.water[idx(x, z)]) return a;
  }
  return -1;
}

/** Width of the river across the corridor at `side`, in tiles. */
export function riverWidth(terrain: Terrain, side = 0): number {
  const e = terrain.entry;
  let n = 0;
  for (let a = 4; a < GRID; a += 0.25) {
    const x = Math.floor(e.x + e.dx * a - e.dz * side);
    const z = Math.floor(e.z + e.dz * a + e.dx * side);
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) break;
    if (terrain.water[idx(x, z)]) n++;
  }
  return n * 0.25;
}
