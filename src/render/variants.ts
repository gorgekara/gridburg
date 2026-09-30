import { GRID, N_TILES, T_COM, T_OFFICE, T_RES, tileHash } from '../constants';
import { Network, type RSeg } from '../roads/network';
import type { Raster } from '../roads/raster';
import { VARIANTS, SIZE_FULL, SIZE_PAIR, designOf } from './buildingGeo';

/**
 * Which of a zone's building designs stands on each lot. Most lots pick one by the tile's own hash,
 * but houses and low flats come in runs: every lot on the same side of a street within the same short
 * stretch (RUN along it) gets the same design and is painted alike, the way a builder puts up a row.
 * The building layer, the street detail, the parked cars, the incidents and the overlay all ask here,
 * so they agree on what stands where.
 */
const RUN = 3;
const byHash = (i: number): number => Math.floor(tileHash(i) * VARIANTS) % VARIANTS;
const table = new Uint8Array(N_TILES);
const runs = new Int32Array(N_TILES).fill(-1);
/** For a lot of a pair, the other lot; -1 for a lot standing alone. */
const partner = new Int32Array(N_TILES).fill(-1);
for (let i = 0; i < N_TILES; i++) table[i] = byHash(i);

export function lotVariant(i: number): number { return table[i]; }

/** The other lot a pair's building stands across, or -1. */
export function lotPartner(i: number): number { return partner[i]; }

/** Whether a lot is the second of a pair: its building is drawn from the other lot, the lead. */
export function isPairFollower(i: number): boolean { return partner[i] >= 0 && partner[i] < i; }

/** The terrace run a lot belongs to (a number shared by its row), or -1 when it stands alone. */
export function terraceRun(i: number): number { return runs[i]; }

/** Which run a lot on `seg` falls in: the side of the street it is on and how far along it stands. */
export function runKey(seg: RSeg, x: number, z: number, level: number): number {
  const at = Network.nearestOn(seg, x, z);
  const k = Math.min(seg.n - 1, Math.floor(at.t * seg.n));
  const tx = seg.pts[k * 2 + 2] - seg.pts[k * 2], tz = seg.pts[k * 2 + 3] - seg.pts[k * 2 + 1];
  const side = tx * (z - at.z) - tz * (x - at.x) > 0 ? 1 : 0;
  return ((seg.id * 2 + side) * 4096 + Math.floor(at.s / RUN)) * 4 + level;
}

/** Zones whose buildings come in all three sizes; industry, farms and leisure keep to the one. */
const SIZED = new Set([T_RES, T_COM, T_OFFICE]);

/**
 * Whether two lots side by side along the same side of a street can share one building: the same
 * zone and height, both in road-aligned cells facing the same way, a cell apart along the street.
 */
function canPair(i: number, n: number, kind: Uint8Array, level: Uint8Array, raster: Raster): boolean {
  if (kind[n] !== kind[i] || level[n] !== level[i] || raster.cell[i] < 0 || raster.cell[n] < 0) return false;
  if (raster.accSeg[n] !== raster.accSeg[i] || Math.abs(raster.face[n] - raster.face[i]) > 1e-3) return false;
  const dx = raster.lotX[n] - raster.lotX[i], dz = raster.lotZ[n] - raster.lotZ[i];
  const gap = Math.hypot(dx, dz);
  if (gap < 0.95 || gap > 1.05) return false;
  // Beside each other, not one behind the other: the step between them runs across the front.
  return Math.abs(dx * Math.sin(raster.face[i]) + dz * Math.cos(raster.face[i])) < 0.05;
}

export function assignVariants(kind: Uint8Array, level: Uint8Array, raster: Raster, net: Network): void {
  partner.fill(-1);
  for (let i = 0; i < N_TILES; i++) {
    runs[i] = -1;
    table[i] = byHash(i);
    if (kind[i] !== T_RES || (level[i] !== 1 && level[i] !== 2) || raster.accSeg[i] < 0) continue;
    const seg = net.segs.get(raster.accSeg[i]);
    if (!seg) continue;
    const key = runKey(seg, raster.lotX[i], raster.lotZ[i], level[i]);
    runs[i] = key;
    table[i] = Math.floor(tileHash(key * 7 + 3) * VARIANTS) % VARIANTS;
  }
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!SIZED.has(k) || !level[i] || raster.accSeg[i] < 0 || partner[i] >= 0) continue;
    const house = k === T_RES && level[i] === 1;
    // Flats, shops and offices pair up with the lot beside them now and then, into one wide block.
    if (!house) {
      const x = i % GRID, z = Math.floor(i / GRID);
      for (const n of [x + 1 < GRID ? i + 1 : -1, z + 1 < GRID ? i + GRID : -1]) {
        if (n < 0 || partner[n] >= 0 || !canPair(i, n, kind, level, raster)) continue;
        if (tileHash(Math.min(i, n) * 211 + Math.max(i, n) * 7 + 5) > (k === T_RES ? 0.35 : 0.45)) continue;
        partner[i] = n; partner[n] = i;
        table[i] = table[n] = designOf(table[i]) | SIZE_PAIR << 3;
        break;
      }
      if (partner[i] >= 0) continue;
    }
    // Otherwise a building is widened to fill its lot: whole terrace runs of houses built wall to
    // wall, and a share of the lone ones and the bigger buildings.
    const full = runs[i] >= 0 ? tileHash(runs[i] * 13 + 1) < 0.55 : tileHash(i * 29 + 3) < (house ? 0.3 : 0.4);
    if (full) table[i] = designOf(table[i]) | SIZE_FULL << 3;
  }
}
