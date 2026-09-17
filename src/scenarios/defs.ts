import { T_COM, T_IND, T_RES } from '../constants';
import { KIND_ROAD } from '../roads/network';
import type { SaveData } from '../save';
import type { Tool } from '../input';
import { Site } from './build';

/**
 * What a scenario asks of the player. Every level wants a city where every building is on the
 * network, so a level can never be solved by demolishing the demand.
 */
export type GoalKind =
  | 'connected' // every standing building reaches the highway
  | 'commute' // rolling average door-to-door time, at most `target` seconds
  | 'nojam' // no driver abandons their trip
  | 'flow'; // at least `target` arrivals a minute

export interface Goal {
  kind: GoalKind;
  target: number;
}

export interface Scenario {
  id: string;
  name: string;
  /** One line for the level card. */
  blurb: string;
  /** What is wrong with the city, and the shape of a fix. */
  brief: string;
  seed: number;
  /** Money the player gets. There is no income in a scenario: this is the whole budget. */
  budget: number;
  /** Spend this much or less to earn three stars. */
  par: number;
  /** Seconds every goal has to hold at once before the level is solved. */
  hold: number;
  /**
   * Seconds of traffic fast-forwarded before the player takes over. Long enough that the jam has
   * finished forming: a level must not be solvable by arriving early and waiting.
   */
  warm: number;
  tools: Tool[];
  goals: Goal[];
  /** Where to point the camera, in the highway's frame. */
  look: { along: number; side: number };
  /** The city as the player finds it. Call `buildScenario` to get something loadable. */
  build(): Site;
}

const ROADS: Tool[] = ['road', 'avenue', 'upgrade', 'bulldoze'];
const ALL: Tool[] = ['road', 'avenue', 'upgrade', 'roundabout', 'light', 'oneway', 'bulldoze'];

export const SCENARIOS: Scenario[] = [
  {
    id: 'first-mile',
    name: 'First Mile',
    blurb: 'Two districts, and no way in.',
    brief: 'The developers built a neighbourhood and a business park with their own streets, then went '
      + 'home without connecting either of them to the highway. Nobody can get in or out. Link them up.',
    seed: 14,
    budget: 2000,
    par: 650,
    hold: 20,
    warm: 10,
    tools: ROADS,
    goals: [{ kind: 'connected', target: 0 }, { kind: 'commute', target: 30 }],
    look: { along: 22, side: 0 },
    build() {
      const s = new Site(this.seed);
      // The highway spur stops well short of both districts.
      s.road([[7, 0], [16, 0]], KIND_ROAD);
      // Housing estate, one side: a spine with two cross streets, and no way out.
      s.road([[22, -9], [31, -9]], KIND_ROAD);
      for (const along of [22, 31]) s.road([[along, -12], [along, -6]], KIND_ROAD);
      // Business park, the other side: the same again.
      s.road([[22, 9], [31, 9]], KIND_ROAD);
      for (const along of [22, 31]) s.road([[along, 6], [along, 12]], KIND_ROAD);
      s.district(T_RES, 1, [21, 32], [-12, -6]);
      s.district(T_COM, 1, [21, 26], [6, 12]);
      s.district(T_IND, 1, [27, 32], [6, 12]);
      return s;
    },
  },
  {
    id: 'crossing',
    name: 'One Bridge',
    blurb: 'Every car in town uses the same bridge.',
    brief: 'The homes are on this bank and every job is on the far one, joined by a single two-lane '
      + 'bridge. It seizes up within a minute, and so does the road feeding it. The whole crossing '
      + 'needs more capacity, not just the span.',
    seed: 282,
    budget: 2600,
    par: 1300,
    hold: 25,
    warm: 120,
    tools: ALL,
    goals: [{ kind: 'connected', target: 0 }, { kind: 'commute', target: 30 }, { kind: 'nojam', target: 0 }],
    look: { along: 30, side: 0 },
    build() {
      const s = new Site(this.seed);
      // Near bank: the approach, with two streets of housing hanging off it.
      s.road([[7, 0], [29, 0]], KIND_ROAD);
      for (const along of [13, 21]) s.road([[along, -9], [along, 9]], KIND_ROAD);
      for (const side of [-9, 9]) s.road([[13, side], [21, side]], KIND_ROAD);
      // The one bridge, and the estate on the far bank.
      s.road([[29, 0], [40, 0]], KIND_ROAD);
      s.road([[40, -9], [40, 9]], KIND_ROAD);
      for (const side of [-9, 9]) s.road([[40, side], [47, side]], KIND_ROAD);
      s.road([[47, -9], [47, 9]], KIND_ROAD);
      s.district(T_RES, 1, [12, 22], [-11, 11]);
      s.district(T_COM, 1, [39, 42], [-11, 11]);
      s.district(T_IND, 1, [43, 48], [-11, 11]);
      return s;
    },
  },
  {
    id: 'four-ways',
    name: 'Four Ways',
    blurb: 'One crossroads, taking the whole city.',
    brief: 'Homes are on this side of the crossroads and the work is on the other, so every trip in '
      + 'town goes through it, one car at a time. A junction this busy needs either more lanes or '
      + 'somewhere else for the traffic to go.',
    seed: 80,
    budget: 1600,
    par: 400,
    hold: 25,
    warm: 120,
    tools: ALL,
    goals: [{ kind: 'connected', target: 0 }, { kind: 'commute', target: 30 }, { kind: 'nojam', target: 0 }],
    look: { along: 20, side: 0 },
    build() {
      const s = new Site(this.seed);
      s.road([[7, 0], [34, 0]], KIND_ROAD);
      s.road([[20, -13], [20, 13]], KIND_ROAD);
      // Housing on the near side of the crossroads, hung off the arterial.
      for (const along of [11, 16]) s.road([[along, -9], [along, 9]], KIND_ROAD);
      for (const side of [-9, 9]) s.road([[11, side], [16, side]], KIND_ROAD);
      // Work on the far side.
      for (const along of [25, 31]) s.road([[along, -9], [along, 9]], KIND_ROAD);
      for (const side of [-9, 9]) s.road([[25, side], [31, side]], KIND_ROAD);
      s.district(T_RES, 1, [10, 17], [-11, 11]);
      s.district(T_COM, 1, [24, 28], [-11, 11]);
      s.district(T_IND, 1, [28, 32], [-11, 11]);
      return s;
    },
  },
  {
    id: 'long-haul',
    name: 'The Long Haul',
    blurb: 'The jobs are miles away down a country lane.',
    brief: 'The industrial estate went up at the far end of a lane that was a cart track first. The '
      + 'road is not gridlocked so much as long and slow. Make the journey shorter, or make it faster.',
    seed: 2481,
    budget: 3500,
    par: 1800,
    hold: 25,
    warm: 120,
    tools: ALL,
    goals: [{ kind: 'connected', target: 0 }, { kind: 'commute', target: 30 }],
    look: { along: 28, side: 0 },
    build() {
      const s = new Site(this.seed);
      // A lane that wanders, because it was a cart track first.
      s.road([[7, 0], [17, -5], [27, 4], [37, -4], [46, 2], [52, 0]], KIND_ROAD);
      // The old village, near the highway.
      for (const along of [10, 16]) s.road([[along, -9], [along, 9]], KIND_ROAD);
      for (const side of [-9, 9]) s.road([[10, side], [16, side]], KIND_ROAD);
      // The estate at the far end of the lane.
      s.road([[52, -9], [52, 9]], KIND_ROAD);
      for (const side of [-9, 9]) s.road([[46, side], [52, side]], KIND_ROAD);
      s.district(T_RES, 1, [9, 17], [-11, 11]);
      s.district(T_COM, 1, [45, 48], [-11, 11]);
      s.district(T_IND, 1, [48, 53], [-11, 11]);
      return s;
    },
  },
  {
    id: 'rush-hour',
    name: 'Rush Hour',
    blurb: 'A full grid, a full budget, and gridlock.',
    brief: 'A district of towers on a grid of ordinary streets, the whole population crossing to the '
      + 'other half at once. Every junction is a stand-off. There is enough money here for a couple of '
      + 'proper arteries, and not one street more.',
    seed: 19,
    budget: 3000,
    par: 2200,
    hold: 30,
    warm: 120,
    tools: ALL,
    goals: [{ kind: 'connected', target: 0 }, { kind: 'commute', target: 30 }, { kind: 'nojam', target: 0 }],
    look: { along: 24, side: 0 },
    build() {
      const s = new Site(this.seed);
      s.road([[7, 0], [12, 0]], KIND_ROAD);
      for (const side of [-10, 0, 10]) s.road([[12, side], [33, side]], KIND_ROAD);
      for (const along of [12, 19, 26, 33]) s.road([[along, -10], [along, 10]], KIND_ROAD);
      s.district(T_RES, 2, [11, 20], [-12, 12]);
      s.district(T_COM, 1, [24, 28], [-12, 12]);
      s.district(T_IND, 1, [28, 34], [-12, 12]);
      return s;
    },
  },
];

export function scenarioById(id: string): Scenario | null {
  return SCENARIOS.find((s) => s.id === id) ?? null;
}

/** A scenario's starting city, with the level's budget as its money. */
export function buildScenario(def: Scenario): SaveData {
  return def.build().toSave(def.budget);
}
