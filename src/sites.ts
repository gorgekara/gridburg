import { GRID, N_TILES, SERVICES } from './constants';

export function footprint(tile: number, kind: number): number[] {
  const [w, d] = SERVICES[kind]?.footprint ?? [1, 1];
  const x = tile % GRID, z = Math.floor(tile / GRID);
  if (x + w > GRID || z + d > GRID) return [];
  return Array.from({ length: w * d }, (_, n) => tile + n % w + Math.floor(n / w) * GRID);
}

export function siteOwners(kind: Uint8Array): Int32Array {
  const owners = new Int32Array(N_TILES).fill(-1);
  for (let i = 0; i < N_TILES; i++) if (SERVICES[kind[i]]?.footprint) {
    for (const t of footprint(i, kind[i])) owners[t] = i;
  }
  return owners;
}
