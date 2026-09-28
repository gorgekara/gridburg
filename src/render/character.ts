import { GRID, N_TILES, tileHash } from '../constants';
import type { CityMaps } from '../sim/messages';

/**
 * A neighbourhood's character, read off the city's own maps: how well-off it is, how rough, how much
 * rubbish lies about, how loud. Each is cut into a few bands, so the street detail can dress a rich
 * street differently from a poor one and rebuild a chunk only when a street really changes character,
 * not every time a number wobbles. Every map is smoothed over the 3 × 3 cells round each tile first, so
 * one hot cell does not make a lone island of graffiti, and a tile only leaves its band once the value
 * is well past the cut (the margin), so a street sitting on a cut does not flicker between two looks.
 */
export interface Bands {
  /** 0 poor, 1 ordinary, 2 well-off, 3 rich: from land value. */
  wealth: Uint8Array;
  /** 0 calm, 1 some trouble, 2 rough: from crime, or any neglect. */
  rough: Uint8Array;
  /** 0 clean, 1 bags at the kerb, 2 piles of it: from uncollected garbage. */
  litter: Uint8Array;
  /** 1 beside something loud: a motorway, a factory. */
  loud: Uint8Array;
}

const WEALTH = [60, 115, 150], ROUGH = [25, 60], LITTER = [40, 110], LOUD = [90];

function band(v: number, cuts: readonly number[]): number {
  let b = 0;
  while (b < cuts.length && v >= cuts[b]) b++;
  return b;
}

/** The band for `v`, kept at `prev` unless `v` is past the cut by `margin`. */
function sticky(v: number, cuts: readonly number[], margin: number, prev: number): number {
  const raw = band(v, cuts);
  if (raw > prev) return Math.max(prev, band(v - margin, cuts));
  if (raw < prev) return Math.min(prev, band(v + margin, cuts));
  return raw;
}

function smooth(src: Uint8Array, out: Float32Array): Float32Array {
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    let sum = 0, n = 0;
    for (let dz = -1; dz <= 1; dz++) {
      const zz = z + dz;
      if (zz < 0 || zz >= GRID) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= GRID) continue;
        sum += src[zz * GRID + xx]; n++;
      }
    }
    out[z * GRID + x] = sum / n;
  }
  return out;
}

export function ordinaryBands(): Bands {
  return { wealth: new Uint8Array(N_TILES).fill(1), rough: new Uint8Array(N_TILES), litter: new Uint8Array(N_TILES), loud: new Uint8Array(N_TILES) };
}

const scratch = new Float32Array(N_TILES);

/** The bands of every tile. With no maps yet every tile is ordinary: exactly the plain look. */
export function bandsOf(maps: CityMaps | null, neglect: Uint8Array, prev?: Bands): Bands {
  const out = ordinaryBands();
  if (!maps) return out;
  const pass = (src: Uint8Array, cuts: readonly number[], margin: number, dst: Uint8Array, old: Uint8Array | undefined): void => {
    smooth(src, scratch);
    for (let i = 0; i < N_TILES; i++) dst[i] = old ? sticky(scratch[i], cuts, margin, old[i]) : band(scratch[i], cuts);
  };
  pass(maps.land, WEALTH, 8, out.wealth, prev?.wealth);
  pass(maps.crime, ROUGH, 8, out.rough, prev?.rough);
  pass(maps.garbage, LITTER, 10, out.litter, prev?.litter);
  pass(maps.noise, LOUD, 10, out.loud, prev?.loud);
  for (let i = 0; i < N_TILES; i++) if (neglect[i]) out.rough[i] = 2;
  return out;
}

/** All four bands of a tile in one small number, for fingerprints. */
export function bandCode(b: Bands, i: number): number {
  return b.wealth[i] + 4 * b.rough[i] + 16 * b.litter[i] + 64 * b.loud[i];
}

/** The parts of the day the street life keeps to. */
export const TIME = { NIGHT: 0, EARLY: 1, MORNING: 2, MIDDAY: 3, AFTERNOON: 4, EVENING: 5 } as const;

export function timeBand(hour: number): number {
  if (hour < 6 || hour >= 22) return TIME.NIGHT;
  if (hour < 8) return TIME.EARLY;
  if (hour < 11) return TIME.MORNING;
  if (hour < 14) return TIME.MIDDAY;
  if (hour < 18) return TIME.AFTERNOON;
  return TIME.EVENING;
}

const HOME: [number, number][] = [[0, 0.35], [1, 0.3], [2, 0.12], [5, 0.12], [7, 0.4], [9, 0.15], [16, 0.2], [18, 0.6], [19, 0.85], [22, 0.85], [23, 0.4], [24, 0.35]];
const OFFICE: [number, number][] = [[0, 0.12], [1, 0.08], [5, 0.08], [7, 0.35], [9, 0.6], [16, 0.7], [17, 0.9], [19, 0.9], [21, 0.25], [24, 0.12]];

function curve(points: [number, number][], h: number): number {
  for (let k = 1; k < points.length; k++) {
    const [h1, v1] = points[k];
    if (h <= h1) {
      const [h0, v0] = points[k - 1];
      return v0 + (v1 - v0) * (h - h0) / (h1 - h0 || 1);
    }
  }
  return points[points.length - 1][1];
}

/** The share of windows lit at an hour: homes, then offices. */
export function occupancy(hour: number): [number, number] {
  const h = ((hour % 24) + 24) % 24;
  return [curve(HOME, h), curve(OFFICE, h)];
}

/**
 * A building's own paint, as a factor on its walls near 1: a little lighter or darker, a little warmer
 * or cooler, by a hash of `key` (a terrace run shares one key, so a row is painted alike). Rich streets
 * lean to cream and brick; poor ones to a greyer, grimier shade.
 */
export function buildingTint(key: number, wealth: number, out: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }): void {
  const h1 = tileHash(key * 5 + 1), h2 = tileHash(key * 5 + 2);
  const light = 0.9 + 0.2 * h1, warm = (h2 - 0.5) * 0.16;
  let r = light * (1 + warm), g = light, b = light * (1 - warm);
  if (wealth === 3) { r *= 1.04; g *= 1.02; b *= 0.94; }
  else if (wealth === 0) {
    const grey = (r + g + b) / 3;
    r = (r * 0.7 + grey * 0.3) * 0.94; g = (g * 0.7 + grey * 0.3) * 0.94; b = (b * 0.7 + grey * 0.3) * 0.94;
  }
  out.set(r, g, b);
}
