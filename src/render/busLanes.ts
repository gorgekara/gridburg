import * as THREE from 'three';
import { GRID, N_TILES, T_BUS } from '../constants';
import { Network } from '../roads/network';
import type { RSeg } from '../roads/network';
import { laneCentre, LANE_WIDTH } from '../roads/lanes';
import { busLaneSpan, busBays, BUS_BAY, BAY_LENGTH, BAY_TAPER } from '../roads/busLanes';
import { crossingApproaches } from '../roads/crossings';
import { MeshBuilder } from './meshBuilder';

// Bus lanes and bus stops as a highway engineer paints them: the kerb lane surfaced red with a wide
// solid line beside it (broken where other traffic may cross it), BUS in the lane, and a lay-by at
// each stop with a kerb round its back and a yellow outline.
const RED = 0xa8483d, WHITE = 0xeeeee6, YELLOW = 0xe6c23a, ASPHALT = 0x3d3f44, KERB = 0xb9b5ab;

/** Which strokes of a seven-segment letter are lit: top, top-right, bottom-right, bottom, bottom-left, top-left, middle. */
const LETTERS: Record<string, string> = { B: '0011111', U: '0111110', S: '1011011' };

export interface BusMarks { busLanes: number; busBays: number; busStands: number }

/** A stop's bay, as the street furniture needs it to keep clear: which road, where, which side, how far out. */
export interface BayView { seg: number; s: number; side: number; outer: number; inLane: boolean }

/** Static, merged geometry: one draw call for every bus lane, bay and their markings. */
export class BusLaneLayer {
  readonly group = new THREE.Group();
  marks: BusMarks = { busLanes: 0, busBays: 0, busStands: 0 };
  bays: BayView[] = [];
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93 }));
  private key = '';

  constructor() {
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  rebuild(net: Network, kind: Uint8Array, raster: { accSeg: Int32Array; accS: Float32Array }): void {
    let stops = '';
    for (let i = 0; i < N_TILES; i++) if (kind[i] === T_BUS) stops += `${i}:${raster.accSeg[i]},`;
    const key = `${net.version}|${stops}`;
    if (key === this.key) return;
    this.key = key;
    this.marks = { busLanes: 0, busBays: 0, busStands: 0 };
    const b = new MeshBuilder(), half = GRID / 2, pose = { x: 0, z: 0, tx: 0, tz: 0 };
    const zebras = crossingApproaches(net);
    /** Points along a road between two arc lengths (from its a end), in world coordinates. */
    const along = (s: RSeg, d0: number, d1: number): { pts: number[]; count: number } => {
      const count = Math.max(2, Math.ceil(Math.abs(d1 - d0) / 0.2) + 1), pts: number[] = [];
      for (let k = 0; k < count; k++) {
        Network.poseAt(s, d0 + ((d1 - d0) * k) / (count - 1), pose);
        pts.push(pose.x - half, pose.z - half);
      }
      return { pts, count };
    };
    /** A stretch of line `offset` right of a→b, solid or broken, between two arc lengths. */
    const line = (s: RSeg, d0: number, d1: number, halfW: number, y: number, color: number, offset: number, dash = 0): void => {
      if (d1 - d0 < 0.05) return;
      if (!dash) { const r = along(s, d0, d1); b.ribbon(r.pts, r.count, halfW, y, color, offset); return; }
      for (let d = d0; d < d1; d += dash * 1.8) { const r = along(s, d, Math.min(d1, d + dash)); b.ribbon(r.pts, r.count, halfW, y, color, offset); }
    };
    /**
     * A word in seven-segment letters, laid in a lane and read by the traffic coming up it: letters
     * side by side across the lane, stretched along it. `at` is the arc length from the a end.
     */
    const word = (s: RSeg, at: number, fwd: boolean, offset: number, text: string, w: number, h: number, color: number): void => {
      Network.poseAt(s, at, pose);
      const dir = fwd ? 1 : -1, tx = pose.tx * dir, tz = pose.tz * dir, rx = -tz, rz = tx;
      const cx = pose.x - half - pose.tz * offset, cz = pose.z - half + pose.tx * offset;
      const gap = w * 0.45, total = text.length * w + (text.length - 1) * gap;
      [...text].forEach((ch, k) => {
        const u0 = -total / 2 + k * (w + gap) + w / 2, on = LETTERS[ch] ?? '0000000';
        const p = (u: number, v: number): [number, number] => [cx + rx * (u0 + u) + tx * (v - h / 2), cz + rz * (u0 + u) + tz * (v - h / 2)];
        const strokes: [number, number, number, number][] = [[-w / 2, h, w / 2, h], [w / 2, h / 2, w / 2, h], [w / 2, 0, w / 2, h / 2], [-w / 2, 0, w / 2, 0], [-w / 2, 0, -w / 2, h / 2], [-w / 2, h / 2, -w / 2, h], [-w / 2, h / 2, w / 2, h / 2]];
        strokes.forEach(([u1, v1, u2, v2], j) => { if (on[j] === '1') b.ribbon([...p(u1, v1), ...p(u2, v2)], 2, w * 0.13, 0.058, color); });
      });
    };

    // ---- bus lanes ----
    for (const s of net.segs.values()) {
      if (!s.bus || s.structure === 2) continue;
      for (const fwd of [true, false]) {
        const span = busLaneSpan(net, s, fwd, zebras);
        if (!span) continue;
        this.marks.busLanes++;
        // Arc lengths from the a end, and offsets right of a→b.
        const toA = (p: number): number => (fwd ? p : s.len - p);
        const lo = (p0: number, p1: number): [number, number] => [Math.min(toA(p0), toA(p1)), Math.max(toA(p0), toA(p1))];
        const sign = fwd ? 1 : -1, w = LANE_WIDTH[s.kind], centre = laneCentre(net, s, fwd, 0) * sign;
        const inner = (laneCentre(net, s, fwd, 0) - w / 2) * sign;
        const [a0, a1] = lo(span.from, span.to);
        line(s, a0, a1, w / 2 - 0.015, 0.0505, RED, centre);
        line(s, a0, a1, 0.02, 0.057, WHITE, inner);
        // Broken where others may cross it: into the bay before the junction, and where it starts.
        const [b0, b1] = lo(span.to, Math.min(s.len, span.to + BUS_BAY));
        line(s, b0, b1, 0.014, 0.057, WHITE, inner, 0.22);
        const [c0, c1] = lo(Math.max(0, span.from - 1), span.from);
        line(s, c0, c1, 0.014, 0.057, WHITE, inner, 0.22);
        // BUS at the start, and every six cells along.
        for (let p = span.from + 0.5; p < span.to - 0.5; p += 6) word(s, toA(p), fwd, centre, 'BUS', w * 0.2, 0.3, WHITE);
      }
    }

    // ---- bus stops ----
    this.bays = [];
    for (const bay of busBays(net, kind, raster.accSeg, raster.accS, T_BUS)) {
      const { seg: s, s: at, side, fwd, edge, outer } = bay;
      const sign = side;
      const d0 = Math.max(0.2, at - BAY_LENGTH / 2 - BAY_TAPER), d1 = Math.min(s.len - 0.2, at + BAY_LENGTH / 2 + BAY_TAPER);
      if (d1 - d0 < 1) continue;
      this.bays.push({ seg: s.id, s: at, side, outer, inLane: bay.inLane });
      const standFrom = Math.max(d0, at - BAY_LENGTH / 2), standTo = Math.min(d1, at + BAY_LENGTH / 2);
      if (bay.inLane) {
        // In a bus lane: a yellow box round the stand, and BUS STOP… here just BUS, in the lane.
        this.marks.busStands++;
        const w = LANE_WIDTH[s.kind], c = laneCentre(net, s, fwd, 0);
        for (const o of [c - w / 2 + 0.03, c + w / 2 - 0.03]) line(s, standFrom, standTo, 0.012, 0.058, YELLOW, o * sign, 0.12);
        word(s, at, fwd, c * sign, 'BUS', w * 0.2, 0.3, YELLOW);
        continue;
      }
      // A lay-by: paved out from the kerb to its own back kerb, tapering in and out.
      this.marks.busBays++;
      const r = along(s, d0, d1), depth: number[] = [];
      for (let k = 0; k < r.count; k++) {
        const d = d0 + ((d1 - d0) * k) / (r.count - 1);
        const t = Math.min(1, Math.max(0, Math.min(d - d0, d1 - d) / BAY_TAPER));
        depth.push(edge + (outer - edge) * (t * t * (3 - 2 * t)));
      }
      const inner = edge - 0.01;
      // band(left, right) spans from −left to +right of a→b.
      if (sign > 0) {
        b.band(r.pts, r.count, -inner, depth, 0.046, ASPHALT);
        b.band(r.pts, r.count, depth.map(v => -v), depth.map(v => v + 0.06), 0.062, KERB);
      } else {
        b.band(r.pts, r.count, depth, -inner, 0.046, ASPHALT);
        b.band(r.pts, r.count, depth.map(v => v + 0.06), depth.map(v => -v), 0.062, KERB);
      }
      // The yellow outline: along the stand at the lane's edge and at the back, and BUS in the bay.
      line(s, standFrom, standTo, 0.012, 0.058, YELLOW, (edge - 0.02) * sign, 0.12);
      line(s, standFrom, standTo, 0.012, 0.058, YELLOW, (outer - 0.04) * sign, 0.12);
      word(s, at, fwd, ((edge + outer) / 2) * sign, 'BUS', 0.05, 0.22, YELLOW);
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = b.build();
  }
}
