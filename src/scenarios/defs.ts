import { T_COM, T_IND, T_RES } from '../constants';
import { KIND_ROAD } from '../roads/network';
import type { SaveData } from '../save';
import type { Tool } from '../input';
import { Site } from './build';

/**
 * A wave of the rush. Traffic steps up at `at` seconds into the shift and the city is paid
 * `grant` to cope with it, so the money only ever arrives once the problem it has to solve is
 * already visible. A level is a sequence of these, hardest last.
 */
export interface Wave {
  /** Seconds into the shift when this wave takes over. The first is always 0. */
  at: number;
  /** Trip rate from here on, as a multiple of what the city would generate on its own. */
  demand: number;
  /** Paid into the budget the moment the wave lands. */
  grant: number;
  /** Shown as the wave lands, and on the timeline. Two or three words. */
  name: string;
}

export interface Scenario {
  id: string;
  name: string;
  /** One line for the level card. */
  blurb: string;
  /** What the shift is, and where it will hurt. */
  brief: string;
  seed: number;
  /** Cash in hand when the shift opens. The rest arrives with the waves. */
  opening: number;
  /** How long the shift runs, in simulated seconds. Survive it and the level is won. */
  duration: number;
  waves: Wave[];
  /** Stalled cars the city shrugs off. Below this the gridlock meter falls. */
  tolerated: number;
  /** Stalled cars that fill the gridlock meter in `patience` seconds. */
  gridlock: number;
  /** Seconds of full gridlock before the shift is lost. */
  patience: number;
  /** Trips delivered for one, two and three stars. */
  targets: [number, number, number];
  /** Seconds of traffic run before the player takes over, so the roads are not empty at the whistle. */
  warm: number;
  tools: Tool[];
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
    blurb: 'Two districts, no way in, and the shift has started.',
    brief: 'The developers built a neighbourhood and a business park with their own streets, then went '
      + 'home without connecting either of them to the highway. Get them linked before the morning '
      + 'builds, and keep the link wide enough for what comes after it.',
    seed: 14,
    opening: 900,
    duration: 180,
    waves: [
      { at: 0, demand: 0.7, grant: 0, name: 'Early shift' },
      { at: 60, demand: 1.3, grant: 700, name: 'School run' },
      { at: 115, demand: 2.1, grant: 800, name: 'Full rush' },
    ],
    tolerated: 6,
    gridlock: 40,
    patience: 25,
    targets: [150, 205, 245],
    warm: 8,
    tools: ROADS,
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
    blurb: 'Every car in town, one two-lane bridge, four waves.',
    brief: 'The homes are on this bank and every job is on the far one, joined by a single two-lane '
      + 'bridge. It copes with the early shift and nothing more. The whole crossing needs capacity — '
      + 'the span, the approach to it, and somewhere else to go once both are full.',
    seed: 282,
    opening: 850,
    duration: 260,
    waves: [
      { at: 0, demand: 0.45, grant: 0, name: 'Early shift' },
      { at: 55, demand: 0.8, grant: 900, name: 'First commuters' },
      { at: 115, demand: 1.15, grant: 1000, name: 'School run' },
      { at: 175, demand: 1.5, grant: 1050, name: 'Full rush' },
      { at: 225, demand: 1.9, grant: 0, name: 'Peak' },
    ],
    tolerated: 10,
    gridlock: 60,
    patience: 28,
    targets: [480, 720, 920],
    warm: 15,
    tools: ALL,
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
    blurb: 'One crossroads, taking the whole city, all shift.',
    brief: 'Homes are on this side of the crossroads and the work is on the other, so every trip in '
      + 'town goes through it, one car at a time. It holds up early. By the middle of the shift the '
      + 'junction is the city, and a junction this busy needs either more lanes or somewhere else to go.',
    seed: 80,
    opening: 550,
    duration: 240,
    waves: [
      { at: 0, demand: 0.5, grant: 0, name: 'Early shift' },
      { at: 50, demand: 0.9, grant: 650, name: 'First commuters' },
      { at: 105, demand: 1.4, grant: 750, name: 'School run' },
      { at: 160, demand: 2.0, grant: 750, name: 'Full rush' },
      { at: 210, demand: 2.6, grant: 0, name: 'Peak' },
    ],
    tolerated: 8,
    gridlock: 55,
    patience: 25,
    targets: [380, 560, 700],
    warm: 12,
    tools: ALL,
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
      + 'road is not gridlocked so much as long and slow, and a long journey is the one thing a rush '
      + 'hour cannot absorb. Make the journey shorter, or make it faster, before the peak arrives.',
    seed: 2481,
    opening: 950,
    duration: 260,
    waves: [
      { at: 0, demand: 0.5, grant: 0, name: 'Early shift' },
      { at: 55, demand: 0.9, grant: 950, name: 'First commuters' },
      { at: 115, demand: 1.35, grant: 1050, name: 'School run' },
      { at: 175, demand: 1.9, grant: 1100, name: 'Full rush' },
      { at: 225, demand: 2.4, grant: 0, name: 'Peak' },
    ],
    tolerated: 10,
    gridlock: 60,
    patience: 28,
    targets: [480, 730, 930],
    warm: 15,
    tools: ALL,
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
    blurb: 'A full grid, a drip of money, and five waves.',
    brief: 'A district of towers on a grid of ordinary streets, the whole population crossing to the '
      + 'other half at once. Every junction is a stand-off by the middle of the shift. The money comes '
      + 'in instalments and never all at once, so each wave buys one artery — pick the right one.',
    seed: 19,
    opening: 800,
    duration: 300,
    waves: [
      { at: 0, demand: 0.25, grant: 0, name: 'Early shift' },
      { at: 55, demand: 0.45, grant: 850, name: 'First commuters' },
      { at: 110, demand: 0.7, grant: 950, name: 'School run' },
      { at: 170, demand: 1.0, grant: 1050, name: 'Full rush' },
      { at: 230, demand: 1.6, grant: 950, name: 'Peak' },
      { at: 270, demand: 2.2, grant: 0, name: 'The worst of it' },
    ],
    tolerated: 12,
    gridlock: 62,
    patience: 25,
    targets: [750, 1150, 1420],
    warm: 15,
    tools: ALL,
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

/** Everything a level pays out over a whole shift, opening cash included. */
export function totalBudget(def: Scenario): number {
  return def.waves.reduce((a, w) => a + w.grant, def.opening);
}

/** A scenario's starting city, with the level's opening cash as its money. */
export function buildScenario(def: Scenario): SaveData {
  return def.build().toSave(def.opening);
}
