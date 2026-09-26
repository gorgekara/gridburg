// Priority at uncontrolled junctions: which road through a junction is the major one, and how long a
// gap in its traffic a driver needs to cross or join it. Pure functions.

import { KIND_ROAD, KIND_AVENUE, KIND_LANE, KIND_HIGHWAY, KIND_MOTORWAY, KIND_RAMP, KIND_HIGHWAY2 } from '../roads/network';

/** How important a road is at a junction: its class first, then its lanes. */
export function roadRank(kind: number, lanes: number): number {
  const cls = kind === KIND_HIGHWAY ? 5 : kind === KIND_MOTORWAY || kind === KIND_HIGHWAY2 ? 6 : kind === KIND_RAMP ? 4 : kind === KIND_AVENUE ? 3 : kind === KIND_ROAD ? 2 : kind === KIND_LANE ? 1 : 2;
  return cls * 10 + Math.min(9, lanes);
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

/** Which way a movement turns, from the direction it arrives in to the one it leaves in (right-hand traffic). */
export function turnOf(ax: number, az: number, bx: number, bz: number): 'straight' | 'right' | 'left' {
  const cross = ax * bz - az * bx, dot = ax * bx + az * bz;
  if (dot > Math.cos(Math.PI / 5)) return 'straight';
  return cross > 0 ? 'right' : 'left';
}

/**
 * The gap in major-road traffic, in game seconds, a driver needs: the Highway Capacity Manual's
 * critical gaps, scaled by the game's three-to-one clock. A major-road car turning left across the
 * oncoming lanes needs the shortest one.
 */
export function criticalGap(turn: 'straight' | 'right' | 'left', major: boolean): number {
  if (major) return turn === 'left' ? 1.4 : 0;
  return turn === 'right' ? 2.0 : turn === 'straight' ? 2.2 : 2.4;
}
