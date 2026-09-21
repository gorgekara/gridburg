import { airportRunway } from '../airports';
import { T_TROLLEY } from '../constants';
import * as THREE from 'three';
import { GRID, T_BUS, T_STATION, T_SUBWAY, T_AIRPORT } from '../constants';
import { transitNetwork } from '../sim/transit';
import { railPath, railTrack, intercityTrack, PLATFORM_LENGTH } from '../roads/rail';
import type { TrackPoint } from '../roads/rail';
import type { Raster } from '../roads/raster';
import { Network, HALF_WIDTH } from '../roads/network';
import { Builder } from './buildingGeo';

// Palette (matches the concrete and service buildings).
const CONCRETE = 0xb9b4a8, PARAPET = 0xc9c4b8, PIER = 0xa9a498, BALLAST = 0x9a958c, SLEEPER = 0x6b5a48, RAIL = 0x8d969b;
const PLATFORM = 0xd3cec2, EDGE_LINE = 0xe3c04c, CANOPY = 0x6e9cb6, CANOPY_TRIM = 0x426c85, STEEL = 0x536470, GLAZING = 0x9cc3d6, BUFFER = 0xc44536;
const BODY = 0xe9ece8, WINDOW = 0x243847, STRIPE = 0x329cac, DOOR = 0xb4c2c6, UNDER = 0x3a4248, ROOF = 0xb5bdc0;

// Viaduct cross-section heights: the girder soffit clears buses and the portal crossbeam.
const DECK = 1.12, SOFFIT = 0.94, BALLAST_TOP = 1.16, SLEEPER_TOP = 1.185, RAIL_TOP = 1.21, PLATFORM_TOP = 1.22;
const PORTAL_SPACING = 3, PLATFORM_LEN = PLATFORM_LENGTH;
// Train: three cars on a 0.66 pitch, end cars carry a nose.
const CAR_LEN = 0.62, CAR_PITCH = 0.66, NOSE = 0.145, TRAIN_HALF = CAR_PITCH + CAR_LEN / 2 + NOSE;
const V_MAX = 3.4, ACCEL = 1.4, DWELL = 5;

type V3 = [number, number, number];
/** A local frame on the ground: origin, lateral (right) axis and forward axis, both unit and horizontal. */
interface Frame { x: number; z: number; rx: number; rz: number; fx: number; fz: number }
const IDENTITY: Frame = { x: 0, z: 0, rx: 1, rz: 0, fx: 0, fz: 1 };
const frameAt = (p: TrackPoint): Frame => ({ x: p.x, z: p.z, rx: -p.tz, rz: p.tx, fx: p.tx, fz: p.tz });
const place = (f: Frame, u: number, y: number, v: number): V3 => [f.x + f.rx * u + f.fx * v, y, f.z + f.rz * u + f.fz * v];

/** Flat-shaded, vertex-coloured triangle soup. Faces are wound outward from a supplied interior point. */
class Solid {
  private pos: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();

  /** Convex polygon, fanned; `inside` is any point on the solid's interior side. */
  poly(pts: V3[], color: number, inside: V3): void {
    this.c.setHex(color);
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const n = pts.length;
    const flip = nx * (cx / n - inside[0]) + ny * (cy / n - inside[1]) + nz * (cz / n - inside[2]) < 0;
    for (let i = 1; i < n - 1; i++) {
      const tri = flip ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]];
      for (const p of tri) { this.pos.push(p[0], p[1], p[2]); this.col.push(this.c.r, this.c.g, this.c.b); }
    }
  }

  /** Box in a frame: centred laterally on u and along on v, base at y. */
  box(f: Frame, u: number, y: number, v: number, w: number, h: number, d: number, color: number): void {
    const P = (su: number, sy: number, sv: number): V3 => place(f, u + su * w / 2, y + sy * h, v + sv * d / 2);
    const inside = P(0, 0.5, 0);
    for (const s of [-1, 1]) {
      this.poly([P(s, 0, -1), P(s, 0, 1), P(s, 1, 1), P(s, 1, -1)], color, inside);
      this.poly([P(-1, 0, s), P(1, 0, s), P(1, 1, s), P(-1, 1, s)], color, inside);
    }
    this.poly([P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], color, inside);
    this.poly([P(-1, 0, -1), P(1, 0, -1), P(1, 0, 1), P(-1, 0, 1)], color, inside);
  }

  /**
   * Extrude a convex (u, y) profile along track points [i0, i1], with end caps. The profile is
   * placed perpendicular to each point's tangent, so curves stay continuous.
   */
  sweep(track: TrackPoint[], i0: number, i1: number, profile: [number, number][], color: number, caps = true): void {
    if (i1 <= i0) return;
    const ring = (i: number): V3[] => profile.map(([u, y]) => place(frameAt(track[i]), u, y, 0));
    const mu = profile.reduce((s, p) => s + p[0], 0) / profile.length, my = profile.reduce((s, p) => s + p[1], 0) / profile.length;
    const centre = (i: number): V3 => place(frameAt(track[i]), mu, my, 0);
    let prev = ring(i0);
    if (caps) this.poly(prev, color, centre(i0 + 1));
    for (let i = i0 + 1; i <= i1; i++) {
      const next = ring(i), c0 = centre(i - 1), c1 = centre(i);
      const inside: V3 = [(c0[0] + c1[0]) / 2, (c0[1] + c1[1]) / 2, (c0[2] + c1[2]) / 2];
      for (let k = 0; k < profile.length; k++) {
        const k1 = (k + 1) % profile.length;
        this.poly([prev[k], prev[k1], next[k1], next[k]], color, inside);
      }
      prev = next;
    }
    if (caps) this.poly(prev, color, centre(i1 - 1));
  }

  /**
   * Loft chamfered rectangular sections along local +z (car bodies and noses). `face(s, e)` picks the
   * colour of edge e (0 bottom, 2 right, 4 top, 6 left, odd = chamfers) between sections s and s+1.
   */
  loft(sections: { v: number; hw: number; y0: number; y1: number; ch: number }[], face: (s: number, e: number) => number, capStart: number | null, capEnd: number | null): void {
    const ring = (s: { hw: number; y0: number; y1: number; ch: number; v: number }): V3[] => [
      [-s.hw + s.ch, s.y0], [s.hw - s.ch, s.y0], [s.hw, s.y0 + s.ch], [s.hw, s.y1 - s.ch],
      [s.hw - s.ch, s.y1], [-s.hw + s.ch, s.y1], [-s.hw, s.y1 - s.ch], [-s.hw, s.y0 + s.ch],
    ].map(([u, y]) => [u, y, s.v] as V3);
    const mid = (s: { y0: number; y1: number; v: number }): V3 => [0, (s.y0 + s.y1) / 2, s.v];
    for (let s = 0; s + 1 < sections.length; s++) {
      const a = ring(sections[s]), b = ring(sections[s + 1]), m0 = mid(sections[s]), m1 = mid(sections[s + 1]);
      const inside: V3 = [0, (m0[1] + m1[1]) / 2, (m0[2] + m1[2]) / 2];
      for (let e = 0; e < 8; e++) this.poly([a[e], a[(e + 1) % 8], b[(e + 1) % 8], b[e]], face(s, e), inside);
    }
    if (capStart !== null) this.poly(ring(sections[0]), capStart, mid(sections[1]));
    if (capEnd !== null) this.poly(ring(sections.at(-1)!), capEnd, mid(sections.at(-2)!));
  }

  build(dx = 0, dz = 0): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos);
    for (let i = 0; i < pos.length; i += 3) { pos[i] += dx; pos[i + 2] += dz; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** One passenger car, local +z forward, wheels on y = 0. `nose` adds a streamlined cab at +z. */
function carGeometry(nose: boolean, pantograph: boolean): THREE.BufferGeometry {
  const s = new Solid(), h = CAR_LEN / 2;
  const body = { hw: 0.15, y0: 0.06, y1: 0.33, ch: 0.045 };
  const sections = [{ v: -h, ...body }, { v: h, ...body }];
  if (nose) sections.push(
    { v: h + 0.065, hw: 0.146, y0: 0.06, y1: 0.305, ch: 0.055 },
    { v: h + 0.115, hw: 0.125, y0: 0.07, y1: 0.235, ch: 0.05 },
    { v: h + NOSE, hw: 0.085, y0: 0.09, y1: 0.16, ch: 0.03 },
  );
  s.loft(sections, (sec, e) => {
    if (e === 0) return UNDER;
    if (sec === 0) return e === 4 || e === 3 || e === 5 ? ROOF : BODY;
    if (sec === 2) return e >= 3 && e <= 5 ? WINDOW : e === 2 || e === 6 ? BODY : STRIPE;
    if (sec === 3) return STRIPE;
    return BODY;
  }, BODY, nose ? STRIPE : BODY);
  // Side detailing: window band, doors and livery stripe, just proud of the body.
  for (const side of [-1, 1]) {
    const u = side * 0.152;
    s.box(IDENTITY, u, 0.125, 0, 0.006, 0.035, CAR_LEN - 0.02, STRIPE);
    for (const [v0, v1] of [[-h + 0.03, -0.215], [-0.125, 0.125], [0.215, h - (nose ? 0.0 : 0.03)]]) {
      s.box(IDENTITY, u, 0.2, (v0 + v1) / 2, 0.008, 0.08, v1 - v0, WINDOW);
    }
    for (const v of [-0.17, 0.17]) {
      s.box(IDENTITY, u, 0.075, v, 0.01, 0.22, 0.075, DOOR);
      s.box(IDENTITY, side * 0.157, 0.2, v, 0.006, 0.075, 0.05, WINDOW);
    }
  }
  if (nose) {
    for (const u of [-0.07, 0.07]) s.box(IDENTITY, u, 0.1, h + NOSE - 0.004, 0.035, 0.018, 0.012, 0xfff3c4);
    s.box(IDENTITY, 0, 0.06, h + 0.07, 0.24, 0.04, 0.12, UNDER);
  }
  // Roof equipment and bogies.
  s.box(IDENTITY, 0, 0.33, 0, 0.14, 0.022, CAR_LEN * 0.55, ROOF);
  if (pantograph) {
    s.box(IDENTITY, 0, 0.352, 0.05, 0.1, 0.012, 0.012, STEEL);
    s.box(IDENTITY, 0, 0.352, -0.05, 0.1, 0.012, 0.012, STEEL);
    s.box(IDENTITY, 0, 0.364, 0, 0.012, 0.045, 0.1, STEEL);
    s.box(IDENTITY, 0, 0.405, 0, 0.16, 0.01, 0.02, STEEL);
  }
  for (const v of [-0.2, 0.2]) {
    s.box(IDENTITY, 0, 0, v, 0.22, 0.06, 0.16, UNDER);
    for (const u of [-0.1, 0.1]) s.box(IDENTITY, u, 0.005, v, 0.02, 0.045, 0.13, 0x59636a);
  }
  return s.build();
}

interface Train {
  cars: THREE.Mesh[];
  px: Float32Array; pz: Float32Array; cum: Float32Array;
  d0: number; d1: number; travel: number; phase: number;
}

/** Distance covered after `t` seconds of a D-long run with trapezoidal (ease in / ease out) speed. */
function runDistance(D: number, t: number): number {
  const tA = V_MAX / ACCEL, dA = 0.5 * ACCEL * tA * tA;
  if (D <= 2 * dA) {
    const tp = Math.sqrt(D / ACCEL);
    return t < tp ? 0.5 * ACCEL * t * t : D - 0.5 * ACCEL * Math.max(0, 2 * tp - t) ** 2;
  }
  const T = 2 * tA + (D - 2 * dA) / V_MAX;
  if (t < tA) return 0.5 * ACCEL * t * t;
  if (t < T - tA) return dA + V_MAX * (t - tA);
  return D - 0.5 * ACCEL * Math.max(0, T - t) ** 2;
}
function runTime(D: number): number {
  const tA = V_MAX / ACCEL, dA = 0.5 * ACCEL * tA * tA;
  return D <= 2 * dA ? 2 * Math.sqrt(D / ACCEL) : 2 * tA + (D - 2 * dA) / V_MAX;
}

/** Cheap hash of everything the transit layout depends on. */
export function transportSignature(kind: Uint8Array, flags: Uint8Array, raster: Raster, net?: Network): number {
  let h = net ? (net.version + 1) * 0x9e37 : 17;
  for (let i = 0; i < kind.length; i++) {
    const k = kind[i];
    if (k !== T_TROLLEY && k !== T_BUS && k !== T_STATION && k !== T_SUBWAY && k !== T_AIRPORT) continue;
    h = (Math.imul(h, 16777619) ^ i) >>> 0;
    h = (Math.imul(h, 16777619) ^ (k * 131 + flags[i] * 7 + (raster.accSeg[i] + 2))) >>> 0;
  }
  return h;
}

export class TransportLayer {
  readonly group = new THREE.Group();
  private tracks = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
  private moving = new THREE.Group();
  private trains: Train[] = [];
  private planes: { mesh: THREE.Mesh; x: number; z: number; dx: number; dz: number; phase: number }[] = [];
  private signature = '';
  private inputs = -1;
  private p = new THREE.Vector3();
  constructor() {
    this.tracks.castShadow = true; this.tracks.receiveShadow = true;
    this.group.add(this.tracks, this.moving);
  }
  reset(): void { this.signature = ''; this.inputs = -1; }
  rebuild(kind: Uint8Array, flags: Uint8Array, raster: Raster, net: Network, gates: readonly { x: number; z: number }[] = [], rotations?: Uint8Array): void {
    // Stations rarely change, but this runs on every state update, so skip the costly
    // route search unless the network or a transport tile actually changed.
    const inputs = transportSignature(kind, flags, raster, net) ^ (rotations?.reduce((hash, rot, i) => kind[i] === T_AIRPORT ? Math.imul(hash ^ (rot + i), 16777619) : hash, 17) ?? 17);
    if (inputs === this.inputs) return;
    this.inputs = inputs;
    const transit = transitNetwork(kind, i => flags[i] === 0 && raster.accSeg[i] >= 0, (a, b) => kind[a] === T_STATION && railPath(net, raster, a, b).length > 1, gates);
    const signature = `${net.version}:` + JSON.stringify([transit, transit.airports.map(i => rotations?.[i] ?? 0)]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.moving.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    this.moving.clear(); this.trains = []; this.planes = [];
    const half = GRID / 2, solid = new Solid(), bridged = new Set<number>();
    const rail = transit.lines.filter(line => line.mode === 'rail');
    const trainMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55 });
    const endCar = rail.length ? carGeometry(true, false) : null, midCar = rail.length ? carGeometry(false, true) : null;
    let endCarOut: THREE.BufferGeometry | null = null, midCarOut: THREE.BufferGeometry | null = null;
    // A line out of town runs from its station to the nearest city entrance and keeps going off the map.
    const outbound = transit.intercity.map(station => ({ station, track: intercityTrack(net, raster, station) })).filter(o => o.track.length > 1);
    for (const [n, out] of outbound.entries()) {
      this.viaduct(solid, out.track, net);
      this.terminus(solid, out.track, false, net, bridged.has(out.station) ? -1 : out.station);
      bridged.add(out.station);
      if (!endCarOut) { endCarOut = carGeometry(true, false); midCarOut = carGeometry(false, true); }
      const cars = [endCarOut, midCarOut!, endCarOut].map((g, k) => {
        const mesh = new THREE.Mesh(g, trainMat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.rotation.order = 'YXZ'; mesh.userData.flip = k === 0;
        this.moving.add(mesh);
        return mesh;
      });
      const length = out.track.at(-1)!.s;
      let a0 = TRAIN_HALF + 0.08, a1 = length - TRAIN_HALF - 0.08;
      if (a1 < a0) a0 = a1 = length / 2;
      this.trains.push({
        cars, d0: a0, d1: a1, travel: runTime(a1 - a0), phase: (n * 5.7 + 3) % 20,
        px: Float32Array.from(out.track, p => p.x - half), pz: Float32Array.from(out.track, p => p.z - half), cum: Float32Array.from(out.track, p => p.s),
      });
    }
    for (const [n, line] of rail.entries()) {
      const track = railTrack(net, raster, line.a, line.b);
      if (track.length < 2) continue;
      const len = track.at(-1)!.s;
      this.viaduct(solid, track, net);
      for (const [station, atEnd] of [[line.a, false], [line.b, true]] as const) {
        this.terminus(solid, track, atEnd, net, bridged.has(station) ? -1 : station);
        bridged.add(station);
      }
      const cars = [endCar!, midCar!, endCar!].map((g, k) => {
        const mesh = new THREE.Mesh(g, trainMat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.rotation.order = 'YXZ'; mesh.userData.flip = k === 0;
        this.moving.add(mesh);
        return mesh;
      });
      let d0 = TRAIN_HALF + 0.08, d1 = len - TRAIN_HALF - 0.08;
      if (d1 < d0) d0 = d1 = len / 2;
      this.trains.push({
        cars, d0, d1, travel: runTime(d1 - d0), phase: (n * 7.3 + (line.a % 11)) % 20,
        px: Float32Array.from(track, p => p.x - half), pz: Float32Array.from(track, p => p.z - half), cum: Float32Array.from(track, p => p.s),
      });
    }
    if (!this.trains.length) { endCar?.dispose(); midCar?.dispose(); endCarOut?.dispose(); midCarOut?.dispose(); trainMat.dispose(); }
    this.tracks.geometry.dispose(); this.tracks.geometry = solid.build(-half, -half);
    for (const i of transit.airports) {
      const plane = new Builder(1);
      plane.box(0.95, 0.13, 0.16, 0, 0, 0, 0xf1f1e7);
      plane.box(0.28, 0.035, 0.9, 0, 0.02, 0, 0xd5e1e4);
      plane.box(0.16, 0.24, 0.025, -0.37, 0.06, 0, 0x428aa8);
      plane.box(0.2, 0.025, 0.4, -0.35, 0.07, 0, 0x8eb8c7);
      plane.box(0.1, 0.06, 0.165, 0.3, 0.055, 0, 0x416078);
      const mesh = new THREE.Mesh(plane.build(), new THREE.MeshStandardMaterial({ vertexColors: true }));
      mesh.castShadow = true; this.moving.add(mesh);
      const runway = airportRunway(i, rotations?.[i] ?? 0);
      mesh.rotation.y = (rotations?.[i] ?? 0) * Math.PI / 2;
      this.planes.push({ mesh, x: runway.x - half, z: runway.z - half, dx: runway.dx, dz: runway.dz, phase: i % 30 });
    }
  }

  /** Box-girder deck with parapets, ballast, sleepers and rails, carried on portal frames that straddle the road. */
  private viaduct(s: Solid, track: TrackPoint[], net: Network): void {
    const last = track.length - 1, len = track[last].s;
    const plat = Math.min(PLATFORM_LEN, len / 2);
    let iP = 0; while (iP < last && track[iP].s < plat) iP++;
    let jP = last; while (jP > 0 && track[jP].s > len - plat) jP--;
    s.sweep(track, 0, last, [[-0.34, DECK], [0.34, DECK], [0.34, 1.02], [0.24, SOFFIT], [-0.24, SOFFIT], [-0.34, 1.02]], CONCRETE);
    s.sweep(track, 0, last, [[-0.21, BALLAST_TOP], [0.21, BALLAST_TOP], [0.27, DECK + 0.002], [-0.27, DECK + 0.002]], BALLAST);
    // Parapets stop where the platforms begin.
    if (jP > iP) for (const side of [-1, 1]) s.sweep(track, iP, jP, [[side * 0.3, DECK], [side * 0.345, DECK], [side * 0.345, DECK + 0.085], [side * 0.3, DECK + 0.085]], PARAPET);
    for (const u of [-0.1, 0.1]) {
      s.sweep(track, 0, last, [[u - 0.014, SLEEPER_TOP], [u + 0.014, SLEEPER_TOP], [u + 0.014, RAIL_TOP], [u - 0.014, RAIL_TOP]], RAIL);
    }
    // Sleepers every 0.2 along the track.
    let k = 0;
    for (let d = 0.1; d < len; d += 0.2) {
      while (k < last - 1 && track[k + 1].s < d) k++;
      const a = track[k], b = track[k + 1], t = (d - a.s) / (b.s - a.s || 1);
      const f = frameAt({ ...a, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: b.x - a.x, tz: b.z - a.z });
      const l = Math.hypot(f.fx, f.fz) || 1; f.fx /= l; f.fz /= l; f.rx = -f.fz; f.rz = f.fx;
      s.box(f, 0, BALLAST_TOP - 0.005, 0, 0.34, SLEEPER_TOP - BALLAST_TOP + 0.005, 0.055, SLEEPER);
    }
    // Portal frames: legs just outside the curbs of the road below, never inside another road.
    const portal = (i: number): boolean => {
      const p = track[i], hit = net.nearestSeg(p.x, p.z, 0.1);
      if (!hit) return false;
      const f = frameAt(p), off = HALF_WIDTH[hit.seg.kind] + 0.17;
      for (const u of [-off, off]) {
        const [x, , z] = place(f, u, 0, 0);
        for (const seg of net.segs.values()) {
          const m = HALF_WIDTH[seg.kind] + 0.1;
          if (x < seg.minX - m || x > seg.maxX + m || z < seg.minZ - m || z > seg.maxZ + m) continue;
          if (Network.nearestOn(seg, x, z).dist < m) return false;
        }
      }
      for (const u of [-off, off]) {
        s.box(f, u, 0, 0, 0.26, 0.04, 0.26, PIER);
        s.box(f, u, 0.04, 0, 0.13, SOFFIT - 0.18, 0.13, PIER);
      }
      s.box(f, 0, SOFFIT - 0.15, 0, off * 2 + 0.17, 0.15, 0.16, CONCRETE);
      return true;
    };
    let lastPortal = -Infinity;
    for (let i = 0; i <= last; i++) {
      const d = track[i].s;
      if (d < 0.3 || d > len - 0.3) continue;
      if (d - lastPortal >= PORTAL_SPACING || (lastPortal < 0 && d >= 0.3)) { if (portal(i)) lastPortal = d; }
    }
    if (len - lastPortal > 1.2) for (let i = last; i > 0 && track[i].s > len - 1.2; i--) if (track[i].s <= len - 0.3 && portal(i)) break;
  }

  /** Side platforms, canopy and buffer stop at one end of a line, plus a footbridge into the station hall. */
  private terminus(s: Solid, track: TrackPoint[], atEnd: boolean, net: Network, station: number): void {
    const last = track.length - 1, len = track[last].s, plat = Math.min(PLATFORM_LEN, len / 2);
    let i0 = 0, i1 = last;
    if (atEnd) { while (i0 < last && track[i0].s < len - plat) i0++; } else { while (i1 > 0 && track[i1].s > plat) i1--; }
    if (i1 <= i0) return;
    for (const side of [-1, 1]) {
      const [a, b] = [side * 0.34, side * 0.68].sort((p, q) => p - q);
      s.sweep(track, i0, i1, [[a, PLATFORM_TOP], [b, PLATFORM_TOP], [b, SOFFIT + 0.06], [a, SOFFIT + 0.06]], PLATFORM);
      const e = side * 0.34, e2 = side * 0.39;
      s.sweep(track, i0, i1, [[Math.min(e, e2), PLATFORM_TOP + 0.004], [Math.max(e, e2), PLATFORM_TOP + 0.004], [Math.max(e, e2), PLATFORM_TOP - 0.01], [Math.min(e, e2), PLATFORM_TOP - 0.01]], EDGE_LINE);
    }
    // Canopy on slim columns along the outer platform edges.
    s.sweep(track, i0, i1, [[-0.74, 1.66], [0.74, 1.66], [0.72, 1.62], [-0.72, 1.62]], CANOPY);
    s.sweep(track, i0, i1, [[-0.3, 1.7], [0.3, 1.7], [0.4, 1.66], [-0.4, 1.66]], CANOPY_TRIM);
    const step = Math.max(1, Math.round(0.6 / (track[1].s - track[0].s)));
    for (let i = i0 + 1; i < i1; i += step) for (const u of [-0.6, 0.6]) s.box(frameAt(track[i]), u, PLATFORM_TOP, 0, 0.04, 1.62 - PLATFORM_TOP, 0.04, STEEL);
    const endPt = track[atEnd ? last : 0], f = frameAt(endPt), dir = atEnd ? 1 : -1;
    s.box(f, 0, BALLAST_TOP, dir * -0.04, 0.3, 0.12, 0.06, BUFFER);
    s.box(f, 0, DECK, dir * -0.005, 0.7, PLATFORM_TOP - DECK + 0.02, 0.03, PARAPET);
    if (station < 0) return;
    // Footbridge from the platform edge facing the station to the hall's upper concourse.
    const mid = track[atEnd ? Math.max(i0, last - Math.round((i1 - i0) / 2)) : Math.round((i1 - i0) / 2)], mf = frameAt(mid);
    const cx = station % GRID + 1.5, cz = Math.floor(station / GRID) + 1;
    const side = Math.sign((cx - mid.x) * mf.rx + (cz - mid.z) * mf.rz) || 1;
    const [ax, , az] = place(mf, side * 0.66, 0, 0);
    const tx0 = station % GRID, tz0 = Math.floor(station / GRID);
    const qx = Math.max(tx0 + 0.25, Math.min(tx0 + 2.75, ax)), qz = Math.max(tz0 + 0.25, Math.min(tz0 + 1.75, az));
    const span = Math.hypot(qx - ax, qz - az);
    if (span < 0.05 || span > 5) return;
    const fx = (qx - ax) / span, fz = (qz - az) / span;
    const bf: Frame = { x: (ax + qx) / 2, z: (az + qz) / 2, rx: -fz, rz: fx, fx, fz };
    s.box(bf, 0, DECK, 0, 0.34, 0.1, span + 0.06, CONCRETE);
    for (const u of [-0.16, 0.16]) s.box(bf, u, DECK + 0.1, 0, 0.02, 0.26, span, GLAZING);
    s.box(bf, 0, DECK + 0.36, 0, 0.4, 0.045, span + 0.06, CANOPY_TRIM);
    if (span > 1.4 && !net.nearestSeg(bf.x, bf.z, 0.9)) s.box(bf, 0, 0, 0, 0.14, DECK, 0.14, PIER);
  }

  update(time: number): void {
    for (const t of this.trains) {
      const cycle = 2 * (t.travel + DWELL), ph = (time + t.phase) % cycle;
      const D = t.d1 - t.d0;
      let d: number;
      if (ph < DWELL) d = t.d0;
      else if (ph < DWELL + t.travel) d = t.d0 + runDistance(D, ph - DWELL);
      else if (ph < 2 * DWELL + t.travel) d = t.d1;
      else d = t.d1 - runDistance(D, ph - 2 * DWELL - t.travel);
      for (let k = 0; k < 3; k++) {
        const car = t.cars[k], c = d + (k - 1) * CAR_PITCH;
        const [fx, fz] = this.at(t, c + 0.2), [rx, rz] = this.at(t, c - 0.2);
        car.position.set((fx + rx) / 2, RAIL_TOP, (fz + rz) / 2);
        car.rotation.y = Math.atan2(fx - rx, fz - rz) + (car.userData.flip ? Math.PI : 0);
      }
    }
    for (const p of this.planes) {
      const phase = (time + p.phase) % 36;
      const x = phase < 6 ? 2.5 : 2.5 + (phase - 6) * 1.1;
      p.mesh.position.set(p.x + p.dx * x, 0.1 + Math.max(0, x - 6) * 0.3, p.z + p.dz * x);
      p.mesh.visible = phase < 24;
    }
  }

  /** World x, z at distance d along a train's track (extrapolated past the ends). */
  private at(t: Train, d: number): [number, number] {
    const { cum, px, pz } = t, n = cum.length;
    let lo = 0, hi = n - 1;
    if (d <= 0) hi = 1; else if (d >= cum[n - 1]) lo = n - 2;
    else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const u = (d - cum[lo]) / (cum[hi] - cum[lo] || 1);
    this.p.set(px[lo] + (px[hi] - px[lo]) * u, 0, pz[lo] + (pz[hi] - pz[lo]) * u);
    return [this.p.x, this.p.z];
  }
}
