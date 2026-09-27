// Test maps: every kind of road interaction laid out side by side on one map, with enough of a town
// round it for traffic to use them all. For checking how junctions, lanes, ramps and levels look and
// behave without building each one by hand. Built on the demo city's terrain, whose north bank is dry.
import { defaultExtras } from './extras';
import { highwayLayout, HIGHWAY_END, newCity } from './game';
import { GRID, N_TILES, idx, inBounds, T_RES, T_COM, T_IND, T_COAL, T_PUMP, T_OUTLET, T_TOWER, T_BUS, T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE } from './constants';
import { Network, KIND_AVENUE, KIND_ROAD, KIND_LANE, KIND_HIGHWAY2, KIND_RAMP, ROUNDABOUT_RADIUS } from './roads/network';
import { planFor, allTurns, turnName } from './roads/signals';
import { canStyle } from './roads/lanes';
import { rasterize } from './roads/raster';
import { generateTerrain, touchesWater, adjacentFlow } from './terrain';
import type { SaveData } from './save';

const SEED = 214;
type Pt = { x: number; z: number };

/** The shared start: the demo terrain with its highway, a gate road in, and helpers to lay roads on dry land. */
export function mapStart(): { d: SaveData; net: Network; terrain: ReturnType<typeof generateTerrain>; street: (pts: Pt[], kind?: number) => number[] } {
  const d = newCity(SEED), terrain = generateTerrain(SEED), net = Network.fromPlain(d.net), water = terrain.water;
  const dry = (x: number, z: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const tx = Math.floor(x + dx * 0.9), tz = Math.floor(z + dz * 0.9);
      if (!inBounds(tx, tz) || water[idx(tx, tz)]) return false;
    }
    return true;
  };
  /** A road through guide points, kept to dry land: where it would cross water it stops, and carries on beyond. */
  const street = (pts: Pt[], kind = KIND_ROAD): number[] => {
    const out: number[] = [];
    let run: Pt[] = [];
    const flush = (): void => { if (run.length >= 2 && Math.hypot(run[run.length - 1].x - run[0].x, run[run.length - 1].z - run[0].z) > 1) out.push(...net.insertPath(run, kind)); run = []; };
    let last: Pt | null = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25);
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n };
        // Only the guide points, and the last dry point before water and the first after it.
        if (!dry(p.x, p.z)) { if (run.length && last && run[run.length - 1] !== last) run.push(last); flush(); last = null; continue; }
        if (k === n || !run.length) run.push(p);
        last = p;
      }
    }
    flush();
    return out;
  };
  // In from the highway, as the demo does.
  const layout = highwayLayout(terrain), gate: Pt = { x: 18.5, z: HIGHWAY_END + 5 };
  for (const x of [layout.x1, layout.x2]) net.insertPath([{ x, z: HIGHWAY_END }, { x, z: HIGHWAY_END + 2.5 }, gate], KIND_ROAD);
  return { d, net, terrain, street };
}

/**
 * Homes to the west and work to the east of every street, so trips cross the whole map; and power,
 * water and sewage for them.
 */
/** How a map's town is filled in: how built up it starts, how far south it reaches, whether it has power and water, and whether its jobs include industry (and the freight it draws). */
export interface TownOptions { level?: number; south?: number; utilities?: boolean; homesWest?: number; services?: boolean; industry?: boolean }

export function populate(d: SaveData, net: Network, terrain: ReturnType<typeof generateTerrain>, opts: TownOptions = {}): void {
  const level = opts.level ?? 2, south = opts.south ?? 50, utilities = opts.utilities ?? true, homesWest = opts.homesWest ?? 40;
  const water = terrain.water;
  // Two streets on south to the river from the town's southernmost roads, west and east, for the
  // pumps and outfalls.
  const ends = [...net.nodes.values()].filter(nd => !nd.fixed && (nd.level ?? 0) === 0 && net.degree(nd.id) > 0 && nd.z < 52);
  for (const west of [true, false]) {
    const side = ends.filter(nd => (nd.x < 40) === west);
    if (!side.length) continue;
    const from = side.reduce((a, b) => (b.z > a.z || (b.z === a.z && Math.abs(b.x - (west ? 14 : 62)) < Math.abs(a.x - (west ? 14 : 62))) ? b : a));
    const x = from.x;
    let z = from.z;
    const wet = (zz: number): boolean => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const tx = Math.floor(x + dx * 0.9), tz = Math.floor(zz + dz * 0.9); if (!inBounds(tx, tz) || water[idx(tx, tz)]) return true; } return false; };
    while (z < GRID - 2 && !wet(z + 0.5)) z += 0.5;
    if (z - from.z > 2) net.insertPath([{ x, z: from.z }, { x, z }], KIND_ROAD);
  }
  const ras = rasterize(net), kind = new Uint8Array(N_TILES);
  const free = (i: number): boolean => !water[i] && !terrain.shore[i] && !ras.cover[i] && ras.accSeg[i] >= 0;
  for (let i = 0; i < N_TILES; i++) {
    if (!free(i)) continue;
    const x = i % GRID, z = Math.floor(i / GRID);
    if (z > south) continue;
    kind[i] = x < homesWest ? T_RES : opts.industry !== false && (x + z) % 5 === 0 ? T_IND : T_COM;
  }
  // Power at the town's east end (among the jobs, where there are any), water from the river bank,
  // a tower or two.
  // (Right beside a road: a tile further back may lose its access once the zone cells are laid.)
  const kerbside = (i: number): boolean => Math.hypot(ras.accX[i] - (i % GRID + 0.5), ras.accZ[i] - (Math.floor(i / GRID) + 0.5)) < 1.3;
  if (utilities) {
    const site = (kinds: number[]): number[] => [...kind.keys()].filter(i => kinds.includes(kind[i]) && kerbside(i)).sort((a, b) => b % GRID - a % GRID || a - b);
    const jobs = site([T_COM, T_IND]);
    for (const i of (jobs.length >= 7 ? jobs : site([T_RES, T_COM, T_IND])).slice(0, 7)) kind[i] = T_COAL;
  }
  const bank: { i: number; f: number }[] = [];
  for (let i = 0; i < N_TILES; i++) {
    const x = i % GRID, z = Math.floor(i / GRID);
    if (!water[i] && ras.accSeg[i] >= 0 && !ras.cover[i] && touchesWater(terrain, x, z)) bank.push({ i, f: adjacentFlow(terrain, x, z) });
  }
  bank.sort((a, b) => a.f - b.f);
  if (utilities) {
    for (const { i } of bank.slice(0, 5)) kind[i] = T_PUMP;
    for (const { i } of bank.slice(-6)) kind[i] = T_OUTLET;
  }
  let towers = 0;
  for (let i = 0; i < N_TILES && towers < 2 && utilities; i++) { const x = i % GRID; if ((towers ? x > 50 : x > 12) && kind[i] === T_RES && kerbside(i)) { kind[i] = T_TOWER; towers++; } }
  // Services spread over the town, so it keeps its people: a clinic, school, fire and police station
  // every twelve cells or so.
  if (opts.services) {
    const take = (x0: number, z0: number, k: number): void => {
      for (let r = 0; r < 5; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = x0 + dx, z = z0 + dz;
        if (!inBounds(x, z)) continue;
        const i = idx(x, z);
        if ((kind[i] === T_RES || kind[i] === T_COM) && kerbside(i)) { kind[i] = k; return; }
      }
    };
    for (let z = 16; z <= south; z += 12) for (let x = 10; x < GRID - 4; x += 12) {
      take(x, z, T_CLINIC); take(x + 3, z, T_SCHOOL); take(x, z + 3, T_FIRE); take(x + 3, z + 3, T_POLICE);
    }
  }
  d.kind = kind; d.level = new Uint8Array(N_TILES);
  // Built already, so traffic flows from the start rather than waiting for the town to grow.
  for (let i = 0; i < N_TILES; i++) d.level[i] = kind[i] >= T_COAL ? 1 : kind[i] ? level : 0;
  d.net = net.toPlain(); d.money = 1e6; d.cityLevel = 6; d.extras = defaultExtras(10);
}

/**
 * Junction lab: two long streets east to west (z 20.5 and 36.5) crossed by six test streets, each of
 * the twelve crossings a different kind of junction, between an avenue along the top and one along
 * the bottom.
 *
 *  x 10.5: a T junction (the crossing street stops) · a crossroads with no left turn from the west
 *  x 22.5: an all-way stop · a signal with turn pockets on every arm
 *  x 34.5: a street roundabout · a two-lane avenue roundabout
 *  x 46.5: avenues crossing at an adaptive signal · a shallow Y with a pair of one-way streets
 *  x 58.5: an avenue with bus lanes and stops · bike lanes, calming and busy zebras
 *  x 70.5: narrow lanes, a bend and a dead end · a five-way junction
 */
export function junctionLab(): SaveData {
  const { d, net, terrain, street } = mapStart();
  street([{ x: 6.5, z: 12.5 }, { x: 74.5, z: 12.5 }], KIND_AVENUE);
  street([{ x: 6.5, z: 46.5 }, { x: 74.5, z: 46.5 }], KIND_AVENUE);
  street([{ x: 18.5, z: HIGHWAY_END + 5 }, { x: 18.5, z: 12.5 }]);
  for (const x of [6.5, 74.5]) street([{ x, z: 12.5 }, { x, z: 46.5 }]);
  // The two cross-town streets, in pieces so some stretches can be avenues.
  street([{ x: 6.5, z: 20.5 }, { x: 40.5, z: 20.5 }]);
  street([{ x: 40.5, z: 20.5 }, { x: 52.5, z: 20.5 }], KIND_AVENUE);
  street([{ x: 52.5, z: 20.5 }, { x: 64.5, z: 20.5 }], KIND_AVENUE);
  street([{ x: 64.5, z: 20.5 }, { x: 74.5, z: 20.5 }]);
  street([{ x: 6.5, z: 36.5 }, { x: 28.5, z: 36.5 }]);
  street([{ x: 28.5, z: 36.5 }, { x: 40.5, z: 36.5 }], KIND_AVENUE);
  street([{ x: 40.5, z: 36.5 }, { x: 74.5, z: 36.5 }]);
  // The test streets.
  street([{ x: 10.5, z: 12.5 }, { x: 10.5, z: 46.5 }]);
  street([{ x: 22.5, z: 12.5 }, { x: 22.5, z: 46.5 }]);
  street([{ x: 34.5, z: 12.5 }, { x: 34.5, z: 28.5 }]);
  street([{ x: 34.5, z: 28.5 }, { x: 34.5, z: 46.5 }], KIND_AVENUE);
  street([{ x: 46.5, z: 12.5 }, { x: 46.5, z: 28.5 }], KIND_AVENUE);
  street([{ x: 46.5, z: 28.5 }, { x: 46.5, z: 46.5 }]);
  street([{ x: 58.5, z: 12.5 }, { x: 58.5, z: 46.5 }]);
  street([{ x: 70.5, z: 12.5 }, { x: 70.5, z: 46.5 }]);
  // x 10.5 north: a T junction; the cross street's stretch west of it goes.
  const t = net.nearestNode(10.5, 20.5, 0.2);
  if (t) for (const s of net.segsAt(t.id)) { const o = net.nodes.get(s.a === t.id ? s.b : s.a)!; if (o.x < 10 && Math.abs(o.z - 20.5) < 0.2) net.removeSeg(s.id); }
  street([{ x: 6.5, z: 24.5 }, { x: 10.5, z: 24.5 }]);
  // x 10.5 south: the crossroads bans a turn: no left from the west.
  const cross = net.nearestNode(10.5, 36.5, 0.2);
  if (cross) { const left = allTurns(net, cross.id).find(m => turnName(m) === 'Left' && net.nodes.get(net.segs.get(m.inSeg)!.a === cross.id ? net.segs.get(m.inSeg)!.b : net.segs.get(m.inSeg)!.a)!.x < 10); if (left) cross.bans = [left.key]; }
  // x 22.5: an all-way stop, and a signal with a pocket on every arm.
  const stop = net.nearestNode(22.5, 20.5, 0.2); if (stop) stop.stop = true;
  const sig = net.nearestNode(22.5, 36.5, 0.2);
  if (sig) {
    sig.light = true;
    for (const arm of [...net.segsAt(sig.id)]) {
      const atB = arm.b === sig.id;
      net.addLaneRange(arm.id, atB ? arm.len - 2.6 : 0, atB ? arm.len : 2.6, atB ? 1 : -1, 1);
    }
  }
  // x 34.5: roundabouts.
  net.addRoundabout(34.5, 20.5, ROUNDABOUT_RADIUS[KIND_ROAD], KIND_ROAD);
  net.addRoundabout(34.5, 36.5, ROUNDABOUT_RADIUS[KIND_AVENUE], KIND_AVENUE);
  // x 46.5: avenues at an adaptive signal; below, a shallow Y and a pair of one-way streets.
  const av = net.nearestNode(46.5, 20.5, 0.2);
  if (av) { av.light = true; const plan = planFor(net, av.id); plan.adaptive = true; av.signal = plan; }
  street([{ x: 46.5, z: 30.5 }, { x: 50, z: 34 }, { x: 52.5, z: 36.5 }]);
  net.insertPath([{ x: 40.5, z: 41.5 }, { x: 52.5, z: 41.5 }], KIND_ROAD, true);
  net.insertPath([{ x: 52.5, z: 43.5 }, { x: 40.5, z: 43.5 }], KIND_ROAD, true);
  // x 58.5: bus lanes along the avenue with stops beside it; below, bike lanes, calming, zebras.
  for (const s of net.segs.values()) {
    const ys = [s.pts[1], s.pts[s.n * 2 + 1]], xs = [s.pts[0], s.pts[s.n * 2]];
    if (s.kind === KIND_AVENUE && ys.every(z => Math.abs(z - 20.5) < 0.2) && Math.min(...xs) >= 52) s.bus = true;
    if (s.kind === KIND_ROAD && ys.every(z => Math.abs(z - 36.5) < 0.2) && Math.min(...xs) >= 52 && Math.max(...xs) <= 65) { s.bike = true; s.calm = true; }
  }
  // Street styles: the bottom avenue is a boulevard, the west of the top street has parking lanes and
  // the west of the lower one is tree-lined.
  for (const sg of net.segs.values()) {
    const ys = [sg.pts[1], sg.pts[sg.n * 2 + 1]], xs = [sg.pts[0], sg.pts[sg.n * 2]];
    if (!canStyle(sg, net)) continue;
    if (sg.kind === KIND_AVENUE && ys.every(z => Math.abs(z - 46.5) < 0.2)) { sg.parking = true; sg.trees = true; }
    if (sg.kind === KIND_ROAD && ys.every(z => Math.abs(z - 20.5) < 0.2) && Math.max(...xs) <= 22.6) sg.parking = true;
    if (sg.kind === KIND_ROAD && ys.every(z => Math.abs(z - 36.5) < 0.2) && Math.max(...xs) <= 22.6) sg.trees = true;
  }
  // x 70.5: narrow lanes with a bend and a dead end; below, a five-way junction.
  street([{ x: 70.5, z: 24.5 }, { x: 66, z: 26 }, { x: 64.5, z: 29.5 }], KIND_LANE);
  street([{ x: 70.5, z: 28.5 }, { x: 73, z: 29.5 }], KIND_LANE);
  street([{ x: 70.5, z: 36.5 }, { x: 74.5, z: 40.5 }]);
  net.version++;
  populate(d, net, terrain);
  // Bus stops along the bus-lane avenue, and a pair on a plain street for lay-bys.
  const ras = rasterize(net);
  for (const [x, z] of [[55, 22], [61, 22], [26, 26], [26, 32]]) {
    for (let r = 0; r < 3; r++) {
      const i = idx(x, z + r);
      if (ras.accSeg[i] >= 0 && !ras.cover[i] && d.kind[i] < T_COAL) { d.kind[i] = T_BUS; d.level[i] = 1; break; }
    }
  }
  return d;
}

/**
 * Highway lab: a two-lane highway north to south with an exit and an entrance (the ramps' own lanes),
 * roads up on levels 1 to 3 crossing each other and the streets below, ramps up and down between
 * levels (a level-2 road coming straight down to the ground, an exit off a level-1 road dropping to
 * the ground), a tunnel under the grid, and the avenue's bridge over the river.
 */
export function highwayLab(): SaveData {
  const { d, net, terrain, street } = mapStart();
  street([{ x: 6.5, z: 12.5 }, { x: 74.5, z: 12.5 }], KIND_AVENUE);
  street([{ x: 18.5, z: HIGHWAY_END + 5 }, { x: 18.5, z: 12.5 }]);
  for (const z of [24.5, 36.5, 46.5]) street([{ x: 6.5, z }, { x: 74.5, z }]);
  for (const x of [6.5, 30.5, 50.5, 74.5]) street([{ x, z: 12.5 }, { x, z: 46.5 }]);
  // A two-lane highway running north, with an exit and an entrance and their own lanes.
  net.insertPath([{ x: 40.5, z: 46.5 }, { x: 40.5, z: 12.5 }], KIND_HIGHWAY2);
  const exit = net.insertPath([{ x: 40.5, z: 40 }, { x: 42, z: 35 }, { x: 45, z: 32.5 }, { x: 50.5, z: 31.5 }], KIND_RAMP);
  const entry = net.insertPath([{ x: 50.5, z: 27.5 }, { x: 45, z: 26.5 }, { x: 42, z: 24 }, { x: 40.5, z: 19 }], KIND_RAMP);
  net.addRampLanes([...exit, ...entry]);
  // Up in the air, every road coming down onto a street at each end: a level-1 road across the west of
  // the grid, a level-2 road over it north to south, and a level-3 road over both, on the diagonal.
  const up = (pts: Pt[], levels: [number, number]): number[] => net.insertPath(pts, KIND_ROAD, false, 1, true, levels);
  up([{ x: 6.5, z: 30.5 }, { x: 11, z: 30.5 }], [0, 1]);
  up([{ x: 11, z: 30.5 }, { x: 26, z: 30.5 }], [1, 1]);
  up([{ x: 26, z: 30.5 }, { x: 30.5, z: 30.5 }], [1, 0]);
  up([{ x: 18.5, z: 12.5 }, { x: 18.5, z: 19 }], [0, 2]);
  up([{ x: 18.5, z: 19 }, { x: 18.5, z: 40 }], [2, 2]);
  up([{ x: 18.5, z: 40 }, { x: 18.5, z: 46.5 }], [2, 0]);
  up([{ x: 6.5, z: 16 }, { x: 11, z: 20.5 }], [0, 3]);
  up([{ x: 11, z: 20.5 }, { x: 26, z: 35.5 }], [3, 3]);
  up([{ x: 26, z: 35.5 }, { x: 30.5, z: 42.5 }], [3, 0]);
  // An exit off the level-1 road that drops to the ground.
  up([{ x: 22, z: 30.5 }, { x: 25.5, z: 27.5 }, { x: 30.5, z: 26.5 }], [1, 0]);
  // A tunnel under the east of the grid.
  net.insertPath([{ x: 50.5, z: 16 }, { x: 54, z: 16 }], KIND_ROAD, false, 2, true, [0, -1]);
  net.insertPath([{ x: 54, z: 16 }, { x: 70, z: 40 }], KIND_ROAD, false, 2, true, [-1, -1]);
  net.insertPath([{ x: 70, z: 40 }, { x: 74.5, z: 42 }], KIND_ROAD, false, 2, true, [-1, 0]);
  net.version++;
  populate(d, net, terrain);
  return d;
}
