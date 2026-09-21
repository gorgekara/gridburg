import { GRID, N_TILES, SERVICES } from './constants';

/** A rotated footprint swaps its width and depth; the tile clicked stays its north-west corner. */
export function footprintSize(kind: number, rot = 0): [number, number] {
  const [w, d] = SERVICES[kind]?.footprint ?? [1, 1];
  return rot % 2 ? [d, w] : [w, d];
}

export function footprint(tile: number, kind: number, rot = 0): number[] {
  const [w, d] = footprintSize(kind, rot);
  const x = tile % GRID, z = Math.floor(tile / GRID);
  if (x + w > GRID || z + d > GRID) return [];
  return Array.from({ length: w * d }, (_, n) => tile + n % w + Math.floor(n / w) * GRID);
}

export function siteOwners(kind: Uint8Array, rot?: Uint8Array): Int32Array {
  const owners = new Int32Array(N_TILES).fill(-1);
  for (let i = 0; i < N_TILES; i++) if (SERVICES[kind[i]]?.footprint) {
    for (const t of footprint(i, kind[i], rot?.[i] ?? 0)) owners[t] = i;
  }
  return owners;
}
