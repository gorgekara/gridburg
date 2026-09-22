import { GRID, N_TILES, SERVICES, FLOOD_BARRIER_RADIUS } from '../constants';
import type { Terrain } from '../terrain';
import { DUG, FILLED, hillLevel, HILL_STEP } from '../extras';

/**
 * Water as a height field over the tile grid. The river enters at one map edge as a steady flow and
 * leaves at the other, running down a bed that falls gently from inlet to outlet. Every step each
 * tile passes water to lower-surfaced neighbours, so the river settles a little below its banks and
 * stays there; dam it and the water gathers behind the dam, climbs the banks and spreads over the
 * land until it finds another way down, and drains again when the dam comes out. Ground the player
 * raises stands in the water's way like anything else, and a flood barrier lifts the ground it guards.
 */

/** How far below the bank the water normally stands at the inlet. */
export const RIVER_MARGIN = 0.25;
/** How far the normal surface (and the bed under it) drops from inlet to outlet. */
export const RIVER_FALL = 1.0;
/** Depth of the river at its normal level. */
export const RIVER_DEPTH = 1.2;
/** Depth of a pond the player digs. */
export const POND_DEPTH = 0.7;
/** How high a flood barrier's ground stands above the bank. */
export const BARRIER_HEIGHT = 0.6;
/** Water this deep over dry land counts as a flood: buildings suffer and nothing can be built. */
export const FLOOD_DEPTH = 0.08;
/** Water shallower than this is not worth drawing. */
export const VISIBLE_DEPTH = 0.03;
/** Steps a second the simulation is meant to run at: water moves quicker than the city's clock, so a dam tells within minutes. */
export const WATER_HZ = 180;
/** Share of a surface difference that crosses between two tiles in one step: a quarter, one for each neighbour, keeps it stable. */
const FLOW = 0.25;
/** Water shallower than this flows more slowly, like a film creeping over grass rather than a channel. */
const SHALLOW = 0.6;
/** How much floodwater soaks into dry land each step: enough to dry a film in under a minute, too little to drink a flood. */
const SOAK = 0.000004;

export class WaterSim {
  /** Ground height per tile: 0 on the bank, below it in the river bed, above it on hills. */
  readonly ground = new Float32Array(N_TILES);
  /** Water standing on each tile. */
  readonly depth = new Float32Array(N_TILES);
  /** 1 where dry land is under floodwater. */
  readonly flooded = new Uint8Array(N_TILES);
  /** The normal surface height of the river at each river tile, for drawing and for judging a rise. */
  readonly normal = new Float32Array(N_TILES);
  /** Multiplies the inflow: a storm upstream is a surge above 1. */
  surge = 1;
  /** Land tiles the river has climbed onto, counted after each step. */
  floodedCount = 0;
  private inlet: number[] = [];
  private outlet: number[] = [];
  private drains: number[] = [];
  /** Steady inflow per step: what the bed's fall carries at the normal depth. */
  private inflow = 0;
  private delta = new Float32Array(N_TILES);
  /** Which tiles are dry land as the map was made (not river, not dug), where floodwater soaks away. */
  private land = new Uint8Array(N_TILES);

  readonly base: Terrain;

  constructor(base: Terrain, edits?: Uint8Array, kind?: Uint8Array) {
    this.base = base;
    let lo = Infinity, hi = -Infinity, tiles = 0;
    for (let i = 0; i < N_TILES; i++) if (base.water[i]) { lo = Math.min(lo, base.flow[i]); hi = Math.max(hi, base.flow[i]); tiles++; }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < N_TILES; i++) {
      if (!base.water[i]) continue;
      this.normal[i] = -RIVER_MARGIN - RIVER_FALL * (base.flow[i] - lo) / span;
      const x = i % GRID, z = Math.floor(i / GRID);
      if (x === 0 || z === 0 || x === GRID - 1 || z === GRID - 1) ((base.flow[i] - lo) / span < 0.5 ? this.inlet : this.outlet).push(i);
    }
    // Dry land along the map edge lets floodwater run off the map, except right beside the river's
    // own ends, where it would bleed the river away.
    const mouths = [...this.inlet, ...this.outlet];
    for (let i = 0; i < N_TILES; i++) {
      const x = i % GRID, z = Math.floor(i / GRID);
      if (base.water[i] || (x > 0 && z > 0 && x < GRID - 1 && z < GRID - 1)) continue;
      if (!mouths.some(m => Math.abs(m % GRID - x) + Math.abs(Math.floor(m / GRID) - z) <= 3)) this.drains.push(i);
    }
    // The river is `length` tiles long and `width` wide: the flow its fall drives at the normal depth,
    // less a little for the bends and narrows the straight sum ignores.
    const length = span * 0.5, width = tiles / Math.max(1, length);
    this.inflow = 0.5 * FLOW * (RIVER_FALL / Math.max(1, length)) * width;
    this.reshape(edits ?? new Uint8Array(N_TILES), kind);
    // Start with the river at its normal level, so nothing has to fill up first.
    for (let i = 0; i < N_TILES; i++) this.depth[i] = base.water[i] && !this.land[i] ? Math.max(0, this.normal[i] - this.ground[i]) : 0;
  }

  /** The ground as the player has shaped it: dug ponds, filled banks, hills, and barrier levees. */
  reshape(edits: Uint8Array, kind?: Uint8Array): void {
    const base = this.base;
    for (let i = 0; i < N_TILES; i++) {
      const hill = hillLevel(edits[i]);
      this.ground[i] = hill > 0 ? hill * HILL_STEP : edits[i] === DUG ? -POND_DEPTH : edits[i] === FILLED || !base.water[i] ? 0 : this.normal[i] - RIVER_DEPTH;
      this.land[i] = (!base.water[i] && edits[i] !== DUG) || hill > 0 || edits[i] === FILLED ? 1 : 0;
    }
    if (kind) {
      const r = FLOOD_BARRIER_RADIUS;
      for (let b = 0; b < N_TILES; b++) {
        if (!SERVICES[kind[b]]?.barrier) continue;
        const bx = b % GRID, bz = Math.floor(b / GRID);
        for (let z = Math.max(0, bz - r); z <= Math.min(GRID - 1, bz + r); z++) for (let x = Math.max(0, bx - r); x <= Math.min(GRID - 1, bx + r); x++) {
          const i = z * GRID + x;
          if (this.land[i] && (x - bx) ** 2 + (z - bz) ** 2 <= r * r) this.ground[i] = Math.max(this.ground[i], BARRIER_HEIGHT);
        }
      }
    }
    // Water cannot stand inside ground that has just been raised through it.
    for (let i = 0; i < N_TILES; i++) if (this.ground[i] >= 0 && this.land[i] && this.depth[i] > 0 && hillLevel(edits[i]) > 0) this.depth[i] = 0;
  }

  /** Water surface height of a tile. */
  surface(i: number): number { return this.ground[i] + this.depth[i]; }

  /** Advance one step of WATER_HZ; `scale` runs it faster or slower. */
  step(scale = 1): void {
    const { ground, depth, delta, land } = this;
    delta.fill(0);
    const k = FLOW * scale;
    const exchange = (i: number, j: number): void => {
      const si = ground[i] + depth[i], sj = ground[j] + depth[j];
      if (si === sj) return;
      const from = si > sj ? i : j, to = from === i ? j : i;
      const d = Math.abs(si - sj);
      // Move a share of the difference, far less for a thin film (so a river cannot slip round a dam
      // as a trickle over the grass, but has to pile up into a real flood first), never past the
      // point where the two surfaces meet, and never more than a quarter of what the tile holds.
      const shallow = Math.min(1, depth[from] / SHALLOW);
      const amount = Math.min(k * d * shallow * shallow, d / 2, depth[from] / 4);
      if (amount <= 0) return;
      delta[from] -= amount; delta[to] += amount;
    };
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const i = z * GRID + x;
      if (x + 1 < GRID) exchange(i, i + 1);
      if (z + 1 < GRID) exchange(i, i + GRID);
    }
    const soak = SOAK * scale;
    for (let i = 0; i < N_TILES; i++) {
      let w = depth[i] + delta[i];
      if (land[i] && w > 0) w -= soak;
      depth[i] = w > 0 ? w : 0;
    }
    // The river arrives at the inlet and leaves at the outlet, and anything reaching the edge runs off the map.
    const feed = this.inflow * this.surge * scale / Math.max(1, this.inlet.length);
    for (const i of this.inlet) depth[i] += feed;
    for (const i of this.outlet) depth[i] = Math.max(0, this.normal[i] - ground[i]);
    for (const i of this.drains) depth[i] = 0;
    let count = 0;
    for (let i = 0; i < N_TILES; i++) {
      const f = land[i] && depth[i] > FLOOD_DEPTH ? 1 : 0;
      this.flooded[i] = f; count += f;
    }
    this.floodedCount = count;
  }

  /**
   * The surface to draw: the water's height wherever it stands on land or above the river's own
   * drawn level, NaN elsewhere. The river as normally drawn already covers its channel.
   */
  visible(out = new Float32Array(N_TILES)): Float32Array {
    for (let i = 0; i < N_TILES; i++) {
      const d = this.depth[i];
      const show = this.land[i] ? d > VISIBLE_DEPTH : this.ground[i] + d > 0.02 || (this.base.water[i] ? false : d > VISIBLE_DEPTH);
      out[i] = show ? this.ground[i] + d : NaN;
    }
    return out;
  }
}
