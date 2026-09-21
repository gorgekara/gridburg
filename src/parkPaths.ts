import { GRID } from './constants';
import { sampleCurve } from './roads/network';
import type { Curve } from './roads/network';

export const PARK_PATH_HALF = 0.065;
export const PARK_PATH_COST = 15;
export type ParkPath = Curve;

/** Match the compact save precision before either validating or rendering a route. */
export function quantizeParkPath(path: ParkPath): ParkPath {
  const q = (v: number): number => Math.round(v * 256) / 256;
  return { ax: q(path.ax), az: q(path.az), cx: q(path.cx), cz: q(path.cz), bx: q(path.bx), bz: q(path.bz) };
}

/** The actual narrow footprint, sampled densely enough to include tile-edge crossings. */
export function parkPathTiles(path: ParkPath): number[] {
  const cells = new Set<number>();
  const sm = sampleCurve(path);
  const steps = Math.max(2, Math.ceil(sm.len / 0.025));
  for (let n = 0; n <= steps; n++) {
    const t = n / steps, u = 1 - t;
    const x = u * u * path.ax + 2 * u * t * path.cx + t * t * path.bx;
    const z = u * u * path.az + 2 * u * t * path.cz + t * t * path.bz;
    for (const dx of [-PARK_PATH_HALF, 0, PARK_PATH_HALF]) for (const dz of [-PARK_PATH_HALF, 0, PARK_PATH_HALF]) {
      const ix = Math.floor(x + dx), iz = Math.floor(z + dz);
      if (ix < 0 || iz < 0 || ix >= GRID || iz >= GRID) return [];
      cells.add(iz * GRID + ix);
    }
  }
  return [...cells];
}

/** Conservative clearance against a frontage-shifted, one-cell building lot. */
export function parkPathTouchesLot(path: ParkPath, x: number, z: number): boolean {
  const sm = sampleCurve(path), steps = Math.max(2, Math.ceil(sm.len / 0.025));
  for (let n = 0; n <= steps; n++) {
    const t = n / steps, u = 1 - t;
    const px = u*u*path.ax + 2*u*t*path.cx + t*t*path.bx;
    const pz = u*u*path.az + 2*u*t*path.cz + t*t*path.bz;
    if (Math.abs(px-x) < .5 + PARK_PATH_HALF && Math.abs(pz-z) < .5 + PARK_PATH_HALF) return true;
  }
  return false;
}
