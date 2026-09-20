import { GRID, N_TILES, SERVICES, isService } from './constants';

/**
 * How many operating buildings of the same kind of service already reach each tile. Picking up a fire
 * station shows where the city's fire cover already is, so the next one goes where it is missing.
 * Services of the same sort count together: schools and universities both teach, and every bus stop
 * shares one catchment.
 */
export function serviceCoverage(kind: Uint8Array, k: number): Uint8Array | null {
  const spec = SERVICES[k];
  if (!spec?.radius) return null;
  const peers: number[] = [];
  for (let i = 0; i < N_TILES; i++) {
    const other = SERVICES[kind[i]];
    if (!other?.radius || !isService(kind[i])) continue;
    const sameKind = spec.civic ? other.civic === spec.civic : spec.transport ? other.transport === spec.transport : kind[i] === k;
    if (sameKind) peers.push(i);
  }
  if (!peers.length) return null;
  const out = new Uint8Array(N_TILES);
  for (const i of peers) {
    const other = SERVICES[kind[i]]!;
    const radius = other.radius!, r2 = radius * radius;
    const [fw, fh] = other.footprint ?? [1, 1];
    const cx = i % GRID + fw / 2, cz = Math.floor(i / GRID) + fh / 2;
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(GRID - 1, Math.ceil(cx + radius));
    const z0 = Math.max(0, Math.floor(cz - radius)), z1 = Math.min(GRID - 1, Math.ceil(cz + radius));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if ((x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2 > r2) continue;
      const t = z * GRID + x;
      if (out[t] < 255) out[t]++;
    }
  }
  return out;
}
