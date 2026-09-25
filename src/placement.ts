import { GRID } from './constants';
import type { Network } from './roads/network';
export type Point = { x: number; z: number };

/** Road centerlines run down the middle of a tile, so roads occupy squares like everything else. */
export function gridPoint(p: Point): Point {
  const cell = (v: number): number => Math.max(0.5, Math.min(GRID - 0.5, Math.floor(v) + 0.5));
  return { x: cell(p.x), z: cell(p.z) };
}

/** Resolve connections from the snapped point, so hovering and committing agree. */
export function roadPoint(net: Network, p: Point): Point {
  const grid = gridPoint(p);
  const node = net.nearestNode(grid.x, grid.z, 0.9);
  if (node) return { x: node.x, z: node.z };
  const road = net.nearestSeg(grid.x, grid.z, 0.8);
  return road ? { x: road.x, z: road.z } : grid;
}

/** Within this of a quarter turn, a building squares up with the grid instead. */
const SQUARE_WITHIN = (10 * Math.PI) / 180;

/**
 * Which way a tile building faces its road: straight at it, at whatever angle the road runs, but
 * squared off to the grid when the road is within 10° of one.
 */
export function buildingRotation(dx: number, dz: number): number {
  const a = Math.atan2(dx, dz);
  const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
  return Math.abs(a - q) < SQUARE_WITHIN ? q : a;
}

/**
 * How much a building turned by `yaw` has to shrink across the ground to stay inside its own cell:
 * a square turned by θ needs |cos θ| + |sin θ| times the room. 1 for anything squared to the grid.
 */
export function lotScale(yaw: number): number {
  const off = yaw - Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  return 1 / (Math.abs(Math.cos(off)) + Math.abs(Math.sin(off)));
}
