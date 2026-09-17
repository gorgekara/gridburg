export const GRID = 80;
export const N_TILES = GRID * GRID;
export const MAX_CARS = 600;
export const SIM_HZ = 30;

// Tile kinds. Roads are no longer tiles; they live in the road network.
export const T_EMPTY = 0;
export const T_RES = 2;
export const T_COM = 3;
export const T_IND = 4;
export const T_COAL = 6;
export const T_WIND = 7;
export const T_PUMP = 8;
export const T_TOWER = 9;
export const T_OUTLET = 10;

export const COST_ROAD = 25; // per unit of length
export const COST_AVENUE = 60;
export const BRIDGE_FACTOR = 3;
export const COST_ZONE = 5;
export const COST_LIGHT = 150;
export const COST_ROUNDABOUT = 900;
export const START_MONEY = 14000;
export const ROAD_UPKEEP = 0.015; // per unit length per second; avenues cost double

export interface ServiceSpec {
  name: string;
  cost: number;
  upkeep: number; // per second
  power: number; // capacity provided
  water: number;
  sewage: number;
  pollution: number; // ground pollution emitted per tick
  needsWater: boolean; // must touch the river
}

export const SERVICES: Record<number, ServiceSpec> = {
  [T_COAL]: { name: 'Coal plant', cost: 2500, upkeep: 3, power: 1500, water: 0, sewage: 0, pollution: 9, needsWater: false },
  [T_WIND]: { name: 'Wind turbine', cost: 800, upkeep: 0.6, power: 250, water: 0, sewage: 0, pollution: 0, needsWater: false },
  [T_PUMP]: { name: 'Water pump', cost: 900, upkeep: 1, power: 0, water: 1500, sewage: 0, pollution: 0, needsWater: true },
  [T_TOWER]: { name: 'Water tower', cost: 600, upkeep: 0.5, power: 0, water: 350, sewage: 0, pollution: 0, needsWater: false },
  [T_OUTLET]: { name: 'Sewage outlet', cost: 700, upkeep: 0.8, power: 0, water: 0, sewage: 1500, pollution: 0, needsWater: true },
};

// Capacity per level (index 0 = zoned but empty).
export const RES_POP = [0, 4, 12, 40];
export const COM_JOBS = [0, 3, 10, 30];
export const IND_JOBS = [0, 4, 12, 28];

// Utility demand per level, indexed [kind - T_RES][level].
export const POWER_DEMAND = [[0, 1, 3, 10], [0, 2, 6, 18], [0, 3, 8, 20]];
export const WATER_DEMAND = [[0, 1, 3, 9], [0, 1, 3, 8], [0, 2, 5, 12]];
export const IND_POLLUTION = [0, 1.5, 3, 5];

// Per-tile status flags sent from the worker.
export const F_NO_POWER = 1;
export const F_NO_WATER = 2;
export const F_NO_SEWAGE = 4;
export const F_NO_ROAD = 8;

export function isZone(k: number): boolean {
  return k >= T_RES && k <= T_IND;
}

export function isService(k: number): boolean {
  return k >= T_COAL && k <= T_OUTLET;
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

/** Deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-tile hash in 0..1. */
export function tileHash(i: number): number {
  let h = (i * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
