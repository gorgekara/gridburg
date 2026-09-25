import { GRID } from '../constants';

export const KIND_ROAD = 0;
export const KIND_AVENUE = 1;
export const KIND_LANE = 2;
export const KIND_HIGHWAY = 3;
/** One carriageway of a motorway: three lanes, one way, drawn separately for each direction as in Cities: Skylines 2. */
export const KIND_MOTORWAY = 4;
/** A single-lane, one-way slip road on and off the highways. */
export const KIND_RAMP = 5;
/** A smaller one-way highway: two lanes one way. */
export const KIND_HIGHWAY2 = 6;
/** A one-way highway carriageway of either size. */
export const isCarriageway = (kind: number): boolean => kind === KIND_MOTORWAY || kind === KIND_HIGHWAY2;
/** Kinds that are always one way, in the direction they were drawn. */
export const isOneWayKind = (kind: number): boolean => kind === KIND_MOTORWAY || kind === KIND_RAMP || kind === KIND_HIGHWAY2;
/** Expressway-class roads: fast, no frontage, no pedestrians, no parking, no crossings. */
export const isMotorway = (kind: number): boolean => kind === KIND_HIGHWAY || kind === KIND_MOTORWAY || kind === KIND_RAMP || kind === KIND_HIGHWAY2;
/**
 * Four kinds of road, in the order the upgrade tool walks them. A lane is a single shared track, a
 * street carries two lanes, an avenue four and an expressway six; each sits inside its corridor with
 * a verge either side rather than paving it kerb to kerb. An expressway carries traffic fast but has
 * no frontage: nothing can be zoned or built off it, so cities need ordinary streets behind it.
 */
export const HALF_WIDTH = [0.36, 0.86, 0.24, 1.32, 0.72, 0.3, 0.52];
export const SPEED = [3, 4.5, 2.4, 6.8, 6.8, 4.6, 6.2]; // units per second
export const ROAD_LABEL = ['Street', 'Avenue', 'Lane', 'Expressway', 'One-way highway', 'Highway ramp', 'Two-lane highway'];
/** Whether buildings may use this kind of road as their access. */
export const ROAD_FRONTAGE = [true, true, true, false, false, false, false];
/** Upgrade order: lane, street, avenue, expressway, and back to a lane. */
export const UPGRADE_ORDER = [KIND_LANE, KIND_ROAD, KIND_AVENUE, KIND_HIGHWAY];
/**
 * How wide a roundabout has to be for each kind of road: the circle needs room for the arms to meet it
 * at a sane angle, and a wider carriageway needs a wider circle before its lanes stop fighting.
 */
export const ROUNDABOUT_RADIUS = [1.9, 2.6, 1.5, 4.0, 2.6, 1.9, 2.6];
/** The widest carriageway a roundabout circulates on: an expressway arm still meets an avenue-sized ring. */
export const RING_KIND_LIMIT = 1; // KIND_AVENUE
/**
 * The roundabouts a player can pick: sized to the widest road that meets them, or a single-lane
 * circle, a two-lane one, or a grand two-lane circle for the busiest crossings. `kind` is the ring's
 * carriageway (null follows the roads); `radius` null takes the carriageway's own size.
 */
export const RING_SIZES = [
  { id: 'auto', label: 'Match the roads', hint: 'The ring takes after the widest road that meets it', kind: null, radius: null, cost: 1 },
  { id: 'single', label: 'Single lane', hint: 'A small circle with one lane round it, for streets and lanes', kind: KIND_ROAD, radius: 1.9, cost: 1 },
  { id: 'double', label: 'Two lanes', hint: 'An avenue-sized circle with two lanes round it', kind: KIND_AVENUE, radius: 2.6, cost: 1.5 },
  { id: 'grand', label: 'Grand', hint: 'A wide two-lane circle that takes many arms and a lot of traffic', kind: KIND_AVENUE, radius: 4, cost: 2.4 },
] as const;
export type RingSize = typeof RING_SIZES[number]['id'];
// A ramp widens into a one-way highway and back; the rest walk the ordinary order.
export const nextRoadKind = (kind: number): number => kind === KIND_RAMP ? KIND_HIGHWAY2 : kind === KIND_HIGHWAY2 ? KIND_MOTORWAY : kind === KIND_MOTORWAY ? KIND_RAMP : UPGRADE_ORDER[(UPGRADE_ORDER.indexOf(kind) + 1) % UPGRADE_ORDER.length];
export const LIGHT_CYCLE = 18;

export interface RNode {
  id: number;
  x: number;
  z: number;
  light: boolean;
  ring: boolean; // part of a roundabout
  fixed: boolean; // cannot be bulldozed
  entry: boolean; // the highway connection at the map edge
  stop: boolean; // an all-way stop: every approach halts before entering
}

export interface RSeg {
  structure: 0 | 1 | 2;
  id: number;
  a: number;
  b: number;
  cx: number; // quadratic Bezier control point
  cz: number;
  kind: number;
  oneway: boolean; // traffic flows a -> b only
  fixed: boolean;
  calm: boolean; // traffic calming: slower, but collisions are rarer
  bike?: boolean; // curbside bicycle tracks within the asphalt; absent in older cities
  // derived
  n: number; // number of polyline pieces
  pts: Float32Array; // (n+1) x,z pairs, uniform in t
  cum: Float32Array; // cumulative arc length per sample
  len: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
}

export interface PlainNet {
  nextId: number;
  nodes: number[][]; // id, x, z, flags
  segs: number[][]; // id, a, b, cx, cz, flags
}

export interface Pose { x: number; z: number; tx: number; tz: number }
export interface Curve { ax: number; az: number; cx: number; cz: number; bx: number; bz: number }
export interface Sampled { n: number; pts: Float32Array; cum: Float32Array; len: number; minX: number; maxX: number; minZ: number; maxZ: number }
export interface Hit { seg: RSeg; t: number; s: number; x: number; z: number; dist: number }

export function sampleCurve(c: Curve): Sampled {
  const approx = Math.hypot(c.cx - c.ax, c.cz - c.az) + Math.hypot(c.bx - c.cx, c.bz - c.cz);
  const n = Math.max(2, Math.min(80, Math.ceil(approx / 0.3)));
  const pts = new Float32Array((n + 1) * 2);
  const cum = new Float32Array(n + 1);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * c.ax + 2 * u * t * c.cx + t * t * c.bx;
    const z = u * u * c.az + 2 * u * t * c.cz + t * t * c.bz;
    pts[i * 2] = x;
    pts[i * 2 + 1] = z;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { n, pts, cum, len: cum[n], minX, maxX, minZ, maxZ };
}

/** Split a quadratic at t. Returns [left, right]. */
export function splitCurve(c: Curve, t: number): [Curve, Curve] {
  const a1x = c.ax + (c.cx - c.ax) * t;
  const a1z = c.az + (c.cz - c.az) * t;
  const c1x = c.cx + (c.bx - c.cx) * t;
  const c1z = c.cz + (c.bz - c.cz) * t;
  const mx = a1x + (c1x - a1x) * t;
  const mz = a1z + (c1z - a1z) * t;
  return [
    { ax: c.ax, az: c.az, cx: a1x, cz: a1z, bx: mx, bz: mz },
    { ax: mx, az: mz, cx: c1x, cz: c1z, bx: c.bx, bz: c.bz },
  ];
}

/**
 * Turn a polyline of guide points into smooth quadratic pieces.
 * Two points give a straight piece; more give the classic midpoint-smoothed chain.
 */
export function buildPieces(p: { x: number; z: number }[]): Curve[] {
  const n = p.length - 1;
  if (n < 1) return [];
  if (n === 1) {
    return [{ ax: p[0].x, az: p[0].z, cx: (p[0].x + p[1].x) / 2, cz: (p[0].z + p[1].z) / 2, bx: p[1].x, bz: p[1].z }];
  }
  const out: Curve[] = [];
  let sx = p[0].x;
  let sz = p[0].z;
  for (let i = 1; i < n; i++) {
    const last = i === n - 1;
    const ex = last ? p[n].x : (p[i].x + p[i + 1].x) / 2;
    const ez = last ? p[n].z : (p[i].z + p[i + 1].z) / 2;
    out.push({ ax: sx, az: sz, cx: p[i].x, cz: p[i].z, bx: ex, bz: ez });
    sx = ex;
    sz = ez;
  }
  return out;
}

/** A control point in the frame of its chord, so it can follow when either end moves. */
function chordRel(a: { x: number; z: number }, b: { x: number; z: number }, cx: number, cz: number): { u: number; v: number } {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return { u: 0.5, v: 0 };
  return { u: ((cx - a.x) * dx + (cz - a.z) * dz) / l2, v: ((cx - a.x) * -dz + (cz - a.z) * dx) / l2 };
}

function chordAbs(a: { x: number; z: number }, b: { x: number; z: number }, r: { u: number; v: number }): { x: number; z: number } {
  const dx = b.x - a.x, dz = b.z - a.z;
  return { x: a.x + dx * r.u - dz * r.v, z: a.z + dz * r.u + dx * r.v };
}

function segSegIntersect(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): [number, number] | null {
  const rx = bx - ax, rz = bz - az;
  const sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((cx - ax) * sz - (cz - az) * sx) / den;
  const v = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return [u, v];
}

export class Network {
  nodes = new Map<number, RNode>();
  segs = new Map<number, RSeg>();
  adj = new Map<number, number[]>();
  nextId = 1;
  version = 0;

  // ---- basic construction ------------------------------------------------------------
  addNode(x: number, z: number): RNode {
    const n: RNode = { id: this.nextId++, x, z, light: false, ring: false, fixed: false, entry: false, stop: false };
    this.nodes.set(n.id, n);
    this.adj.set(n.id, []);
    return n;
  }

  resample(s: RSeg): void {
    const a = this.nodes.get(s.a)!;
    const b = this.nodes.get(s.b)!;
    const sm = sampleCurve({ ax: a.x, az: a.z, cx: s.cx, cz: s.cz, bx: b.x, bz: b.z });
    Object.assign(s, sm);
  }

  addSeg(a: number, b: number, cx: number, cz: number, kind: number, oneway = false, fixed = false, minLen = 0.4, structure: 0 | 1 | 2 = 0): RSeg | null {
    if (a === b || !this.nodes.has(a) || !this.nodes.has(b)) return null;
    for (const id of this.adj.get(a)!) {
      const o = this.segs.get(id)!;
      if ((o.a === b || o.b === b) && Math.hypot(o.cx - cx, o.cz - cz) < 0.6) return null;
    }
    const s = {
      id: this.nextId++, a, b, cx, cz, kind, oneway, fixed, structure, calm: false, bike: false,
      n: 0, pts: new Float32Array(0), cum: new Float32Array(0), len: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0,
    } as RSeg;
    this.resample(s);
    if (s.len < minLen) return null;
    this.segs.set(s.id, s);
    this.adj.get(a)!.push(s.id);
    this.adj.get(b)!.push(s.id);
    this.version++;
    return s;
  }

  removeSeg(id: number): void {
    const s = this.segs.get(id);
    if (!s) return;
    this.segs.delete(id);
    for (const nid of [s.a, s.b]) {
      const list = this.adj.get(nid);
      if (!list) continue;
      const k = list.indexOf(id);
      if (k >= 0) list.splice(k, 1);
      const node = this.nodes.get(nid)!;
      if (list.length === 0 && !node.fixed && !node.entry) {
        this.nodes.delete(nid);
        this.adj.delete(nid);
      } else if (list.length < 3) {
        node.light = false;
        node.stop = false;
      }
    }
    this.version++;
  }

  segsAt(nodeId: number): RSeg[] {
    return (this.adj.get(nodeId) ?? []).map((id) => this.segs.get(id)!);
  }

  degree(nodeId: number): number {
    return this.adj.get(nodeId)?.length ?? 0;
  }

  // ---- geometry queries ----------------------------------------------------------------
  /** Position and unit tangent (direction a->b) at arc length s. */
  static poseAt(seg: RSeg, s: number, out: Pose): Pose {
    const { cum, pts, n } = seg;
    const d = s <= 0 ? 0 : s >= seg.len ? seg.len : s;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid; else hi = mid;
    }
    const span = cum[lo + 1] - cum[lo] || 1;
    const u = (d - cum[lo]) / span;
    const x0 = pts[lo * 2], z0 = pts[lo * 2 + 1];
    const x1 = pts[lo * 2 + 2], z1 = pts[lo * 2 + 3];
    out.x = x0 + (x1 - x0) * u;
    out.z = z0 + (z1 - z0) * u;
    // Blend piece directions for a smooth heading.
    let tx = x1 - x0, tz = z1 - z0;
    if (u > 0.5 && lo + 2 <= n) {
      const w = u - 0.5;
      tx = tx * (1 - w) + (pts[lo * 2 + 4] - x1) * w;
      tz = tz * (1 - w) + (pts[lo * 2 + 5] - z1) * w;
    } else if (u <= 0.5 && lo > 0) {
      const w = 0.5 - u;
      tx = tx * (1 - w) + (x0 - pts[lo * 2 - 2]) * w;
      tz = tz * (1 - w) + (z0 - pts[lo * 2 - 1]) * w;
    }
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    return out;
  }

  static nearestOn(seg: RSeg, x: number, z: number): { t: number; s: number; x: number; z: number; dist: number } {
    let best = Infinity, bt = 0, bs = 0, bx = 0, bz = 0;
    const { pts, cum, n } = seg;
    for (let i = 0; i < n; i++) {
      const x0 = pts[i * 2], z0 = pts[i * 2 + 1];
      const dx = pts[i * 2 + 2] - x0, dz = pts[i * 2 + 3] - z0;
      const l2 = dx * dx + dz * dz || 1;
      let u = ((x - x0) * dx + (z - z0) * dz) / l2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const px = x0 + dx * u, pz = z0 + dz * u;
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < best) { best = d; bt = (i + u) / n; bs = cum[i] + (cum[i + 1] - cum[i]) * u; bx = px; bz = pz; }
    }
    return { t: bt, s: bs, x: bx, z: bz, dist: Math.sqrt(best) };
  }

  nearestNode(x: number, z: number, maxDist: number): RNode | null {
    let best: RNode | null = null;
    let bd = maxDist;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /**
   * Whether (x, z) lies on the paved surface (plus a kerb margin) of any road other than `except`.
   * Tunnel interiors do not count: the ground above them is open. Used to keep lamps, signs and
   * everything else on the verge off the carriageway.
   */
  onRoad(x: number, z: number, except = -1, margin = 0.1): boolean {
    for (const o of this.segs.values()) {
      if (o.id === except || o.structure === 2) continue;
      const reach = HALF_WIDTH[o.kind] + margin;
      if (x < o.minX - reach || x > o.maxX + reach || z < o.minZ - reach || z > o.maxZ + reach) continue;
      if (Network.nearestOn(o, x, z).dist < reach) return true;
    }
    return false;
  }

  /**
   * A spot on the verge beside `seg`, `offset` out from its centre line on the right of travel
   * towards `node` (or the left with a negative offset), at least `minAlong` back from the node and
   * further if that would stand on a crossing road. Null when the arm is too short.
   */
  vergeSpot(seg: RSeg, node: number, offset: number, minAlong: number): Pose | null {
    const atA = seg.a === node;
    const pose: Pose = { x: 0, z: 0, tx: 0, tz: 0 };
    for (let d = minAlong; d < seg.len - 0.3; d += 0.25) {
      Network.poseAt(seg, atA ? d : seg.len - d, pose);
      // Direction of travel towards the node.
      const tx = atA ? -pose.tx : pose.tx, tz = atA ? -pose.tz : pose.tz;
      const x = pose.x - tz * offset, z = pose.z + tx * offset;
      if (!this.onRoad(x, z, seg.id)) return { x, z, tx, tz };
    }
    return null;
  }

  nearestSeg(x: number, z: number, maxDist: number): Hit | null {
    let best: Hit | null = null;
    for (const seg of this.segs.values()) {
      if (x < seg.minX - maxDist || x > seg.maxX + maxDist || z < seg.minZ - maxDist || z > seg.maxZ + maxDist) continue;
      const r = Network.nearestOn(seg, x, z);
      if (r.dist < maxDist && (!best || r.dist < best.dist)) best = { seg, ...r };
    }
    return best;
  }

  // ---- editing -------------------------------------------------------------------------
  /** Split a segment at parameter t. Returns the new node and the two child segments. */
  splitSeg(segId: number, t: number): { node: RNode; left: RSeg | null; right: RSeg | null } {
    const s = this.segs.get(segId)!;
    if (s.structure) throw new Error('Bridges and tunnels connect only at their ends');
    const a = this.nodes.get(s.a)!;
    const b = this.nodes.get(s.b)!;
    const [l, r] = splitCurve({ ax: a.x, az: a.z, cx: s.cx, cz: s.cz, bx: b.x, bz: b.z }, t);
    const node = this.addNode(l.bx, l.bz);
    node.ring = false;
    this.removeSegKeepNodes(segId);
    const left = this.addSeg(s.a, node.id, l.cx, l.cz, s.kind, s.oneway, s.fixed, 0.05);
    const right = this.addSeg(node.id, s.b, r.cx, r.cz, s.kind, s.oneway, s.fixed, 0.05);
    for (const child of [left, right]) if (child) { child.bike = !!s.bike; child.calm = s.calm; }
    return { node, left, right };
  }

  private removeSegKeepNodes(id: number): void {
    const s = this.segs.get(id);
    if (!s) return;
    this.segs.delete(id);
    for (const nid of [s.a, s.b]) {
      const list = this.adj.get(nid)!;
      const k = list.indexOf(id);
      if (k >= 0) list.splice(k, 1);
    }
    this.version++;
  }

  /** Split at t, unless that lands within `snap` of an end, in which case reuse the end node. */
  splitOrSnap(segId: number, t: number, snap = 0.7): number {
    const s = this.segs.get(segId)!;
    const d = t * s.len; // t is uniform, close enough to arc length for a snap test
    if (d < snap) return s.a;
    if (s.len - d < snap) return s.b;
    return this.splitSeg(segId, t).node.id;
  }

  /** Find or create the node a stroke endpoint should attach to. */
  resolveEndpoint(x: number, z: number): number {
    const n = this.nearestNode(x, z, 0.9);
    if (n) return n.id;
    const hit = this.nearestSeg(x, z, 0.8);
    if (hit && !hit.seg.structure) return this.splitOrSnap(hit.seg.id, hit.t);
    return this.addNode(x, z).id;
  }

  /** Earliest crossing of a sampled curve with any existing segment, ignoring touches near its ends. */
  private firstCrossing(c: Curve, sm: Sampled, ends?: [number, number]): { t: number; segId: number; tSeg: number } | null {
    let best: { t: number; segId: number; tSeg: number } | null = null;
    for (const seg of this.segs.values()) {
      if (seg.structure) continue;
      // A road already joining the same two nodes lies along this one; it is not a crossing.
      if (ends && ((seg.a === ends[0] && seg.b === ends[1]) || (seg.a === ends[1] && seg.b === ends[0]))) continue;
      if (sm.maxX < seg.minX || sm.minX > seg.maxX || sm.maxZ < seg.minZ || sm.minZ > seg.maxZ) continue;
      for (let i = 0; i < sm.n; i++) {
        const ax = sm.pts[i * 2], az = sm.pts[i * 2 + 1], bx = sm.pts[i * 2 + 2], bz = sm.pts[i * 2 + 3];
        for (let j = 0; j < seg.n; j++) {
          const r = segSegIntersect(ax, az, bx, bz, seg.pts[j * 2], seg.pts[j * 2 + 1], seg.pts[j * 2 + 2], seg.pts[j * 2 + 3]);
          if (!r) continue;
          const t = (i + r[0]) / sm.n;
          const px = ax + (bx - ax) * r[0];
          const pz = az + (bz - az) * r[0];
          if (Math.hypot(px - c.ax, pz - c.az) < 0.7 || Math.hypot(px - c.bx, pz - c.bz) < 0.7) continue;
          if (!best || t < best.t) best = { t, segId: seg.id, tSeg: (j + r[1]) / seg.n };
        }
      }
    }
    return best;
  }

  /**
   * Insert a road along guide points. Endpoints snap to existing nodes and segments,
   * and every crossing with an existing road becomes a junction. Returns new segment ids.
   */
  insertPath(points: { x: number; z: number }[], kind: number, oneway = false, structure: 0 | 1 | 2 = 0, clampToMap = true): number[] {
    const added: number[] = [];
    if (points.length < 2) return added;
    // A player's road stays on the map; the map's own motorway and interchange run outside it.
    const pts = points.map((p) => clampToMap ? { x: Math.max(0.3, Math.min(GRID - 0.3, p.x)), z: Math.max(0.3, Math.min(GRID - 0.3, p.z)) } : { x: p.x, z: p.z });
    const startId = this.resolveEndpoint(pts[0].x, pts[0].z);
    const endId = this.resolveEndpoint(pts[pts.length - 1].x, pts[pts.length - 1].z);
    const sn = this.nodes.get(startId)!;
    const en = this.nodes.get(endId)!;
    pts[0] = { x: sn.x, z: sn.z };
    pts[pts.length - 1] = { x: en.x, z: en.z };
    const pieces = buildPieces(pts);

    let fromId = startId;
    for (let k = 0; k < pieces.length; k++) {
      const c = pieces[k];
      const lastPiece = k === pieces.length - 1;
      const toId = lastPiece ? endId : this.resolveEndpoint(c.bx, c.bz);
      added.push(...this.layCurve(fromId, toId, c, kind, oneway, structure));
      fromId = toId;
    }
    return added;
  }

  /**
   * Lay one curve between two existing nodes, turning every crossing with a surface road into a
   * junction on the way. The curve's ends are pinned to the nodes. Returns the new segment ids.
   */
  layCurve(fromId: number, toId: number, curve: Curve, kind: number, oneway = false, structure: 0 | 1 | 2 = 0): number[] {
    const added: number[] = [];
    const fn = this.nodes.get(fromId)!, tn = this.nodes.get(toId)!;
    let c: Curve = { ...curve, ax: fn.x, az: fn.z, bx: tn.x, bz: tn.z };
    for (let guard = 0; guard < 40; guard++) {
      const sm = sampleCurve(c);
      const hit = structure ? null : this.firstCrossing(c, sm, [fromId, toId]);
      if (!hit || !this.segs.has(hit.segId)) {
        const s = this.addSeg(fromId, toId, c.cx, c.cz, kind, oneway, false, 0.4, structure);
        if (s) added.push(s.id);
        break;
      }
      const xId = this.splitOrSnap(hit.segId, hit.tSeg, 0.6);
      const [left, right] = splitCurve(c, hit.t);
      if (xId !== fromId) {
        const s = this.addSeg(fromId, xId, left.cx, left.cz, kind, oneway);
        if (s) added.push(s.id);
      }
      const xn = this.nodes.get(xId)!;
      c = { ...right, ax: xn.x, az: xn.z };
      fromId = xId;
      if (xId === toId) break;
    }
    return added;
  }

  // ---- direct editing: drag, bend, cut, re-kind ------------------------------------------------
  /** Whether the player may reshape this road: not the map's own motorway, and not a roundabout's ring. */
  editable(seg: RSeg): boolean {
    return !seg.fixed && !(this.nodes.get(seg.a)?.ring && this.nodes.get(seg.b)?.ring);
  }

  /** Curve parameter at arc length `s` along a segment (its samples are uniform in t). */
  static tAt(seg: RSeg, s: number): number {
    const { cum, n } = seg;
    if (s <= 0) return 0;
    if (s >= seg.len) return 1;
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    return (lo + (s - cum[lo]) / (cum[lo + 1] - cum[lo] || 1)) / n;
  }

  /**
   * Drag a node somewhere else. Every road on it follows, keeping its bend in proportion; dropped on
   * another node the two merge, and wherever the moved roads now cross others a junction forms.
   * Returns the ids of the re-laid segments, or null when the node cannot be moved.
   */
  moveNode(id: number, x: number, z: number): number[] | null {
    const node = this.nodes.get(id);
    if (!node || node.fixed || node.entry || node.ring) return null;
    const segs = this.segsAt(id);
    if (segs.some((s) => !this.editable(s))) return null;
    x = Math.max(0.3, Math.min(GRID - 0.3, x));
    z = Math.max(0.3, Math.min(GRID - 0.3, z));
    const plans = segs.map((s) => ({ s, rel: chordRel(this.nodes.get(s.a)!, this.nodes.get(s.b)!, s.cx, s.cz) }));
    let target: RNode | null = null, td = 0.9;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (n.id !== id && d < td) { td = d; target = n; }
    }
    // Dropped on the middle of another road, the node joins it there, as a drawn road would.
    if (!target) {
      const own = new Set(segs.map((s) => s.id));
      let hit: Hit | null = null;
      for (const seg of this.segs.values()) {
        if (own.has(seg.id) || seg.structure) continue;
        const r = Network.nearestOn(seg, x, z);
        if (r.dist < 0.8 && (!hit || r.dist < hit.dist)) hit = { seg, ...r };
      }
      if (hit) target = this.nodes.get(this.splitOrSnap(hit.seg.id, hit.t))!;
      if (target?.id === id) target = null;
    }
    const endId = target ? target.id : id;
    if (!target) { node.x = x; node.z = z; }
    for (const { s } of plans) this.removeSegKeepNodes(s.id);
    const added: number[] = [];
    const touched = new Set<number>([id, endId]);
    for (const { s, rel } of plans) {
      const a = s.a === id ? endId : s.a, b = s.b === id ? endId : s.b;
      touched.add(a); touched.add(b);
      if (a === b) continue;
      const an = this.nodes.get(a)!, bn = this.nodes.get(b)!;
      const c = chordAbs(an, bn, rel);
      // Merged onto a road that already runs the same way between the same nodes: the two become one.
      if (this.segsAt(a).some((o) => (o.a === b || o.b === b) && Math.hypot(o.cx - c.x, o.cz - c.z) < 0.6)) continue;
      const ids = s.structure
        ? [this.addSeg(a, b, c.x, c.z, s.kind, s.oneway, false, 0.4, s.structure)?.id].filter((v): v is number => v !== undefined)
        : this.layCurve(a, b, { ax: an.x, az: an.z, cx: c.x, cz: c.z, bx: bn.x, bz: bn.z }, s.kind, s.oneway);
      for (const sid of ids) this.carryOver(s, sid);
      added.push(...ids);
    }
    this.prune(touched);
    this.version++;
    return added;
  }

  /** Reshape a road by moving its bend. New crossings become junctions. */
  bendSeg(id: number, cx: number, cz: number): number[] | null {
    const s = this.segs.get(id);
    if (!s || !this.editable(s)) return null;
    if (s.structure) {
      s.cx = cx; s.cz = cz;
      this.resample(s);
      this.version++;
      return [id];
    }
    const a = this.nodes.get(s.a)!, b = this.nodes.get(s.b)!;
    this.removeSegKeepNodes(id);
    const ids = this.layCurve(s.a, s.b, { ax: a.x, az: a.z, cx, cz, bx: b.x, bz: b.z }, s.kind, s.oneway);
    if (!ids.length) {
      // Nothing could be laid (it doubled back onto another road): put the old one back.
      this.segs.set(id, s);
      this.adj.get(s.a)!.push(id);
      this.adj.get(s.b)!.push(id);
      this.resample(s);
      return null;
    }
    for (const sid of ids) this.carryOver(s, sid);
    this.version++;
    return ids;
  }

  /**
   * Remove the stretch of a road between arc lengths s0 and s1, leaving dead ends. A cut within a cell
   * of an end takes the end with it. Bridges and tunnels only come out whole.
   */
  cutRange(id: number, s0: number, s1: number): boolean {
    const s = this.segs.get(id);
    if (!s || !this.editable(s)) return false;
    const r = this.range(s, s0, s1);
    if (!r) return false;
    if (r.whole) { this.removeSeg(id); return true; }
    if (s.structure) return false;
    this.removeSeg(this.isolate(id, r.s0, r.s1));
    return true;
  }

  /**
   * Change the kind of a stretch of road, splitting it out of the segment. Spans change whole; the
   * one-way highway kinds only go on whole roads. Returns the changed segment ids.
   */
  setKindRange(id: number, s0: number, s1: number, kind: number): number[] | null {
    const s = this.segs.get(id);
    if (!s || !this.editable(s)) return null;
    const r = this.range(s, s0, s1);
    if (!r) return null;
    let target = id;
    if (!r.whole && !s.structure) {
      if (isOneWayKind(kind)) return null;
      target = this.isolate(id, r.s0, r.s1);
    }
    const seg = this.segs.get(target)!;
    seg.kind = kind;
    if (!canAddBikeLane(seg, this)) seg.bike = false;
    this.version++;
    return [target];
  }

  /** Tidy a requested stretch: ordered, clamped, and swallowing ends closer than a cell, so no stub is left. */
  private range(s: RSeg, s0: number, s1: number): { s0: number; s1: number; whole: boolean } | null {
    if (s0 > s1) [s0, s1] = [s1, s0];
    s0 = s0 < 1 ? 0 : s0;
    s1 = s.len - s1 < 1 ? s.len : s1;
    if (s1 - s0 < 0.3) return null;
    return { s0, s1, whole: s0 === 0 && s1 === s.len };
  }

  /** Split a segment at two arc lengths and return the id of the piece between them. */
  private isolate(id: number, s0: number, s1: number): number {
    let mid = id;
    const s = this.segs.get(id)!;
    if (s1 < s.len) mid = this.splitSeg(id, Network.tAt(s, s1)).left!.id;
    if (s0 > 0) {
      const left = this.segs.get(mid)!;
      mid = this.splitSeg(mid, Network.tAt(left, s0)).right!.id;
    }
    return mid;
  }

  private carryOver(from: RSeg, id: number): void {
    const s = this.segs.get(id);
    if (!s) return;
    s.calm = from.calm;
    s.bike = !!from.bike && canAddBikeLane(s, this);
  }

  /** Drop nodes an edit left with nothing attached, and signals on what is no longer a junction. */
  private prune(ids: Set<number>): void {
    for (const nid of ids) {
      const n = this.nodes.get(nid);
      if (!n) continue;
      const deg = this.degree(nid);
      if (deg === 0 && !n.fixed && !n.entry) { this.nodes.delete(nid); this.adj.delete(nid); }
      else if (deg < 3) { n.light = false; n.stop = false; }
    }
  }

  /** Remove every non-fixed segment that passes through the rectangle. Returns how many went. */
  removeInRect(x0: number, z0: number, x1: number, z1: number): number {
    const doomed: number[] = [];
    for (const s of this.segs.values()) {
      if (s.fixed || s.maxX < x0 || s.minX > x1 || s.maxZ < z0 || s.minZ > z1) continue;
      for (let i = 0; i <= s.n; i++) {
        const x = s.pts[i * 2], z = s.pts[i * 2 + 1];
        if (x >= x0 && x <= x1 && z >= z0 && z <= z1) { doomed.push(s.id); break; }
      }
    }
    for (const id of doomed) this.removeSeg(id);
    return doomed.length;
  }

  /** Reverse a segment's direction (used when flipping a one-way). */
  reverseSeg(id: number): void {
    const s = this.segs.get(id);
    if (!s) return;
    const t = s.a;
    s.a = s.b;
    s.b = t;
    this.resample(s);
    this.version++;
  }

  /**
   * Replace whatever is inside a circle with a one-way roundabout and hook crossing roads onto it.
   * Traffic circulates with the island on the driver's left.
   */
  addRoundabout(cx: number, cz: number, radius: number, kind: number): boolean {
    // The ring has to be wide enough for its own lanes, or traffic locks on the circle.
    const r = Math.max(radius, HALF_WIDTH[kind] * 2 + 0.6);
    if (cx < r + 1 || cz < r + 1 || cx > GRID - r - 1 || cz > GRID - r - 1) return false;
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - cx, n.z - cz);
      if ((n.fixed || n.entry) && d < r + 0.8) return false;
      if (n.ring && d < 2 * r + 1.5) return false;
    }
    for (const s of this.segs.values()) {
      if (!s.fixed && !s.structure) continue;
      if (Network.nearestOn(s, cx, cz).dist < r + 0.8) return false;
    }

    // 1. Split every segment where it crosses the circle.
    const work = [...this.segs.keys()];
    while (work.length) {
      const id = work.pop()!;
      const s = this.segs.get(id);
      if (!s) continue;
      if (s.maxX < cx - r || s.minX > cx + r || s.maxZ < cz - r || s.minZ > cz + r) continue;
      for (let i = 0; i < s.n; i++) {
        const d0 = Math.hypot(s.pts[i * 2] - cx, s.pts[i * 2 + 1] - cz) - r;
        const d1 = Math.hypot(s.pts[i * 2 + 2] - cx, s.pts[i * 2 + 3] - cz) - r;
        if (d0 * d1 >= 0) continue;
        const u = d0 / (d0 - d1);
        const sAt = s.cum[i] + (s.cum[i + 1] - s.cum[i]) * u;
        if (sAt < 0.5 || s.len - sAt < 0.5) continue; // the end node will be pulled onto the ring instead
        const res = this.splitSeg(id, (i + u) / s.n);
        if (res.left) work.push(res.left.id);
        if (res.right) work.push(res.right.id);
        break;
      }
    }
    // 2. Drop what is left inside.
    for (const s of [...this.segs.values()]) {
      const mx = s.pts[(s.n >> 1) * 2], mz = s.pts[(s.n >> 1) * 2 + 1];
      if (Math.hypot(mx - cx, mz - cz) < r - 0.1) this.removeSeg(s.id);
    }
    // 3. Collect nodes on the circle, pull them exactly onto it.
    const ring: { id: number; ang: number }[] = [];
    for (const n of this.nodes.values()) {
      const d = Math.hypot(n.x - cx, n.z - cz);
      if (Math.abs(d - r) < 0.6 && this.degree(n.id) > 0) {
        const ang = Math.atan2(n.z - cz, n.x - cx);
        n.x = cx + Math.cos(ang) * r;
        n.z = cz + Math.sin(ang) * r;
        n.ring = true;
        n.light = false;
        for (const s of this.segsAt(n.id)) this.resample(s);
        ring.push({ id: n.id, ang });
      }
    }
    // 4. Fill gaps so no arc spans more than 60 degrees.
    ring.sort((p, q) => p.ang - q.ang);
    const all: { id: number; ang: number }[] = [...ring];
    const addFiller = (ang: number): void => {
      const n = this.addNode(cx + Math.cos(ang) * r, cz + Math.sin(ang) * r);
      n.ring = true;
      all.push({ id: n.id, ang });
    };
    if (ring.length === 0) {
      for (let k = 0; k < 6; k++) addFiller((k * Math.PI) / 3);
    } else {
      for (let i = 0; i < ring.length; i++) {
        const cur = ring[i];
        let gap = ring[(i + 1) % ring.length].ang - cur.ang;
        if (i === ring.length - 1) gap += Math.PI * 2;
        const parts = Math.ceil(gap / (Math.PI / 3));
        for (let k = 1; k < parts; k++) addFiller(cur.ang + (gap * k) / parts);
      }
    }
    all.sort((p, q) => p.ang - q.ang);
    // 5. One-way arcs in the direction of decreasing angle.
    for (let i = 0; i < all.length; i++) {
      const from = all[(i + 1) % all.length];
      const to = all[i];
      let delta = from.ang - to.ang;
      if (delta <= 0) delta += Math.PI * 2;
      const mid = to.ang + delta / 2;
      const k = r / Math.cos(delta / 2);
      this.addSeg(from.id, to.id, cx + Math.cos(mid) * k, cz + Math.sin(mid) * k, kind, true, false, 0.1);
    }
    this.version++;
    return true;
  }

  // ---- traffic lights ---------------------------------------------------------------
  /** Which of the two signal phases each incident segment belongs to, grouped by road axis. */
  lightGroups(nodeId: number): Map<number, number> {
    const out = new Map<number, number>();
    const node = this.nodes.get(nodeId)!;
    const segs = this.segsAt(nodeId).slice().sort((p, q) => p.id - q.id);
    const angles = segs.map((s) => {
      const atA = s.a === nodeId;
      const i = atA ? 1 : s.n - 1;
      return Math.atan2(s.pts[i * 2 + 1] - node.z, s.pts[i * 2] - node.x);
    });
    let zero = 0;
    segs.forEach((s, k) => {
      let d = Math.abs(angles[k] - angles[0]) % Math.PI;
      if (d > Math.PI / 2) d = Math.PI - d;
      const g = d < Math.PI / 4 ? 0 : 1;
      if (g === 0) zero++;
      out.set(s.id, g);
    });
    if (zero === segs.length) segs.forEach((s, k) => out.set(s.id, k % 2));
    return out;
  }

  // ---- (de)serialization --------------------------------------------------------------
  toPlain(): PlainNet {
    const nodes: number[][] = [];
    for (const n of this.nodes.values()) {
      nodes.push([n.id, n.x, n.z, (n.light ? 1 : 0) | (n.ring ? 2 : 0) | (n.fixed ? 4 : 0) | (n.entry ? 8 : 0) | (n.stop ? 16 : 0)]);
    }
    const segs: number[][] = [];
    for (const s of this.segs.values()) {
      // Kind keeps its original low bit, so a street or avenue reads the same in older saves;
      // the extra kinds set bit 5 as well. Bit 6 stores bike tracks in the existing byte;
      // old saves leave it clear, and structure bits 3–4 remain unchanged.
      segs.push([s.id, s.a, s.b, s.cx, s.cz, (s.kind & 1) | (s.oneway ? 2 : 0) | (s.fixed ? 4 : 0) | ((s.structure ?? 0) << 3) | ((s.kind & 2) << 4) | (s.bike && canAddBikeLane(s, this) ? 64 : 0) | (s.calm ? 128 : 0) | ((s.kind & 4) << 6)]);
    }
    return { nextId: this.nextId, nodes, segs };
  }

  static fromPlain(p: PlainNet): Network {
    const net = new Network();
    for (const [id, x, z, f] of p.nodes) {
      net.nodes.set(id, { id, x, z, light: !!(f & 1), ring: !!(f & 2), fixed: !!(f & 4), entry: !!(f & 8), stop: !!(f & 16) });
      net.adj.set(id, []);
    }
    for (const [id, a, b, cx, cz, f] of p.segs) {
      if (!net.nodes.has(a) || !net.nodes.has(b)) continue;
      const s = {
        id, a, b, cx, cz, structure: ((f >> 3) & 3) <= 2 ? (f >> 3) & 3 : 0, kind: (f & 1) | ((f >> 4) & 2) | ((f >> 6) & 4), oneway: !!(f & 2), fixed: !!(f & 4), calm: !!(f & 128), bike: !!(f & 64),
        n: 0, pts: new Float32Array(0), cum: new Float32Array(0), len: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0,
      } as RSeg;
      net.resample(s);
      net.segs.set(id, s);
      net.adj.get(a)!.push(id);
      net.adj.get(b)!.push(id);
    }
    for (const s of net.segs.values()) if (!canAddBikeLane(s, net)) s.bike = false;
    net.nextId = p.nextId;
    return net;
  }

  /** Centers and radii of all roundabouts, recovered from their arcs. */
  roundabouts(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const s of this.segs.values()) {
      if (!s.oneway) continue;
      const a = this.nodes.get(s.a)!;
      const b = this.nodes.get(s.b)!;
      if (!a.ring || !b.ring) continue;
      // The control point is where the end tangents meet, so the center lies beyond the chord midpoint.
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const h = Math.hypot(b.x - a.x, b.z - a.z) / 2;
      const d = Math.hypot(s.cx - mx, s.cz - mz);
      if (d < 1e-4) continue;
      const k = (h * h) / d;
      const ox = mx + ((mx - s.cx) / d) * k;
      const oz = mz + ((mz - s.cz) / d) * k;
      if (out.some((o) => Math.hypot(o.x - ox, o.z - oz) < 0.5)) continue;
      out.push({ x: ox, z: oz, r: Math.hypot(a.x - ox, a.z - oz) });
    }
    return out;
  }

  entryNode(): RNode | null {
    for (const n of this.nodes.values()) if (n.entry) return n;
    return null;
  }
}

export function signalPhase(simTime: number, nodeId: number, group: number): 'red' | 'amber' | 'green' {
  const t = ((simTime + nodeId * 3.7) % LIGHT_CYCLE + LIGHT_CYCLE) % LIGHT_CYCLE;
  if (group === 0) return t < 8 ? 'green' : t < 9 ? 'amber' : 'red';
  return t >= 9 && t < 17 ? 'green' : t >= 17 && t < 18 ? 'amber' : 'red';
}

/** Is the signal green for this phase group at this node and time? */
export function isGreen(simTime: number, nodeId: number, group: number): boolean {
  return signalPhase(simTime, nodeId, group) === 'green';
}

/** Total length of a guide path once smoothed, plus the part of it that is over water. */
export function measurePath(points: { x: number; z: number }[], water: Uint8Array): { len: number; wet: number } {
  let len = 0;
  let wet = 0;
  for (const c of buildPieces(points)) {
    const sm = sampleCurve(c);
    for (let i = 0; i < sm.n; i++) {
      const d = sm.cum[i + 1] - sm.cum[i];
      len += d;
      const x = Math.floor((sm.pts[i * 2] + sm.pts[i * 2 + 2]) / 2);
      const z = Math.floor((sm.pts[i * 2 + 1] + sm.pts[i * 2 + 3]) / 2);
      if (x >= 0 && z >= 0 && x < GRID && z < GRID && water[z * GRID + x]) wet += d;
    }
  }
  return { len, wet };
}

/** Tracks fit in the 0.42-unit reserved verge, beyond the carriageway and curb. */
export function canAddBikeLane(seg: RSeg, net: Network): boolean {
  return (seg.kind === KIND_ROAD || seg.kind === KIND_AVENUE) && !seg.structure && !seg.fixed
    && !net.nodes.get(seg.a)?.ring && !net.nodes.get(seg.b)?.ring;
}

/** Both sides are installed together, priced per unit of road length. */
export function bikeLaneCost(seg: RSeg): number { return Math.ceil(seg.len * 12); }
