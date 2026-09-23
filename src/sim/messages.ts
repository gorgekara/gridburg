import type { IncidentSnapshot, IncidentView } from './incidents';
import { defaultFunding } from '../management';
import { noPolicies } from '../policies';
import type { Policies, PolicyId } from '../policies';
import type { Funding, FundingKey } from '../management';
import type { CivicNeed } from '../constants';
import type { PlainNet } from '../roads/network';
import type { CityExtras, Taxes } from '../extras';
import type { DisasterKind, DisasterView } from './disasters';

export interface TileReport {
  tile: number;
  name: string;
  level: number;
  occupants: number;
  status: string;
  details: string[];
  blockers: string[];
  coverage: Partial<Record<CivicNeed, number>>;
  neglect: number;
}

export interface Stats {
  incidents: { fires: number; heists: number; racers: number; crashes: number; crime: number; patrols: number; fireEngines: number; prevented: number; extinguished: number; damaged: number; robbed: number; foiled: number };
  transport: { taxiStops: number; taxiRiders: number; busLines: number; trolleyLines: number; railLines: number; intercityLines: number; subwayLines: number; airports: number; riders: number; airPassengers: number; railPassengers: number; fareIncome: number };
  treatedSewage: number;
  entries: number;
  funding: Funding;
  policies: Policies;
  policyExpense: number;
  tollIncome: number;
  /** Dollars a second landed by fishing boats, and how many docks are working. */
  fishingIncome: number;
  docks: number;
  debt: number;
  taxIncome: number;
  roadExpense: number;
  serviceExpense: number;
  loanExpense: number;
  declining: number;
  cityLevel: number;
  happiness: number;
  civic: Record<CivicNeed, number>;
  money: number;
  pop: number;
  jobs: number;
  cars: number;
  commute: number; // seconds, rolling average
  demand: [number, number, number, number]; // R, C, I in -1..1
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
  taxes: Taxes;
  /** Goods in units a minute; income in dollars a second. */
  goods: { produced: number; needed: number; exported: number; imported: number; capacity: number; income: number; importShare: number };
  tourism: { visitors: number; income: number; attraction: number };
  /** City averages, 0..100. */
  landValue: number;
  wellbeing: number;
  garbage: number;
  districtExpense: number;
  disasters: { floods: number; tornadoes: number; damaged: number; active: DisasterKind | null };
  garbageTrucks: number;
  /** Set on the stand-in stats a city shows before the simulation has reported on it. */
  placeholder?: boolean;
}

/** Per-cell maps for the overlays, 0..255. */
export interface CityMaps { land: Uint8Array; noise: Uint8Array; wellbeing: Uint8Array; garbage: Uint8Array; crime: Uint8Array }

export interface EditPayload {
  kind: Uint8Array;
  /** Optional for older callers; absent rotations mean zero quarter turns. */
  rot?: Uint8Array;
  net: PlainNet;
  serial: number;
  cover: Uint8Array;
  accSeg: Int32Array;
  accS: Float32Array;
  /** District of each tile and the ground the player has dug or filled; absent means unchanged. */
  district?: Uint8Array;
  terraform?: Uint8Array;
}

export type MainToWorker =
  | ({ type: 'load'; extras?: CityExtras; disasterRate?: number; incidents?: IncidentSnapshot; policies?: Policies; funding?: Funding; debt?: number; neglect?: Uint8Array; cityLevel: number; seed: number; level: Uint8Array; money: number; tick: number; tax: number } & EditPayload)
  | ({ type: 'edit'; spent: number } & EditPayload)
  | { type: 'speed'; value: number }
  | { type: 'streetView'; active: boolean; driving?: boolean; racing?: boolean }
  | { type: 'player'; at: { x: number; z: number } | null }
  | { type: 'tax'; value: number }
  | { type: 'taxes'; taxes: Taxes }
  | { type: 'districtPolicy'; district: number; mask: number }
  | { type: 'disasters'; on: boolean; rate?: number; trigger?: DisasterKind }
  | { type: 'warm'; ticks: number }
  | { type: 'funding'; key: FundingKey; value: number }
  | { type: 'policy'; id: PolicyId; on: boolean }
  | { type: 'loan'; action: 'take' | 'repay' }
  | { type: 'inspect'; tile: number };

export type WorkerToMain =
  | { type: 'notice'; message: string }
  | { type: 'inspection'; report: TileReport | null }
  | { type: 'state'; incidents: IncidentView; incidentSave: IncidentSnapshot; neglect: Uint8Array; level: Uint8Array; flags: Uint8Array; pollution: Uint8Array; riverPollution: Uint8Array; maps?: CityMaps; disaster?: DisasterView | null; stats: Stats }
  | { type: 'frame'; carHeights: Float32Array; carPitch: Float32Array; carIds: Uint32Array; cars: Float32Array; segCong: Uint8Array; serial: number; cityTime: number; simTime: number; /** Every few frames: the water surface height of every tile holding water worth drawing (NaN elsewhere) and which land is under floodwater. */ water?: Float32Array; flooded?: Uint8Array };

export function emptyStats(money: number): Stats {
  return {
    incidents: { fires: 0, heists: 0, racers: 0, crashes: 0, crime: 0, patrols: 0, fireEngines: 0, prevented: 0, extinguished: 0, damaged: 0, robbed: 0, foiled: 0 },
    transport: { taxiStops: 0, taxiRiders: 0, busLines: 0, trolleyLines: 0, railLines: 0, intercityLines: 0, subwayLines: 0, airports: 0, riders: 0, airPassengers: 0, railPassengers: 0, fareIncome: 0 }, treatedSewage: 0, entries: 0,
    funding: defaultFunding(), policies: noPolicies(), policyExpense: 0, tollIncome: 0, fishingIncome: 0, docks: 0, debt: 0, taxIncome: 0, roadExpense: 0, serviceExpense: 0, loanExpense: 0, declining: 0,
    cityLevel: 0, happiness: 65, civic: { health: 0, education: 0, fire: 0, safety: 0, leisure: 0, waste: 0, deathcare: 0, mail: 0 },
    money, pop: 0, jobs: 0, cars: 0, commute: 0, demand: [0, 0, 0, 0], tick: 0, roadLength: 0, buildings: 0,
    noPath: 0, gaveUp: 0, power: [0, 0], water: [0, 0], sewage: [0, 0], dirtyWater: false, resPollution: 0, income: 0,
    taxes: [10, 10, 10, 10], goods: { produced: 0, needed: 0, exported: 0, imported: 0, capacity: 0, income: 0, importShare: 0 },
    tourism: { visitors: 0, income: 0, attraction: 0 }, landValue: 0, wellbeing: 0, garbage: 0, districtExpense: 0,
    disasters: { floods: 0, tornadoes: 0, damaged: 0, active: null }, garbageTrucks: 0, placeholder: true,
  };
}
