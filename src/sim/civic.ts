import { GRID, N_TILES, T_RES, RES_POP, SERVICES, CIVIC_LABELS } from '../constants';
import type { CivicNeed } from '../constants';

/** Capacity is shared by all connected residents in radius; overlapping providers add coverage. */
export function civicCoverage(kind: Uint8Array, level: Uint8Array, connected: (i: number) => boolean, efficiency: (i: number) => number = () => 1) {
  const coverage = Object.fromEntries(Object.keys(CIVIC_LABELS).map(k => [k, new Float32Array(N_TILES)])) as Record<CivicNeed, Float32Array>;
  const homes: number[] = [];
  let population = 0;
  for (let i = 0; i < N_TILES; i++) if (kind[i] === T_RES && level[i]) {
    population += RES_POP[level[i]];
    if (connected(i)) homes.push(i);
  }
  for (let i = 0; i < N_TILES; i++) {
    const spec = SERVICES[kind[i]];
    if (!spec?.civic || !connected(i)) continue;
    const output = efficiency(i);
    if (output <= 0) continue;
    const x = i % GRID, z = Math.floor(i / GRID), radius2 = spec.radius! ** 2;
    const served = homes.filter(j => (j % GRID - x) ** 2 + (Math.floor(j / GRID) - z) ** 2 <= radius2);
    const demand = served.reduce((n, j) => n + RES_POP[level[j]], 0);
    const share = demand ? Math.min(1, spec.capacity! * output / demand) : 0;
    for (const j of served) coverage[spec.civic][j] = Math.min(1, coverage[spec.civic][j] + share);
  }
  const average = Object.fromEntries(Object.keys(CIVIC_LABELS).map(key => {
    const k = key as CivicNeed;
    const served = homes.reduce((n, i) => n + coverage[k][i] * RES_POP[level[i]], 0);
    return [k, population ? Math.round(100 * served / population) : 0];
  })) as Record<CivicNeed, number>;
  return { coverage, average };
}
