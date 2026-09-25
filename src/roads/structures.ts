import { GRID } from '../constants';
import { roadHalf } from './lanes';
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
// ---- levels ---------------------------------------------------------------------------------------
/** How far apart the levels above ground are, and the lowest and highest a node can be on. */
export const LEVEL_H = 1.1, MIN_LEVEL = -1, MAX_LEVEL = 3;
/** A ramp needs this much length for each level it climbs or drops. */
export const RAMP_PER_LEVEL = 4;
/** Two roads this far apart in height pass without touching; within SAME_HEIGHT they are at one level. */
const CLEARANCE = 0.9, SAME_HEIGHT = 0.25;
/** The height of a level: storeys above ground, or a tunnel's depth below it. */
export const levelY = (level: number): number => level > 0 ? level * LEVEL_H : level < 0 ? -TUNNEL_DROP : 0;
/** What structure a road between two levels is: elevated, tunnel, or plain surface. */
export const structureFor = (la: number, lb: number): Structure => la > 0 || lb > 0 ? 1 : la < 0 || lb < 0 ? 2 : 0;
/** A bridge or tunnel of the old kind: one span humped or dipped between two ends on the ground. */
export const isLegacySpan = (s: Pick<RSeg, 'structure' | 'ya' | 'yb'>): boolean => !!s.structure && !s.ya && !s.yb;
/** A road that stays at one height all along, so another can meet it anywhere. */
export const isFlat = (s: Pick<RSeg, 'structure' | 'ya' | 'yb'>): boolean => !isLegacySpan(s) && (s.ya ?? 0) === (s.yb ?? 0);
const ease = (u: number): number => { const v = u < 0 ? 0 : u > 1 ? 1 : u; return v * v * (3 - 2 * v); };

/**
 * A road's height at `distance` along it. A road between two levels eases from the height of one
 * end to the other; a road of the old kind keeps its hump (bridge) or dip (tunnel) with both portals
 * or abutments on the ground, the central span crossing without a junction.
 */
export function roadHeight(seg: Pick<RSeg, 'structure' | 'len'> & { ya?: number; yb?: number }, distance: number): number {
  if (seg.ya || seg.yb) {
    const ya = seg.ya ?? 0, yb = seg.yb ?? 0;
    return ya === yb ? ya : ya + (yb - ya) * ease(distance / (seg.len || 1));
  }
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
      if (hit.dist < roadHalf(seg) + HALF_WIDTH[roadKind] + 0.1 && Math.abs(y - roadHeight(seg, hit.s)) < 1.4 * CLEAR) return 'The approaches need more clearance from crossing roads';
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
      if (!isLegacySpan(seg)) continue; // roads between levels are checked by levelProblem
      for (let i = 0; i <= sm.n; i++) {
        const hit = Network.nearestOn(seg, sm.pts[i * 2], sm.pts[i * 2 + 1]);
        if (hit.s < 0.9 || seg.len - hit.s < 0.9) {
          if (hit.dist < roadHalf(seg) + 0.5 && sm.cum[i] > 1.5 && sm.len - sm.cum[i] > 1.5) return 'End the road at the bridge or tunnel entrance to connect it';
          continue;
        }
        if (hit.dist < roadHalf(seg) + 0.5 && Math.abs(roadHeight(seg, hit.s)) < 1.4 * CLEAR) return 'Keep surface roads clear of the approach ramps';
      }
    }
  }
  return null;
}

/**
 * Where a tunnel reaches its mouth, measured from one end: the portal stands where the road has
 * dropped far enough to be under the ground. Null at an end that is itself underground.
 */
export function tunnelMouth(seg: RSeg, end: 0 | 1): number | null {
  if (seg.structure !== 2) return null;
  if (isLegacySpan(seg)) return Math.min(PORTAL_AT, seg.len / 2);
  const y0 = end ? seg.yb ?? 0 : seg.ya ?? 0;
  if (y0 < 0) return null;
  for (let d = 0; d <= seg.len; d += 0.1) if (roadHeight(seg, end ? seg.len - d : d) < -0.12) return d;
  return null;
}

/**
 * Why a road from level `la` to level `lb` along these guide points cannot be built, or null. A ramp
 * needs RAMP_PER_LEVEL cells for each level it climbs; nothing goes from a tunnel straight up onto a
 * bridge; and where it passes another road they are either at one level on the flat (a junction), or
 * a whole level apart. A low ramp or deck can't sit in the river.
 */
export function levelProblem(net: Network, terrain: Terrain, points: { x: number; z: number }[], roadKind: number, la: number, lb: number): string | null {
  if (la < 0 && lb > 0 || la > 0 && lb < 0) return 'A tunnel cannot climb straight onto a bridge: come up to the ground between them';
  const pieces = buildPieces(points);
  let total = 0;
  const samples: { x: number; z: number; d: number }[] = [];
  for (const c of pieces) {
    const sm = sampleCurve(c);
    for (let i = 0; i <= sm.n; i++) samples.push({ x: sm.pts[i * 2], z: sm.pts[i * 2 + 1], d: total + sm.cum[i] });
    total += sm.len;
  }
  if (Math.abs(lb - la) * RAMP_PER_LEVEL > total + 0.05) return `A ramp needs ${RAMP_PER_LEVEL} cells per level: make it longer or change fewer levels`;
  const profile = { structure: structureFor(la, lb), len: total, ya: levelY(la), yb: levelY(lb) };
  const flat = la === lb, hw = HALF_WIDTH[roadKind];
  const start = points[0], end = points[points.length - 1];
  for (const p of samples) {
    const y = roadHeight(profile, p.d);
    const tx = Math.floor(p.x), tz = Math.floor(p.z);
    if (tx >= 0 && tz >= 0 && tx < GRID && tz < GRID && terrain.water[tz * GRID + tx] && y > -0.8 && y < 0.5) return 'Keep low ramps and decks out of the river';
    // Near its own ends the road is joining whatever is there, so those are left to the join itself.
    if (Math.hypot(p.x - start.x, p.z - start.z) < 1.2 || Math.hypot(p.x - end.x, p.z - end.z) < 1.2) continue;
    for (const seg of net.segs.values()) {
      const reach = roadHalf(seg) + hw + 0.05;
      if (p.x < seg.minX - reach || p.x > seg.maxX + reach || p.z < seg.minZ - reach || p.z > seg.maxZ + reach) continue;
      const hit = Network.nearestOn(seg, p.x, p.z);
      if (hit.dist >= reach) continue;
      const gap = Math.abs(y - roadHeight(seg, hit.s));
      if (gap >= CLEARANCE) continue;
      if (gap < SAME_HEIGHT) {
        // Meeting another road at its own height: fine on the flat (it becomes a junction), not on a slope.
        if (!flat || !isFlat(seg)) return 'Roads can only meet where both are level: meet it on a flat stretch';
        continue;
      }
      return 'Too close above or below another road: leave a whole level between them';
    }
  }
  return null;
}
