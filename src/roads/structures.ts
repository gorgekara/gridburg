import { GRID } from '../constants';
import { Network, HALF_WIDTH, buildPieces, sampleCurve } from './network';
import type { RSeg } from './network';
import type { Terrain } from '../terrain';
import { siteOwners } from '../sites';

export type Structure = 0 | 1 | 2; // surface, bridge, tunnel
export const STRUCTURE_COST = [1, 3, 4];
/** Deck height at the middle of a span: enough to clear traffic underneath without towering over it. */
export const BRIDGE_RISE = 1.1;
export const TUNNEL_DROP = 1.8;
/** How long the climb onto a bridge is at each end; a short span uses half its length. */
export const BRIDGE_RAMP = 4;
/** The shortest bridge or tunnel: room for two approach ramps and a span between them. */
export const MIN_SPAN = 8;
/**
 * Where a tunnel's portal stands, measured in from each end. The approach up to it stays at street
 * level, so the road visibly runs into the portal mouth instead of sinking under the grass. The
 * ground is not excavated, so a ramp that started diving at the junction simply vanished.
 */
export const PORTAL_AT = 1.6;
/** How long the dip from the portal down to full depth is. */
const TUNNEL_RAMP = 2.4;
/** Both portals/abutments meet the ground. The central span crosses without a junction. */
export function roadHeight(seg: Pick<RSeg, 'structure' | 'len'>, distance: number): number {
  if (!seg.structure) return 0;
  if (seg.structure === 2) {
    const inside = Math.min(distance, seg.len - distance) - PORTAL_AT;
    const u = Math.max(0, Math.min(1, inside / TUNNEL_RAMP));
    return -TUNNEL_DROP * u * u * (3 - 2 * u);
  }
  const ramp = Math.min(BRIDGE_RAMP, seg.len / 2);
  const u = Math.max(0, Math.min(1, distance / ramp, (seg.len - distance) / ramp));
  return BRIDGE_RISE * u * u * (3 - 2 * u);
}
/** Clearance rules are written against the deck, so they scale with it. */
const CLEAR = BRIDGE_RISE / 2.4;

export function structurePlan(net: Network, terrain: Terrain, kind: Uint8Array, points: { x: number; z: number }[], roadKind: number, structure: Structure): Network | string {
  const pieces = buildPieces(points);
  if (pieces.length !== 1) return 'Build one bridge or tunnel span at a time';
  const sm = sampleCurve(pieces[0]);
  if (sm.len < MIN_SPAN - 0.05) return `Allow at least ${MIN_SPAN} cells for the two approach ramps`;
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
    if (terrain.water[Math.min(GRID - 1, Math.floor(z)) * GRID + Math.min(GRID - 1, Math.floor(x))] && Math.abs(y) < 1.2 * CLEAR) return 'Move the ends farther from the river to leave room for ramps';
    if (distance < 1.8 || sm.len - distance < 1.8) continue;
    for (const seg of net.segs.values()) {
      const hit = Network.nearestOn(seg, x, z);
      if (hit.dist < HALF_WIDTH[seg.kind] + HALF_WIDTH[roadKind] + 0.1 && Math.abs(y - roadHeight(seg, hit.s)) < 1.4 * CLEAR) return 'The approaches need more clearance from crossing roads';
    }
  }
  const copy = Network.fromPlain(net.toPlain());
  if (!copy.insertPath(points, roadKind, false, structure).length) return 'This connection already exists';
  return copy;
}

/**
 * Why a surface road along these guide points would clash with a bridge or tunnel: running through
 * an approach ramp at ground level, or touching a span anywhere but its ends. Null when it is clear.
 */
export function approachProblem(net: Network, points: { x: number; z: number }[]): string | null {
  for (const c of buildPieces(points)) {
    const sm = sampleCurve(c);
    for (const seg of net.segs.values()) {
      if (!seg.structure) continue;
      for (let i = 0; i <= sm.n; i++) {
        const hit = Network.nearestOn(seg, sm.pts[i * 2], sm.pts[i * 2 + 1]);
        if (hit.s < 0.9 || seg.len - hit.s < 0.9) {
          if (hit.dist < HALF_WIDTH[seg.kind] + 0.5 && sm.cum[i] > 1.5 && sm.len - sm.cum[i] > 1.5) return 'End the road at the bridge or tunnel entrance to connect it';
          continue;
        }
        if (hit.dist < HALF_WIDTH[seg.kind] + 0.5 && Math.abs(roadHeight(seg, hit.s)) < 1.4 * CLEAR) return 'Keep surface roads clear of the approach ramps';
      }
    }
  }
  return null;
}
