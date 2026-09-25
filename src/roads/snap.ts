import { GRID } from '../constants';
import { Network } from './network';
import type { RSeg } from './network';
import { gridPoint } from '../placement';

type Pt = { x: number; z: number };

/**
 * What the pointer is being snapped for. `from` and `heading` describe the road being drawn, so the
 * angle steps can turn relative to it; `grid` brings back tile-centre snapping, `free` turns off the
 * guides and angle steps (joining existing roads still works), and `joins: false` skips joining
 * altogether, for choosing a curve's bend.
 */
export interface SnapCtx {
  from?: Pt | null;
  heading?: Pt | null;
  grid?: boolean;
  free?: boolean;
  joins?: boolean;
  excludeNodes?: Set<number>;
  excludeSegs?: Set<number>;
}
/** A dashed line to draw while a guide is in use, from where it comes to where it caught. */
export interface Guide { ax: number; az: number; bx: number; bz: number }
export interface Snapped { x: number; z: number; label: string | null; guides: Guide[]; node?: number; seg?: number }

const JOIN_NODE = 0.9;
const JOIN_ROAD = 0.8;
/** How close the pointer has to come to a guide line, and to where two of them cross. */
const GUIDE_CATCH = 0.5;
const CROSS_CATCH = 0.6;
/** Only roads this near the pointer offer guide lines, so a far-off street does not tug at it. */
const GUIDE_REACH = 12;
const STEP = Math.PI / 12; // 15°

interface Line { ox: number; oz: number; dx: number; dz: number; ray: boolean; label: string }

/**
 * Where a road point lands, Trafficity-style: joins an existing node or road first, then catches on
 * guide lines drawn out of nearby roads (straight on, square to them, or parallel from the start),
 * then steps its heading by 15° and its length by whole cells. Nothing forces a grid unless asked.
 */
export function snapPoint(net: Network, p: Pt, ctx: SnapCtx = {}): Snapped {
  const joins = ctx.joins !== false;
  if (ctx.grid) {
    const g = gridPoint(p);
    return (joins && joinAt(net, g, ctx)) || { ...g, label: null, guides: [] };
  }
  if (joins) {
    const j = joinAt(net, p, ctx);
    if (j) return j;
  }
  if (ctx.free) return { x: p.x, z: p.z, label: null, guides: [] };

  const lines = guideLines(net, p, ctx);
  // Two guides crossing near the pointer pin it harder than either one.
  let best: { x: number; z: number; d: number; a: Line; b: Line } | null = null;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const x = crossing(lines[i], lines[j]);
    if (!x) continue;
    const d = Math.hypot(x.x - p.x, x.z - p.z);
    if (d < CROSS_CATCH && (!best || d < best.d)) best = { ...x, d, a: lines[i], b: lines[j] };
  }
  if (best && inMap(best)) return { x: best.x, z: best.z, label: 'Guide ×', guides: [guide(best.a, best), guide(best.b, best)] };
  let one: { x: number; z: number; d: number; line: Line } | null = null;
  for (const line of lines) {
    const t = (p.x - line.ox) * line.dx + (p.z - line.oz) * line.dz;
    if (line.ray && t < 0.5) continue;
    const x = line.ox + line.dx * t, z = line.oz + line.dz * t;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < GUIDE_CATCH && (!one || d < one.d)) one = { x, z, d, line };
  }
  if (one && inMap(one)) return { x: one.x, z: one.z, label: one.line.label, guides: [guide(one.line, one)] };

  if (ctx.from) {
    const f = ctx.from;
    const dist = Math.hypot(p.x - f.x, p.z - f.z);
    if (dist >= 0.5) {
      const ref = ctx.heading ? Math.atan2(ctx.heading.z, ctx.heading.x) : 0;
      let rel = Math.atan2(p.z - f.z, p.x - f.x) - ref;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const steps = Math.round(rel / STEP);
      const ang = ref + steps * STEP;
      const len = Math.max(1, Math.round(dist));
      const q = { x: f.x + Math.cos(ang) * len, z: f.z + Math.sin(ang) * len };
      const deg = Math.abs(steps) * 15;
      if (inMap(q)) return { ...q, label: ctx.heading ? (deg ? `${deg}° turn` : 'Straight on') : `${deg % 180 === 0 ? 0 : deg > 90 ? 180 - deg : deg}°`, guides: [] };
    }
  }
  return { x: p.x, z: p.z, label: null, guides: [] };
}

function inMap(p: Pt): boolean {
  return p.x > 0.3 && p.z > 0.3 && p.x < GRID - 0.3 && p.z < GRID - 0.3;
}

function guide(line: Line, to: Pt): Guide {
  return { ax: line.ox, az: line.oz, bx: to.x, bz: to.z };
}

/** An existing node, or a point on an existing road, near `p`. Bridges and tunnels join only at their ends. */
function joinAt(net: Network, p: Pt, ctx: SnapCtx): Snapped | null {
  let node = null, nd = JOIN_NODE;
  for (const n of net.nodes.values()) {
    if (ctx.excludeNodes?.has(n.id) || !net.degree(n.id)) continue;
    const d = Math.hypot(n.x - p.x, n.z - p.z);
    if (d < nd) { nd = d; node = n; }
  }
  if (node) return { x: node.x, z: node.z, label: 'Join', guides: [], node: node.id };
  let hit: { seg: RSeg; x: number; z: number; dist: number } | null = null;
  for (const seg of net.segs.values()) {
    if (ctx.excludeSegs?.has(seg.id)) continue;
    if (p.x < seg.minX - JOIN_ROAD || p.x > seg.maxX + JOIN_ROAD || p.z < seg.minZ - JOIN_ROAD || p.z > seg.maxZ + JOIN_ROAD) continue;
    const r = Network.nearestOn(seg, p.x, p.z);
    if (r.dist >= JOIN_ROAD || (hit && r.dist >= hit.dist)) continue;
    if (seg.structure && r.s > 0.9 && seg.len - r.s > 0.9) continue;
    hit = { seg, x: r.x, z: r.z, dist: r.dist };
  }
  return hit ? { x: hit.x, z: hit.z, label: 'Connect', guides: [], seg: hit.seg.id } : null;
}

/** Guide lines out of every road end near the pointer, plus parallels through the start point. */
function guideLines(net: Network, p: Pt, ctx: SnapCtx): Line[] {
  const out: Line[] = [];
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const n of net.nodes.values()) {
    if (ctx.excludeNodes?.has(n.id)) continue;
    if (Math.abs(n.x - p.x) > GUIDE_REACH || Math.abs(n.z - p.z) > GUIDE_REACH) continue;
    for (const seg of net.segsAt(n.id)) {
      if (ctx.excludeSegs?.has(seg.id) || seg.len < 0.5) continue;
      const atA = seg.a === n.id;
      Network.poseAt(seg, atA ? 0 : seg.len, pose);
      // Out of the node, away from the road: the way the road would carry straight on.
      const dx = atA ? -pose.tx : pose.tx, dz = atA ? -pose.tz : pose.tz;
      if (net.degree(n.id) === 1) out.push({ ox: n.x, oz: n.z, dx, dz, ray: true, label: 'Straight' });
      out.push({ ox: n.x, oz: n.z, dx: -dz, dz: dx, ray: false, label: 'Perpendicular' });
    }
  }
  if (ctx.from) {
    // Parallel to, or square to, the road nearest the pointer, run through the start point.
    let near: RSeg | null = null, nd = GUIDE_REACH;
    for (const seg of net.segs.values()) {
      if (ctx.excludeSegs?.has(seg.id)) continue;
      const d = Network.nearestOn(seg, p.x, p.z).dist;
      if (d < nd) { nd = d; near = seg; }
    }
    if (near) {
      const r = Network.nearestOn(near, p.x, p.z);
      Network.poseAt(near, r.s, pose);
      const f = ctx.from;
      if (Network.nearestOn(near, f.x, f.z).dist > 0.3) {
        out.push({ ox: f.x, oz: f.z, dx: pose.tx, dz: pose.tz, ray: false, label: 'Parallel' });
        out.push({ ox: f.x, oz: f.z, dx: -pose.tz, dz: pose.tx, ray: false, label: 'Perpendicular' });
      }
    }
  }
  return out;
}

function crossing(a: Line, b: Line): Pt | null {
  const den = a.dx * b.dz - a.dz * b.dx;
  if (Math.abs(den) < 0.2) return null; // nearly parallel lines cross somewhere useless
  const ox = b.ox - a.ox, oz = b.oz - a.oz;
  const t = (ox * b.dz - oz * b.dx) / den;
  const u = (ox * a.dz - oz * a.dx) / den;
  if ((a.ray && t < 0.5) || (b.ray && u < 0.5)) return null;
  return { x: a.ox + a.dx * t, z: a.oz + a.dz * t };
}
