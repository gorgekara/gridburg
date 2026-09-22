import { GRID, N_TILES, SERVICES, T_IND, T_FARM, T_LEISURE, T_COM, T_OFFICE, T_RES, T_AIRPORT, T_SPORTS, T_DOCKS, isZone, zoneBase, zoneOccupants } from '../constants';
import type { CivicNeed } from '../constants';
import { districtHas } from '../extras';
import type { CityExtras } from '../extras';

/**
 * The city's economy beyond headcounts: how loud and how desirable each cell is, the goods that
 * industry makes and shops sell, the visitors the city draws, and the rubbish its buildings put out.
 * Everything here is a pure function of the city's state, so the worker can call it once a second
 * and tests can call it directly.
 */

export interface NoiseInput {
  kind: Uint8Array;
  level: Uint8Array;
  /** Noise laid down by traffic, already rasterized: 0..100 per cell before spreading. */
  roadNoise: Float32Array;
  extras: CityExtras;
}

/** Blur a field with a box filter of the given radius, a few passes for a soft falloff. */
function spread(field: Float32Array, radius: number, passes: number): Float32Array {
  let src = field;
  for (let p = 0; p < passes; p++) {
    const out = new Float32Array(N_TILES);
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      let sum = 0, n = 0;
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        const sx = x + dx, sz = z + dz;
        if (sx < 0 || sz < 0 || sx >= GRID || sz >= GRID) continue;
        sum += src[sz * GRID + sx]; n++;
      }
      out[z * GRID + x] = sum / n;
    }
    src = out;
  }
  return src;
}

/** Noise, 0..100: traffic, factories, the airport, nightlife and stadiums; quiet districts damp it. */
export function noiseMap({ kind, level, roadNoise, extras }: NoiseInput): Float32Array {
  const source = Float32Array.from(roadNoise);
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i], l = level[i];
    if (k === T_IND && l) source[i] += 40 + l * 15;
    else if (k === T_FARM && l) source[i] += 6;
    else if (k === T_LEISURE && l >= 2) source[i] += 18 * l;
    else if (k === T_COM && l) source[i] += 8 * l;
    else if (k === T_AIRPORT) source[i] += 160;
    else if (k === T_SPORTS) source[i] += 40;
    else if (SERVICES[k]?.power && SERVICES[k].pollution > 0) source[i] += 60;
  }
  const out = spread(source, 1, 2);
  for (let i = 0; i < N_TILES; i++) {
    const d = extras.district[i];
    const quiet = d && districtHas(extras.districtPolicies[d - 1], 'quiet');
    out[i] = Math.min(100, out[i] * (quiet ? 0.4 : 1) * 1.6);
  }
  return out;
}

export interface LandValueInput {
  kind: Uint8Array;
  level: Uint8Array;
  water: Uint8Array;
  pollution: Float32Array;
  noise: Float32Array;
  crime: Float32Array;
  garbage: Float32Array;
  coverage: Record<CivicNeed, Float32Array>;
  /** Cells within walking distance of a stop or station: 0..1. */
  transit: Float32Array;
  extras: CityExtras;
}

/** Distance in cells to the nearest water cell, capped at `cap`. */
export function waterDistance(water: Uint8Array, cap = 8): Float32Array {
  const d = new Float32Array(N_TILES).fill(cap);
  for (let i = 0; i < N_TILES; i++) if (water[i]) d[i] = 0;
  // Two chamfer passes are plenty for a short, capped distance.
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const i = z * GRID + x;
    if (x) d[i] = Math.min(d[i], d[i - 1] + 1);
    if (z) d[i] = Math.min(d[i], d[i - GRID] + 1);
    if (x && z) d[i] = Math.min(d[i], d[i - GRID - 1] + 1.41);
    if (z && x < GRID - 1) d[i] = Math.min(d[i], d[i - GRID + 1] + 1.41);
  }
  for (let z = GRID - 1; z >= 0; z--) for (let x = GRID - 1; x >= 0; x--) {
    const i = z * GRID + x;
    if (x < GRID - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
    if (z < GRID - 1) d[i] = Math.min(d[i], d[i + GRID] + 1);
    if (x < GRID - 1 && z < GRID - 1) d[i] = Math.min(d[i], d[i + GRID + 1] + 1.41);
    if (z < GRID - 1 && x) d[i] = Math.min(d[i], d[i + GRID - 1] + 1.41);
  }
  return d;
}

/**
 * Land value, 0..100. Parks, a river view, transit, landmarks and good services raise it; pollution,
 * noise, crime and uncollected rubbish lower it. Green and quiet districts add a premium.
 */
export function landValueMap(input: LandValueInput, riverDistance: Float32Array): Float32Array {
  const { kind, pollution, noise, crime, garbage, coverage, transit, extras } = input;
  // Landmarks lift everything around them.
  const landmark = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) if (SERVICES[kind[i]]?.attraction) landmark[i] = 100;
  const view = spread(landmark, 3, 2);
  const out = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    const services = (coverage.health[i] + coverage.education[i] + coverage.safety[i] + coverage.fire[i]) / 4;
    const river = riverDistance[i] <= 0 ? 0 : Math.max(0, 1 - (riverDistance[i] - 1) / 5);
    let v = 28
      + Math.min(1, coverage.leisure[i]) * 18
      + river * 14
      + transit[i] * 10
      + services * 16
      + Math.min(12, view[i] * 0.6)
      - pollution[i] * 3.5
      - noise[i] * 0.22
      - crime[i] * 0.15
      - Math.max(0, garbage[i] - 30) * 0.3;
    const d = extras.district[i];
    if (d) {
      const mask = extras.districtPolicies[d - 1];
      if (districtHas(mask, 'green')) v += 7;
      if (districtHas(mask, 'quiet')) v += 5;
      if (districtHas(mask, 'highriseBan')) v += 3;
    }
    out[i] = Math.max(0, Math.min(100, v));
  }
  // A little smoothing so value does not jump from one cell to the next.
  return spread(out, 1, 1);
}

/** Well-being of the people living in each home, 0..100 (0 elsewhere). */
export function wellbeingMap(kind: Uint8Array, level: Uint8Array, land: Float32Array, noise: Float32Array, pollution: Float32Array, crime: Float32Array, garbage: Float32Array, coverage: Record<CivicNeed, Float32Array>): Float32Array {
  const out = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    if (kind[i] !== T_RES || !level[i]) continue;
    const services = (coverage.health[i] + coverage.education[i] + coverage.safety[i] + coverage.leisure[i] + coverage.waste[i]) / 5;
    out[i] = Math.max(0, Math.min(100, 40 + services * 30 + land[i] * 0.25 - noise[i] * 0.2 - pollution[i] * 4 - crime[i] * 0.2 - Math.max(0, garbage[i] - 25) * 0.4));
  }
  return out;
}

export interface GoodsReport {
  /** Units a minute. */
  produced: number;
  needed: number;
  local: number;
  exported: number;
  imported: number;
  exportCapacity: number;
  /** Dollars a second earned selling surplus goods out of town. */
  exportIncome: number;
  /** Share of shops' stock bought in from outside, 0..1: it eats into their takings. */
  importShare: number;
  /** Share of production nobody can buy or ship out, 0..1. */
  unsold: number;
}

/**
 * Goods: factories and farms make them, shops and offices use them, and whatever is left is exported
 * through the city's entrances, freight rail and docks. A shortfall is bought in from outside.
 */
export function goodsFlow(kind: Uint8Array, level: Uint8Array, pop: number, links: { entries: number; railLines: number; docks: number; airports: number }, output = 1): GoodsReport {
  let produced = 0, needed = pop * 0.05;
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i], l = level[i];
    if (!l || !isZone(k)) continue;
    const jobs = zoneOccupants(k, l);
    if (k === T_IND) produced += jobs * 1.1 * output;
    else if (k === T_FARM) produced += jobs * 1.3 * output;
    else if (k === T_COM || k === T_LEISURE) needed += jobs * 0.9;
    else if (k === T_OFFICE) needed += jobs * 0.15;
  }
  produced += links.docks * 12;
  const local = Math.min(produced, needed);
  const exportCapacity = links.entries * 200 + links.railLines * 260 + links.docks * 60 + links.airports * 160;
  const surplus = produced - local;
  const exported = Math.min(surplus, exportCapacity);
  const imported = needed - local;
  return {
    produced, needed, local, exported, imported, exportCapacity,
    exportIncome: exported / 60 * 0.65,
    importShare: needed > 0 ? imported / needed : 0,
    unsold: produced > 0 ? (surplus - exported) / produced : 0,
  };
}

export interface TourismReport { attraction: number; access: number; visitors: number; income: number }

/** Visitors a minute and what they spend a second: parks, leisure, landmarks and the river draw them; entrances, rail and the airport bring them. */
export function tourism(kind: Uint8Array, level: Uint8Array, riverDistance: Float32Array, links: { entries: number; railLines: number; airports: number }, happiness: number, extras: CityExtras): TourismReport {
  let attraction = 0;
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i], l = level[i];
    const spec = SERVICES[k];
    const d = extras.district[i];
    const quarter = d && districtHas(extras.districtPolicies[d - 1], 'tourist') ? 1.4 : 1;
    if (k === T_LEISURE && l) attraction += zoneOccupants(k, l) * 0.45 * (riverDistance[i] <= 3 ? 1.4 : 1) * quarter;
    else if (spec?.attraction) attraction += spec.attraction * quarter;
    else if (spec?.civic === 'leisure') attraction += (spec.capacity ?? 0) / 220;
    else if (k === T_DOCKS) attraction += 3;
  }
  const access = links.entries > 0 ? 0.6 + links.entries * 0.25 + links.railLines * 0.35 + links.airports * 0.8 : 0;
  const mood = Math.max(0.3, Math.min(1.3, happiness / 65));
  const visitors = attraction * access * mood;
  return { attraction, access, visitors, income: visitors / 60 * 0.8 };
}

/** Rubbish a building puts out per second, and how much a truck clears around its stop. */
export const GARBAGE_RATE = 0.03;
export const GARBAGE_PICKUP_RADIUS = 3;

/** Add a second's rubbish to every occupied building; homes with waste coverage clear part of it themselves. */
export function accumulateGarbage(garbage: Float32Array, kind: Uint8Array, level: Uint8Array, waste: Float32Array): void {
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k) || !level[i]) { garbage[i] = Math.max(0, garbage[i] - 1); continue; }
    const base = zoneBase(k);
    const amount = zoneOccupants(k, level[i]) * GARBAGE_RATE * (base === T_IND ? 1.4 : 1);
    garbage[i] = Math.min(100, garbage[i] + amount * (1 - 0.6 * Math.min(1, waste[i])));
  }
}
