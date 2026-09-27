// The welcome tutorials: short lessons, each on a map prepared for it, with steps the player works
// through (each ticks off when the city shows it done) and a goal that finishes the lesson.
import { newCity, HIGHWAY_END } from './game';
import { mapStart, populate } from './debugMaps';
import { N_TILES, T_RES, T_COM, T_COAL, T_WIND, T_SOLAR, T_GAS, T_PUMP, T_OUTLET, T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE, T_BUS, F_NO_ROAD } from './constants';
import { Network, KIND_AVENUE, KIND_ROAD, KIND_LANE, KIND_HIGHWAY2, KIND_RAMP, isCarriageway } from './roads/network';
import type { SaveData } from './save';
import type { Stats } from './sim/messages';

/** What a step or goal can look at: the city as the game holds it. */
export interface TutorialView { net: Network; kind: Uint8Array; flags: Uint8Array; stats: Stats }
export interface TutorialStep { text: string; hint: string; done: (v: TutorialView) => boolean }
export interface Tutorial {
  id: string;
  title: string;
  /** One line for the menu. */
  blurb: string;
  /** What the lesson is about, shown when it starts. */
  intro: string;
  setup: () => SaveData;
  steps: TutorialStep[];
  goal: { text: string; done: (v: TutorialView) => boolean };
}

const count = (v: TutorialView, ...kinds: number[]): number => { let n = 0; for (let i = 0; i < N_TILES; i++) if (kinds.includes(v.kind[i])) n++; return n; };
/** How many of these buildings are joined to a road. */
const working = (v: TutorialView, ...kinds: number[]): number => { let n = 0; for (let i = 0; i < N_TILES; i++) if (kinds.includes(v.kind[i]) && !(v.flags[i] & F_NO_ROAD)) n++; return n; };
/** Length of road the player has laid (the map's own highway does not count). */
const laid = (v: TutorialView): number => [...v.net.segs.values()].filter(s => !s.fixed && (s.kind === KIND_ROAD || s.kind === KIND_AVENUE || s.kind === KIND_LANE)).reduce((t, s) => t + s.len, 0);

/** The ramps the player has built (the map's own motorway junction has ramps of its own). */
const playerRamps = (v: TutorialView) => [...v.net.segs.values()].filter(s => s.kind === KIND_RAMP && !s.fixed);

const TUTORIAL_SEED = 214;
/** Where the Junctions lesson's one street crosses the avenue. */
const CROSS = { x: 40.5, z: 27.5 };

export const TUTORIALS: Tutorial[] = [
  {
    id: 'streets', title: 'First streets', blurb: 'Roads, zones, and power and water for a first neighbourhood',
    intro: 'Every city starts with a road off the highway. Lay some streets, zone homes and shops beside them, and give them power, water and somewhere for the sewage to go.',
    setup: () => { const d = newCity(TUTORIAL_SEED); d.money = 40000; return d; },
    steps: [
      { text: 'Lay a street off the end of the highway', hint: 'Roads › Road: click at the end of the highway, then click again to finish. Lay at least ten cells.', done: v => laid(v) >= 10 },
      { text: 'Zone some homes beside it', hint: 'Zones › Residential: brush along the street. Homes need a road within reach.', done: v => count(v, T_RES) >= 12 },
      { text: 'Zone a few shops', hint: 'Zones › Commercial: people need somewhere to work and shop.', done: v => count(v, T_COM) >= 6 },
      { text: 'Build a power plant beside a road', hint: 'Electricity: a coal plant is cheapest; wind is clean. Power travels along the roads.', done: v => working(v, T_COAL, T_WIND, T_SOLAR, T_GAS) >= 1 },
      { text: 'Pump water from the river', hint: 'Water › Water pump: on the river bank, beside a road.', done: v => working(v, T_PUMP) >= 1 },
      { text: 'Build a sewage outlet', hint: 'Water › Sewage outlet: downstream of the pump, on the bank.', done: v => working(v, T_OUTLET) >= 1 },
    ],
    goal: { text: 'Grow to 150 residents', done: v => v.stats.pop >= 150 },
  },
  {
    id: 'services', title: 'Services', blurb: 'Clinics, schools, fire and police for a town that has none',
    intro: 'This town has homes, shops, power and water, but nothing to look after its people. Each service covers the homes around it: place them where they reach the most.',
    setup: () => {
      const { d, net, terrain, street } = mapStart();
      street([{ x: 10.5, z: 12.5 }, { x: 60.5, z: 12.5 }], KIND_AVENUE);
      street([{ x: 18.5, z: HIGHWAY_END + 5 }, { x: 18.5, z: 12.5 }]);
      for (const z of [20.5, 28.5, 36.5]) street([{ x: 10.5, z }, { x: 60.5, z }]);
      for (const x of [10.5, 22.5, 34.5, 46.5, 60.5]) street([{ x, z: 12.5 }, { x, z: 36.5 }]);
      populate(d, net, terrain, { level: 1, south: 30, homesWest: 44 });
      d.cityLevel = 3;
      return d;
    },
    steps: [
      { text: 'Build a clinic', hint: 'Services › Clinic: its circle shows the homes it covers.', done: v => working(v, T_CLINIC) >= 1 },
      { text: 'Build a school', hint: 'Services › School.', done: v => working(v, T_SCHOOL) >= 1 },
      { text: 'Build a fire station', hint: 'Services › Fire station: engines drive to fires along the roads.', done: v => working(v, T_FIRE) >= 1 },
      { text: 'Build a police station', hint: 'Services › Police station: patrols keep crime down.', done: v => working(v, T_POLICE) >= 1 },
    ],
    goal: { text: 'Cover 35% of the town with every service: one of each will not be enough, and schools fill up first', done: v => (['health', 'education', 'fire', 'safety'] as const).every(k => v.stats.civic[k] >= 35) },
  },
  {
    id: 'junctions', title: 'Junctions', blurb: 'Rebuild the one crossing between two halves of town: control, turn lanes and capacity',
    intro: 'Homes are in the west of this town and the jobs in the east, and the only way across is one crossing with the avenue down the middle, where the avenue has priority. Control it with a signal or a roundabout, give turning traffic room, then give the crossing street the capacity the whole town needs from it.',
    setup: () => {
      const { d, net, terrain, street } = mapStart();
      // The west: the way in from the highway, and a grid of streets.
      street([{ x: 18.5, z: HIGHWAY_END + 5 }, { x: 18.5, z: 12.5 }], KIND_AVENUE);
      street([{ x: 6.5, z: 12.5 }, { x: 30.5, z: 12.5 }], KIND_AVENUE);
      for (const x of [6.5, 18.5, 30.5]) street([{ x, z: 12.5 }, { x, z: 40.5 }]);
      for (const z of [20.5, 34.5, 40.5]) street([{ x: 6.5, z }, { x: 30.5, z }]);
      // The east: its own grid, reached only across the avenue.
      for (const x of [50.5, 62.5, 74.5]) street([{ x, z: 14.5 }, { x, z: 40.5 }]);
      for (const z of [14.5, 20.5, 34.5, 40.5]) street([{ x: 50.5, z }, { x: 74.5, z }]);
      // The avenue down the middle, and the one street that crosses it.
      street([{ x: CROSS.x, z: 10.5 }, { x: CROSS.x, z: 44.5 }], KIND_AVENUE);
      street([{ x: 6.5, z: CROSS.z }, { x: 74.5, z: CROSS.z }], KIND_ROAD);
      populate(d, net, terrain, { level: 1, south: 24, services: true, industry: false });
      d.cityLevel = 5;
      return d;
    },
    steps: [
      { text: 'Put a signal or a roundabout on the crossing at the middle', hint: 'Traffic › Signal (or Roundabout): click where the street crosses the avenue in the middle of town.', done: v => { const n = v.net.nearestNode(CROSS.x, CROSS.z, 3); return !!n && (n.light || n.ring || [...v.net.nodes.values()].some(o => o.ring && Math.hypot(o.x - CROSS.x, o.z - CROSS.z) < 4)); } },
      { text: 'Give turning traffic a pocket lane, or ban a turn that holds everyone up', hint: 'Roads › Add lane: drag along the last stretch before a junction. Or Traffic › Turns: click a junction and ban a turn.', done: v => [...v.net.segs.values()].some(s => !!(s.addR || s.addL)) || [...v.net.nodes.values()].some(n => !!n.bans?.length) },
    ],
    goal: { text: 'Widen the crossing street to an avenue on both sides of the junction', done: v => {
      // The street's pieces near the crossing (not a roundabout's arcs, which leave the line).
      const near = [...v.net.segs.values()].filter(s => {
        const a = v.net.nodes.get(s.a)!, b = v.net.nodes.get(s.b)!;
        return Math.abs(a.z - CROSS.z) < 0.8 && Math.abs(b.z - CROSS.z) < 0.8 && Math.min(Math.abs(a.x - CROSS.x), Math.abs(b.x - CROSS.x)) < 9;
      });
      const side = (w: boolean): boolean => near.some(s => (v.net.nodes.get(s.a)!.x + v.net.nodes.get(s.b)!.x) / 2 < CROSS.x === w);
      return side(true) && side(false) && near.every(s => s.kind === KIND_AVENUE);
    } },
  },
  {
    id: 'highways', title: 'Highways', blurb: 'Join a town to the highway that runs past it with an exit and an entrance',
    intro: 'A two-lane highway runs past this town, but there is no way on or off it. Build an exit ramp and an entrance ramp: each gets a lane of its own on the highway.',
    setup: () => {
      const { d, net, terrain, street } = mapStart();
      street([{ x: 6.5, z: 12.5 }, { x: 74.5, z: 12.5 }], KIND_AVENUE);
      street([{ x: 18.5, z: HIGHWAY_END + 5 }, { x: 18.5, z: 12.5 }]);
      for (const z of [22.5, 32.5, 42.5]) street([{ x: 6.5, z }, { x: 34.5, z }]);
      for (const x of [6.5, 20.5, 34.5]) street([{ x, z: 12.5 }, { x, z: 42.5 }]);
      // The highway, joined to the avenue at the north end only.
      net.insertPath([{ x: 50.5, z: 46.5 }, { x: 50.5, z: 12.5 }], KIND_HIGHWAY2);
      net.insertPath([{ x: 53.5, z: 12.5 }, { x: 53.5, z: 46.5 }], KIND_HIGHWAY2);
      street([{ x: 50.5, z: 46.5 }, { x: 53.5, z: 46.5 }]);
      populate(d, net, terrain, { level: 1, south: 34, homesWest: 30, services: true, industry: false });
      d.cityLevel = 4;
      return d;
    },
    steps: [
      { text: 'Build an exit ramp off the highway into the town', hint: 'Roads › Ramp: start on the highway and draw off it to a street. Ramps run the way you draw them.', done: v => playerRamps(v).some(s => v.net.segsAt(s.a).some(o => isCarriageway(o.kind))) },
      { text: 'Build an entrance ramp from the town onto the highway', hint: 'Roads › Ramp: start on a street and finish on the highway.', done: v => playerRamps(v).some(s => v.net.segsAt(s.b).some(o => isCarriageway(o.kind))) },
    ],
    goal: { text: 'Both ramps join the town\'s streets', done: v => {
      const joined = (s: { a: number; b: number }, end: 'a' | 'b'): boolean => v.net.segsAt(s[end]).some(o => o.kind !== KIND_RAMP && !isCarriageway(o.kind));
      const ramps = playerRamps(v);
      return ramps.some(s => joined(s, 'b')) && ramps.some(s => joined(s, 'a'));
    } },
  },
  {
    id: 'buses', title: 'Buses', blurb: 'A bus route with stops and bus lanes',
    intro: 'Buses take cars off the road. Place stops near homes and near jobs (each stop joins the one before it into a route), and give the buses their own lane on the avenue.',
    setup: () => {
      const { d, net, terrain, street } = mapStart();
      street([{ x: 6.5, z: 12.5 }, { x: 74.5, z: 12.5 }], KIND_AVENUE);
      street([{ x: 18.5, z: HIGHWAY_END + 5 }, { x: 18.5, z: 12.5 }]);
      street([{ x: 6.5, z: 28.5 }, { x: 74.5, z: 28.5 }], KIND_AVENUE);
      for (const x of [6.5, 22.5, 40.5, 58.5, 74.5]) street([{ x, z: 12.5 }, { x, z: 42.5 }]);
      street([{ x: 6.5, z: 42.5 }, { x: 74.5, z: 42.5 }]);
      populate(d, net, terrain, { level: 1, south: 30, services: true, industry: false });
      d.cityLevel = 4;
      return d;
    },
    steps: [
      { text: 'Place a bus stop among the homes', hint: 'Transport › Bus stop: beside a road in the west of town.', done: v => working(v, T_BUS) >= 1 },
      { text: 'Place a second stop among the shops and jobs', hint: 'Transport › Bus stop: in the east. The two join into a route.', done: v => v.stats.transport.busLines >= 1 },
      { text: 'Give the buses a lane of their own on an avenue', hint: 'Roads › Bus lanes: click an avenue.', done: v => [...v.net.segs.values()].some(s => !!s.bus) },
    ],
    goal: { text: 'Carry 15 riders a minute: more stops near homes and jobs bring more riders', done: v => v.stats.transport.riders >= 15 },
  },
];

const KEY = 'gridburg.tutorials.v1';
/** The tutorials finished so far, by id. */
export function finished(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
export function markFinished(id: string): void {
  try { const s = finished(); s.add(id); localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* storage may be blocked */ }
}
