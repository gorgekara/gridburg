import { GRID, N_TILES, idx, inBounds, mulberry32 } from './constants';

export interface RiverPoint { x: number; z: number; w: number } // world tile coords (0..GRID), half width

/** The shape of the map the player picked before founding the city. */
export type MapType = 'river' | 'islands' | 'seaport' | 'lakes';

export const MAP_TYPES: { id: MapType; name: string; blurb: string }[] = [
  { id: 'river', name: 'River valley', blurb: 'A winding river splits a wide green valley.' },
  { id: 'islands', name: 'Island chain', blurb: 'Lobed islands joined by sandbars, with a strait offshore.' },
  { id: 'seaport', name: 'Sea port', blurb: 'Open sea along one coast, with a sheltered bay.' },
  { id: 'lakes', name: 'Lake district', blurb: 'Rolling land dotted with lakes on a single stream.' },
];

export interface Terrain {
  seed: number;
  /** Which map type produced this terrain. */
  type: MapType;
  water: Uint8Array; // 1 where the tile is water: river, sea or lake
  /** Index into `river` of the nearest river sample for water tiles, -1 on land. Larger = further downstream. */
  flow: Int16Array;
  /** The flow channel as an ordered polyline. Never empty: open water bodies live in `water` alone. */
  river: RiverPoint[];
  /** Highway entry: position on the map edge and the inward unit direction. */
  entry: { x: number; z: number; dx: number; dz: number };
}

const STEP = 0.5;
const STUB = 7; // dry cells the highway needs ahead of the entry
const ISLET = 60; // sizable enough that a sandbar should reach it
const SCENERY = 150; // unreachable land this small is scenery, not a marooned town
const SCENERY_BUDGET = 300; // ...and only this many tiles of it in total
const DIRS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// River keeps salt 0: its maps must not move.
const TYPE_SALT: Record<MapType, number> = { river: 0, islands: 0x5bf03635, seaport: 0x27d4eb2f, lakes: 0x165667b1 };

/** Deterministic from the seed and the map type together, so main thread and worker agree. */
function stream(seed: number, type: MapType): () => number {
  // Scramble the seed so neighboring seeds give unrelated maps, and each type its own map.
  const rnd = mulberry32((Math.imul((seed || 1) ^ 0x9e3779b9, 0x85ebca6b) ^ (TYPE_SALT[type] ?? 0)) >>> 0);
  for (let k = 0; k < 4; k++) rnd();
  return rnd;
}

/** Everything about the map that comes from the seed and type alone. */
export function generateTerrain(seed: number, type: MapType = 'river'): Terrain {
  const rnd = stream(seed, type);
  if (type === 'river') return riverValley(seed, rnd);
  const plan = type === 'islands' ? islandPlan(rnd) : type === 'seaport' ? seaportPlan(rnd) : lakePlan(rnd);
  return shapeMap(seed, type, rnd, plan);
}

// ---------------------------------------------------------------- river valley

function riverValley(seed: number, rnd: () => number): Terrain {
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

  const river: RiverPoint[] = [];
  for (let t = -4; t <= GRID + 4; t += STEP) {
    const off = base + drift * (t - GRID / 2) + a1 * Math.sin(f1 * t + p1) + a2 * Math.sin(f2 * t + p2);
    const w = w0 + 0.5 * Math.sin(wf * t + wp);
    river.push(point(northSouth, t, off, w));
  }

  const water = new Uint8Array(N_TILES);
  const flow = new Int16Array(N_TILES).fill(-1);
  carve(river, water, flow);

  // Highway entry on an edge the river does not cross, on the roomier side of it.
  const mid = GRID / 2;
  const lowSide = base > mid; // more land on the low-coordinate side
  const side = (northSouth ? 0 : 2) + (lowSide ? 0 : 1);
  let along = Math.round(mid + (rnd() - 0.5) * GRID * 0.4);
  for (let tries = 0; tries < GRID && !clearApproach(water, side, along); tries++) {
    along = ((along + 7) % (GRID - 16)) + 8;
    along = Math.round(along);
  }
  return { seed, type: 'river', water, flow, river, entry: entryAt(side, along) };
}

// ------------------------------------------------------------- shaped maps

/** One attempt at a map. `push` moves land against water: positive means more land. */
interface Plan {
  lay(push: number): { water: Uint8Array; flow: Int16Array; river: RiverPoint[] };
  lo: number; // smallest acceptable dry fraction
  hi: number; // largest acceptable dry fraction
  step: number;
}

const MIN_MAIN = 0.42; // the region reachable from the entry, as a fraction of the map

/**
 * Lay the map out, then nudge the land/water balance until the result is playable:
 * enough dry ground, one big region behind the highway entry and no marooned towns.
 */
function shapeMap(seed: number, type: MapType, rnd: () => number, plan: Plan): Terrain {
  let best: Terrain | null = null;
  let bestMain = -1;
  let push = 0;
  for (let attempt = 0; attempt < 16; attempt++) {
    const { water, flow, river } = plan.lay(push);
    knit(water, flow);
    landfall(water, flow);
    const entry = pickEntry(water, rnd);
    trimIslets(water, entry);
    const dry = N_TILES - count(water);
    const main = floodLand(water, entryTile(entry)).count;
    const terrain: Terrain = { seed, type, water, flow, river, entry };
    if (dry >= plan.lo * N_TILES && dry <= plan.hi * N_TILES && main >= MIN_MAIN * N_TILES) {
      fillFlow(water, flow, river);
      return terrain;
    }
    if (main > bestMain) { best = terrain; bestMain = main; }
    // Too little dry ground, or too little of it behind the entry, both call for more land.
    push += dry < plan.lo * N_TILES || main < MIN_MAIN * N_TILES ? plan.step : -plan.step;
  }
  const fallback = best as Terrain;
  fillFlow(fallback.water, fallback.flow, fallback.river);
  return fallback;
}

// ------------------------------------------------------------------ islands

/** A scatter of big lobed islands along one side of a strait, joined where they touch. */
function islandPlan(rnd: () => number): Plan {
  const northSouth = rnd() < 0.5;
  const near = rnd() < 0.5;
  const chanBase = near ? GRID * (0.12 + rnd() * 0.1) : GRID * (1 - 0.12 - rnd() * 0.1);
  const dirMain = chanBase < GRID / 2 ? 1 : -1;
  const drift = (rnd() - 0.5) * 0.2;
  const a1 = 3 + rnd() * 4;
  const a2 = 1.5 + rnd() * 2;
  const f1 = (Math.PI * 2) / (GRID * (0.7 + rnd() * 0.6));
  const f2 = (Math.PI * 2) / (GRID * (0.25 + rnd() * 0.2));
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const w0 = 2.1 + rnd() * 1.1;
  const wf = (Math.PI * 2) / (GRID * (0.3 + rnd() * 0.3));
  const wp = rnd() * Math.PI * 2;
  const chan = (t: number): number => chanBase + drift * (t - GRID / 2) + a1 * Math.sin(f1 * t + p1) + a2 * Math.sin(f2 * t + p2);

  const n = 3 + Math.floor(rnd() * 4);
  const cols = Math.ceil(n / 2);
  const seeds: { t: number; frac: number; r: number; k: number[]; p: number[] }[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = (i / cols) | 0;
    const t = (GRID * (col + 0.5 + (rnd() - 0.5) * 0.5)) / cols;
    const frac = (row + 0.32 + rnd() * 0.36) / 2;
    // Fewer islands means bigger ones: the chain should cover about half the map either way.
    seeds.push({ t, frac, r: Math.sqrt(1500 / n) * (0.85 + rnd() * 0.3), k: harmonics(rnd), p: phases(rnd) });
  }
  const islets: { t: number; off: number; r: number; k: number[]; p: number[] }[] = [];
  for (let i = 0, m = 1 + Math.floor(rnd() * 2); i < m; i++) {
    const r = 2.6 + rnd() * 2;
    // Clear of the strait itself, so the channel never chops an islet into crumbs.
    islets.push({ t: GRID * (0.15 + rnd() * 0.7), off: r * 1.3 + 5 + rnd() * 7, r, k: harmonics(rnd), p: phases(rnd) });
  }
  const lagoons: { t: number; frac: number; r: number; k: number[]; p: number[] }[] = [];
  for (let i = 0, m = 2 + Math.floor(rnd() * 3); i < m; i++) {
    lagoons.push({ t: GRID * (0.1 + rnd() * 0.8), frac: 0.15 + rnd() * 0.7, r: 4.5 + rnd() * 4.5, k: harmonics(rnd), p: phases(rnd) });
  }

  return {
    lo: 0.46, hi: 0.62, step: 0.08,
    lay(push) {
      const scale = 1 + push;
      const span = (t: number): number => Math.max(6, (dirMain > 0 ? GRID - chan(t) : chan(t)) - 9);
      const land: Blob[] = seeds.map(s => blob(point(northSouth, s.t, chan(s.t) + dirMain * (7 + s.frac * span(s.t)), 0), s.r * scale, s.k, s.p));
      const offshore: Blob[] = islets.map(s => blob(point(northSouth, s.t, chan(s.t) - dirMain * s.off, 0), s.r, s.k, s.p));
      const sea: Blob[] = lagoons.map(s => blob(point(northSouth, s.t, chan(s.t) + dirMain * (7 + s.frac * span(s.t)), 0), s.r, s.k, s.p));

      // Islands stop at the strait rather than straddling it, so nothing sizable ends up marooned.
      const water = new Uint8Array(N_TILES).fill(1);
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        const t = northSouth ? z + 0.5 : x + 0.5;
        const c = northSouth ? x + 0.5 : z + 0.5;
        const main = dirMain * (c - chan(t)) > 0;
        const dry = main ? land.some(b => inBlob(b, x, z)) && !sea.some(b => inBlob(b, x, z)) : offshore.some(b => inBlob(b, x, z));
        if (dry) water[idx(x, z)] = 0;
      }
      const flow = new Int16Array(N_TILES).fill(-1);
      const river: RiverPoint[] = [];
      for (let t = -4; t <= GRID + 4; t += STEP) river.push(point(northSouth, t, chan(t), w0 + 0.5 * Math.sin(wf * t + wp)));
      carve(river, water, flow);
      return { water, flow, river };
    },
  };
}

// ------------------------------------------------------------------ seaport

/** Open sea down one side behind a ragged coast, a bay cut into it and a shipping channel offshore. */
function seaportPlan(rnd: () => number): Plan {
  const northSouth = rnd() < 0.5;
  const seaHigh = rnd() < 0.5;
  const base = GRID * (0.54 + rnd() * 0.08);
  const a1 = 4 + rnd() * 4;
  const a2 = 2 + rnd() * 2.5;
  const a3 = 1 + rnd() * 1.5;
  const f1 = (Math.PI * 2) / (GRID * (0.8 + rnd() * 0.7));
  const f2 = (Math.PI * 2) / (GRID * (0.3 + rnd() * 0.2));
  const f3 = (Math.PI * 2) / (GRID * (0.15 + rnd() * 0.1));
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const p3 = rnd() * Math.PI * 2;
  const bayT = GRID * (0.2 + rnd() * 0.6);
  const bayR = 7 + rnd() * 4;
  const bayD = bayR * (0.45 + rnd() * 0.35);
  const bayK = harmonics(rnd), bayP = phases(rnd);
  const rocks: { t: number; off: number; r: number; k: number[]; p: number[] }[] = [];
  for (let i = 0, m = 1 + Math.floor(rnd() * 2); i < m; i++) {
    const r = 2.2 + rnd() * 2;
    // Well clear of the shipping channel, so the lane never slices a rock in half.
    rocks.push({ t: GRID * (0.1 + rnd() * 0.8), off: r * 1.3 + 8 + rnd() * 6, r, k: harmonics(rnd), p: phases(rnd) });
  }
  const laneF = (Math.PI * 2) / (GRID * (0.4 + rnd() * 0.4));
  const laneP = rnd() * Math.PI * 2;
  const laneW = 2.2 + rnd() * 0.8;

  return {
    lo: 0.5, hi: 0.66, step: 2,
    lay(push) {
      // u measures distance inland from the sea-side edge of the map; the coast is a wavy line in it.
      const coast = (t: number): number => base + push + a1 * Math.sin(f1 * t + p1) + a2 * Math.sin(f2 * t + p2) + a3 * Math.sin(f3 * t + p3);
      const cross = (u: number): number => (seaHigh ? u : GRID - u);
      const at = (t: number, u: number, w = 0): RiverPoint => point(northSouth, t, cross(u), w);
      const bay = blob(at(bayT, coast(bayT) - bayD), bayR, bayK, bayP);
      const isles: Blob[] = rocks.map(s => blob(at(s.t, coast(s.t) + s.off), s.r, s.k, s.p));

      const water = new Uint8Array(N_TILES);
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        const t = northSouth ? z + 0.5 : x + 0.5;
        const c = northSouth ? x + 0.5 : z + 0.5;
        const u = seaHigh ? c : GRID - c;
        const wet = (u > coast(t) || inBlob(bay, x, z)) && !isles.some(b => inBlob(b, x, z));
        if (wet) water[idx(x, z)] = 1;
      }
      const flow = new Int16Array(N_TILES).fill(-1);
      const river: RiverPoint[] = [];
      for (let t = -4; t <= GRID + 4; t += STEP) {
        // The channel runs offshore and swings into the bay, so the port sits on the current.
        const pull = (bayD + 3) * Math.exp(-(((t - bayT) / (0.5 * bayR)) ** 2));
        const u = coast(t) + 2.8 + 1.1 * Math.sin(laneF * t + laneP) - pull;
        river.push(at(t, u, laneW + 0.4 * Math.sin(laneF * 2 * t + laneP)));
      }
      carve(river, water, flow);
      return { water, flow, river };
    },
  };
}

// -------------------------------------------------------------------- lakes

/** Mostly dry country with a handful of lakes strung along one stream. */
function lakePlan(rnd: () => number): Plan {
  const northSouth = rnd() < 0.5;
  const base = GRID * (0.34 + rnd() * 0.32);
  const drift = (rnd() - 0.5) * 0.2;
  const a1 = 4 + rnd() * 5;
  const a2 = 2 + rnd() * 2;
  const f1 = (Math.PI * 2) / (GRID * (0.7 + rnd() * 0.6));
  const f2 = (Math.PI * 2) / (GRID * (0.25 + rnd() * 0.2));
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const w0 = 1 + rnd() * 0.5;
  const wf = (Math.PI * 2) / (GRID * (0.3 + rnd() * 0.3));
  const wp = rnd() * Math.PI * 2;
  const stem = (t: number): number => base + drift * (t - GRID / 2) + a1 * Math.sin(f1 * t + p1) + a2 * Math.sin(f2 * t + p2);

  const n = 2 + Math.floor(rnd() * 3);
  const lakes: { t: number; off: number; r: number; k: number[]; p: number[] }[] = [];
  for (let i = 0; i < n; i++) {
    const t = GRID * (0.16 + (0.68 * (i + 0.5 + (rnd() - 0.5) * 0.4)) / n);
    lakes.push({ t, off: (rnd() - 0.5) * 7, r: 5.5 + rnd() * 3.5, k: harmonics(rnd), p: phases(rnd) });
  }

  return {
    lo: 0.75, hi: 0.95, step: 0.08,
    lay(push) {
      const scale = 1 + push;
      const bodies: Blob[] = lakes.map(s => blob(point(northSouth, s.t, stem(s.t) + s.off, 0), s.r * scale, s.k, s.p));
      const water = new Uint8Array(N_TILES);
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        if (bodies.some(b => inBlob(b, x, z))) water[idx(x, z)] = 1;
      }
      const flow = new Int16Array(N_TILES).fill(-1);
      const river: RiverPoint[] = [];
      for (let t = -4; t <= GRID + 4; t += STEP) river.push(point(northSouth, t, stem(t), w0 + 0.3 * Math.sin(wf * t + wp)));
      carve(river, water, flow);
      return { water, flow, river };
    },
  };
}

// ------------------------------------------------------------------ shaping

interface Blob { x: number; z: number; r: number; k: number[]; p: number[] }

function harmonics(rnd: () => number): number[] { return [0.14 + rnd() * 0.12, 0.06 + rnd() * 0.1, 0.05 + rnd() * 0.08]; }
function phases(rnd: () => number): number[] { return [rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2]; }

function blob(at: { x: number; z: number }, r: number, k: number[], p: number[]): Blob {
  return { x: at.x, z: at.z, r, k, p };
}

/** A rounded but irregular body, so coastlines never read as circles. */
function inBlob(b: Blob, x: number, z: number): boolean {
  const dx = x + 0.5 - b.x, dz = z + 0.5 - b.z;
  const d = Math.hypot(dx, dz);
  if (d > b.r * 1.5) return false;
  const a = Math.atan2(dz, dx);
  return d < b.r * (1 + b.k[0] * Math.sin(3 * a + b.p[0]) + b.k[1] * Math.sin(5 * a + b.p[1]) + b.k[2] * Math.sin(2 * a + b.p[2]));
}

/** A point on the flow channel: `t` runs along the map, `c` across it. */
function point(northSouth: boolean, t: number, c: number, w = 0): RiverPoint {
  return northSouth ? { x: c, z: t, w } : { x: t, z: c, w };
}

/** Rasterize the flow channel: water, with `flow` pointing at the nearest sample. */
function carve(river: RiverPoint[], water: Uint8Array, flow: Int16Array): void {
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
}

/** Open water away from the channel still drains into it: spread flow indices across the body. */
function fillFlow(water: Uint8Array, flow: Int16Array, river: RiverPoint[]): void {
  const queue = new Int32Array(N_TILES);
  let head = 0, tail = 0;
  for (let i = 0; i < N_TILES; i++) if (water[i] && flow[i] >= 0) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++], x = i % GRID, z = (i / GRID) | 0;
    for (const [dx, dz] of DIRS) {
      if (!inBounds(x + dx, z + dz)) continue;
      const j = idx(x + dx, z + dz);
      if (!water[j] || flow[j] >= 0) continue;
      flow[j] = flow[i];
      queue[tail++] = j;
    }
  }
  // A pond with no outlet still has to pollute somewhere: hand it the closest sample outright.
  for (let i = 0; i < N_TILES; i++) {
    if (!water[i] || flow[i] >= 0) continue;
    const x = (i % GRID) + 0.5, z = ((i / GRID) | 0) + 0.5;
    let near = 0, bestSq = Infinity;
    for (let r = 0; r < river.length; r++) {
      const d = (x - river[r].x) ** 2 + (z - river[r].z) ** 2;
      if (d < bestSq) { bestSq = d; near = r; }
    }
    flow[i] = near;
  }
}

// -------------------------------------------------------------- connectivity

function count(water: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < N_TILES; i++) n += water[i];
  return n;
}

/** Label every connected patch of dry land. */
function labelLand(water: Uint8Array): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(N_TILES).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(N_TILES);
  for (let start = 0; start < N_TILES; start++) {
    if (water[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let head = 0, tail = 0, n = 0;
    queue[tail++] = start; label[start] = id;
    while (head < tail) {
      const i = queue[head++], x = i % GRID, z = (i / GRID) | 0;
      n++;
      for (const [dx, dz] of DIRS) {
        if (!inBounds(x + dx, z + dz)) continue;
        const j = idx(x + dx, z + dz);
        if (water[j] || label[j] >= 0) continue;
        label[j] = id;
        queue[tail++] = j;
      }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

function biggest(sizes: number[]): number {
  let best = -1;
  for (let i = 0; i < sizes.length; i++) if (best < 0 || sizes[i] > sizes[best]) best = i;
  return best;
}

/**
 * Join every sizable island to the mainland with a sandbar. Land the bar cannot reach without
 * damming the flow channel stays put: that is the far bank, which bridges are for.
 */
function knit(water: Uint8Array, flow: Int16Array): void {
  for (let pass = 0; pass < 6; pass++) {
    const { label, sizes } = labelLand(water);
    const main = biggest(sizes);
    let joined = false;
    for (let c = 0; c < sizes.length; c++) {
      if (c === main || sizes[c] < ISLET) continue;
      joined = sandbar(water, flow, label, c, main) || joined;
    }
    if (!joined) return;
  }
}

/** Raise a three-tile-wide bar along the shortest route between two land patches, never damming the channel. */
function sandbar(water: Uint8Array, flow: Int16Array, label: Int32Array, from: number, to: number): boolean {
  const prev = new Int32Array(N_TILES).fill(-2);
  const queue = new Int32Array(N_TILES);
  let head = 0, tail = 0, hit = -1;
  for (let i = 0; i < N_TILES; i++) if (label[i] === from) { prev[i] = -1; queue[tail++] = i; }
  while (head < tail && hit < 0) {
    const i = queue[head++], x = i % GRID, z = (i / GRID) | 0;
    for (const [dx, dz] of DIRS) {
      if (!inBounds(x + dx, z + dz)) continue;
      const j = idx(x + dx, z + dz);
      if (prev[j] !== -2 || flow[j] >= 0) continue;
      prev[j] = i;
      if (label[j] === to) { hit = j; break; }
      queue[tail++] = j;
    }
  }
  if (hit < 0) return false;
  for (let i = hit; i >= 0; i = prev[i]) {
    const x = i % GRID, z = (i / GRID) | 0;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!inBounds(x + ox, z + oz)) continue;
      const j = idx(x + ox, z + oz);
      if (flow[j] < 0) water[j] = 0;
    }
  }
  return true;
}

/** Flood the dry land reachable on foot from a tile. */
function floodLand(water: Uint8Array, start: number): { mask: Uint8Array; count: number } {
  const mask = new Uint8Array(N_TILES);
  if (start < 0 || water[start]) return { mask, count: 0 };
  const queue = new Int32Array(N_TILES);
  let head = 0, tail = 0, n = 0;
  queue[tail++] = start; mask[start] = 1;
  while (head < tail) {
    const i = queue[head++], x = i % GRID, z = (i / GRID) | 0;
    n++;
    for (const [dx, dz] of DIRS) {
      if (!inBounds(x + dx, z + dz)) continue;
      const j = idx(x + dx, z + dz);
      if (water[j] || mask[j]) continue;
      mask[j] = 1;
      queue[tail++] = j;
    }
  }
  return { mask, count: n };
}

/** The first tile inside the map along the highway. */
export function entryTile(entry: Terrain['entry']): number {
  const x = entry.dx ? (entry.dx > 0 ? 0 : GRID - 1) : Math.floor(entry.x);
  const z = entry.dz ? (entry.dz > 0 ? 0 : GRID - 1) : Math.floor(entry.z);
  return inBounds(x, z) ? idx(x, z) : -1;
}

/** The dry land a city can actually build on: everything walkable from the highway entry. */
export function reachableLand(t: Terrain): { mask: Uint8Array; count: number } {
  return floodLand(t.water, entryTile(t.entry));
}

/** Drown scraps of land: islets crowding the highway entry, and any beyond the scenery budget. */
function trimIslets(water: Uint8Array, entry: Terrain['entry']): void {
  const home = entryTile(entry);
  if (home < 0 || water[home]) return;
  const { label, sizes } = labelLand(water);
  const main = label[home];
  const ex = home % GRID, ez = (home / GRID) | 0;
  const near = new Uint8Array(sizes.length);
  for (let i = 0; i < N_TILES; i++) {
    const c = label[i];
    if (c < 0 || c === main || sizes[c] >= SCENERY) continue;
    if (Math.hypot((i % GRID) - ex, ((i / GRID) | 0) - ez) < 14) near[c] = 1;
  }
  let budget = SCENERY_BUDGET;
  const drown = new Uint8Array(sizes.length);
  for (let c = 0; c < sizes.length; c++) {
    if (c === main || sizes[c] >= SCENERY) continue;
    if (near[c] || sizes[c] > budget) drown[c] = 1;
    else budget -= sizes[c];
  }
  for (let i = 0; i < N_TILES; i++) {
    const c = label[i];
    if (c >= 0 && drown[c]) water[i] = 1;
  }
}

// -------------------------------------------------------------------- entry

/** Tile `s` steps in from edge `side` and `o` tiles across from the highway lane, or -1 outside the map. */
function approach(side: number, along: number, s: number, o: number): number {
  const e = side & 1 ? GRID - 1 - s : s;
  const a = Math.floor(along) + o;
  const x = side < 2 ? e : a;
  const z = side < 2 ? a : e;
  return inBounds(x, z) ? idx(x, z) : -1;
}

/** Is the highway stub, and the ground beside it, dry all the way in from the edge? */
function clearApproach(water: Uint8Array, side: number, along: number): boolean {
  for (let s = 0; s <= STUB + 2; s++) {
    for (let o = -2; o <= 2; o++) {
      const i = approach(side, along, s, o);
      if (i >= 0 && water[i]) return false;
    }
  }
  return true;
}

/** Nothing to land on? Reclaim a causeway from the shore to the mainland, short of damming the channel. */
function landfall(water: Uint8Array, flow: Int16Array): void {
  const { label, sizes } = labelLand(water);
  const main = biggest(sizes);
  if (main < 0) return;
  for (let side = 0; side < 4; side++) {
    for (let along = 8; along < GRID - 8; along++) {
      const home = approach(side, along, 0, 0);
      if (home >= 0 && label[home] === main && clearApproach(water, side, along)) return;
    }
  }
  let bestSide = -1, bestAlong = 0, bestDepth = GRID;
  for (let side = 0; side < 4; side++) {
    for (let along = 8; along < GRID - 8; along++) {
      let depth = -1;
      for (let s = 0; s < GRID && depth < 0; s++) {
        const centre = approach(side, along, s, 0);
        if (centre >= 0 && label[centre] === main) { depth = s; break; }
        for (let o = -2; o <= 2; o++) {
          const i = approach(side, along, s, o);
          if (i >= 0 && flow[i] >= 0) { s = GRID; break; } // the channel runs across: try elsewhere
        }
      }
      if (depth >= 0 && depth < bestDepth) { bestDepth = depth; bestSide = side; bestAlong = along; }
    }
  }
  if (bestSide < 0) return;
  for (let s = 0; s <= bestDepth + STUB + 2; s++) {
    for (let o = -2; o <= 2; o++) {
      const i = approach(bestSide, bestAlong, s, o);
      if (i >= 0 && flow[i] < 0) water[i] = 0;
    }
  }
}

/** Sides 0..3: low x, high x, low z, high z. The highway runs down the middle of a tile column. */
function entryAt(side: number, along: number): Terrain['entry'] {
  const low = !(side & 1);
  const edge = low ? 0 : GRID;
  const dir = low ? 1 : -1;
  const lane = Math.floor(along) + 0.5;
  return side < 2 ? { x: edge, z: lane, dx: dir, dz: 0 } : { x: lane, z: edge, dx: 0, dz: dir };
}

/** The first dry approach onto the mainland, searched from a seeded corner of the map. */
function pickEntry(water: Uint8Array, rnd: () => number): Terrain['entry'] {
  const { label, sizes } = labelLand(water);
  const main = biggest(sizes);
  const first = Math.floor(rnd() * 4);
  const offset = Math.floor(rnd() * GRID);
  let fallback: Terrain['entry'] | null = null;
  for (let s = 0; s < 4; s++) {
    const side = (first + s) % 4;
    for (let k = 0; k < GRID - 16; k++) {
      const along = 8 + ((offset + k * 7) % (GRID - 16));
      if (!clearApproach(water, side, along)) continue;
      const entry = entryAt(side, along);
      if (!fallback) fallback = entry;
      const home = entryTile(entry);
      if (home >= 0 && label[home] === main) return entry;
    }
  }
  return fallback ?? entryAt(0, GRID / 2);
}

/** Is any of the 4 neighbors of tile (x,z) water? */
export function touchesWater(t: Terrain, x: number, z: number): boolean {
  for (const [dx, dz] of DIRS) {
    if (inBounds(x + dx, z + dz) && t.water[idx(x + dx, z + dz)]) return true;
  }
  return false;
}

/** Flow index of the water next to a tile (max = furthest downstream), or -1. */
export function adjacentFlow(t: Terrain, x: number, z: number): number {
  let f = -1;
  for (const [dx, dz] of DIRS) {
    if (inBounds(x + dx, z + dz)) f = Math.max(f, t.flow[idx(x + dx, z + dz)]);
  }
  return f;
}
