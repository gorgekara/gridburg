import { Network, HALF_WIDTH, KIND_LANE, isOneWayKind, isMotorway, KIND_RAMP } from './network';
import type { RSeg, Pose } from './network';

/**
 * Lanes, Trafficity-style. Every kind of road comes with a default number of lanes, and the player
 * can add or take away lanes on either side of any stretch of it. A segment stores only the change,
 * `addR` and `addL` (right and left of its centre line seen travelling a→b), so an untouched road is
 * laid out exactly as roads always were. Lane 0 is the kerb lane, the rightmost in the direction of
 * travel; offsets are measured to the right of travel.
 */

/** Lanes each way on a two-way kind; lanes in all on a one-way kind (motorway, ramp, two-lane highway). */
export const DEFAULT_LANES = [1, 2, 1, 3, 3, 1, 2];
/** How wide one lane of each kind is. */
export const LANE_WIDTH = [0.36, 0.43, 0.24, 0.44, 0.44, 0.6, 0.5];
/** How long a widening takes to open out from its narrower neighbour. */
export const TAPER = 1.6;
/** The most lanes one direction of a segment can have, for sizing per-lane tables. */
export const MAXL = 6;
const MAX_TWO_WAY = 4, MAX_ONE_WAY = 6;

export const oneWay = (s: RSeg): boolean => s.oneway || isOneWayKind(s.kind);
const addR = (s: RSeg): number => s.addR ?? 0;
const addL = (s: RSeg): number => s.addL ?? 0;
/** A roundabout ring circulates in a single lane, whatever it is built of. */
const ringArc = (net: Network, s: RSeg): boolean => !!net.nodes.get(s.a)?.ring && !!net.nodes.get(s.b)?.ring && s.oneway;

/** Lanes before any were added: each way on a two-way road, in all on a one-way one. */
function baseLanes(s: RSeg): number {
  return isOneWayKind(s.kind) || !s.oneway ? DEFAULT_LANES[s.kind] : 2 * DEFAULT_LANES[s.kind];
}

/** The strip between the outer lane and the kerb. */
function shoulder(kind: number): number {
  const d = DEFAULT_LANES[kind], w = LANE_WIDTH[kind], hw = HALF_WIDTH[kind];
  return isOneWayKind(kind) ? (2 * hw - d * w) / 2 : hw - d * w;
}

/** How many lanes carry traffic a→b (`fwd`) or b→a. */
export function lanesFor(net: Network, s: RSeg, fwd: boolean): number {
  if (oneWay(s) && !fwd) return 0;
  if (s.kind === KIND_LANE || ringArc(net, s)) return 1;
  return oneWay(s) ? baseLanes(s) + addR(s) + addL(s) : DEFAULT_LANES[s.kind] + (fwd ? addR(s) : addL(s));
}

/** Distance from the centre line to the road's edge on one side (+1 right, −1 left, seen a→b), ignoring tapers. */
export function sideHalf(s: RSeg, side: number): number {
  return HALF_WIDTH[s.kind] + (side > 0 ? addR(s) : addL(s)) * LANE_WIDTH[s.kind];
}

/** The wider of a road's two halves, for anything that needs a single width. */
export function roadHalf(s: RSeg): number {
  return Math.max(sideHalf(s, 1), sideHalf(s, -1));
}

/** Where the middle of lane `i` sits, to the right of travel. */
export function laneCentre(net: Network, s: RSeg, fwd: boolean, i: number): number {
  if (ringArc(net, s)) return 0;
  if (s.kind === KIND_LANE) return oneWay(s) ? 0 : 0.1;
  const edge = oneWay(s) || fwd ? sideHalf(s, 1) : sideHalf(s, -1);
  return edge - shoulder(s.kind) - (i + 0.5) * LANE_WIDTH[s.kind];
}

/** Whether the Add-lane tool may widen or narrow this road. */
export function canAddLanes(s: RSeg, net: Network): boolean {
  return s.kind !== KIND_LANE && !s.fixed && !ringArc(net, s);
}

/** The range `addR` and `addL` may each take, given the other: 1 to 4 lanes each way, or 1 to 6 on a one-way road. */
export function laneLimits(s: RSeg): { minR: number; maxR: number; minL: number; maxL: number } {
  if (oneWay(s)) {
    const base = baseLanes(s);
    // A side can only lose the lanes that fit inside it, or its edge would cross the centre line.
    const lo = -Math.floor(HALF_WIDTH[s.kind] / LANE_WIDTH[s.kind] + 1e-9), hiR = MAX_ONE_WAY - base - addL(s), hiL = MAX_ONE_WAY - base - addR(s);
    // Never fewer than one lane in all, and never more than the cap.
    return { minR: Math.max(lo, 1 - base - addL(s)), maxR: hiR, minL: Math.max(lo, 1 - base - addR(s)), maxL: hiL };
  }
  const d = DEFAULT_LANES[s.kind];
  return { minR: 1 - d, maxR: MAX_TWO_WAY - d, minL: 1 - d, maxL: MAX_TWO_WAY - d };
}

/** Bring a segment's added lanes back within the limits, after its kind changed. */
export function clampLanes(s: RSeg): void {
  let lim = laneLimits(s);
  s.addR = Math.max(lim.minR, Math.min(lim.maxR, addR(s)));
  lim = laneLimits(s);
  s.addL = Math.max(lim.minL, Math.min(lim.maxL, addL(s)));
  if (!s.addR) delete s.addR;
  if (!s.addL) delete s.addL;
}

// ---- tapers ------------------------------------------------------------------------------------------
/** Per segment, the edge each end narrows to: [a right, a left, b right, b left]; NaN where it does not. */
export type Tapers = Map<number, [number, number, number, number]>;

/** The one other segment at a node where exactly two meet, and whether it carries on in the same sense. */
function continuation(net: Network, s: RSeg, node: number): { o: RSeg; same: boolean } | null {
  if (net.degree(node) !== 2) return null;
  const o = net.segsAt(node).find((q) => q.id !== s.id);
  if (!o) return null;
  // Travelling a→b along s into the node at its b end, o carries on a→b if it starts there.
  const same = (s.b === node && o.a === node) || (s.a === node && o.b === node);
  return { o, same };
}

/**
 * Where two segments meet end to end and one is wider on a side, the wider one narrows to meet the
 * other there, over TAPER. At a junction of three or more there is no taper: a turning lane runs
 * right up to the stop line.
 */
export function laneTapers(net: Network): Tapers {
  const out: Tapers = new Map();
  for (const s of net.segs.values()) {
    const t: [number, number, number, number] = [NaN, NaN, NaN, NaN];
    let any = false;
    for (const [end, node] of [[0, s.a], [1, s.b]] as const) {
      const c = continuation(net, s, node);
      if (!c) continue;
      for (const [k, side] of [[0, 1], [1, -1]] as const) {
        const theirs = sideHalf(c.o, c.same ? side : -side), mine = sideHalf(s, side);
        if (mine > theirs + 0.01) { t[end * 2 + k] = theirs; any = true; }
      }
    }
    if (any) out.set(s.id, t);
  }
  return out;
}

/** How long a taper is on this segment. */
export const taperLength = (s: RSeg): number => Math.min(TAPER, s.len * 0.4);

/** The road's edge on one side at distance `d` along it, narrowing where it tapers into a neighbour. */
export function edgeAt(s: RSeg, side: number, d: number, tapers: Tapers): number {
  const full = sideHalf(s, side);
  const t = tapers.get(s.id);
  if (!t) return full;
  const k = side > 0 ? 0 : 1, len = taperLength(s);
  let edge = full;
  const ta = t[k], tb = t[2 + k];
  if (!Number.isNaN(ta) && d < len) edge = Math.min(edge, ta + (full - ta) * smooth(d / len));
  if (!Number.isNaN(tb) && s.len - d < len) edge = Math.min(edge, tb + (full - tb) * smooth((s.len - d) / len));
  return edge;
}
const smooth = (u: number): number => { const v = Math.max(0, Math.min(1, u)); return v * v * (3 - 2 * v); };

// ---- lane continuity and turns --------------------------------------------------------------------
/**
 * Across a node, which lane each lane of `from` carries on in: the one sitting in the same place
 * across the road. A lane with nothing there ends (−1), and its traffic has to move over first.
 */
export function matchLanes(net: Network, from: RSeg, fromFwd: boolean, to: RSeg, toFwd: boolean): number[] {
  const n = lanesFor(net, from, fromFwd), m = lanesFor(net, to, toFwd);
  const tol = 0.6 * Math.max(LANE_WIDTH[from.kind], LANE_WIDTH[to.kind]);
  const theirs = Array.from({ length: m }, (_, j) => laneCentre(net, to, toFwd, j));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const mine = laneCentre(net, from, fromFwd, i);
    let best = -1, bd = tol;
    theirs.forEach((o, j) => { const d = Math.abs(o - mine); if (d < bd) { bd = d; best = j; } });
    out.push(best);
  }
  // Two very different roads (a lane into an expressway): rather than end every lane, carry on nearest.
  if (m && out.every((j) => j < 0)) {
    for (let i = 0; i < n; i++) {
      const mine = laneCentre(net, from, fromFwd, i);
      out[i] = theirs.reduce((b, o, j) => (Math.abs(o - mine) < Math.abs(theirs[b] - mine) ? j : b), 0);
    }
  }
  return out;
}

/** One way out of a junction for traffic arriving along a road: which road, which way, how sharp a turn, how many lanes. */
export interface Exit { seg: number; fwd: boolean; angle: number; lanes: number }
/**
 * How the lanes of one approach to a node are used: its exits (rightmost turn first), which exits
 * each lane may take, and which lanes of an exit a car from a given lane may end up in.
 */
export interface Approach { exits: Exit[]; serve: number[][]; targets(lane: number, exit: number): number[] }

const pose: Pose = { x: 0, z: 0, tx: 0, tz: 0 };
/** Direction of travel along a segment at one of its ends, leaving (`out`) or arriving. */
function heading(s: RSeg, atA: boolean, out: boolean): { x: number; z: number } {
  Network.poseAt(s, atA ? 0 : s.len, pose);
  // Along a→b at a, or b→a arriving at a, and so on.
  const sign = atA === out ? 1 : -1;
  return { x: pose.tx * sign, z: pose.tz * sign };
}

const RIGHT = 0.35, LEFT = -0.35;

/** Lanes of an approach, their turns and their target lanes. See the spec for the rules. */
export function approachLanes(net: Network, node: number, seg: RSeg, fwd: boolean): Approach {
  const n = lanesFor(net, seg, fwd);
  const inDir = heading(seg, !fwd, false);
  const exits: Exit[] = [];
  for (const o of net.segsAt(node)) {
    for (const outFwd of [true, false]) {
      if ((outFwd ? o.a : o.b) !== node) continue;
      if (!outFwd && oneWay(o)) continue;
      if (o.id === seg.id && outFwd !== fwd) continue; // no U-turns back the way it came
      if (o.id === seg.id && o.a !== o.b) continue;
      const d = heading(o, outFwd, true);
      const cross = inDir.x * d.z - inDir.z * d.x, dot = inDir.x * d.x + inDir.z * d.z;
      exits.push({ seg: o.id, fwd: outFwd, angle: Math.atan2(cross, dot), lanes: lanesFor(net, o, outFwd) });
    }
  }
  exits.sort((p, q) => q.angle - p.angle);
  const E = exits.length;
  const serve: number[][] = Array.from({ length: n }, () => []);
  const special = new Map<string, number[]>(); // "lane:exit" -> targets, where the general rule does not apply
  const toSeg = (e: Exit): RSeg => net.segs.get(e.seg)!;

  const plain = net.degree(node) === 2;
  const interchange = net.degree(node) === 3 && net.segsAt(node).every((q) => isMotorway(q.kind));
  if (E === 0) {
    // A dead end: nowhere to go.
  } else if (plain || (interchange && (E === 1 || seg.kind === KIND_RAMP))) {
    // Carrying on along one road, or merging onto a carriageway: lanes line up across the node.
    exits.forEach((e, k) => {
      if (seg.kind === KIND_RAMP && interchange) {
        // A slip road joins on its own side: the carriageway's kerb lane if it comes in from the right.
        const lane = e.angle <= 0 ? 0 : e.lanes - 1;
        for (let i = 0; i < n; i++) { serve[i].push(k); special.set(`${i}:${k}`, [lane]); }
        return;
      }
      const m = matchLanes(net, seg, fwd, toSeg(e), e.fwd);
      m.forEach((j, i) => { if (j >= 0) { serve[i].push(k); special.set(`${i}:${k}`, [j]); } });
    });
  } else if (interchange) {
    // A diverge: every lane that carries on goes straight, and the lane on the ramp's side may leave.
    const straight = exits.reduce((b, e, k) => (Math.abs(e.angle) < Math.abs(exits[b].angle) ? k : b), 0);
    exits.forEach((e, k) => {
      if (k === straight) {
        matchLanes(net, seg, fwd, toSeg(e), e.fwd).forEach((j, i) => { if (j >= 0) { serve[i].push(k); special.set(`${i}:${k}`, [j]); } });
      } else {
        const i = e.angle > 0 ? 0 : n - 1;
        serve[i].push(k);
        special.set(`${i}:${k}`, [e.angle > 0 ? 0 : e.lanes - 1]);
      }
    });
  } else if (E === 1) {
    for (let i = 0; i < n; i++) serve[i].push(0);
  } else {
    // Pockets: lanes that begin at a plain node just upstream, on the kerb or the median side.
    let kR = 0, kL = 0;
    const start = fwd ? seg.a : seg.b;
    const up = continuation(net, seg, start);
    if (up) {
      const upFwd = up.o.b === start;
      if (!(oneWay(up.o) && !upFwd)) {
        const fed = new Set(matchLanes(net, up.o, upFwd, seg, fwd).filter((j) => j >= 0));
        while (kR < n - 1 && !fed.has(kR)) kR++;
        while (kL < n - 1 - kR && !fed.has(n - 1 - kL)) kL++;
      }
    }
    for (let i = 0; i < kR; i++) serve[i].push(0);
    for (let i = n - kL; i < n; i++) serve[i].push(E - 1);
    const rest = Array.from({ length: n - kR - kL }, (_, i) => kR + i);
    let restExits = exits.map((_, k) => k).filter((k) => !(kR && k === 0) && !(kL && k === E - 1));
    if (!restExits.length) restExits = exits.map((_, k) => k);
    // Share the rest out: lane k of m takes exit j of E' where their slices of [0, 1] overlap.
    const m = rest.length, Ep = restExits.length;
    rest.forEach((lane, r) => {
      // Lanes run kerb (0) to median; exits right to left: both left to right across the road.
      restExits.forEach((ex, j) => {
        const lo = Math.max(r / m, j / Ep), hi = Math.min((r + 1) / m, (j + 1) / Ep);
        if (hi - lo > 1e-9) serve[lane].push(ex);
      });
    });
    for (const list of serve) list.sort((p, q) => p - q);
  }

  const targets = (lane: number, exit: number): number[] => {
    const fixed = special.get(`${lane}:${exit}`);
    if (fixed) return fixed;
    const e = exits[exit];
    if (!e || e.lanes <= 0) return [];
    const servers = serve.map((l, i) => (l.includes(exit) ? i : -1)).filter((i) => i >= 0);
    const k = Math.max(1, servers.length);
    // A car in a lane that does not serve this exit (it waited too long to move over) goes by rank.
    let r = servers.indexOf(lane);
    if (r < 0) r = Math.max(0, Math.min(k - 1, servers.filter((i) => i < lane).length));
    const m = e.lanes;
    if (e.angle > RIGHT) return [Math.min(r, m - 1)];
    if (e.angle < LEFT) return [Math.max(0, Math.min(m - 1, m - k + r))];
    if (m > k) return Array.from({ length: m - k + 1 }, (_, d) => r + d);
    return [Math.min(r, m - 1)];
  };
  return { exits, serve, targets };
}
