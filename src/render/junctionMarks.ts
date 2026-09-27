// The paint and sign positions that make a junction's rules readable: stop lines where traffic stops,
// give-way "shark teeth" where it yields, solid lines between lanes on the last stretch before the
// line, and chevron boards round curves too tight for their road's speed. What controls each junction
// comes from roads/control.ts, which the simulation uses too, so the paint always matches the traffic.

import { Network, SPEED } from '../roads/network';
import { GRID } from '../constants';
import type { RSeg } from '../roads/network';
import { junctionKind, majorArms, stopLine, SOLID_STRETCH, HOLD_BEHIND_LINE } from '../roads/control';
import { lanesFor, laneCentre, sideHalf, oneWay, roadHalf } from '../roads/lanes';
import { curveSpeed } from '../sim/driver';
import type { MeshBuilder } from './meshBuilder';

/** How many of each mark a rebuild laid down, for tests and for the curious. */
export interface JunctionMarks { stopLines: number; giveWays: number; yieldSigns: number; chevrons: number; gores: number; ramps: number; pedHeads: number; splitters: number; medians: number; barriers: number; guardrails: number; medianTrees: number; rumbles: number; banSigns: number; streetTrees: number; parkingBays: number }

/** Where a sign stands (map coordinates), which way it faces, and the road (and distance along it) it serves. */
export interface SignSpot { x: number; z: number; tx: number; tz: number; seg?: RSeg; s?: number }
/** A curve slower than this share of its road's speed gets chevrons. */
export const CHEVRON_SHARE = 0.7;

const WHITE = 0xf2f2ee, YELLOW = 0xe8c547;
const MARK_Y = 0.058;

/**
 * Lay the junction paint into `b` and return the sign spots. `crossings` maps a segment to the
 * distance of its zebra crossing from each end (0 for none). `lift` puts the paint on a raised road.
 */
export function junctionPaint(net: Network, crossings: Map<number, [number, number]>, b: MeshBuilder, lift: (s: RSeg) => void, marks: JunctionMarks): { yieldSpots: SignSpot[] } {
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  const yieldSpots: SignSpot[] = [];
  const half = GRID / 2;
  // A roundabout's ring, one way between ring nodes: as the simulation has it (a two-way link between
  // two roundabouts is an ordinary road, and gives way at both ends).
  const isArc = (s: RSeg): boolean => s.oneway && !!net.nodes.get(s.a)?.ring && !!net.nodes.get(s.b)?.ring;
  for (const node of net.nodes.values()) {
    const kind = junctionKind(net, node.id);
    if (kind === 'plain') continue;
    const major = kind === 'yield' ? majorArms(net, node.id) : null;
    for (const s of net.segsAt(node.id)) {
      if ((s.a === node.id) === (s.b === node.id) || s.structure === 2 || isArc(s)) continue;
      // Travelling a→b arrives at b; b→a, on a two-way road, arrives at a.
      const fwd = s.b === node.id;
      if (!fwd && oneWay(s)) continue;
      const mark = kind === 'light' || kind === 'stop' ? 'stop' : kind === 'ring' || (major && !major.has(s.id)) ? 'give' : null;
      const line = stopLine(net, node.id, crossings.get(s.id)?.[fwd ? 1 : 0] ?? 0);
      // Where the simulation holds traffic at the line (a stretch long enough for it); on a shorter one
      // cars stop mid-way, so no line is painted that they would stand over.
      if (!(s.len > Math.max(1.8, 2 * (line + HOLD_BEHIND_LINE)))) continue;
      lift(s);
      const d = fwd ? s.len - line : line;
      // The arriving lanes, as sideways offsets in the a→b frame (positive to the right of a→b).
      const lo = oneWay(s) ? -sideHalf(s, -1) : fwd ? 0 : -sideHalf(s, -1);
      const hi = oneWay(s) ? sideHalf(s, 1) : fwd ? sideHalf(s, 1) : 0;
      const inLo = lo + (lo < 0 ? 0.04 : 0.03), inHi = hi - (hi > 0 ? 0.04 : 0.03);
      Network.poseAt(s, d, pose);
      const x = pose.x - half, z = pose.z - half, tx = pose.tx, tz = pose.tz, rx = -tz, rz = tx;
      // The way arriving traffic travels.
      const dx = fwd ? tx : -tx, dz = fwd ? tz : -tz;
      if (mark === 'stop') {
        b.ribbon([x - dx * 0.035, z - dz * 0.035, x + dx * 0.035, z + dz * 0.035], 2, (inHi - inLo) / 2, MARK_Y, WHITE, (fwd ? 1 : -1) * (inLo + inHi) / 2);
        marks.stopLines++;
      } else if (mark === 'give') {
        const n = Math.max(3, Math.floor((inHi - inLo) / 0.075));
        for (let k = 0; k < n; k++) {
          const off = inLo + ((k + 0.5) * (inHi - inLo)) / n;
          // Each tooth points back at the driver, its base on the line.
          b.arrow(x + rx * off - dx * 0.045, z + rz * off - dz * 0.045, -dx, -dz, 0.045, MARK_Y, WHITE);
        }
        marks.giveWays++;
        const spot = net.vergeSpot(s, node.id, sideHalf(s, fwd ? 1 : -1) + 0.2, Math.min(line + 0.2, s.len * 0.4));
        if (spot) { yieldSpots.push({ ...spot, seg: s, s: d }); marks.yieldSigns++; }
      }
      if (kind === 'ring') continue;
      // Solid lines on the last stretch: between arriving lanes, and down the middle of a street.
      const s0 = fwd ? Math.max(0, d - SOLID_STRETCH) : d, s1 = fwd ? d : Math.min(s.len, d + SOLID_STRETCH);
      const solid = (off: number, color: number, w = 0.018): void => {
        const steps = Math.max(1, Math.ceil((s1 - s0) / 0.3));
        const arr = new Float32Array((steps + 1) * 2);
        for (let k = 0; k <= steps; k++) {
          Network.poseAt(s, s0 + ((s1 - s0) * k) / steps, pose);
          arr[k * 2] = pose.x - half; arr[k * 2 + 1] = pose.z - half;
        }
        b.ribbon(arr, steps + 1, w, MARK_Y - 0.001, color, off);
      };
      const n = lanesFor(net, s, fwd);
      for (let k = 1; k < n; k++) {
        const between = (laneCentre(net, s, fwd, k - 1) + laneCentre(net, s, fwd, k)) / 2;
        solid(fwd ? between : -between, WHITE);
      }
      if (!oneWay(s) && s.kind === 0) solid(0, YELLOW, 0.022);
    }
  }
  return { yieldSpots };
}

/**
 * Chevron boards round every curve too tight for its road's speed: along the outside of its tightest
 * stretch, about a cell apart, facing the traffic.
 */
export function chevronSpots(net: Network, marks: JunctionMarks): SignSpot[] {
  const out: SignSpot[] = [];
  for (const s of net.segs.values()) {
    // Not slip roads, and not a roundabout's ring, whose curve everyone expects.
    if (s.structure === 2 || s.kind === 5 || (s.oneway && net.nodes.get(s.a)?.ring && net.nodes.get(s.b)?.ring)) continue;
    const limit = SPEED[s.kind] * CHEVRON_SHARE;
    let last = -Infinity;
    for (let i = 1; i < s.n; i++) {
      const ax = s.pts[i * 2 - 2], az = s.pts[i * 2 - 1], bx = s.pts[i * 2], bz = s.pts[i * 2 + 1], cx = s.pts[i * 2 + 2], cz = s.pts[i * 2 + 3];
      const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
      const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ac = Math.hypot(cx - ax, cz - az);
      if (Math.abs(cross) < 1e-9) continue;
      const r = (ab * bc * ac) / (2 * Math.abs(cross));
      if (curveSpeed(r) >= limit || s.cum[i] - last < 1) continue;
      last = s.cum[i];
      // Turning right (cross > 0 in this frame) puts the outside on the left, and the other way round.
      const tx = (cx - ax) / ac, tz = (cz - az) / ac, side = cross > 0 ? -1 : 1, off = roadHalf(s) + 0.28;
      out.push({ x: bx + -tz * off * side, z: bz + tx * off * side, tx, tz, seg: s, s: s.cum[i] });
      marks.chevrons++;
    }
  }
  return out;
}
