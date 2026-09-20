import { Network, HALF_WIDTH } from './network';
import type { RSeg } from './network';
import type { Raster } from './raster';
import { GRID, SERVICES, T_STATION } from '../constants';
import { APPROACH, entryGate } from './entries';

/** Length of the elevated platform at each end of a line; the track is centred on the station hall. */
export const PLATFORM_LENGTH = 2.45;

/** A raw corridor sample on a road centerline, with the half width of the road under it. */
interface CorridorPoint { x: number; z: number; hw: number }
/** A point on the smoothed track: position, unit tangent, road half width below, arc length. */
export interface TrackPoint { x: number; z: number; tx: number; tz: number; hw: number; s: number }

/**
 * Shortest road-centerline corridor between two stations' access points. `joints` are the indices
 * where the corridor switches segments (junctions), which is where the track gets filleted.
 */
function corridor(net: Network, raster: Raster, a: number, b: number): { pts: CorridorPoint[]; joints: number[] } {
  const pts: CorridorPoint[] = [], joints: number[] = [];
  const start = net.segs.get(raster.accSeg[a]), end = net.segs.get(raster.accSeg[b]);
  if (!start || !end) return { pts, joints };
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  const append = (seg: RSeg, from: number, to: number): void => {
    const steps = Math.max(1, Math.ceil(Math.abs(to - from) / 0.4));
    const hw = HALF_WIDTH[seg.kind] ?? HALF_WIDTH[0];
    for (let i = 0; i <= steps; i++) {
      Network.poseAt(seg, from + (to - from) * i / steps, pose);
      const last = pts.at(-1);
      if (!last || Math.hypot(last.x - pose.x, last.z - pose.z) > 0.001) pts.push({ x: pose.x, z: pose.z, hw });
      else if (i === 0) last.hw = Math.min(last.hw, hw);
    }
  };
  // Stop positions: project each station hall's centre onto its access street, so the platform
  // (PLATFORM_LENGTH, ending at the track's end) sits alongside the hall rather than off its corner.
  const [fw, fd] = SERVICES[T_STATION]?.footprint ?? [1, 1];
  const centre = (tile: number, seg: RSeg): number => Network.nearestOn(seg, tile % GRID + fw / 2, Math.floor(tile / GRID) + fd / 2).s;
  const H = PLATFORM_LENGTH / 2;
  const clamp = (seg: RSeg, v: number): number => Math.max(0, Math.min(seg.len, v));
  const sa = centre(a, start), sb = centre(b, end);
  if (start.id === end.id) {
    const dir = sa <= sb ? 1 : -1;
    append(start, clamp(start, sa - dir * H), clamp(start, sb + dir * H));
    return { pts, joints };
  }
  // Dijkstra by arc length, leaving the start segment from whichever end is closer to the goal,
  // so the track never doubles back along the station's own street.
  const dist = new Map<number, number>(), prev = new Map<number, { node: number; seg: number }>(), done = new Set<number>();
  const seed = (node: number, d: number): void => {
    if (d < (dist.get(node) ?? Infinity)) { dist.set(node, d); prev.set(node, { node: -1, seg: -1 }); }
  };
  seed(start.a, sa); seed(start.b, start.len - sa);
  for (;;) {
    let node = -1, best = Infinity;
    for (const [n, d] of dist) if (!done.has(n) && d < best) { best = d; node = n; }
    if (node < 0) break;
    done.add(node);
    for (const seg of net.segsAt(node)) {
      if (seg.structure || seg.id === start.id || seg.id === end.id) continue;
      const other = seg.a === node ? seg.b : seg.a, d = best + seg.len;
      if (d < (dist.get(other) ?? Infinity)) { dist.set(other, d); prev.set(other, { node, seg: seg.id }); }
    }
  }
  const viaA = (dist.get(end.a) ?? Infinity) + sb, viaB = (dist.get(end.b) ?? Infinity) + end.len - sb;
  if (!Number.isFinite(Math.min(viaA, viaB))) return { pts, joints };
  const target = viaA <= viaB ? end.a : end.b;
  const legs: { from: number; seg: number }[] = [];
  let origin = target;
  for (let p = prev.get(origin)!; p.node >= 0; p = prev.get(origin)!) { legs.unshift({ from: p.node, seg: p.seg }); origin = p.node; }
  append(start, origin === start.a ? clamp(start, sa + H) : clamp(start, sa - H), origin === start.a ? 0 : start.len);
  joints.push(pts.length - 1);
  for (const leg of legs) {
    const seg = net.segs.get(leg.seg)!;
    append(seg, leg.from === seg.a ? 0 : seg.len, leg.from === seg.a ? seg.len : 0);
    joints.push(pts.length - 1);
  }
  append(end, target === end.a ? 0 : end.len, target === end.a ? clamp(end, sb + H) : clamp(end, sb - H));
  return { pts, joints: joints.filter(j => j > 0 && j < pts.length - 1) };
}

/** Elevated rail follows existing road corridors, so tracks never cut through buildings. Raw centerline samples. */
export function railPath(net: Network, raster: Raster, a: number, b: number): { x: number; z: number }[] {
  return corridor(net, raster, a, b).pts.map(p => ({ x: p.x, z: p.z }));
}

/**
 * The drawable track between two stations: the corridor with every junction corner replaced by a
 * circular-ish fillet (cubic Bezier), sized so the arc stays inside the road's own width, then
 * resampled at an even `step`. Tangents are unit vectors along the direction of travel a -> b.
 */
export function railTrack(net: Network, raster: Raster, a: number, b: number, step = 0.25): TrackPoint[] {
  const { pts, joints } = corridor(net, raster, a, b);
  if (pts.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum.at(-1)!;
  const at = (s: number): { x: number; z: number; hw: number } => {
    const d = Math.max(0, Math.min(total, s));
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= d) lo = mid; else hi = mid; }
    const u = (d - cum[lo]) / (cum[hi] - cum[lo] || 1), p = pts[lo], q = pts[hi];
    return { x: p.x + (q.x - p.x) * u, z: p.z + (q.z - p.z) * u, hw: Math.min(p.hw, q.hw) };
  };
  const dirAt = (s0: number, s1: number): { x: number; z: number } => {
    const p = at(s0), q = at(s1), l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    return { x: (q.x - p.x) / l, z: (q.z - p.z) / l };
  };

  // Plan one fillet per junction; neighbouring fillets share the distance between their joints.
  const fillets: { s0: number; s1: number; p0: { x: number; z: number }; p1: { x: number; z: number }; t0: { x: number; z: number }; t1: { x: number; z: number }; k: number }[] = [];
  const js = joints.map(j => cum[j]);
  for (let n = 0; n < js.length; n++) {
    const sj = js[n];
    const room = Math.min(sj - (n > 0 ? (js[n - 1] + sj) / 2 : 0), (n + 1 < js.length ? (js[n + 1] + sj) / 2 : total) - sj);
    const probe = Math.min(0.8, room);
    if (probe < 0.1) continue;
    const din = dirAt(sj - probe, sj), dout = dirAt(sj, sj + probe);
    const theta = Math.acos(Math.max(-1, Math.min(1, din.x * dout.x + din.z * dout.z)));
    if (theta < 0.08) continue;
    const hw = Math.min(pts[joints[n]].hw, at(sj - probe).hw, at(sj + probe).hw);
    // The arc's midpoint sits r(1 - cos(theta/2)) off each centerline; keep that inside the road.
    let r = Math.min(2, (0.95 * hw) / (1 - Math.cos(theta / 2)));
    let t = r * Math.tan(Math.min(theta, 2.8) / 2);
    const limit = Math.max(0.05, room * 0.95);
    if (t > limit) { t = limit; r = t / Math.tan(Math.min(theta, 2.8) / 2); }
    const s0 = sj - t, s1 = sj + t;
    const tin = dirAt(Math.max(0, s0 - 0.3), s0 + 0.001), tout = dirAt(s1 - 0.001, Math.min(total, s1 + 0.3));
    fillets.push({ s0, s1, p0: at(s0), p1: at(s1), t0: tin, t1: tout, k: (4 / 3) * Math.tan(theta / 4) * r });
  }

  // Dense polyline: corridor samples outside fillets, Bezier samples inside them.
  const dense: { x: number; z: number; hw: number }[] = [];
  const push = (p: { x: number; z: number; hw: number }): void => {
    const last = dense.at(-1);
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.01) dense.push(p);
  };
  let f = 0;
  push(at(0));
  for (let i = 1; i < pts.length; i++) {
    while (f < fillets.length && fillets[f].s1 <= cum[i]) {
      const F = fillets[f++];
      push(at(F.s0));
      const hw = at((F.s0 + F.s1) / 2).hw;
      const c0 = { x: F.p0.x + F.t0.x * F.k, z: F.p0.z + F.t0.z * F.k }, c1 = { x: F.p1.x - F.t1.x * F.k, z: F.p1.z - F.t1.z * F.k };
      const n = Math.max(4, Math.ceil((F.s1 - F.s0) / 0.08));
      for (let k = 1; k <= n; k++) {
        const u = k / n, v = 1 - u;
        push({
          x: v * v * v * F.p0.x + 3 * v * v * u * c0.x + 3 * v * u * u * c1.x + u * u * u * F.p1.x,
          z: v * v * v * F.p0.z + 3 * v * v * u * c0.z + 3 * v * u * u * c1.z + u * u * u * F.p1.z,
          hw,
        });
      }
    }
    const inside = fillets.some(F => cum[i] > F.s0 && cum[i] < F.s1);
    if (!inside) push(pts[i]);
  }

  // Even resample by arc length, then central-difference tangents.
  const dc = [0];
  for (let i = 1; i < dense.length; i++) dc.push(dc[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  const len = dc.at(-1)!;
  const count = Math.max(2, Math.round(len / step) + 1);
  const out: TrackPoint[] = [];
  let j = 1;
  for (let i = 0; i < count; i++) {
    const s = (len * i) / (count - 1);
    while (j < dense.length - 1 && dc[j] < s) j++;
    const p = dense[j - 1], q = dense[j], u = Math.max(0, Math.min(1, (s - dc[j - 1]) / (dc[j] - dc[j - 1] || 1)));
    out.push({ x: p.x + (q.x - p.x) * u, z: p.z + (q.z - p.z) * u, tx: 0, tz: 1, hw: Math.min(p.hw, q.hw), s });
  }
  for (let i = 0; i < out.length; i++) {
    const p = out[Math.max(0, i - 1)], q = out[Math.min(out.length - 1, i + 1)], l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    out[i].tx = (q.x - p.x) / l; out[i].tz = (q.z - p.z) / l;
  }
  return out;
}

/**
 * The track for a line that leaves town: the corridor from its station to the nearest city entrance,
 * then straight on past the map edge, alongside the highway that arrives there.
 */
export function intercityTrack(net: Network, raster: Raster, station: number, step = 0.25): TrackPoint[] {
  const gates = [...net.nodes.values()].filter(n => n.entry).map(entryGate);
  if (!gates.length) return [];
  const sx = station % GRID, sz = Math.floor(station / GRID);
  const gate = gates.reduce((best, g) => Math.hypot(g.x - sx, g.z - sz) < Math.hypot(best.x - sx, best.z - sz) ? g : best);
  // Aim at the road tile just inside the gate, which the entrance's own avenue always serves.
  let target = -1, bestDistance = Infinity;
  for (let i = 0; i < GRID * GRID; i++) {
    if (raster.accSeg[i] < 0) continue;
    const d = Math.hypot(i % GRID + 0.5 - gate.x, Math.floor(i / GRID) + 0.5 - gate.z);
    if (d < bestDistance) { bestDistance = d; target = i; }
  }
  if (target < 0) return [];
  const track = railTrack(net, raster, station, target, step);
  if (track.length < 2) return [];
  // Carry on off the map, following the direction the entrance faces.
  const last = track.at(-1)!;
  const run = APPROACH + 6;
  for (let d = step; d <= run; d += step) {
    track.push({ x: last.x - gate.dx * d, z: last.z - gate.dz * d, tx: -gate.dx, tz: -gate.dz, hw: last.hw, s: last.s + d });
  }
  return track;
}
