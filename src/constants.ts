export const GRID = 64;
export const N_TILES = GRID * GRID;
export const MAX_CARS = 500;
export const SIM_HZ = 30;

export const T_EMPTY = 0;
export const T_ROAD = 1;
export const T_RES = 2;
export const T_COM = 3;
export const T_IND = 4;
export const T_AVENUE = 5;

export const COST_ROAD = 25;
export const COST_AVENUE = 60;
export const COST_ZONE = 5;
export const START_MONEY = 6000;
export const ROAD_UPKEEP = 0.08; // per road tile per second; avenues cost double

// Capacity per level (index 0 = zoned but empty).
export const RES_POP = [0, 4, 12, 40];
export const COM_JOBS = [0, 3, 10, 30];
export const IND_JOBS = [0, 4, 12, 28];

export const SQRT2 = Math.SQRT2;

/** 8 directions clockwise from north: N, NE, E, SE, S, SW, W, NW. Odd indices are diagonals. */
export const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export function isRoad(k: number): boolean {
  return k === T_ROAD || k === T_AVENUE;
}

export function isZone(k: number): boolean {
  return k >= T_RES && k <= T_IND;
}

export function idx(x: number, z: number): number {
  return z * GRID + x;
}

export function inBounds(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < GRID && z < GRID;
}

/** Neighbor tile index in 4-direction d (0=N/-z, 1=E/+x, 2=S/+z, 3=W/-x) or -1. */
export function neighbor(i: number, d: number): number {
  const x = i % GRID;
  const z = (i / GRID) | 0;
  switch (d) {
    case 0: return z > 0 ? i - GRID : -1;
    case 1: return x < GRID - 1 ? i + 1 : -1;
    case 2: return z < GRID - 1 ? i + GRID : -1;
    default: return x > 0 ? i - 1 : -1;
  }
}

/** Neighbor tile index in 8-direction d (see DIRS8) or -1. */
export function neighbor8(i: number, d: number): number {
  const x = (i % GRID) + DIRS8[d][0];
  const z = ((i / GRID) | 0) + DIRS8[d][1];
  return inBounds(x, z) ? idx(x, z) : -1;
}

export function opposite8(d: number): number {
  return (d + 4) & 7;
}

/**
 * Is tile i connected to its neighbor in 8-direction d?
 * Orthogonal road neighbors always connect; diagonal ones only when the link bit was drawn.
 */
export function connected(kind: Uint8Array, link: Uint8Array, i: number, d: number): boolean {
  const n = neighbor8(i, d);
  if (n < 0 || !isRoad(kind[n]) || !isRoad(kind[i])) return false;
  if (d & 1) return ((link[i] >> d) & 1) === 1;
  return true;
}
