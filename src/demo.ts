import { T_CEMETERY, T_POST_OFFICE } from './constants';
import { defaultExtras } from './extras';
import { DOOR } from './game';
import { T_OFFICE, T_BUS, T_STATION, T_SUBWAY, T_AIRPORT, T_TREATMENT, SERVICES } from './constants';
import { footprint, siteOwners } from './sites';
import { T_PARK, T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE, T_RECYCLING, T_UNIVERSITY, T_SOLAR, GRID, N_TILES, T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET, idx, inBounds } from './constants';
import { Network, KIND_AVENUE, KIND_ROAD, ROUNDABOUT_RADIUS } from './roads/network';
import { rasterize } from './roads/raster';
import { generateTerrain, touchesWater, adjacentFlow } from './terrain';
import { newCity } from './game';
import type { SaveData } from './save';

const DEMO_SEED = 214;

/**
 * A prebuilt town laid out relative to the highway entry, so it works on any seed:
 * a main avenue, a street grid, a curved ring road, a riverside drive, zoning and utilities.
 */
export function demoCity(expanded = false): SaveData {
  const d = newCity(DEMO_SEED);
  const terrain = generateTerrain(DEMO_SEED);
  const net = Network.fromPlain(d.net);
  const e = terrain.entry;
  // The demo was laid out from a highway stub that ended 7.5 cells in; the interchange's street node
  // is further in now, so the whole plan slides inward with it.
  const shift = DOOR - 7.5;
  const P = (along: number, side: number): { x: number; z: number } => ({
    x: e.x + e.dx * (along + 0.5 + shift) - e.dz * side,
    z: e.z + e.dz * (along + 0.5 + shift) + e.dx * side,
  });
  const clampP = (p: { x: number; z: number }): { x: number; z: number } => ({
    x: Math.max(1.5, Math.min(GRID - 1.5, p.x)), z: Math.max(1.5, Math.min(GRID - 1.5, p.z)),
  });

  // Streets.
  // The avenue starts at the interchange's street node, at the foot of the overpass.
  net.insertPath([P(7, 0), P(40, 0)], KIND_AVENUE);
  for (const side of [-12, -6, 6, 12]) net.insertPath([clampP(P(10, side)), clampP(P(40, side))], KIND_ROAD);
  for (const along of [10, 16, 22, 28, 34, 40]) net.insertPath([clampP(P(along, -12)), clampP(P(along, 12))], KIND_ROAD);
  // Suburbs: a curved crescent beyond the grid, reached by extended side streets.
  net.insertPath([P(10, -12), P(12, -17), P(18, -21), P(26, -21), P(32, -17), P(34, -12)].map(clampP), KIND_ROAD);
  for (const along of [16, 22, 28]) net.insertPath([clampP(P(along, -12)), clampP(P(along, -20))], KIND_ROAD);
  // A curved ring road around the far end.
  net.insertPath([P(40, 12), P(44, 9), P(46, 0), P(44, -9), P(40, -12)].map(clampP), KIND_ROAD);

  // Riverside drive, joined to the end of the avenue.
  let best = -1, bd = 1e9;
  const anchor = P(43, 0);
  terrain.river.forEach((r, j) => {
    if (r.x < 4 || r.z < 4 || r.x > GRID - 4 || r.z > GRID - 4) return;
    const dd = Math.hypot(r.x - anchor.x, r.z - anchor.z);
    if (dd < bd) { bd = dd; best = j; }
  });
  if (best >= 0) {
    // Dry within half a road width plus a margin, so the drive never ends up lying on the water.
    const dry = (x: number, z: number): boolean => {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const tx = Math.floor(x + dx * 0.9), tz = Math.floor(z + dz * 0.9);
        if (!inBounds(tx, tz) || terrain.water[idx(tx, tz)]) return false;
      }
      return true;
    };
    // Split a polyline into the runs that stay on dry land the whole way.
    const dryRuns = (points: { x: number; z: number }[]): { x: number; z: number }[][] => {
      const runs: { x: number; z: number }[][] = [];
      let run: { x: number; z: number }[] = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const reachable = i === 0 || (() => {
          const q = points[i - 1], steps = Math.ceil(Math.hypot(p.x - q.x, p.z - q.z) / 0.25);
          for (let k = 0; k <= steps; k++) if (!dry(q.x + (p.x - q.x) * k / steps, q.z + (p.z - q.z) * k / steps)) return false;
          return true;
        })();
        if (dry(p.x, p.z) && reachable) run.push(p);
        else { if (run.length >= 2) runs.push(run); run = dry(p.x, p.z) ? [p] : []; }
      }
      if (run.length >= 2) runs.push(run);
      return runs;
    };
    const bank: { x: number; z: number }[] = [];
    for (let j = best - 16; j <= best + 16; j += 4) {
      const a = terrain.river[Math.max(0, Math.min(terrain.river.length - 2, j))];
      const b = terrain.river[Math.max(1, Math.min(terrain.river.length - 1, j + 1))];
      let nx = -(b.z - a.z), nz = b.x - a.x;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      // Pick the bank on the city side.
      if ((anchor.x - a.x) * nx + (anchor.z - a.z) * nz < 0) { nx = -nx; nz = -nz; }
      const p = clampP({ x: Math.floor(a.x + nx * (a.w + 2.6)) + 0.5, z: Math.floor(a.z + nz * (a.w + 2.6)) + 0.5 });
      if (!bank.length || Math.hypot(p.x - bank.at(-1)!.x, p.z - bank.at(-1)!.z) > 0.6) bank.push(p);
    }
    const runs = dryRuns(bank);
    for (const run of runs) net.insertPath(run, KIND_ROAD);
    // Join the longest dry stretch to the end of the avenue, again only over dry land.
    const drive = runs.sort((a, b) => b.length - a.length)[0];
    if (drive) {
      const mid = drive[Math.floor(drive.length / 2)];
      const from = clampP(P(46, 0));
      const link = dryRuns([from, mid]);
      if (link.length === 1 && link[0].length === 2) net.insertPath(link[0], KIND_ROAD);
    }
  }

  // A bridge from the far corner of the grid over the river.
  const deck = [P(47, -20), P(68, -20)].map(clampP);
  if (!terrain.water[idx(Math.floor(deck[0].x), Math.floor(deck[0].z))] && !terrain.water[idx(Math.floor(deck[1].x), Math.floor(deck[1].z))]) {
    net.insertPath([clampP(P(40, -12)), clampP(P(44, -16)), deck[0]], KIND_ROAD);
    net.insertPath(deck, KIND_ROAD, false, 1);
    net.insertPath([deck[1], clampP(P(76, -20))], KIND_ROAD);
  }

  // Traffic control on the avenue.
  const rb = P(22, 0);
  net.addRoundabout(rb.x, rb.z, ROUNDABOUT_RADIUS[KIND_AVENUE], KIND_AVENUE);
  for (const along of [16, 28, 34]) {
    const p = P(along, 0);
    const n = net.nearestNode(p.x, p.z, 1.0);
    if (n && net.degree(n.id) >= 3) n.light = true;
  }

  // Curved pieces can still bow across a bank, so drop any surface road left standing on water.
  for (const seg of [...net.segs.values()]) {
    if (seg.structure) continue;
    let wet = false;
    for (let i = 0; i <= seg.n && !wet; i++) {
      const x = Math.floor(seg.pts[i * 2]), z = Math.floor(seg.pts[i * 2 + 1]);
      wet = inBounds(x, z) && terrain.water[idx(x, z)] === 1;
    }
    if (wet) net.removeSeg(seg.id);
  }

  // Removing a span can strand a stretch of road; drop anything the highway can no longer reach.
  const entryNode = [...net.nodes.values()].find(n => n.entry) ?? [...net.nodes.values()][0];
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

  // Zoning from the rasterized network.
  const ras = rasterize(net);
  const kind = new Uint8Array(N_TILES);
  const free = (i: number, bank = false): boolean => !terrain.water[i] && (bank || !terrain.shore[i]) && !ras.cover[i] && ras.accSeg[i] >= 0;
  for (let i = 0; i < N_TILES; i++) {
    if (!free(i)) continue;
    const px = (i % GRID) + 0.5 - e.x, pz = ((i / GRID) | 0) + 0.5 - e.z;
    const along = px * e.dx + pz * e.dz;
    const side = Math.abs(-px * e.dz + pz * e.dx);
    const signed = -px * e.dz + pz * e.dx;
    if (along > 43 || signed > 14 || signed < -23) continue;
    if (along >= 36.5) kind[i] = T_IND;
    else if (along >= 32.5) kind[i] = (i + ((i / GRID) | 0)) % 3 ? T_PARK : 0; // green belt between industry and homes
    else if (side < 3.5 && along > 11) kind[i] = T_COM;
    else kind[i] = T_RES;
  }

  // Pocket parks break up the residential blocks.
  for (const [along, side] of [[13, 8.5], [19, -9], [25, 9], [30, -15], [14, -15], [24, -18]]) {
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
      const p = P(along + dx, side + dz), x = Math.floor(p.x), z = Math.floor(p.z);
      if (inBounds(x, z) && kind[idx(x, z)] === T_RES) kind[idx(x, z)] = T_PARK;
    }
  }

  // Utilities.
  const place = (near: { x: number; z: number }, k: number, ok: (i: number, x: number, z: number) => boolean, bank = false): boolean => {
    for (let r = 0; r < 9; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = Math.floor(near.x) + dx, z = Math.floor(near.z) + dz;
          if (!inBounds(x, z)) continue;
          const i = idx(x, z);
          if (free(i, bank) && kind[i] < T_COAL && ok(i, x, z)) { kind[i] = k; return true; }
        }
      }
    }
    return false;
  };
  const any = (): boolean => true;
  place(P(42, -10), T_COAL, any);
  place(P(42, -7), T_COAL, any);
  place(P(41, 9), T_WIND, any);
  place(P(41, 11), T_WIND, any);
  place(P(38, 13), T_WIND, any);
  place(P(43, 6), T_WIND, any);
  place(P(43, -4), T_WIND, any);
  place(P(11, 13), T_TOWER, any);
  place(P(11, -13), T_TOWER, any);
  // Pump upstream, outlet downstream, both on the bank beside the riverside drive.
  let up = -1, down = -1, upFlow = 1e9, downFlow = -1;
  for (let i = 0; i < N_TILES; i++) {
    const x = i % GRID, z = (i / GRID) | 0;
    if (!free(i, true) || !touchesWater(terrain, x, z)) continue;
    const f = adjacentFlow(terrain, x, z);
    if (f < upFlow) { upFlow = f; up = i; }
    if (f > downFlow) { downFlow = f; down = i; }
  }
  if (up >= 0) {
    kind[up] = T_PUMP;
    place({ x: up % GRID, z: (up / GRID) | 0 }, T_PUMP, (_i, x, z) => touchesWater(terrain, x, z) && adjacentFlow(terrain, x, z) < upFlow + 12, true);
  }
  if (down >= 0 && down !== up) {
    kind[down] = T_OUTLET;
    // A second outlet right beside the first so sewage capacity keeps up.
    place({ x: down % GRID, z: (down / GRID) | 0 }, T_OUTLET, (_i, x, z) => touchesWater(terrain, x, z) && adjacentFlow(terrain, x, z) > upFlow + 20, true);
  }

  // Neighborhood centers demonstrate service coverage on both sides of the avenue.
  for (const side of [-8, 8]) {
    place(P(19, side), T_PARK, any);
    place(P(21, side), T_CLINIC, any);
    place(P(23, side), T_SCHOOL, any);
    place(P(25, side), T_FIRE, any);
    place(P(27, side), T_POLICE, any);
  }
  place(P(32, 10), T_RECYCLING, any);
  place(P(28, -10), T_UNIVERSITY, any);
  place(P(40, 6), T_SOLAR, any);

  if (expanded) {
    place(P(12, -5), T_BUS, any); place(P(28, -5), T_BUS, any);
    place(P(18, 8), T_BUS, any); place(P(40, 8), T_BUS, any);
    for (let i = 0; i < N_TILES; i++) if (kind[i] === T_COM && i % 3 === 0) kind[i] = T_OFFICE;
    if (down >= 0) kind[down] = T_TREATMENT;
    const placeLarge = (near: { x: number; z: number }, k: number): void => {
      const owners = siteOwners(kind);
      const choices = Array.from({ length: N_TILES }, (_, i) => i).sort((a, b) => Math.hypot(a % GRID - near.x, Math.floor(a / GRID) - near.z) - Math.hypot(b % GRID - near.x, Math.floor(b / GRID) - near.z));
      for (const i of choices) {
        const cells = footprint(i, k);
        if (!cells.length || ras.accSeg[i] < 0 || cells.some(t => terrain.water[t] || terrain.shore[t] || ras.cover[t] || SERVICES[kind[t]] || owners[t] >= 0)) continue;
        for (const t of cells) kind[t] = 0;
        kind[i] = k; return;
      }
    };
    // One station within reach of a motorway gate, so it runs intercity trains, and one downtown.
    const front = e.dx ? e.z : e.x;
    const gates = [0.5, GRID - 0.5].map(along => (e.dx ? { x: e.x + e.dx * 4, z: along } : { x: along, z: e.z + e.dz * 4 }));
    const nearGate = [front - 0.5, 0.5 - front, front - GRID + 0.5, GRID - 0.5 - front]
      .map(side => clampP(P(11, side + (side > 0 ? -9 : 9))))
      .find(q => gates.some(gt => Math.hypot(gt.x - q.x, gt.z - q.z) < 22)) ?? P(14, -10);
    placeLarge(nearGate, T_STATION); placeLarge(P(36, 10), T_STATION);
    place(P(17, 2), T_SUBWAY, any); place(P(29, -2), T_SUBWAY, any); place(P(24, -14), T_SUBWAY, any);
    placeLarge(P(48, 14), T_AIRPORT);
    // Deathcare and a post office, which towers need once the city is a City.
    placeLarge(P(33, -13), T_CEMETERY);
    place(P(22, 5), T_POST_OFFICE, any);
  }

  const level = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) if (kind[i] >= T_COAL) level[i] = 1;
  return { seed: DEMO_SEED, kind, level, net: net.toPlain(), money: expanded ? 40000 : 12000, cityLevel: expanded ? 5 : 0, tick: 0, tax: 10, extras: defaultExtras(10) };
}
