import { GRID, N_TILES, T_ROAD, T_RES, T_COM, T_IND, idx } from './constants';
import type { SaveData } from './save';

/** A prebuilt city: an imperfect grid so traffic has somewhere to jam. */
export function demoCity(): SaveData {
  const kind = new Uint8Array(N_TILES);
  const level = new Uint8Array(N_TILES);
  const lo = 6;
  const hi = GRID - 7; // inclusive
  const step = 4;

  // Vertical roads every 4 tiles across the whole build area.
  for (let x = lo; x <= hi; x += step) {
    for (let z = lo; z <= hi; z++) kind[idx(x, z)] = T_ROAD;
  }
  // Horizontal roads: dense in the middle band, sparse outside so trips funnel.
  for (let z = lo; z <= hi; z += step) {
    const row = (z - lo) / step;
    const dense = z > 22 && z < 42;
    if (dense || row % 2 === 0) {
      for (let x = lo; x <= hi; x++) kind[idx(x, z)] = T_ROAD;
    }
  }
  // Remove a few vertical links to create a couple of chokepoints.
  for (const x of [22, 38]) {
    for (let z = 27; z <= 29; z++) kind[idx(x, z)] = 0;
    for (let z = 35; z <= 37; z++) kind[idx(x, z)] = 0;
  }

  // Zone the blocks by distance from center.
  const cx = GRID / 2;
  const cz = GRID / 2;
  for (let z = lo; z <= hi; z++) {
    for (let x = lo; x <= hi; x++) {
      const i = idx(x, z);
      if (kind[i] === T_ROAD) continue;
      const dx = Math.abs(x - cx);
      const dz = Math.abs(z - cz);
      const d = Math.max(dx, dz * 1.3);
      let k: number;
      if (d < 8) k = T_COM;
      else if (d < 21) k = T_RES;
      else k = T_IND;
      // A few commercial strips along the main east-west road.
      if (k === T_RES && Math.abs(z - cz) <= 1.5 && Math.random() < 0.7) k = T_COM;
      kind[i] = k;
    }
  }
  return { kind, level, money: 9000, tick: 0, tax: 10 };
}
