import { GRID, N_TILES, idx, inBounds, mulberry32 } from './constants';

export interface RiverPoint { x: number; z: number; w: number } // world tile coords (0..GRID), half width

/** How far past the tile mask the river is actually drawn; RiverLayer uses the same margin. */
export const WATER_EDGE = 0.4;

export interface Terrain {
  seed: number;
  water: Uint8Array; // 1 where the tile is river
  /**
   * 1 where a dry tile still lies under the water as it is drawn. The mask above counts a tile as
   * river only when its centre is inside the channel, while the ribbon reaches WATER_EDGE further
   * and its bank blends further still, so a strip either side looks wet without being river.
   * Nothing may be built there, or the buildings stand in the water.
   */
  shore: Uint8Array;
  /** Index into `river` of the nearest river sample for water tiles, -1 on land. Larger = further downstream. */
  flow: Int16Array;
  river: RiverPoint[];
  /** Highway entry: position on the map edge and the inward unit direction. */
  entry: { x: number; z: number; dx: number; dz: number };
}

const STEP = 0.5;
/** How far in from the map edge the river's source lies. */
export const SOURCE = 10;

/** Everything about the map that comes from the seed alone, so main thread and worker agree. */
export function generateTerrain(seed: number): Terrain {
  // Scramble the seed so neighboring seeds give unrelated maps.
  const rnd = mulberry32(Math.imul((seed || 1) ^ 0x9e3779b9, 0x85ebca6b) >>> 0);
  for (let k = 0; k < 4; k++) rnd();
  const northSouth = rnd() < 0.5;
  const base = GRID * (0.32 + rnd() * 0.36);
  const a1 = 5 + rnd() * 6;
  const a2 = 2 + rnd() * 3;
  const f1 = (Math.PI * 2) / (GRID * (0.7 + rnd() * 0.6));
  const f2 = (Math.PI * 2) / (GRID * (0.25 + rnd() * 0.2));
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const w0 = 1.5 + rnd() * 0.7;
  const wf = (Math.PI * 2) / (GRID * (0.3 + rnd() * 0.3));
  const wp = rnd() * Math.PI * 2;
  const drift = (rnd() - 0.5) * 0.25;

  // The river rises on the map itself, a little way in from one edge, as a stream a cell wide, and
  // gathers width as it runs to the far edge and off it.
  const river: RiverPoint[] = [];
  for (let t = SOURCE; t <= GRID + 4; t += STEP) {
    const off = base + drift * (t - GRID / 2) + a1 * Math.sin(f1 * t + p1) + a2 * Math.sin(f2 * t + p2);
    const full = w0 + 0.5 * Math.sin(wf * t + wp);
    const grown = Math.max(0, Math.min(1, (t - SOURCE) / (GRID * 0.7)));
    // Never thinner than a cell and a half, so the stream's tiles stay joined edge to edge on a diagonal.
    const w = Math.max(0.8, full * (0.3 + 0.7 * grown * grown * (3 - 2 * grown)));
    river.push(northSouth ? { x: off, z: t, w } : { x: t, z: off, w });
  }

  const water = new Uint8Array(N_TILES);
  const flow = new Int16Array(N_TILES).fill(-1);
  const best = new Float32Array(N_TILES).fill(1e9);
  for (let r = 0; r < river.length; r++) {
    const p = river[r];
    const R = p.w;
    const x0 = Math.floor(p.x - R - 1);
    const x1 = Math.ceil(p.x + R + 1);
    const z0 = Math.floor(p.z - R - 1);
    const z1 = Math.ceil(p.z + R + 1);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(x, z)) continue;
        const d = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z);
        const i = idx(x, z);
        if (d < R && d < best[i]) {
          best[i] = d;
          water[i] = 1;
          flow[i] = r;
        }
      }
    }
  }

  // Anything whose tile would sit under the drawn water counts as shore: the tile's near edge has to
  // clear the ribbon, so its centre must be more than half a tile beyond it.
  const shore = new Uint8Array(N_TILES);
  for (const p of river) {
    const R = p.w + WATER_EDGE + 0.5;
    for (let z = Math.floor(p.z - R - 1); z <= Math.ceil(p.z + R + 1); z++) {
      for (let x = Math.floor(p.x - R - 1); x <= Math.ceil(p.x + R + 1); x++) {
        if (!inBounds(x, z)) continue;
        const i = idx(x, z);
        if (!water[i] && Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) < R) shore[i] = 1;
      }
    }
  }

  // Highway entry on an edge the river does not cross, on the roomier side of it.
  const mid = GRID / 2;
  const lowSide = base > mid; // more land on the low-coordinate side
  let along = Math.round(mid + (rnd() - 0.5) * GRID * 0.4);
  const stub = 7;
  const clear = (a: number): boolean => {
    for (let s = 0; s <= stub + 2; s++) {
      for (let o = -2; o <= 2; o++) {
        const e = lowSide ? s : GRID - 1 - s;
        const x = northSouth ? e : Math.floor(a) + o;
        const z = northSouth ? Math.floor(a) + o : e;
        if (inBounds(x, z) && water[idx(x, z)]) return false;
      }
    }
    return true;
  };
  for (let tries = 0; tries < GRID && !clear(along); tries++) {
    along = ((along + 7) % (GRID - 16)) + 8;
    along = Math.round(along);
  }
  const edge = lowSide ? 0 : GRID;
  const dir = lowSide ? 1 : -1;
  // The highway runs down the middle of a tile column, like every other road.
  const lane = Math.floor(along) + 0.5;
  const entry = northSouth
    ? { x: edge, z: lane, dx: dir, dz: 0 }
    : { x: lane, z: edge, dx: 0, dz: dir };

  return { seed, water, shore, flow, river, entry };
}

/** Is any of the 4 neighbors of tile (x,z) water? */
export function touchesWater(t: Terrain, x: number, z: number): boolean {
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (inBounds(x + dx, z + dz) && t.water[idx(x + dx, z + dz)]) return true;
  }
  return false;
}

/** Flow index of the water next to a tile (max = furthest downstream), or -1. */
export function adjacentFlow(t: Terrain, x: number, z: number): number {
  let f = -1;
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    if (inBounds(x + dx, z + dz)) f = Math.max(f, t.flow[idx(x + dx, z + dz)]);
  }
  return f;
}
