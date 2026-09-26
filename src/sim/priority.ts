// Priority at uncontrolled junctions: which road through a junction is the major one, and how long a
// gap in its traffic a driver needs to cross or join it. Pure functions.

// Which road is the major one lives with the other junction facts, in roads/control.ts.
export { roadRank, majorPair, STRAIGHT } from '../roads/control';
export type { Arm } from '../roads/control';

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
