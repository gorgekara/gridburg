import { N_TILES, T_PATH, T_PLAZA, T_LAWN, isDecoration, neighbor } from './constants';

/** Only pedestrian surfaces carry access through a freeform park. Amenities are destinations. */
export function isParkWalkable(kind: number): boolean {
  return kind === T_PATH || kind === T_PLAZA || kind === T_LAWN;
}

/** Cardinal pedestrian access from roads connected to the city's network.
 * Roadside amenities can operate directly, but cannot bridge two paths. Ponds, trees, kiosks,
 * benches, flowers and fountains only receive access; none propagate it. Runs in O(N_TILES).
 */
export function parkAccess(kind: Uint8Array, roadConnected: (tile: number) => boolean): Uint8Array {
  const access = new Uint8Array(N_TILES);
  const queue = new Int32Array(N_TILES);
  let head = 0, tail = 0;
  for (let i = 0; i < N_TILES; i++) {
    if (!isDecoration(kind[i]) || !roadConnected(i)) continue;
    access[i] = 1;
    if (isParkWalkable(kind[i])) queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    for (let d = 0; d < 4; d++) {
      const next = neighbor(i, d);
      if (next < 0 || access[next] || !isDecoration(kind[next])) continue;
      access[next] = 1;
      if (isParkWalkable(kind[next])) queue[tail++] = next;
    }
  }
  return access;
}

export interface DecorationPlacementState {
  kind: Uint8Array;
  water: Uint8Array;
  shore: Uint8Array;
  cover: Uint8Array;
  owners: Int32Array;
  airportClearance?: Uint8Array;
}

/** Placement has no road requirement. Replacing a decoration is allowed; callers charge the
 * full price of the new piece. Zoning and other buildings must be cleared explicitly first.
 */
export function decorationPlacementAllowed(tile: number, state: DecorationPlacementState): boolean {
  if (!Number.isInteger(tile) || tile < 0 || tile >= N_TILES) return false;
  const { kind, water, shore, cover, owners, airportClearance } = state;
  if (water[tile] || shore[tile] || cover[tile] || airportClearance?.[tile]) return false;
  if (owners[tile] >= 0 && owners[tile] !== tile) return false;
  return kind[tile] === 0 || isDecoration(kind[tile]);
}
