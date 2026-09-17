import { GRID, N_TILES, T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET, idx, inBounds } from './constants';
import { Network, KIND_AVENUE, KIND_ROAD } from './roads/network';
import { rasterize } from './roads/raster';
import { generateTerrain, touchesWater, adjacentFlow } from './terrain';
import { newCity } from './game';
import type { SaveData } from './save';

const DEMO_SEED = 3;

/**
 * A prebuilt town laid out relative to the highway entry, so it works on any seed:
 * a main avenue, a street grid, a curved ring road, a riverside drive, zoning and utilities.
 */
export function demoCity(): SaveData {
  const d = newCity(DEMO_SEED);
  const terrain = generateTerrain(DEMO_SEED);
  const net = Network.fromPlain(d.net);
  const e = terrain.entry;
  const P = (along: number, side: number): { x: number; z: number } => ({
    x: e.x + e.dx * along - e.dz * side,
    z: e.z + e.dz * along + e.dx * side,
  });
  const clampP = (p: { x: number; z: number }): { x: number; z: number } => ({
    x: Math.max(1.5, Math.min(GRID - 1.5, p.x)), z: Math.max(1.5, Math.min(GRID - 1.5, p.z)),
  });

  // Streets.
  net.insertPath([P(7, 0), P(40, 0)], KIND_AVENUE);
  for (const side of [-12, -6, 6, 12]) net.insertPath([clampP(P(10, side)), clampP(P(40, side))], KIND_ROAD);
  for (const along of [10, 16, 22, 28, 34, 40]) net.insertPath([clampP(P(along, -12)), clampP(P(along, 12))], KIND_ROAD);
  // A curved ring road around the far end.
  net.insertPath([P(40, 12), P(46, 9), P(49, 0), P(46, -9), P(40, -12)].map(clampP), KIND_ROAD);

  // Riverside drive, joined to the end of the avenue.
  let best = -1, bd = 1e9;
  const anchor = P(45, 0);
  terrain.river.forEach((r, j) => {
    if (r.x < 4 || r.z < 4 || r.x > GRID - 4 || r.z > GRID - 4) return;
    const dd = Math.hypot(r.x - anchor.x, r.z - anchor.z);
    if (dd < bd) { bd = dd; best = j; }
  });
  if (best >= 0) {
    const bank: { x: number; z: number }[] = [];
    for (let j = best - 16; j <= best + 16; j += 4) {
      const a = terrain.river[Math.max(0, Math.min(terrain.river.length - 2, j))];
      const b = terrain.river[Math.max(1, Math.min(terrain.river.length - 1, j + 1))];
      let nx = -(b.z - a.z), nz = b.x - a.x;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      // Pick the bank on the city side.
      if ((anchor.x - a.x) * nx + (anchor.z - a.z) * nz < 0) { nx = -nx; nz = -nz; }
      const p = { x: a.x + nx * (a.w + 2.1), z: a.z + nz * (a.w + 2.1) };
      if (p.x > 2 && p.z > 2 && p.x < GRID - 2 && p.z < GRID - 2) bank.push(p);
    }
    if (bank.length >= 2) {
      net.insertPath(bank, KIND_ROAD);
      const mid = bank[Math.floor(bank.length / 2)];
      const from = P(49, 0);
      net.insertPath([clampP(from), { x: (from.x + mid.x) / 2 + e.dz * 3, z: (from.z + mid.z) / 2 + e.dx * 3 }, mid].map(clampP), KIND_ROAD);
    }
  }

  // Traffic control on the avenue.
  const rb = P(22, 0);
  net.addRoundabout(rb.x, rb.z, 2.3, KIND_AVENUE);
  for (const along of [16, 28, 34]) {
    const p = P(along, 0);
    const n = net.nearestNode(p.x, p.z, 1.0);
    if (n && net.degree(n.id) >= 3) n.light = true;
  }

  // Zoning from the rasterized network.
  const ras = rasterize(net);
  const kind = new Uint8Array(N_TILES);
  const free = (i: number): boolean => !terrain.water[i] && !ras.cover[i] && ras.accSeg[i] >= 0;
  for (let i = 0; i < N_TILES; i++) {
    if (!free(i)) continue;
    const px = (i % GRID) + 0.5 - e.x, pz = ((i / GRID) | 0) + 0.5 - e.z;
    const along = px * e.dx + pz * e.dz;
    const side = Math.abs(-px * e.dz + pz * e.dx);
    if (along > 43 || side > 14) continue;
    if (along >= 35.5) kind[i] = T_IND;
    else if (along >= 31.5) continue; // buffer between industry and homes
    else if (side < 4 && along > 11) kind[i] = T_COM;
    else kind[i] = T_RES;
  }

  // Utilities.
  const place = (near: { x: number; z: number }, k: number, ok: (i: number, x: number, z: number) => boolean): boolean => {
    for (let r = 0; r < 9; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = Math.floor(near.x) + dx, z = Math.floor(near.z) + dz;
          if (!inBounds(x, z)) continue;
          const i = idx(x, z);
          if (free(i) && kind[i] < T_COAL && ok(i, x, z)) { kind[i] = k; return true; }
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
    if (!free(i) || !touchesWater(terrain, x, z)) continue;
    const f = adjacentFlow(terrain, x, z);
    if (f < upFlow) { upFlow = f; up = i; }
    if (f > downFlow) { downFlow = f; down = i; }
  }
  if (up >= 0) {
    kind[up] = T_PUMP;
    place({ x: up % GRID, z: (up / GRID) | 0 }, T_PUMP, (_i, x, z) => touchesWater(terrain, x, z) && adjacentFlow(terrain, x, z) < upFlow + 12);
  }
  if (down >= 0 && down !== up) {
    kind[down] = T_OUTLET;
    // A second outlet right beside the first so sewage capacity keeps up.
    place({ x: down % GRID, z: (down / GRID) | 0 }, T_OUTLET, (_i, x, z) => touchesWater(terrain, x, z) && adjacentFlow(terrain, x, z) > upFlow + 20);
  }

  const level = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) if (kind[i] >= T_COAL) level[i] = 1;
  return { seed: DEMO_SEED, kind, level, net: net.toPlain(), money: 12000, tick: 0, tax: 10 };
}
