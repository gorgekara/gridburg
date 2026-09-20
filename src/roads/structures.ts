import { GRID } from '../constants';
import { Network, HALF_WIDTH, buildPieces, sampleCurve } from './network';
import type { RSeg } from './network';
import type { Terrain } from '../terrain';
import { siteOwners } from '../sites';

export type Structure = 0 | 1 | 2; // surface, bridge, tunnel
export const STRUCTURE_COST = [1, 3, 4];
/** Both portals/abutments meet the ground. The central span crosses without a junction. */
export function roadHeight(seg: Pick<RSeg, 'structure' | 'len'>, distance: number): number {
  if (!seg.structure) return 0;
  const ramp = Math.min(6, seg.len / 2);
  const u = Math.max(0, Math.min(1, distance / ramp, (seg.len - distance) / ramp));
  return (seg.structure === 1 ? 2.4 : -2.4) * u * u * (3 - 2 * u);
}

export function structurePlan(net: Network, terrain: Terrain, kind: Uint8Array, points: { x: number; z: number }[], roadKind: number, structure: Structure): Network | string {
  const pieces = buildPieces(points);
  if (pieces.length !== 1) return 'Build one bridge or tunnel span at a time';
  const sm = sampleCurve(pieces[0]);
  if (sm.len < 14) return 'Allow at least 14 cells for the two approach ramps';
  for (const p of [points[0], points.at(-1)!]) {
    if (terrain.water[Math.floor(p.z) * GRID + Math.floor(p.x)]) return 'Both ends must meet dry land';
    const hit = net.nearestSeg(p.x, p.z, 0.8);
    if (hit?.seg.structure && hit.s > 0.7 && hit.seg.len - hit.s > 0.7) return 'Connect to a bridge or tunnel at its ends';
  }
  const owners = siteOwners(kind);
  for (let n = 0; n <= sm.n; n++) {
    const x = sm.pts[n * 2], z = sm.pts[n * 2 + 1], distance = sm.cum[n];
    const y = roadHeight({ structure, len: sm.len }, distance);
    if (structure === 1 || Math.abs(y) < 0.8) {
      const radius = HALF_WIDTH[roadKind] + 0.45;
      for (let zz = Math.floor(z - radius); zz <= Math.floor(z + radius); zz++) for (let xx = Math.floor(x - radius); xx <= Math.floor(x + radius); xx++) {
        if (xx < 0 || zz < 0 || xx >= GRID || zz >= GRID) return 'Keep the approaches inside the city boundary';
        const i = zz * GRID + xx;
        if (kind[i] || owners[i] >= 0) return 'Clear buildings and zoning from the span or portals first';
      }
    }
    if (terrain.water[Math.min(GRID - 1, Math.floor(z)) * GRID + Math.min(GRID - 1, Math.floor(x))] && Math.abs(y) < 1.2) return 'Move the ends farther from the river to leave room for ramps';
    if (distance < 1.8 || sm.len - distance < 1.8) continue;
    for (const seg of net.segs.values()) {
      const hit = Network.nearestOn(seg, x, z);
      if (hit.dist < HALF_WIDTH[seg.kind] + HALF_WIDTH[roadKind] + 0.1 && Math.abs(y - roadHeight(seg, hit.s)) < 1.1) return 'The approaches need more clearance from crossing roads';
    }
  }
  const copy = Network.fromPlain(net.toPlain());
  if (!copy.insertPath(points, roadKind, false, structure).length) return 'This connection already exists';
  return copy;
}
