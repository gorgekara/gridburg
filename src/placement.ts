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

/** Tile buildings stay inside their cells, facing the nearest cardinal road direction. */
export function buildingRotation(dx: number, dz: number): number {
  return Math.round(Math.atan2(dx, dz) / (Math.PI / 2)) * (Math.PI / 2);
}
