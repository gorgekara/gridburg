import { GRID, N_TILES, SERVICES, FLOOD_BARRIER_RADIUS } from '../constants';
import type { Terrain } from '../terrain';
import { FILLED, hillLevel, digLevel, digDepth, HILL_STEP } from '../extras';

/**
 * Water as a height field over the tile grid. The river enters at one map edge as a steady flow and
 * leaves at the other, running down a bed that falls gently from inlet to outlet. Every step each
 * tile passes water to lower-surfaced neighbours, so the river settles a little below its banks and
 * stays there; dam it and the water gathers behind the dam, climbs the banks and spreads over the
 * land until it finds another way down, and drains again when the dam comes out. Ground the player
 * raises stands in the water's way like anything else, and a flood barrier lifts the ground it guards.
 * Dug ground lies below the river, so a channel cut from the bank carries the river wherever it is
 * led, and groundwater fills any basin dug on its own into a lake.
 */

/** How far below the bank the water normally stands at the inlet. */
export const RIVER_MARGIN = 0.25;
/** How far the normal surface (and the bed under it) drops from inlet to outlet. */
export const RIVER_FALL = 0.7;
/** Depth of the river at its normal level. */
export const RIVER_DEPTH = 1.2;
/** The shallowest dig lies below the river's lowest level, so a channel cut from the river carries it anywhere. */
export const POND_DEPTH = digDepth(1);
/** Where groundwater stands: dug ground fills to this level on its own, so a basin becomes a lake. */
export const WATER_TABLE = -0.35;
/** How fast groundwater seeps into dug ground each step: a basin fills in under a minute, a long channel gains little. */
const SEEP = 0.00003;
/** A dug channel that reaches the map edge spills over it like a weir: this much of its depth squared leaves each step. */
const WEIR = 0.004 / (2 * 0.9 * 0.9);
/** How high a flood barrier's ground stands above the bank. */
export const BARRIER_HEIGHT = 0.6;
/** Water this deep over dry land counts as a flood: buildings suffer and nothing can be built. */
export const FLOOD_DEPTH = 0.08;
/** Water shallower than this is not worth drawing. */
export const VISIBLE_DEPTH = 0.03;
/** The share of the river's course over which it gathers its water, from a trickle at the head to its full flow. */
const GATHER = 0.7;
/** Steps a second the simulation is meant to run at: water moves quicker than the city's clock, so a dam tells within minutes. */
export const WATER_HZ = 720;
/** Share of a surface difference that crosses between two tiles in one step: a quarter, one for each neighbour, keeps it stable. */
const FLOW = 0.25;
/** Water shallower than this flows more slowly, like a film creeping over grass rather than a channel. */
const SHALLOW = 0.9;
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
  /** How far below its normal surface the river bed lies at each river tile. */
  readonly bedDepth = new Float32Array(N_TILES);
  /** Multiplies the inflow: a storm upstream is a surge above 1. */
  surge = 1;
  /** Land tiles the river has climbed onto, counted after each step. */
  floodedCount = 0;
  /** Where the river gathers its water: every tile along its growing upper course, a little each. */
  private inlet: number[] = [];
  /** The river's head, where it rises. */
  private head: number[] = [];
  private outlet: number[] = [];
  /** Tiles the player has dug out, which groundwater fills. */
  private dug: number[] = [];
  /** Per outlet tile: how much leaves each step per unit of depth squared, set so the normal depth carries the normal flow. */
  private outflow: number[] = [];
  private drains: number[] = [];
  /** Dug ground on the map edge: water leaves over it like a weir rather than vanishing. */
  private weirs: number[] = [];
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
    // The river gathers its water along the first part of its course, so it carries little near
    // the head and its surface falls slowly there, then steadily once it is full grown.
    const gathered = (p: number): number => (p <= GATHER ? p * p / (2 * GATHER) : GATHER / 2 + (p - GATHER)) / (1 - GATHER / 2);
    for (let i = 0; i < N_TILES; i++) {
      if (!base.water[i]) continue;
      const progress = (base.flow[i] - lo) / span;
      this.normal[i] = -RIVER_MARGIN - RIVER_FALL * gathered(progress);
      // The bed is shallow at the source and deepens downstream with the river's width.
      this.bedDepth[i] = RIVER_DEPTH * (0.4 + 0.6 * Math.min(1, progress * 1.6));
      const x = i % GRID, z = Math.floor(i / GRID);
      // The river gathers along its upper course, from a trickle at the head, so it builds up as it
      // goes; it leaves where it reaches the map edge.
      if (base.flow[i] <= lo + 2) this.head.push(i);
      if (progress > 0.03 && progress <= GATHER) this.inlet.push(i);
      if ((x === 0 || z === 0 || x === GRID - 1 || z === GRID - 1) && progress > 0.5) this.outlet.push(i);
    }
    // Dry land along the map edge lets floodwater run off the map, except right beside the river's
    // own ends, where it would bleed the river away.
    const mouths = [...this.head, ...this.outlet];
    for (let i = 0; i < N_TILES; i++) {
      const x = i % GRID, z = Math.floor(i / GRID);
      if (base.water[i] || (x > 0 && z > 0 && x < GRID - 1 && z < GRID - 1)) continue;
      if (!mouths.some(m => Math.abs(m % GRID - x) + Math.abs(Math.floor(m / GRID) - z) <= 3)) this.drains.push(i);
    }
    // The river is `length` tiles long and `width` wide: the flow its fall drives at the normal depth.
    const length = span * 0.5, width = tiles / Math.max(1, length);
    this.inflow = FLOW * (RIVER_FALL / Math.max(1, length)) * width;
    // The outlet is a weir: what leaves grows with the square of the depth, so a swollen river
    // stands a little higher there, and a river cut off upstream runs itself dry.
    this.outflow = this.outlet.map(i => this.inflow / Math.max(1, this.outlet.length) / (this.bedDepth[i] * this.bedDepth[i]));
    this.reshape(edits ?? new Uint8Array(N_TILES), kind);
    // Start with the river at its normal level, so nothing has to fill up first.
    for (let i = 0; i < N_TILES; i++) this.depth[i] = base.water[i] && !this.land[i] ? Math.max(0, this.normal[i] - this.ground[i]) : 0;
  }

  /** The ground as the player has shaped it: dug ponds, filled banks, hills, and barrier levees. */
  reshape(edits: Uint8Array, kind?: Uint8Array): void {
    const base = this.base;
    this.weirs = [];
    this.dug = [];
    for (let i = 0; i < N_TILES; i++) {
      const hill = hillLevel(edits[i]), dig = digLevel(edits[i]);
      if (dig > 0 && !base.water[i]) this.dug.push(i);
      // Digging the river bed deepens the channel under its water; digging land opens a basin.
      this.ground[i] = hill > 0 ? hill * HILL_STEP : dig > 0 ? (base.water[i] ? this.normal[i] - this.bedDepth[i] - 0.9 * dig : -digDepth(dig)) : edits[i] === FILLED || !base.water[i] ? 0 : this.normal[i] - this.bedDepth[i];
      this.land[i] = (!base.water[i] && dig === 0) || hill > 0 || edits[i] === FILLED ? 1 : 0;
      const x = i % GRID, z = Math.floor(i / GRID);
      // The outermost ring cannot be dug, so dug ground beside it is where a channel meets the edge.
      if (dig > 0 && !base.water[i] && (x <= 1 || z <= 1 || x >= GRID - 2 || z >= GRID - 2)) this.weirs.push(i);
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

  /** How deep the bed lies where the river enters the map and where it leaves, for carrying the channel on beyond it. */
  edgeGround(): { before: number; after: number } {
    const mean = (tiles: number[]): number => tiles.length ? tiles.reduce((s, i) => s + this.ground[i], 0) / tiles.length : -RIVER_MARGIN - RIVER_DEPTH;
    return { before: mean(this.head), after: mean(this.outlet) };
  }

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
      // Move a share of the difference, far less for a thin film over land (so a river cannot slip
      // round a dam as a trickle over the grass, but has to pile up into a real flood first; a
      // stream in its own bed runs freely however shallow), never past the point where the two
      // surfaces meet, and never more than a quarter of what the tile holds.
      const shallow = land[from] ? Math.min(1, depth[from] / SHALLOW) : 1;
      const amount = Math.min(k * d * shallow * shallow * shallow, d / 2, depth[from] / 4);
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
    // Only the river bed gathers water: ground raised or filled in its course takes none.
    let open = 0;
    for (const i of this.inlet) if (!land[i]) open++;
    const feed = this.inflow * this.surge * scale / Math.max(1, open);
    for (const i of this.inlet) if (!land[i]) depth[i] += feed;
    // Groundwater rises into anything dug below the water table, until it stands there as a lake.
    const seep = SEEP * scale;
    for (const i of this.dug) if (ground[i] + depth[i] < WATER_TABLE) depth[i] = Math.min(WATER_TABLE - ground[i], depth[i] + seep);
    this.outlet.forEach((i, k) => { depth[i] = Math.max(0, depth[i] - this.outflow[k] * depth[i] * depth[i] * scale); });
    for (const i of this.drains) if (land[i]) depth[i] = 0;
    for (const i of this.weirs) depth[i] = Math.max(0, depth[i] - WEIR * depth[i] * depth[i] * scale);
    let count = 0;
    for (let i = 0; i < N_TILES; i++) {
      const f = land[i] && depth[i] > FLOOD_DEPTH ? 1 : 0;
      this.flooded[i] = f; count += f;
    }
    this.floodedCount = count;
  }

  /**
   * The water as the renderer wants it: the surface height of every tile that holds water worth
   * drawing (the whole river, and land or ponds under more than a film), NaN elsewhere.
   */
  frame(out = new Float32Array(N_TILES)): Float32Array {
    for (let i = 0; i < N_TILES; i++) {
      const d = this.depth[i];
      out[i] = (this.base.water[i] && !this.land[i]) || d > VISIBLE_DEPTH ? this.ground[i] + d : NaN;
    }
    return out;
  }
}
