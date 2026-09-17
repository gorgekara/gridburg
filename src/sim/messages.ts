import type { PlainNet } from '../roads/network';

export interface Stats {
  money: number;
  pop: number;
  jobs: number;
  cars: number;
  commute: number; // seconds, rolling average
  demand: [number, number, number]; // R, C, I in -1..1
  tick: number;
  roadLength: number;
  buildings: number;
  noPath: number; // trips that failed to find a route in the last tick
  gaveUp: number; // cars that despawned after being stuck, last tick
  power: [number, number]; // used, capacity
  water: [number, number];
  sewage: [number, number];
  dirtyWater: boolean;
  resPollution: number; // average ground pollution under homes
  income: number; // net per second
  arrivals: number; // trips completed since the city was loaded
  flow: number; // arrivals per minute, over the last 30 seconds
  stuck: number; // cars that have sat still for over twenty seconds
  orphans: number; // standing buildings with no road link to the highway
}

export interface EditPayload {
  kind: Uint8Array;
  net: PlainNet;
  serial: number;
  cover: Uint8Array;
  accSeg: Int32Array;
  accS: Float32Array;
}

export type MainToWorker =
  /** `frozen` holds buildings as they are and stops all income: a scenario's city and budget are fixed. */
  | ({ type: 'load'; seed: number; level: Uint8Array; money: number; tick: number; tax: number; frozen: boolean } & EditPayload)
  | ({ type: 'edit'; spent: number } & EditPayload)
  | { type: 'speed'; value: number }
  | { type: 'tax'; value: number }
  /** Fast-forward: growth ticks only, or whole simulation seconds with traffic when `traffic` is set. */
  | { type: 'warm'; ticks: number; traffic?: boolean };

export type WorkerToMain =
  | { type: 'state'; level: Uint8Array; flags: Uint8Array; pollution: Uint8Array; riverPollution: Uint8Array; stats: Stats }
  | { type: 'frame'; cars: Float32Array; segCong: Uint8Array; serial: number; simTime: number };

export function emptyStats(money: number): Stats {
  return {
    money, pop: 0, jobs: 0, cars: 0, commute: 0, demand: [0, 0, 0], tick: 0, roadLength: 0, buildings: 0,
    noPath: 0, gaveUp: 0, power: [0, 0], water: [0, 0], sewage: [0, 0], dirtyWater: false, resPollution: 0, income: 0,
    arrivals: 0, flow: 0, stuck: 0, orphans: 0,
  };
}
