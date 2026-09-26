// Where a bus lane's rule applies, shared by the simulation (who may drive in it) and the renderer
// (where it is painted red), so what is painted is what is obeyed.
import { Network, KIND_LANE, isMotorway } from './network';
import type { RSeg } from './network';
import { busLaneOn, laneCentre, lanesFor, sideHalf } from './lanes';
import { GRID } from '../constants';
import { stopLine, SOLID_STRETCH } from './control';
import { crossingApproaches } from './crossings';

/**
 * The stretch where a bus lane gives way to ordinary traffic before a junction, so a car turning
 * kerbside can move over into it, across a broken line, before the solid stretch up to the stop line.
 */
export const BUS_BAY = 1.0;
/** How far out of its lane a bus pulls into a lay-by: enough for a car to pass it alongside. */
export const BAY_SIDE = 0.29;
/** How far a bus stop's shelter stands back from where a lot would sit, so its lay-by fits in front of it. */
export const BAY_SETBACK = 0.26;
/** A lay-by's length along the kerb, and the taper at each end of it. */
export const BAY_LENGTH = 1.8, BAY_TAPER = 0.4;
/** Past a junction, how far beyond its mouth (or its zebra) the bus lane starts. */
const BUS_START = 0.2;
/** A span shorter than this is not worth painting or enforcing. */
const MIN_SPAN = 1;

/**
 * The bus lane in direction `fwd` of `seg`, as distances along the direction of travel from where it
 * starts, or null if that direction has none. It starts clear of the junction behind and ends BUS_BAY
 * short of the solid stretch before the stop line ahead; through a node joining only two roads it runs right up to the node, so
 * the bus lanes of consecutive segments join up. `zebras` is `crossingApproaches(net)`, if to hand.
 */
export function busLaneSpan(net: Network, seg: RSeg, fwd: boolean, zebras?: Map<number, [number, number]>): { from: number; to: number } | null {
  if (!busLaneOn(net, seg, fwd)) return null;
  const start = fwd ? seg.a : seg.b, end = fwd ? seg.b : seg.a;
  const z = (zebras ?? crossingApproaches(net)).get(seg.id);
  const zebraAt = (node: number): number => (z ? z[node === seg.a ? 0 : 1] : 0);
  const from = net.degree(start) >= 3 ? stopLine(net, start, zebraAt(start)) + BUS_START : net.degree(start) === 2 ? 0 : 0.3;
  const to = net.degree(end) >= 3 ? seg.len - stopLine(net, end, zebraAt(end)) - SOLID_STRETCH - BUS_BAY : net.degree(end) === 2 ? seg.len : seg.len - 0.3;
  return to - from >= MIN_SPAN ? { from, to } : null;
}

/** A bus stop's lay-by (or, where its kerb lane is a bus lane, its stand in that lane). */
export interface BusBay { tile: number; seg: RSeg; s: number; side: number; fwd: boolean; inLane: boolean; edge: number; outer: number }

/** How far out from the centre line a lay-by's back kerb is: room for a bus pulled BAY_SIDE out of its lane. */
export function bayOuter(net: Network, seg: RSeg, fwd: boolean): number {
  return laneCentre(net, seg, fwd, 0) + BAY_SIDE + 0.16;
}

/**
 * How a bus calls at a stop at arc length `s` on `seg`, on side `side` (+1 right of a→b), serving the
 * traffic whose kerb that is: from a lay-by, from a stand in the lane (on a bus lane, or where a lay-by
 * would run into a junction), or not at all (a bridge, a roundabout, a road without frontage or a narrow
 * lane, the far side of a one-way road, or a stop too close to a junction even to stand at). Shared by
 * the simulation and the renderer, so a bus pulls in only where a lay-by is drawn.
 */
export function stopKind(net: Network, seg: RSeg, s: number, side: number, zebras?: Map<number, [number, number]>): 'bay' | 'stand' | null {
  if (seg.structure || seg.kind === KIND_LANE || isMotorway(seg.kind)) return null;
  if (net.nodes.get(seg.a)?.ring && net.nodes.get(seg.b)?.ring) return null;
  const fwd = side > 0;
  if (lanesFor(net, seg, fwd) === 0) return null;
  const z = (zebras ??= crossingApproaches(net)).get(seg.id);
  // Clear of the stop line and zebra at a junction, and of the very end anywhere else.
  const clear = (node: number): number => (net.degree(node) >= 3 ? stopLine(net, node, z ? z[node === seg.a ? 0 : 1] : 0) + 0.2 : 0.2);
  const lo = clear(seg.a), hi = seg.len - clear(seg.b);
  const fits = (reach: number): boolean => s - reach >= lo && s + reach <= hi;
  const span = busLaneSpan(net, seg, fwd, zebras), along = fwd ? s : seg.len - s;
  const inLane = !!span && along >= span.from && along <= span.to;
  if (!inLane && fits(BAY_LENGTH / 2 + BAY_TAPER)) return 'bay';
  return fits(BAY_LENGTH / 2) ? 'stand' : null;
}

/**
 * Every bus stop's bay or stand, from the tiles holding a stop (`busTile`) and where each reaches its road.
 * `s` is the stop's arc length along the road from its a end; `side` is +1 right of a→b.
 */
export function busBays(net: Network, kind: ArrayLike<number>, accSeg: ArrayLike<number>, accS: ArrayLike<number>, busTile: number): BusBay[] {
  const out: BusBay[] = [];
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  const zebras = crossingApproaches(net);
  for (let i = 0; i < kind.length; i++) {
    if (kind[i] !== busTile || accSeg[i] < 0) continue;
    const seg = net.segs.get(accSeg[i]);
    if (!seg) continue;
    const s = accS[i];
    const side = stopSideOf(seg, s, i % GRID + 0.5, Math.floor(i / GRID) + 0.5, pose), fwd = side > 0;
    const how = stopKind(net, seg, s, side, zebras);
    if (!how) continue;
    out.push({ tile: i, seg, s, side, fwd, inLane: how === 'stand', edge: sideHalf(seg, side), outer: bayOuter(net, seg, fwd) });
  }
  return out;
}

/** Which side of a road (+1 right of a→b, −1 left) the point (x, z) is on, seen from arc length s. */
export function stopSideOf(seg: RSeg, s: number, x: number, z: number, pose = { x: 0, z: 0, tx: 0, tz: 0 }): number {
  Network.poseAt(seg, s, pose);
  return (x - pose.x) * -pose.tz + (z - pose.z) * pose.tx > 0 ? 1 : -1;
}
