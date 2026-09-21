import { GRID, N_TILES, T_AIRPORT, isService, isZone } from './constants';
import { footprint, footprintSize } from './sites';

export const AIRPORT_APPROACH_LENGTH = 12;

/** Runway origin and forward unit vector in grid coordinates (before subtracting GRID / 2).
 * Matches BuildingLayer's quarter-turn transform of buildingGeo's local runway at z = 0.
 * A point at local runway distance u is (x + dx * u, z + dz * u).
 */
export function airportRunway(tile: number, rot = 0): { x: number; z: number; dx: number; dz: number } {
  const turn = rot & 3;
  const dx = [1, 0, -1, 0][turn], dz = [0, -1, 0, 1][turn];
  const [w, d] = footprintSize(T_AIRPORT, turn);
  return {
    x: tile % GRID + w / 2 - 3.5 * dx + dz,
    z: Math.floor(tile / GRID) + d / 2 - 3.5 * dz - dx,
    dx, dz,
  };
}

/** Footprint, one tile around its perimeter, and three-wide approaches extending 12 tiles
 * beyond either runway end. Clip to the map without wrapping into another row.
 */
export function airportClearanceTiles(tile: number, rot = 0): number[] {
  if (!Number.isInteger(tile) || tile < 0 || tile >= N_TILES || !footprint(tile, T_AIRPORT, rot).length) return [];
  const { x, z, dx, dz } = airportRunway(tile, rot);
  const tiles = new Set<number>();
  const add = (u: number, v: number): void => {
    const tx = Math.floor(x + dx * u - dz * v), tz = Math.floor(z + dz * u + dx * v);
    if (tx >= 0 && tx < GRID && tz >= 0 && tz < GRID) tiles.add(tz * GRID + tx);
  };
  for (let u = -1; u <= 8; u++) for (let v = -1; v <= 3; v++) add(u, v);
  for (let u = 1; u <= AIRPORT_APPROACH_LENGTH; u++) for (let v = -1; v <= 1; v++) {
    add(-u, v); add(7 + u, v);
  }
  return [...tiles];
}

export function airportClearanceMask(kind: Uint8Array, rot?: Uint8Array): Uint8Array {
  const mask = new Uint8Array(N_TILES);
  for (let i = 0; i < kind.length; i++) if (kind[i] === T_AIRPORT) {
    for (const tile of airportClearanceTiles(i, rot?.[i] ?? 0)) mask[tile] = 1;
  }
  return mask;
}

/** Empty zoning may remain but can never grow within clearance. Existing buildings, including
 * the far edge of a service whose anchor is outside the corridor, block a new airport.
 */
export function airportPlacementBlocked(tile: number, rot: number, kind: Uint8Array, level: Uint8Array, rotations?: Uint8Array): boolean {
  const tiles = airportClearanceTiles(tile, rot);
  if (!tiles.length) return true;
  const clearance = new Set(tiles);
  for (let i = 0; i < kind.length; i++) {
    if (isService(kind[i]) || (isZone(kind[i]) && level[i] > 0)) {
      if (footprint(i, kind[i], rotations?.[i] ?? 0).some(t => clearance.has(t))) return true;
    }
  }
  return false;
}
