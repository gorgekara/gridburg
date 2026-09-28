import { N_TILES, T_RES, tileHash } from '../constants';
import { Network, type RSeg } from '../roads/network';
import type { Raster } from '../roads/raster';
import { VARIANTS } from './buildingGeo';

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
for (let i = 0; i < N_TILES; i++) table[i] = byHash(i);

export function lotVariant(i: number): number { return table[i]; }

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

export function assignVariants(kind: Uint8Array, level: Uint8Array, raster: Raster, net: Network): void {
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
}
