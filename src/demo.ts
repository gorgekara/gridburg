import { defaultExtras } from './extras';
import { highwayLayout, HIGHWAY_END } from './game';
import {
  GRID, N_TILES, idx, inBounds, SERVICES,
  T_RES, T_COM, T_IND, T_OFFICE, T_LEISURE, T_FARM, T_PARK, T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE, T_RECYCLING, T_UNIVERSITY,
  T_COAL, T_WIND, T_SOLAR, T_GAS, T_PUMP, T_TOWER, T_OUTLET, T_TREATMENT, T_BUS, T_STATION, T_SUBWAY, T_AIRPORT, T_TAXI,
  T_PLAYGROUND, T_SPORTS, T_GARDEN, T_HOSPITAL, T_CITY_HOSPITAL, T_POLICE_HQ, T_CEMETERY, T_CREMATORIUM, T_POST_OFFICE,
  T_DOCKS, T_LANDMARK, T_NUCLEAR,
} from './constants';
import { footprint, siteOwners } from './sites';
import { Network, KIND_AVENUE, KIND_ROAD, ROUNDABOUT_RADIUS } from './roads/network';
import { rasterize } from './roads/raster';
import { generateTerrain, touchesWater, adjacentFlow } from './terrain';
import { newCity } from './game';
import type { SaveData } from './save';

const DEMO_SEED = 214;

type Pt = { x: number; z: number };

/**
 * A prebuilt city that fills the whole map of the demo seed. The two-lane highway comes in at the top
 * left; the river rises in the west, loops south round a peninsula and leaves at the east edge.
 *
 *  - North bank, the old city: a street grid on six-cell blocks with two cross-town avenues, a
 *    downtown of shops and offices round a roundabout, heavy industry in the north-east behind a
 *    green belt, and curving suburbs in the north-west.
 *  - The peninsula inside the river's loop: parkland, leisure and a landmark, ringed by the drive.
 *  - South bank, the new town: three bridges and a road round the river's source lead to a second
 *    grid with its own centre, farms in the south-west and industry in the south-east by the airport.
 *
 * Riverside drives run along both banks. Every district has its clinic, school, fire and police, and
 * power, water and sewage are sized for the whole city.
 */
export function demoCity(expanded = false): SaveData {
  const d = newCity(DEMO_SEED);
  const terrain = generateTerrain(DEMO_SEED);
  const net = Network.fromPlain(d.net);
  const water = terrain.water;
  const clamp = (p: Pt): Pt => ({ x: Math.max(1.5, Math.min(GRID - 1.5, p.x)), z: Math.max(1.5, Math.min(GRID - 1.5, p.z)) });

  // ---- roads ---------------------------------------------------------------------------------------
  // Dry within half a road width plus a margin, so no street ends up lying in the river.
  const dry = (x: number, z: number): boolean => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const tx = Math.floor(x + dx * 0.9), tz = Math.floor(z + dz * 0.9);
      if (!inBounds(tx, tz) || water[idx(tx, tz)]) return false;
    }
    return true;
  };
  // Split a polyline into the runs that stay on dry land the whole way.
  const dryRuns = (points: Pt[]): Pt[][] => {
    const runs: Pt[][] = [];
    let run: Pt[] = [];
    const flush = (): void => { if (run.length >= 2) runs.push(run); run = []; };
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (i > 0) {
        const q = points[i - 1], steps = Math.ceil(Math.hypot(p.x - q.x, p.z - q.z) / 0.25);
        for (let k = 1; k < steps; k++) {
          const x = q.x + (p.x - q.x) * k / steps, z = q.z + (p.z - q.z) * k / steps;
          if (!dry(x, z)) { flush(); break; }
        }
      }
      if (dry(p.x, p.z)) run.push(p); else flush();
    }
    flush();
    return runs;
  };
  /** A street along guide points, kept to dry land: where it would cross water it simply stops. */
  const street = (points: Pt[], kind = KIND_ROAD): void => {
    // Sample straight runs finely enough that a crossing of the river is found and cut out.
    const fine: Pt[] = [];
    points.map(clamp).forEach((p, i, all) => {
      if (i === 0) { fine.push(p); return; }
      const q = all[i - 1], n = Math.max(1, Math.round(Math.hypot(p.x - q.x, p.z - q.z) / 3));
      for (let k = 1; k <= n; k++) fine.push({ x: q.x + (p.x - q.x) * k / n, z: q.z + (p.z - q.z) * k / n });
    });
    for (const run of dryRuns(fine)) {
      // Keep the path's own corners, drop the in-between samples on straight stretches.
      const kept = run.filter((p, k) => k === 0 || k === run.length - 1 || points.some(g => Math.hypot(g.x - p.x, g.z - p.z) < 0.01) || k % 4 === 0);
      net.insertPath(kept, kind);
    }
  };
  const bridge = (from: Pt, to: Pt, kind = KIND_ROAD): void => {
    if (!dry(from.x, from.z) || !dry(to.x, to.z)) return;
    net.insertPath([from, to], kind, false, 1);
  };

  // The way in: both carriageways of the crossing highway curve into the western avenue.
  const layout = highwayLayout(terrain);
  const inX = layout.x1, outX = layout.x2;
  const gate: Pt = { x: 18.5, z: HIGHWAY_END + 5 };
  for (const x of [inX, outX]) net.insertPath([{ x, z: HIGHWAY_END }, { x, z: HIGHWAY_END + 2.5 }, gate], KIND_ROAD);

  // North bank: the grid.
  const W = 6.5, E = 74.5;
  street([{ x: W, z: 12.5 }, { x: E, z: 12.5 }], KIND_AVENUE); // the gateway boulevard
  street([{ x: 2.5, z: 24.5 }, { x: 77.5, z: 24.5 }], KIND_AVENUE); // the cross-town avenue
  for (const z of [18.5, 30.5, 36.5, 42.5]) street([{ x: z > 29 ? 24.5 : W, z }, { x: E, z }]);
  street([gate, { x: 18.5, z: 12.5 }, { x: 18.5, z: 50.5 }], KIND_AVENUE); // the western avenue, on to the bridge
  street([{ x: 42.5, z: 6.5 }, { x: 42.5, z: 60.5 }], KIND_AVENUE); // the central avenue, down the peninsula
  for (const x of [6.5, 12.5, 24.5, 30.5, 36.5, 48.5, 54.5, 60.5, 72.5]) {
    // Industry in the north-east has big blocks: fewer streets there.
    street([{ x, z: x >= 60 ? 12.5 : 6.5 }, { x, z: 50.5 }]);
  }
  street([{ x: 66.5, z: 24.5 }, { x: 66.5, z: 50.5 }]);
  street([{ x: 30.5, z: 6.5 }, { x: 72.5, z: 6.5 }]); // service road along the north edge
  // North-west suburbs: crescents instead of a grid.
  street([{ x: 6.5, z: 30.5 }, { x: 9, z: 36 }, { x: 14, z: 40 }, { x: 18.5, z: 41.5 }]);
  street([{ x: 6.5, z: 38.5 }, { x: 9.5, z: 44 }, { x: 14, z: 47 }, { x: 18.5, z: 47.5 }]);
  street([{ x: 12.5, z: 30.5 }, { x: 15, z: 33.5 }, { x: 18.5, z: 34.5 }]);
  street([{ x: 6.5, z: 30.5 }, { x: 18.5, z: 30.5 }]);

  // Riverside drives on both banks, a little way back from the water.
  const bankDrive = (towards: Pt, from: number, to: number, skip: (p: Pt) => boolean = () => false): void => {
    let pts: Pt[] = [];
    const runs: Pt[][] = [];
    for (let j = from; j <= to; j += 3) {
      const a = terrain.river[Math.max(0, Math.min(terrain.river.length - 2, j))];
      const b = terrain.river[Math.max(1, Math.min(terrain.river.length - 1, j + 1))];
      let nx = -(b.z - a.z), nz = b.x - a.x;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if ((towards.x - a.x) * nx + (towards.z - a.z) * nz < 0) { nx = -nx; nz = -nz; }
      const p = { x: Math.floor(a.x + nx * (a.w + 2.7)) + 0.5, z: Math.floor(a.z + nz * (a.w + 2.7)) + 0.5 };
      if (skip(p)) { runs.push(pts); pts = []; continue; }
      if (!pts.length || Math.hypot(p.x - pts.at(-1)!.x, p.z - pts.at(-1)!.z) > 1.2) pts.push(p);
    }
    runs.push(pts);
    for (const part of runs) for (const run of dryRuns(part.map(clamp))) net.insertPath(run, KIND_ROAD);
  };
  const n = terrain.river.length;
  // The north drive stays off the peninsula: its banks are too close together for a road each side.
  bankDrive({ x: 40, z: 20 }, 0, n - 1, p => p.x > 31 && p.x < 51 && p.z > 52);
  bankDrive({ x: 40, z: 78 }, 0, n - 1);

  // Crossings: the western avenue and the central avenue carry on over the river, a road bridge in
  // the east, and a road round the river's source in the west.
  bridge({ x: 18.5, z: 50.5 }, { x: 18.5, z: 60.5 }, KIND_AVENUE);
  bridge({ x: 42.5, z: 60.5 }, { x: 42.5, z: 68.5 }, KIND_AVENUE);
  bridge({ x: 60.5, z: 50.5 }, { x: 60.5, z: 62.5 });
  street([{ x: 2.5, z: 24.5 }, { x: 2.5, z: 64.5 }]);


  // South bank: the new town.
  street([{ x: 2.5, z: 70.5 }, { x: 77.5, z: 70.5 }], KIND_AVENUE);
  street([{ x: 2.5, z: 64.5 }, { x: 77.5, z: 64.5 }]);
  street([{ x: 2.5, z: 76.5 }, { x: 54.5, z: 76.5 }]);
  street([{ x: 18.5, z: 60.5 }, { x: 18.5, z: 77.5 }], KIND_AVENUE);
  street([{ x: 42.5, z: 68.5 }, { x: 42.5, z: 77.5 }], KIND_AVENUE);
  // The south-east corner below the avenue is left open for the airfield.
  for (const x of [8.5, 12.5, 24.5, 30.5, 36.5, 48.5, 54.5, 60.5, 66.5, 72.5]) street([{ x, z: 58.5 }, { x, z: x > 56 ? 70.5 : 77.5 }]);

  // Traffic control: roundabouts at the two centres, lights where avenues cross.
  net.addRoundabout(42.5, 24.5, ROUNDABOUT_RADIUS[KIND_AVENUE], KIND_AVENUE);
  net.addRoundabout(42.5, 70.5, ROUNDABOUT_RADIUS[KIND_AVENUE], KIND_AVENUE);
  for (const [x, z] of [[18.5, 12.5], [18.5, 24.5], [42.5, 12.5], [18.5, 70.5], [30.5, 24.5], [54.5, 24.5], [42.5, 36.5], [42.5, 18.5]]) {
    const node = net.nearestNode(x, z, 1.0);
    if (node && net.degree(node.id) >= 3 && !node.ring) node.light = true;
  }

  // Anything left standing in the water, or cut off from the highway, goes.
  for (const seg of [...net.segs.values()]) {
    if (seg.structure || seg.fixed) continue;
    for (let i = 0; i <= seg.n; i++) {
      const x = Math.floor(seg.pts[i * 2]), z = Math.floor(seg.pts[i * 2 + 1]);
      if (inBounds(x, z) && water[idx(x, z)]) { net.removeSeg(seg.id); break; }
    }
  }
  const entryNode = [...net.nodes.values()].find(nd => nd.entry) ?? [...net.nodes.values()][0];
  if (entryNode) {
    const seen = new Set<number>([entryNode.id]), queue = [entryNode.id];
    for (let head = 0; head < queue.length; head++) {
      for (const seg of net.segsAt(queue[head])) {
        const other = seg.a === queue[head] ? seg.b : seg.a;
        if (!seen.has(other)) { seen.add(other); queue.push(other); }
      }
    }
    for (const seg of [...net.segs.values()]) if (!seen.has(seg.a) && !seen.has(seg.b)) net.removeSeg(seg.id);
  }

  // ---- zoning --------------------------------------------------------------------------------------
  const ras = rasterize(net);
  const kind = new Uint8Array(N_TILES);
  const free = (i: number, bank = false): boolean => !water[i] && (bank || !terrain.shore[i]) && !ras.cover[i] && ras.accSeg[i] >= 0;
  const hash = (i: number): number => ((i * 2654435761) >>> 0) % 100;
  for (let i = 0; i < N_TILES; i++) {
    if (!free(i)) continue;
    const x = i % GRID + 0.5, z = Math.floor(i / GRID) + 0.5;
    const peninsula = x > 30 && x < 52 && z > 49 && z < 64;
    const south = z > 58 && !peninsula;
    const nearRiver = (() => { for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const tx = Math.floor(x) + dx, tz = Math.floor(z) + dz; if (inBounds(tx, tz) && water[idx(tx, tz)]) return true; } return false; })();
    // Shops line the avenues, a block deep on each side.
    const onAvenue = Math.abs(z - 12.5) < 3.2 || Math.abs(z - 24.5) < 3.2 || Math.abs(x - 42.5) < 3.2 || Math.abs(x - 18.5) < 3.2 && z > 10 || Math.abs(z - 70.5) < 3.2;
    let k: number;
    if (peninsula) k = hash(i) < 55 ? T_LEISURE : T_PARK;
    else if (!south && x > 58 && z < 21) k = T_IND; // north-east industry
    else if (!south && x > 55 && z < 24 || !south && x > 58 && z < 26) k = hash(i) < 70 ? T_PARK : 0; // green belt
    else if (south && x > 56 && z > 67) k = T_IND; // south-east industry, by the airport
    else if (south && x < 22 && z > 72) k = T_FARM;
    else if (Math.abs(x - 42.5) < 10 && Math.abs(z - 24.5) < 9) k = T_COM; // downtown
    else if (Math.abs(x - 42.5) < 7 && Math.abs(z - 70.5) < 5) k = T_COM; // the south centre
    else if (nearRiver && hash(i) < 45) k = T_LEISURE;
    else if (onAvenue && hash(i) < 80) k = T_COM;
    else k = T_RES;
    kind[i] = k;
  }
  // Pocket parks and playing fields break up the residential blocks.
  for (let i = 0; i < N_TILES; i++) if (kind[i] === T_RES && hash(i) < 5) kind[i] = T_PARK;

  // ---- services and utilities ----------------------------------------------------------------------
  const place = (near: Pt, k: number, ok: (i: number, x: number, z: number) => boolean = () => true, bank = false): boolean => {
    // Never inside the lot of a large building placed earlier.
    const owners = siteOwners(kind);
    for (let r = 0; r < 10; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = Math.floor(near.x) + dx, z = Math.floor(near.z) + dz;
        if (!inBounds(x, z)) continue;
        const i = idx(x, z);
        if (free(i, bank) && kind[i] < T_COAL && owners[i] < 0 && ok(i, x, z)) { kind[i] = k; return true; }
      }
    }
    return false;
  };
  const placeLarge = (near: Pt, k: number): boolean => {
    const owners = siteOwners(kind);
    const choices = Array.from({ length: N_TILES }, (_, i) => i)
      .filter(i => Math.hypot(i % GRID - near.x, Math.floor(i / GRID) - near.z) < 14)
      .sort((a, b) => Math.hypot(a % GRID - near.x, Math.floor(a / GRID) - near.z) - Math.hypot(b % GRID - near.x, Math.floor(b / GRID) - near.z));
    for (const i of choices) {
      const cells = footprint(i, k);
      if (!cells.length || ras.accSeg[i] < 0 || cells.some(t => water[t] || terrain.shore[t] || ras.cover[t] || SERVICES[kind[t]] || owners[t] >= 0)) continue;
      for (const t of cells) kind[t] = 0;
      kind[i] = k;
      return true;
    }
    return false;
  };

  // Power: coal and gas with the industry, a wind farm on the eastern edge, solar in the south.
  for (const p of [{ x: 70, z: 9 }, { x: 74, z: 16 }, { x: 64, z: 14 }, { x: 62, z: 5 }, { x: 76, z: 6 }]) place(p, T_COAL);
  place({ x: 70, z: 68 }, T_GAS); place({ x: 58, z: 67 }, T_GAS);
  for (let z = 30; z <= 44; z += 2) place({ x: 77, z }, T_WIND);
  for (const x of [8, 11, 14]) place({ x, z: 78 }, T_WIND);
  place({ x: 26, z: 78 }, T_SOLAR); place({ x: 50, z: 78 }, T_SOLAR);

  // Water: pumps upstream near the source, outlets downstream towards the mouth; towers round town.
  const bankTiles: { i: number; f: number }[] = [];
  for (let i = 0; i < N_TILES; i++) {
    const x = i % GRID, z = Math.floor(i / GRID);
    if (free(i, true) && touchesWater(terrain, x, z)) bankTiles.push({ i, f: adjacentFlow(terrain, x, z) });
  }
  bankTiles.sort((a, b) => a.f - b.f);
  const upstream = bankTiles.slice(0, Math.max(1, Math.floor(bankTiles.length * 0.25)));
  const downstream = bankTiles.slice(Math.floor(bankTiles.length * 0.8));
  const pick = (list: { i: number }[], count: number, k: number): number[] => {
    const chosen: number[] = [];
    for (let s = 0; s < list.length && chosen.length < count; s += Math.max(1, Math.floor(list.length / count))) {
      const { i } = list[s];
      if (kind[i] >= T_COAL) continue;
      kind[i] = k; chosen.push(i);
    }
    return chosen;
  };
  pick(upstream, 9, T_PUMP);
  const outlets = pick(downstream, 9, T_OUTLET);
  for (const p of [{ x: 8, z: 16 }, { x: 30, z: 40 }, { x: 56, z: 34 }, { x: 70, z: 44 }, { x: 10, z: 66 }, { x: 34, z: 76 }, { x: 64, z: 60 }]) place(p, T_TOWER);

  // Every district gets its everyday services.
  const districts: Pt[] = [
    { x: 11, z: 18 }, { x: 28, z: 16 }, { x: 52, z: 16 },
    { x: 11, z: 40 }, { x: 28, z: 34 }, { x: 52, z: 34 }, { x: 68, z: 34 },
    { x: 10, z: 68 }, { x: 28, z: 70 }, { x: 52, z: 66 }, { x: 66, z: 62 },
  ];
  for (const c of districts) {
    place(c, T_CLINIC); place({ x: c.x + 2, z: c.z }, T_SCHOOL); place({ x: c.x + 3, z: c.z - 2 }, T_SCHOOL);
    place({ x: c.x, z: c.z + 2 }, T_FIRE); place({ x: c.x + 2, z: c.z + 2 }, T_POLICE);
    place({ x: c.x - 2, z: c.z }, T_PLAYGROUND);
  }
  for (const p of [{ x: 60, z: 28 }, { x: 62, z: 60 }, { x: 8, z: 22 }, { x: 30, z: 46 }, { x: 14, z: 74 }, { x: 36, z: 8 }]) place(p, T_RECYCLING);
  for (const p of [{ x: 20, z: 20 }, { x: 58, z: 44 }, { x: 4, z: 58 }]) place(p, T_FIRE);
  // A lattice of the services every street needs within reach, so no neighbourhood falls between districts.
  for (let z = 8; z < GRID; z += 14) for (let x = 8; x < GRID; x += 14) {
    place({ x, z }, T_FIRE); place({ x: x + 3, z }, T_POLICE);
    place({ x: x + 6, z: z + 3 }, T_CLINIC); place({ x: x + 3, z: z + 6 }, T_SCHOOL); place({ x: x + 7, z: z + 7 }, T_SCHOOL);
    if ((x + z) % 28 === 16) place({ x, z: z + 3 }, T_RECYCLING);
  }

  if (expanded) {
    // Offices in the centres, big civic buildings, transit and the airport.
    for (let i = 0; i < N_TILES; i++) if (kind[i] === T_COM && hash(i) < 45) kind[i] = T_OFFICE;
    // A city this size treats its sewage, so the river runs clear to the falls.
    for (const o of outlets) kind[o] = T_TREATMENT;
    placeLarge({ x: 30, z: 28 }, T_UNIVERSITY);
    placeLarge({ x: 50, z: 30 }, T_CITY_HOSPITAL);
    placeLarge({ x: 24, z: 66 }, T_HOSPITAL);
    placeLarge({ x: 36, z: 18 }, T_POLICE_HQ);
    placeLarge({ x: 40, z: 54 }, T_GARDEN);
    placeLarge({ x: 46, z: 56 }, T_LANDMARK);
    placeLarge({ x: 26, z: 44 }, T_SPORTS);
    placeLarge({ x: 58, z: 72 }, T_SPORTS);
    placeLarge({ x: 8, z: 46 }, T_CEMETERY); placeLarge({ x: 70, z: 48 }, T_CEMETERY);
    place({ x: 76, z: 20 }, T_CREMATORIUM); place({ x: 4, z: 76 }, T_CREMATORIUM);
    for (const p of [{ x: 46, z: 20 }, { x: 38, z: 74 }, { x: 14, z: 30 }, { x: 62, z: 38 }, { x: 26, z: 10 }, { x: 10, z: 62 }, { x: 68, z: 62 }]) place(p, T_POST_OFFICE);
    for (let z = 10; z < GRID; z += 18) for (let x = 12; x < GRID; x += 20) { place({ x, z }, T_POST_OFFICE); place({ x: x + 4, z: z + 4 }, T_CREMATORIUM); }
    placeLarge({ x: 58, z: 16 }, T_NUCLEAR);
    placeLarge({ x: 12, z: 60 }, T_UNIVERSITY);
    // A railway: one station by the highway's gate so trains run out of town, one downtown, one south.
    placeLarge({ x: 24, z: 8 }, T_STATION);
    placeLarge({ x: 50, z: 22 }, T_STATION);
    placeLarge({ x: 36, z: 66 }, T_STATION);
    for (const p of [{ x: 38, z: 22 }, { x: 22, z: 38 }, { x: 58, z: 40 }, { x: 46, z: 72 }, { x: 14, z: 66 }]) place(p, T_SUBWAY);
    for (let z = 10; z <= 46; z += 9) for (let x = 8; x <= 72; x += 12) place({ x, z }, T_BUS);
    for (const x of [8, 26, 50, 68]) place({ x, z: 67 }, T_BUS);
    for (const p of [{ x: 40, z: 27 }, { x: 44, z: 72 }]) place(p, T_TAXI);
    placeLarge({ x: 62, z: 72 }, T_AIRPORT);
    // Fishing docks on the southern bank, downstream of nothing dirty.
    place({ x: 22, z: 60 }, T_DOCKS, (_i, x, z) => touchesWater(terrain, x, z), true);
  }

  const level = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) if (kind[i] >= T_COAL) level[i] = 1;
  return { seed: DEMO_SEED, kind, level, net: net.toPlain(), money: expanded ? 80000 : 20000, cityLevel: expanded ? 5 : 0, tick: 0, tax: 10, extras: defaultExtras(10) };
}
