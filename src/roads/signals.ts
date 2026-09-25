import { Network } from './network';
import type { RSeg } from './network';
import { approachLanes, oneWay } from './lanes';

/**
 * Traffic signal plans, Trafficity-style. A signalised junction runs its phases in turn; in each phase
 * every movement (arriving along one road, leaving along another) is green, green but giving way
 * (yield), or red. A movement is keyed `${inSeg}${f|b}>${outSeg}${f|b}` by the segments and the way
 * they are driven, so the lanes it uses come from the automatic turn lanes and survive lane edits.
 */

/** Seconds of amber after each phase, for the movements that go red next. */
export const AMBER = 1;
export const MIN_GREEN = 3, MAX_GREEN = 60, DEFAULT_GREEN = 8;
/** 1: protected green. 2: green, but give way to traffic that has it protected. Missing: red. */
export type MoveState = 1 | 2;
export interface SignalPhase { green: number; moves: Record<string, MoveState> }
export interface SignalPlan { phases: SignalPhase[]; adaptive?: boolean }
export type SignalState = 'green' | 'yield' | 'amber' | 'red';

export const moveKey = (inSeg: number, inFwd: boolean, outSeg: number, outFwd: boolean): string =>
  `${inSeg}${inFwd ? 'f' : 'b'}>${outSeg}${outFwd ? 'f' : 'b'}`;
const KEY = /^(\d+)([fb])>(\d+)([fb])$/;

/** One way through a junction, with how sharply it turns (positive to the right). */
export interface Movement { key: string; inSeg: number; inFwd: boolean; outSeg: number; outFwd: boolean; angle: number }

/** Every movement through a node: from each road arriving there into each road leaving it. */
export function movements(net: Network, node: number): Movement[] {
  const out: Movement[] = [];
  for (const s of net.segsAt(node)) {
    for (const fwd of [true, false]) {
      // Arriving along s: a→b arrives at b, b→a (two-way roads only) arrives at a.
      if ((fwd ? s.b : s.a) !== node || (!fwd && oneWay(s))) continue;
      for (const e of approachLanes(net, node, s, fwd).exits) {
        out.push({ key: moveKey(s.id, fwd, e.seg, e.fwd), inSeg: s.id, inFwd: fwd, outSeg: e.seg, outFwd: e.fwd, angle: e.angle });
      }
    }
  }
  return out;
}

/** The direction traffic arrives along an approach, at the node. */
function arrival(s: RSeg, fwd: boolean): { x: number; z: number } {
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  Network.poseAt(s, fwd ? s.len : 0, p);
  return fwd ? { x: p.tx, z: p.tz } : { x: -p.tx, z: -p.tz };
}

/**
 * A sensible plan to start from. At a crossroads opposite arms go together, straight on and right
 * protected and left turns giving way to oncoming traffic; at a T the through road goes first (its
 * turn into the side road giving way), then the side road; anything else takes turns arm by arm.
 */
export function defaultPlan(net: Network, node: number): SignalPlan {
  const moves = movements(net, node);
  const arms: { id: string; seg: RSeg; fwd: boolean; moves: Movement[] }[] = [];
  for (const m of moves) {
    const id = `${m.inSeg}${m.inFwd ? 'f' : 'b'}`;
    let arm = arms.find(a => a.id === id);
    if (!arm) { arm = { id, seg: net.segs.get(m.inSeg)!, fwd: m.inFwd, moves: [] }; arms.push(arm); }
    arm.moves.push(m);
  }
  const dir = arms.map(a => arrival(a.seg, a.fwd));
  const opposite = (i: number, j: number): boolean => dir[i].x * dir[j].x + dir[i].z * dir[j].z < -0.7;
  const phase = (group: number[], yieldLeft: boolean): SignalPhase => {
    const out: Record<string, MoveState> = {};
    for (const i of group) for (const m of arms[i].moves) out[m.key] = yieldLeft && m.angle < -0.35 ? 2 : 1;
    return { green: DEFAULT_GREEN, moves: out };
  };
  if (arms.length === 4) {
    for (let j = 1; j < 4; j++) {
      const rest = [1, 2, 3].filter(k => k !== j);
      if (opposite(0, j) && opposite(rest[0], rest[1])) return { phases: [phase([0, j], true), phase(rest, true)] };
    }
  }
  if (arms.length === 3) {
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      if (!opposite(i, j)) continue;
      const side = [0, 1, 2].find(k => k !== i && k !== j)!;
      return { phases: [phase([i, j], true), phase([side], false)] };
    }
  }
  return { phases: arms.map((_, i) => phase([i], false)) };
}

/** Whether a plan still describes this junction: every movement it names exists, and its timings are sane. */
export function planFits(net: Network, node: number, plan: SignalPlan | undefined): boolean {
  if (!plan || !Array.isArray(plan.phases) || !plan.phases.length) return false;
  const all = movements(net, node), keys = new Set(all.map(m => m.key));
  const sane = plan.phases.every(p => Number.isFinite(p.green) && p.green >= MIN_GREEN && p.green <= MAX_GREEN
    && Object.entries(p.moves).every(([k, v]) => keys.has(k) && (v === 1 || v === 2)));
  // Every movement must get a green somewhere, or the traffic routed that way would wait for ever:
  // a new arm added since the plan was made sends it back to the default.
  const served = new Set(plan.phases.flatMap(p => Object.keys(p.moves)));
  return sane && all.every(m => served.has(m.key));
}

/** The plan a signalised node actually runs: its own if it still fits, otherwise the default. */
export function planFor(net: Network, node: number): SignalPlan {
  const own = net.nodes.get(node)?.signal;
  return own && planFits(net, node, own) ? own : defaultPlan(net, node);
}

/**
 * The state of movement `key` in `phase`, `t` seconds in, whose green lasts `len` (the plan's green,
 * or longer or shorter when adapting). After the green comes the amber: a movement that is also
 * green next phase just stays green.
 */
export function stateIn(plan: SignalPlan, phase: number, t: number, len: number, key: string): SignalState {
  const p = plan.phases[phase];
  if (!p) return 'red';
  const now = p.moves[key];
  const on: SignalState = now === 1 ? 'green' : now === 2 ? 'yield' : 'red';
  if (t < len || !now) return on;
  return plan.phases[(phase + 1) % plan.phases.length].moves[key] ? on : 'amber';
}

export const cycleOf = (plan: SignalPlan): number => plan.phases.reduce((t, p) => t + p.green + AMBER, 0);

/** Where a fixed-time plan is at `time` seconds into its cycle. */
export function fixedClock(plan: SignalPlan, time: number): { phase: number; t: number; len: number } {
  const cycle = cycleOf(plan);
  if (!plan.phases.length || cycle <= 0) return { phase: 0, t: 0, len: 0 };
  let t = ((time % cycle) + cycle) % cycle;
  for (let i = 0; i < plan.phases.length; i++) {
    const span = plan.phases[i].green + AMBER;
    if (t < span || i === plan.phases.length - 1) return { phase: i, t, len: plan.phases[i].green };
    t -= span;
  }
  return { phase: 0, t: 0, len: plan.phases[0].green };
}

/** Rewrite every key of a plan through `fn`, which returns the new key or null to drop the plan. */
function rekey(plan: SignalPlan, fn: (inSeg: number, inF: string, outSeg: number, outF: string) => string | null): SignalPlan | null {
  const phases: SignalPhase[] = [];
  for (const p of plan.phases) {
    const moves: Record<string, MoveState> = {};
    for (const [k, v] of Object.entries(p.moves)) {
      const m = k.match(KEY);
      if (!m) return null;
      const nk = fn(+m[1], m[2], +m[3], m[4]);
      if (nk === null) return null;
      moves[nk] = v;
    }
    phases.push({ green: p.green, moves });
  }
  return { ...plan, phases };
}

/** A segment at the junction was split: its piece there has a new id. */
export function renameSeg(plan: SignalPlan, oldId: number, newId: number): void {
  const out = rekey(plan, (a, af, b, bf) => `${a === oldId ? newId : a}${af}>${b === oldId ? newId : b}${bf}`);
  if (out) plan.phases = out.phases;
}

/** A segment at the junction was reversed: what was driven a→b is now driven b→a. */
export function flipSeg(plan: SignalPlan, segId: number): void {
  const flip = (id: number, f: string): string => `${id}${id === segId ? (f === 'f' ? 'b' : 'f') : f}`;
  const out = rekey(plan, (a, af, b, bf) => `${flip(a, af)}>${flip(b, bf)}`);
  if (out) plan.phases = out.phases;
}

/** A copy of a plan with its segment ids mapped (for saves), or null if any has no counterpart. */
export function remapPlan(plan: SignalPlan, map: (segId: number) => number | undefined): SignalPlan | null {
  return rekey(plan, (a, af, b, bf) => {
    const na = map(a), nb = map(b);
    return na === undefined || nb === undefined ? null : `${na}${af}>${nb}${bf}`;
  });
}

export const clonePlan = (plan: SignalPlan): SignalPlan => ({ ...(plan.adaptive ? { adaptive: true } : {}), phases: plan.phases.map(p => ({ green: p.green, moves: { ...p.moves } })) });
