export const GRID = 64;
export const N_TILES = GRID * GRID;
export const MAX_CARS = 500;
export const SIM_HZ = 30;

export const T_EMPTY = 0;
export const T_ROAD = 1;
export const T_RES = 2;
export const T_COM = 3;
export const T_IND = 4;

export const COST_ROAD = 25;
export const COST_ZONE = 5;
export const START_MONEY = 6000;
export const ROAD_UPKEEP = 0.08; // per road tile per second

// Capacity per level (index 0 = zoned but empty).
export const RES_POP = [0, 4, 12, 40];
export const COM_JOBS = [0, 3, 10, 30];
export const IND_JOBS = [0, 4, 12, 28];

export function idx(x: number, z: number): number {
  return z * GRID + x;
}

export function inBounds(x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < GRID && z < GRID;
}

/** Neighbor tile index in direction d (0=N/-z, 1=E/+x, 2=S/+z, 3=W/-x) or -1. */
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
