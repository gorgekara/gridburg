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
export const T_PARK = 11;
export const T_CLINIC = 12;
export const T_SCHOOL = 13;
export const T_FIRE = 14;
export const T_POLICE = 15;
export const T_RECYCLING = 16;
export const T_UNIVERSITY = 17;
export const T_SOLAR = 18;
export const T_OFFICE = 5;
export const T_BUS = 19;
export const T_STATION = 20;
export const T_AIRPORT = 21;
export const T_TREATMENT = 22;
export const T_SUBWAY = 23;
export const T_PLAYGROUND = 24;
export const T_SPORTS = 25;
export const T_GARDEN = 26;
export const OFFICE_UNLOCK = 3;
export const ENTRY_UNLOCK = 2;
export const COST_ENTRY = 3500;
export type CivicNeed = 'health' | 'education' | 'fire' | 'safety' | 'leisure' | 'waste';
export const CIVIC_LABELS: Record<CivicNeed, string> = {
  health: 'Healthcare', education: 'Education', fire: 'Fire protection', safety: 'Public safety', leisure: 'Recreation', waste: 'Waste collection',
};

export const COST_ROAD = 25; // per unit of length
export const COST_AVENUE = 180; // tripled when avenues grew to a three-tile corridor
export const BRIDGE_FACTOR = 3;
export const COST_ZONE = 5;
export const COST_LIGHT = 150;
export const COST_STOP = 60;
export const COST_CALM = 45; // per unit of street length
export const COST_ROUNDABOUT = 900;
export const START_MONEY = 14000;
export const COST_LANE = 14;
export const COST_HIGHWAY = 430;
export const ROAD_UPKEEP = 0.015; // per unit length per second, scaled per kind for the tiles it takes
/** Build cost per unit length, indexed by road kind. */
export const ROAD_COST = [COST_ROAD, COST_AVENUE, COST_LANE, COST_HIGHWAY];
/** Upkeep multiplier per road kind: wider roads cost more to keep. */
export const ROAD_UPKEEP_FACTOR = [1, 3, 0.6, 4.5];

export interface ServiceSpec {
  name: string;
  unlock?: number;
  footprint?: [number, number];
  transport?: 'bus' | 'rail' | 'subway' | 'air';
  treatment?: number;
  civic?: CivicNeed;
  capacity?: number;
  radius?: number;
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

const civic = (name: string, cost: number, upkeep: number, unlock: number, need: CivicNeed, capacity: number, radius: number): ServiceSpec => ({
  name, cost, upkeep, unlock, civic: need, capacity, radius, power: 0, water: 0, sewage: 0, pollution: 0, needsWater: false,
});
Object.assign(SERVICES, {
  [T_PARK]: civic('Neighborhood park', 450, 0.3, 0, 'leisure', 400, 10),
  [T_CLINIC]: civic('Medical clinic', 1400, 1.2, 1, 'health', 700, 16),
  [T_SCHOOL]: civic('Elementary school', 1800, 1.4, 1, 'education', 600, 15),
  [T_FIRE]: civic('Fire station', 2000, 1.5, 2, 'fire', 1000, 18),
  [T_POLICE]: civic('Police station', 2200, 1.6, 2, 'safety', 1000, 18),
  [T_RECYCLING]: { ...civic('Recycling center', 2600, 1.8, 2, 'waste', 1800, 30), pollution: 0.6 },
  [T_UNIVERSITY]: civic('University', 6500, 3.5, 4, 'education', 2400, 26),
  // Recreation grows with the city: a corner playground, then a sports field, then a proper park.
  [T_PLAYGROUND]: civic('Playground', 900, 0.6, 1, 'leisure', 800, 12),
  [T_SPORTS]: { ...civic('Sports field', 2600, 1.8, 3, 'leisure', 2000, 18), footprint: [2, 2] as [number, number] },
  [T_GARDEN]: { ...civic('City park', 6000, 3.2, 4, 'leisure', 4000, 26), footprint: [3, 3] as [number, number] },
  [T_SOLAR]: { name: 'Solar farm', cost: 4800, upkeep: 1.5, unlock: 3, power: 1800, water: 0, sewage: 0, pollution: 0, needsWater: false },
});

Object.assign(SERVICES, {
  [T_BUS]: { name: 'Bus stop', cost: 500, upkeep: 0.45, unlock: 2, transport: 'bus', radius: 9, capacity: 30, power: 0, water: 0, sewage: 0, pollution: 0, needsWater: false },
  [T_STATION]: { name: 'Railway station', cost: 5500, upkeep: 3, unlock: 4, transport: 'rail', footprint: [3, 2], radius: 18, capacity: 120, power: 0, water: 0, sewage: 0, pollution: 0, needsWater: false },
  [T_AIRPORT]: { name: 'Regional airport', cost: 12000, upkeep: 7, unlock: 5, transport: 'air', footprint: [8, 3], radius: 24, capacity: 240, power: 0, water: 0, sewage: 0, pollution: 0.5, needsWater: false },
  [T_SUBWAY]: { name: 'Metro station', cost: 4200, upkeep: 2.5, unlock: 4, transport: 'subway', radius: 14, capacity: 100, power: 0, water: 0, sewage: 0, pollution: 0, needsWater: false },
  [T_TREATMENT]: { name: 'Sewage treatment plant', cost: 3200, upkeep: 2, unlock: 2, treatment: 0.95, sewage: 2200, power: 0, water: 0, pollution: 0, needsWater: true },
});

// Capacity per level (index 0 = zoned but empty).
export const RES_POP = [0, 4, 12, 40];
export const COM_JOBS = [0, 3, 10, 30];
export const OFFICE_JOBS = [0, 5, 16, 42];
export const IND_JOBS = [0, 4, 12, 28];

// Utility demand per level, indexed [kind - T_RES][level].
export const POWER_DEMAND = [[0, 1, 3, 10], [0, 2, 6, 18], [0, 3, 8, 20], [0, 2, 5, 14]];
export const WATER_DEMAND = [[0, 1, 3, 9], [0, 1, 3, 8], [0, 2, 5, 12], [0, 1, 3, 7]];
export const IND_POLLUTION = [0, 1.5, 3, 5];

// Per-tile status flags sent from the worker.
export const F_NO_POWER = 1;
export const F_NO_WATER = 2;
export const F_NO_SEWAGE = 4;
export const F_NO_ROAD = 8;
export const F_DECLINING = 16;

export function isZone(k: number): boolean {
  return k >= T_RES && k <= T_OFFICE;
}

export function isService(k: number): boolean {
  return Object.hasOwn(SERVICES, k);
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
