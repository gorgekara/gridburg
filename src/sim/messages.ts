export interface Stats {
  money: number;
  pop: number;
  jobs: number;
  cars: number;
  commute: number; // seconds, rolling average
  demand: [number, number, number]; // R, C, I in -1..1
  tick: number;
  roads: number;
  buildings: number;
  noPath: number; // trips that failed to find a route in the last tick
}

export type MainToWorker =
  | { type: 'load'; kind: Uint8Array; link: Uint8Array; level: Uint8Array; money: number; tick: number; tax: number }
  | { type: 'kind'; kind: Uint8Array; link: Uint8Array; spent: number }
  | { type: 'speed'; value: number }
  | { type: 'tax'; value: number }
  | { type: 'warm'; ticks: number };

export type WorkerToMain =
  | { type: 'state'; level: Uint8Array; stats: Stats }
  | { type: 'frame'; cars: Float32Array; congestion: Uint8Array };

export function emptyStats(money: number): Stats {
  return { money, pop: 0, jobs: 0, cars: 0, commute: 0, demand: [0, 0, 0], tick: 0, roads: 0, buildings: 0, noPath: 0 };
}
