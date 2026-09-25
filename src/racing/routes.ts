import { GRID } from '../constants';
import { roadHalf } from '../roads/lanes';
import { isMotorway } from '../roads/network';
import type { Network, RSeg } from '../roads/network';
import { roadHeight } from '../roads/structures';

/**
 * Race routes, planned from the city's own streets. A route is a polyline along the middle of the
 * roads (in scene space), with where it starts and finishes, how many laps, and a barrier across
 * every side street it passes so the racers keep to it.
 */

export type RaceKind = 'circuit' | 'sprint' | 'drift' | 'drag' | 'police';

export const RACE_KINDS: Record<RaceKind, { label: string; color: number; blurb: string }> = {
  circuit: { label: 'Circuit', color: 0x3f8cff, blurb: 'Laps of a closed loop against three rivals' },
  sprint: { label: 'Sprint', color: 0x3fcf6f, blurb: 'Point to point across town against three rivals' },
  drift: { label: 'Drift', color: 0xc05cff, blurb: 'Slide round the loop to beat the score' },
  drag: { label: 'Drag', color: 0xffc93f, blurb: 'Flat out down a straight: nail the launch' },
  police: { label: 'Pursuit', color: 0xff4f4f, blurb: 'Reach the finish with the police on your tail' },
};

export interface Barrier { x: number; z: number; yaw: number; width: number; y: number; arrow: number }

export interface RaceRoute {
  id: string;
  kind: RaceKind;
  name: string;
  /** Points along the route in scene space, with the road height and cumulative distance. */
  xs: Float32Array; zs: Float32Array; ys: Float32Array; cum: Float32Array;
  /**
   * The racing line: the route rounded off through its junctions, for the rivals to follow. Sampled
   * evenly, one point per LINE_STEP of the route's own length, so `lineAt` maps route distance to it.
   */
  lx: Float32Array; lz: Float32Array;
  /** Length of one lap (or of the whole run). */
  length: number;
  laps: number;
  loop: boolean;
  barriers: Barrier[];
  /** Widest half-width of road along the route: how far off the middle still counts as on it. */
  width: number;
  reward: number;
  /** Rivals racing, or 1 for the police car in a pursuit. */
  rivals: number;
  /** The drift score to beat, for drift races. */
  target: number;
}

/** A seeded random stream, so the same city gets the same races. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roads a race can use: surface or bridge, not the motorways, tunnels, or anything off the map. */
function raceable(seg: RSeg): boolean {
  if (seg.structure === 2 || isMotorway(seg.kind)) return false;
  return seg.minX > 0.5 && seg.minZ > 0.5 && seg.maxX < GRID - 0.5 && seg.maxZ < GRID - 0.5;
}

interface Step { seg: RSeg; from: number; to: number }

/** Shortest paths from a node over raceable roads, with a cost per segment. */
function dijkstra(net: Network, start: number, cost: (seg: RSeg) => number): { dist: Map<number, number>; via: Map<number, Step> } {
  const dist = new Map<number, number>([[start, 0]]), via = new Map<number, Step>(), done = new Set<number>();
  const open: [number, number][] = [[0, start]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [d, node] = open.splice(bi, 1)[0];
    if (done.has(node)) continue;
    done.add(node);
    for (const seg of net.segsAt(node)) {
      if (!raceable(seg)) continue;
      const forward = seg.a === node;
      if (seg.oneway && !forward) continue;
      const other = forward ? seg.b : seg.a, nd = d + cost(seg);
      if (nd < (dist.get(other) ?? Infinity)) { dist.set(other, nd); via.set(other, { seg, from: node, to: other }); open.push([nd, other]); }
    }
  }
  return { dist, via };
}

function pathTo(via: Map<number, Step>, start: number, end: number): Step[] {
  const steps: Step[] = [];
  for (let n = end; n !== start;) {
    const s = via.get(n);
    if (!s) return [];
    steps.unshift(s);
    n = s.from;
  }
  return steps;
}

const lengthOf = (steps: Step[]): number => steps.reduce((n, s) => n + s.seg.len, 0);

/** Turn a chain of segments into route points in scene space. */
function trace(steps: Step[]): { xs: number[]; zs: number[]; ys: number[]; joints: number[] } {
  const xs: number[] = [], zs: number[] = [], ys: number[] = [], joints: number[] = [];
  for (const { seg, from } of steps) {
    if (xs.length) joints.push(xs.length - 1);
    const forward = seg.a === from;
    for (let k = 0; k <= seg.n; k++) {
      const i = forward ? k : seg.n - k;
      if (xs.length && k === 0) continue;
      xs.push(seg.pts[i * 2] - GRID / 2); zs.push(seg.pts[i * 2 + 1] - GRID / 2);
      ys.push(roadHeight(seg, seg.cum[i]));
    }
  }
  return { xs, zs, ys, joints };
}

const LINE_STEP = 0.1;

/** Cut a polyline between two distances along it, interpolating the ends. */
function slice(xs: number[], zs: number[], ys: number[], cum: number[], from: number, to: number): { xs: number[]; zs: number[]; ys: number[] } {
  const out = { xs: [] as number[], zs: [] as number[], ys: [] as number[] };
  const at = (d: number): void => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < d) i++;
    const u = Math.max(0, Math.min(1, (d - cum[i]) / (cum[i + 1] - cum[i] || 1)));
    out.xs.push(xs[i] + (xs[i + 1] - xs[i]) * u); out.zs.push(zs[i] + (zs[i + 1] - zs[i]) * u); out.ys.push(ys[i] + (ys[i + 1] - ys[i]) * u);
  };
  at(from);
  for (let i = 0; i < cum.length; i++) if (cum[i] > from + 1e-3 && cum[i] < to - 1e-3) { out.xs.push(xs[i]); out.zs.push(zs[i]); out.ys.push(ys[i]); }
  at(to);
  return out;
}

/**
 * The line a driver takes: the route sampled evenly and rounded off, so a right-angled junction
 * becomes a curve of a car length or so rather than a pivot on the spot.
 */
function racingLine(xs: Float32Array, zs: Float32Array, cum: Float32Array, loop: boolean): { lx: Float32Array; lz: Float32Array } {
  const length = cum[cum.length - 1], n = Math.max(2, Math.round(length / LINE_STEP) + 1);
  let lx = new Float32Array(n), lz = new Float32Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * length;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const u = Math.max(0, Math.min(1, (d - cum[j]) / (cum[j + 1] - cum[j] || 1)));
    lx[k] = xs[j] + (xs[j + 1] - xs[j]) * u; lz[k] = zs[j] + (zs[j + 1] - zs[j]) * u;
  }
  // A few passes of a moving average about half a car length either side round every corner off.
  const reach = 7;
  for (let pass = 0; pass < 5; pass++) {
    const ox = new Float32Array(n), oz = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      if (!loop && (k === 0 || k === n - 1)) { ox[k] = lx[k]; oz[k] = lz[k]; continue; }
      let sx = 0, sz = 0, c = 0;
      for (let o = -reach; o <= reach; o++) {
        let i = k + o;
        if (loop) i = ((i % (n - 1)) + (n - 1)) % (n - 1); else i = Math.max(0, Math.min(n - 1, i));
        sx += lx[i]; sz += lz[i]; c++;
      }
      ox[k] = sx / c; oz[k] = sz / c;
    }
    if (loop) { ox[n - 1] = ox[0]; oz[n - 1] = oz[0]; }
    lx = ox; lz = oz;
  }
  return { lx, lz };
}

/** Barriers across every side street the route passes, arrows pointing on along the route. */
function barriersFor(net: Network, steps: Step[], loop: boolean): Barrier[] {
  const onRoute = new Set(steps.map(s => s.seg.id));
  const out: Barrier[] = [];
  const width = Math.max(...steps.map(s => roadHalf(s.seg)));
  steps.forEach((step, k) => {
    if (!loop && k === steps.length - 1) return;
    const node = step.to, n = net.nodes.get(node);
    if (!n) return;
    const next = steps[(k + 1) % steps.length];
    // Which way the route leaves this junction: the arrow on every barrier points that way.
    const leaving = next.seg, fwd = leaving.a === node, i = fwd ? 1 : leaving.n - 1;
    const arrow = Math.atan2(leaving.pts[i * 2] - n.x, leaving.pts[i * 2 + 1] - n.z);
    for (const arm of net.segsAt(node)) {
      if (onRoute.has(arm.id)) continue;
      const out1 = arm.a === node, j = out1 ? 1 : arm.n - 1;
      const dx = arm.pts[j * 2] - n.x, dz = arm.pts[j * 2 + 1] - n.z, dl = Math.hypot(dx, dz) || 1;
      const d = Math.min(arm.len * 0.6, width + 0.55);
      const s = out1 ? d : arm.len - d, ix = Math.min(arm.n, Math.round(s / arm.len * arm.n));
      const x = arm.pts[ix * 2] - GRID / 2, z = arm.pts[ix * 2 + 1] - GRID / 2;
      out.push({ x, z, yaw: Math.atan2(dx / dl, dz / dl), width: roadHalf(arm) * 2 + 0.25, y: roadHeight(arm, s), arrow });
    }
  });
  return out;
}

function build(kind: RaceKind, name: string, steps: Step[], net: Network, loop: boolean, laps: number, rivals: number): RaceRoute | null {
  if (steps.length < 1) return null;
  const traced = trace(steps);
  if (traced.xs.length < 3) return null;
  let { xs, zs, ys } = traced;
  if (loop) { xs.push(xs[0]); zs.push(zs[0]); ys.push(ys[0]); }
  const measure = (): number[] => { const c = [0]; for (let i = 1; i < xs.length; i++) c.push(c[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1])); return c; };
  // Start and finish in the middle of a street, never on a junction: a loop starts halfway along its
  // longest street; a run starts halfway along its first street and ends halfway along its last.
  const raw = measure(), full = raw[raw.length - 1];
  const bounds = [0, ...traced.joints.map(i => raw[i]), loop ? raw[raw.length - 2] + Math.hypot(xs[xs.length - 1] - xs[xs.length - 2], zs[zs.length - 1] - zs[zs.length - 2]) : full];
  if (loop) {
    let best = 0;
    for (let k = 1; k < bounds.length - 1; k++) if (bounds[k + 1] - bounds[k] > bounds[best + 1] - bounds[best]) best = k;
    const mid = (bounds[best] + bounds[best + 1]) / 2;
    const tail = slice(xs, zs, ys, raw, mid, full), head = slice(xs, zs, ys, raw, 0, mid);
    xs = [...tail.xs, ...head.xs.slice(1)]; zs = [...tail.zs, ...head.zs.slice(1)]; ys = [...tail.ys, ...head.ys.slice(1)];
  } else if (steps.length > 1 && kind !== 'drag') {
    const from = (bounds[0] + bounds[1]) / 2, to = (bounds[bounds.length - 2] + bounds[bounds.length - 1]) / 2;
    ({ xs, zs, ys } = slice(xs, zs, ys, raw, from, to));
  }
  const cum = Float32Array.from(measure());
  const length = cum[cum.length - 1];
  if (length < 6) return null;
  const total = length * laps;
  const reward = Math.round((150 + total * 22 * (kind === 'police' ? 1.5 : kind === 'drag' ? 1.8 : 1)) / 50) * 50;
  return {
    id: `${kind}-${steps[0].from}-${steps[steps.length - 1].to}-${Math.round(length)}`, kind, name,
    xs: Float32Array.from(xs), zs: Float32Array.from(zs), ys: Float32Array.from(ys), cum, length, laps, loop,
    ...racingLine(Float32Array.from(xs), Float32Array.from(zs), cum, loop),
    barriers: barriersFor(net, steps, loop), width: Math.max(...steps.map(s => roadHalf(s.seg))),
    reward, rivals, target: Math.round(total * 180 / 100) * 100,
  };
}

const STREET_NAMES = ['Harbour', 'Kingsway', 'Mill Lane', 'Ridge', 'Foundry', 'Canal', 'Station', 'Market', 'Old Town', 'Riverside', 'Parkway', 'Beacon', 'Quarry', 'Northgate', 'Elm', 'Viaduct'];

/**
 * Plan the city's races: a couple of each kind where the streets allow, seeded by the map so the same
 * city keeps the same races until its roads change.
 */
export function planRaces(net: Network, seed: number): RaceRoute[] {
  const rnd = stream(seed * 977 + net.segs.size * 13);
  const nodes = [...net.nodes.values()].filter(n => !n.ring && net.segsAt(n.id).some(raceable) && n.x > 2 && n.z > 2 && n.x < GRID - 2 && n.z < GRID - 2);
  if (nodes.length < 6) return [];
  const races: RaceRoute[] = [];
  const used = new Set<string>();
  const name = (kind: RaceKind): string => {
    for (let k = 0; k < 20; k++) {
      const n = STREET_NAMES[Math.floor(rnd() * STREET_NAMES.length)];
      if (!used.has(n)) { used.add(n); return `${n} ${RACE_KINDS[kind].label}`; }
    }
    return RACE_KINDS[kind].label;
  };
  const pickNode = (): number => nodes[Math.floor(rnd() * nodes.length)].id;

  // Point to point: a long way across town.
  const sprint = (kind: RaceKind, lo: number, hi: number): void => {
    for (let tries = 0; tries < 30; tries++) {
      const a = pickNode();
      const { dist, via } = dijkstra(net, a, s => s.len);
      const far = [...dist.entries()].filter(([, d]) => d >= lo && d <= hi).sort((x, y) => y[1] - x[1]);
      if (!far.length) continue;
      const [b] = far[Math.floor(rnd() * Math.min(4, far.length))];
      const steps = pathTo(via, a, b);
      const route = build(kind, name(kind), steps, net, false, 1, kind === 'police' ? 1 : 3);
      if (route && !races.some(r => r.id === route.id)) { races.push(route); return; }
    }
  };

  // A loop: out one way and back another, never on the same street twice.
  const circuit = (kind: RaceKind, lo: number, hi: number): void => {
    for (let tries = 0; tries < 40; tries++) {
      const a = pickNode();
      const out = dijkstra(net, a, s => s.len);
      const mids = [...out.dist.entries()].filter(([, d]) => d >= lo / 2.6 && d <= hi / 2);
      if (!mids.length) continue;
      const [b] = mids[Math.floor(rnd() * mids.length)];
      const there = pathTo(out.via, a, b);
      const usedSegs = new Set(there.map(s => s.seg.id)), usedNodes = new Set(there.map(s => s.to));
      usedNodes.delete(b);
      const back = dijkstra(net, b, s => usedSegs.has(s.id) ? 1e6 : s.len + (usedNodes.has(s.a) || usedNodes.has(s.b) ? 40 : 0));
      const home = pathTo(back.via, b, a);
      if (!home.length || home.some(s => usedSegs.has(s.seg.id))) continue;
      const steps = [...there, ...home], length = lengthOf(steps);
      if (length < lo || length > hi) continue;
      const route = build(kind, name(kind), steps, net, true, length < 22 ? 3 : 2, kind === 'drift' ? 0 : 3);
      if (route && !races.some(r => r.id === route.id)) { races.push(route); return; }
    }
  };

  // A drag strip: the longest run of road that stays straight through its junctions.
  const drag = (): void => {
    let best: Step[] = [];
    for (const n of nodes) for (const first of net.segsAt(n.id)) {
      if (!raceable(first)) continue;
      const steps: Step[] = [];
      let node = n.id, seg = first;
      const heading = (s: RSeg, from: number): number => {
        const f = s.a === from, i0 = f ? 0 : s.n, i1 = f ? s.n : 0;
        return Math.atan2(s.pts[i1 * 2] - s.pts[i0 * 2], s.pts[i1 * 2 + 1] - s.pts[i0 * 2 + 1]);
      };
      let dir = heading(seg, node);
      for (let guard = 0; guard < 30; guard++) {
        if (seg.oneway && seg.a !== node) break;
        const to = seg.a === node ? seg.b : seg.a;
        steps.push({ seg, from: node, to });
        // Carry straight on through the junction, if a road does.
        let next: RSeg | null = null, bestTurn = 0.12;
        for (const s of net.segsAt(to)) {
          if (s.id === seg.id || !raceable(s) || steps.some(t => t.seg.id === s.id)) continue;
          const h = heading(s, to), turn = Math.abs(Math.atan2(Math.sin(h - dir), Math.cos(h - dir)));
          if (turn < bestTurn) { bestTurn = turn; next = s; }
        }
        if (!next) break;
        node = to; seg = next; dir = heading(seg, node);
      }
      if (lengthOf(steps) > lengthOf(best)) best = steps;
    }
    // A quarter-mile is plenty: trim a very long straight.
    while (best.length > 1 && lengthOf(best) > 26) best = best.slice(0, -1);
    if (lengthOf(best) >= 10) {
      const route = build('drag', name('drag'), best, net, false, 1, 1);
      if (route) races.push(route);
    }
  };

  circuit('circuit', 16, 44);
  circuit('circuit', 24, 60);
  sprint('sprint', 28, 60);
  sprint('sprint', 36, 80);
  circuit('drift', 14, 36);
  drag();
  sprint('police', 34, 80);
  return races;
}

/** Point and direction on a route `s` along it (wrapping round a loop). */
export function routeAt(r: RaceRoute, s: number): { x: number; z: number; y: number; tx: number; tz: number } {
  const len = r.length;
  let d = r.loop ? ((s % len) + len) % len : Math.max(0, Math.min(len, s));
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (r.cum[mid] <= d) lo = mid; else hi = mid; }
  const span = r.cum[hi] - r.cum[lo] || 1, u = (d - r.cum[lo]) / span;
  const dx = r.xs[hi] - r.xs[lo], dz = r.zs[hi] - r.zs[lo], dl = Math.hypot(dx, dz) || 1;
  d = u;
  return { x: r.xs[lo] + dx * d, z: r.zs[lo] + dz * d, y: r.ys[lo] + (r.ys[hi] - r.ys[lo]) * d, tx: dx / dl, tz: dz / dl };
}

/** The distance along the route nearest to (x, z), searched between `from` and `to` (lap distance). */
export function nearestOnRoute(r: RaceRoute, x: number, z: number, from: number, to: number): { s: number; dist: number } {
  let best = { s: from, dist: Infinity };
  for (let s = from; s <= to; s += 0.05) {
    const p = routeAt(r, s), d = Math.hypot(p.x - x, p.z - z);
    if (d < best.dist) best = { s, dist: d };
  }
  return best;
}

/** A point and direction on the racing line, `s` along the route (wrapping round a loop). */
export function lineAt(r: RaceRoute, s: number): { x: number; z: number; tx: number; tz: number } {
  const n = r.lx.length, len = r.length;
  const d = r.loop ? ((s % len) + len) % len : Math.max(0, Math.min(len, s));
  const f = d / len * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
  const dx = r.lx[i + 1] - r.lx[i], dz = r.lz[i + 1] - r.lz[i], dl = Math.hypot(dx, dz) || 1;
  return { x: r.lx[i] + dx * u, z: r.lz[i] + dz * u, tx: dx / dl, tz: dz / dl };
}

/** How tight the racing line bends around `s`: the speed a racer can take it at. */
export function cornerSpeed(r: RaceRoute, s: number, top: number): number {
  const a = lineAt(r, s - 0.6), b = lineAt(r, s + 0.6);
  const turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
  if (turn < 1e-3) return top;
  const radius = 1.2 / turn;
  return Math.min(top, Math.sqrt(5.5 * radius));
}
