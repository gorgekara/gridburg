// Facts about junctions that the renderer and the simulation must agree on: what controls each one,
// which road through it has priority, and where its stop lines are. Pure functions of the network.

import { Network, isMotorway, KIND_ROAD, KIND_AVENUE, KIND_LANE, KIND_HIGHWAY, KIND_MOTORWAY, KIND_RAMP, KIND_HIGHWAY2 } from './network';
import type { RSeg } from './network';
import { roadHalf } from './lanes';

export type JunctionKind = 'plain' | 'yield' | 'light' | 'stop' | 'ring';

/**
 * What controls a node. A ring node is part of a roundabout. Where three or more roads meet it is a
 * signal, an all-way stop or, by default, a junction that yields, except where only highway-class
 * roads meet three ways (a slip road leaving or joining a carriageway), which merges on the move.
 */
export function junctionKind(net: Network, nodeId: number): JunctionKind {
  const n = net.nodes.get(nodeId);
  if (!n) return 'plain';
  if (n.ring) return 'ring';
  const deg = net.degree(nodeId);
  if (deg < 3 || (deg === 3 && net.segsAt(nodeId).every(q => isMotorway(q.kind)))) return 'plain';
  return n.light ? 'light' : n.stop ? 'stop' : 'yield';
}

/**
 * How important a road is at a junction, by its class alone: a turn pocket or an added lane on a side
 * street does not make it the main road. A slip road that ends at a surface junction joins it from the
 * side, so it ranks lowest.
 */
export function roadRank(kind: number): number {
  return kind === KIND_MOTORWAY || kind === KIND_HIGHWAY2 ? 6 : kind === KIND_HIGHWAY ? 5 : kind === KIND_AVENUE ? 3 : kind === KIND_ROAD ? 2 : kind === KIND_LANE ? 1 : kind === KIND_RAMP ? 0 : 2;
}

/** An arm of a junction: its rank, and the direction it leaves the node in (radians). */
export interface Arm { rank: number; angle: number }

/** The least angle two arms must make to count as one road running through. */
export const STRAIGHT = (150 * Math.PI) / 180;

/**
 * The two arms that form the major road, or null when no road stands out. The major road is the pair
 * of arms that runs nearly straight through and outranks, or equals, every other arm. When another
 * pair is just as important and just as straight (a crossroads of two equal roads), nothing does.
 */
export function majorPair(arms: Arm[]): [number, number] | null {
  let best: [number, number] | null = null, bestRank = -1, tied = false;
  for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
    let d = Math.abs(arms[i].angle - arms[j].angle) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < STRAIGHT) continue;
    const rank = Math.min(arms[i].rank, arms[j].rank);
    if (rank > bestRank) { best = [i, j]; bestRank = rank; tied = false; }
    else if (rank === bestRank) tied = true;
  }
  if (!best || tied) return null;
  for (let k = 0; k < arms.length; k++) if (k !== best[0] && k !== best[1] && arms[k].rank > bestRank) return null;
  return best;
}

/** The direction a segment leaves a node in, as an angle. */
function armAngle(seg: RSeg, nodeId: number): number {
  const pose = { x: 0, z: 0, tx: 0, tz: 0 }, fromA = seg.a === nodeId;
  Network.poseAt(seg, fromA ? Math.min(0.3, seg.len / 2) : Math.max(seg.len / 2, seg.len - 0.3), pose);
  return fromA ? Math.atan2(pose.tz, pose.tx) : Math.atan2(-pose.tz, -pose.tx);
}

/** The segment ids of the major road through a yielding junction, or null when none stands out. */
export function majorArms(net: Network, nodeId: number): Set<number> | null {
  if (junctionKind(net, nodeId) !== 'yield') return null;
  const at = net.segsAt(nodeId).filter(s => (s.a === nodeId) !== (s.b === nodeId));
  const pair = majorPair(at.map(s => ({ rank: roadRank(s.kind), angle: armAngle(s, nodeId) })));
  return pair ? new Set(pair.map(k => at[k].id)) : null;
}

/** Half the length of a zebra crossing's stripes along the road. */
export const ZEBRA_HALF = 0.17;

/**
 * How far from the node an approach's stop line (or give-way line) is painted: just short of its zebra
 * crossing if it has one, otherwise clear of the widest road meeting there. `crossing` is the distance
 * of the zebra's centre from the node, from `crossingApproaches`.
 */
export function stopLine(net: Network, nodeId: number, crossing = 0): number {
  if (crossing > 0) return crossing + ZEBRA_HALF + 0.1;
  let half = 0;
  for (const s of net.segsAt(nodeId)) half = Math.max(half, roadHalf(s));
  return half + 0.3;
}

/** Where a car's centre stands when it stops at a stop line: half the longest vehicle behind it. */
export const HOLD_BEHIND_LINE = 0.3;
/** The stretch before a stop line where the lines between lanes are solid and nobody overtakes. */
export const SOLID_STRETCH = 1.5;
