import * as THREE from 'three';
import { GRID } from '../constants';
import { Network, HALF_WIDTH, KIND_AVENUE, isGreen } from '../roads/network';
import type { Pose } from '../roads/network';
import type { Terrain } from '../terrain';
import { MeshBuilder } from './meshBuilder';

const ASPHALT = 0x4c4d55;
const CURB = 0xb9b6ad;
const DECK = 0x9a968c;
const RAIL = 0xd8d5cc;
const DASH = 0xf1d36a;
const LINE = 0xe8b93c;
const WHITE = 0xe9e9e4;
const GRAY = new THREE.Color(ASPHALT);
const RED = new THREE.Color(0xd63b2f);
const tmp = new THREE.Color();
const pose: Pose = { x: 0, z: 0, tx: 0, tz: 0 };
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v3 = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const LAMP_RED = new THREE.Color(0xff3b30);
const LAMP_GREEN = new THREE.Color(0x34e36b);
const MAX_LAMPS = 2048;

/** Draws the whole road network as one vertex-colored mesh, rebuilt whenever the network changes. */
export class RoadLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private poles: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private lampInfo: { node: number; group: number }[] = [];
  private ranges = new Map<number, [number, number]>();
  private sign = new THREE.Group();

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    const poleGeo = new THREE.BoxGeometry(0.05, 0.55, 0.05);
    poleGeo.translate(0, 0.275, 0);
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2b2d33 }), MAX_LAMPS);
    const lampGeo = new THREE.BoxGeometry(0.13, 0.2, 0.13);
    lampGeo.translate(0, 0.62, 0);
    this.lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_LAMPS);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS * 3), 3);
    for (const m of [this.poles, this.lamps]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.poles.castShadow = true;

    // Highway sign at the entry.
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.06), new THREE.MeshStandardMaterial({ color: 0x1f7a4d }));
    board.position.y = 1.25;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.07), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    stripe.position.y = 1.25;
    this.sign.add(board, stripe);
    for (const x of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), new THREE.MeshStandardMaterial({ color: 0x777777 }));
      leg.position.set(x, 0.5, 0);
      this.sign.add(leg);
    }
    this.sign.traverse((o) => { o.castShadow = true; });
    this.group.add(this.sign);
  }

  rebuild(net: Network, terrain: Terrain): void {
    const b = new MeshBuilder();
    const half = GRID / 2;
    this.ranges.clear();
    const world = (pts: Float32Array, count: number): Float32Array => {
      const out = new Float32Array(count * 2);
      for (let i = 0; i < count * 2; i++) out[i] = pts[i] - half;
      return out;
    };
    const overWater = (x: number, z: number): boolean => {
      const tx = Math.floor(x), tz = Math.floor(z);
      return tx >= 0 && tz >= 0 && tx < GRID && tz < GRID && terrain.water[tz * GRID + tx] === 1;
    };

    // Curbs and bridge decks first (lowest), then asphalt, then markings.
    for (const s of net.segs.values()) {
      const hw = HALF_WIDTH[s.kind];
      const pts = world(s.pts, s.n + 1);
      b.ribbon(pts, s.n + 1, hw + 0.09, 0.03, CURB);
      // Bridge: a concrete deck and rails wherever the road is over water.
      let runStart = -1;
      for (let i = 0; i <= s.n + 1; i++) {
        const wet = i <= s.n && overWater(s.pts[i * 2], s.pts[i * 2 + 1]);
        if (wet && runStart < 0) runStart = Math.max(0, i - 1);
        if (!wet && runStart >= 0) {
          const end = Math.min(s.n, i);
          const count = end - runStart + 1;
          if (count >= 2) {
            const sub = pts.subarray(runStart * 2, (end + 1) * 2);
            b.ribbon(sub, count, hw + 0.22, 0.024, DECK);
            b.ribbon(sub, count, 0.035, 0.2, RAIL, hw + 0.13);
            b.ribbon(sub, count, 0.035, 0.2, RAIL, -(hw + 0.13));
          }
          runStart = -1;
        }
      }
    }
    for (const n of net.nodes.values()) {
      let hw = 0;
      for (const s of net.segsAt(n.id)) hw = Math.max(hw, HALF_WIDTH[s.kind]);
      if (hw > 0) b.disc(n.x - half, n.z - half, hw + 0.09, 0.031, CURB);
    }
    for (const s of net.segs.values()) {
      const pts = world(s.pts, s.n + 1);
      this.ranges.set(s.id, b.ribbon(pts, s.n + 1, HALF_WIDTH[s.kind], 0.045, ASPHALT));
    }
    for (const n of net.nodes.values()) {
      let hw = 0;
      for (const s of net.segsAt(n.id)) hw = Math.max(hw, HALF_WIDTH[s.kind]);
      if (hw > 0) b.disc(n.x - half, n.z - half, hw, 0.046, ASPHALT);
    }

    // Roundabout islands.
    for (const rb of net.roundabouts()) {
      let hw = HALF_WIDTH[0];
      const near = net.nearestSeg(rb.x + rb.r, rb.z, 0.6);
      if (near) hw = HALF_WIDTH[near.seg.kind];
      b.disc(rb.x - half, rb.z - half, rb.r - hw - 0.09, 0.05, 0x6fa84f, 28);
      b.disc(rb.x - half, rb.z - half, (rb.r - hw) * 0.45, 0.052, 0x4f8a3a, 20);
    }

    // Markings.
    for (const s of net.segs.values()) {
      const trimA = net.degree(s.a) >= 3 ? 1.0 : 0.2;
      const trimB = net.degree(s.b) >= 3 ? 1.0 : 0.2;
      const from = trimA;
      const to = s.len - trimB;
      if (to - from < 0.5) continue;
      const avenue = s.kind === KIND_AVENUE;
      const strip = (s0: number, s1: number, halfW: number, offset: number, color: number): void => {
        const steps = Math.max(1, Math.ceil((s1 - s0) / 0.35));
        const arr = new Float32Array((steps + 1) * 2);
        for (let k = 0; k <= steps; k++) {
          Network.poseAt(s, s0 + ((s1 - s0) * k) / steps, pose);
          arr[k * 2] = pose.x - half;
          arr[k * 2 + 1] = pose.z - half;
        }
        b.ribbon(arr, steps + 1, halfW, 0.056, color, offset);
      };
      if (s.oneway) {
        for (let d = from + 0.3; d < to; d += 1.6) {
          Network.poseAt(s, d, pose);
          b.arrow(pose.x - half, pose.z - half, pose.tx, pose.tz, 0.2, 0.057, WHITE);
        }
        if (avenue) for (let d = from; d + 0.4 < to; d += 0.95) strip(d, d + 0.4, 0.02, 0, WHITE);
      } else if (avenue) {
        strip(from, to, 0.02, -0.045, LINE);
        strip(from, to, 0.02, 0.045, LINE);
        for (let d = from; d + 0.4 < to; d += 0.95) {
          strip(d, d + 0.4, 0.018, 0.34, WHITE);
          strip(d, d + 0.4, 0.018, -0.34, WHITE);
        }
      } else {
        for (let d = from; d + 0.3 < to; d += 0.8) strip(d, d + 0.3, 0.022, 0, DASH);
      }
    }

    // The highway continues off the map so the entry reads as a connection to somewhere.
    const entry = net.entryNode();
    if (entry) {
      const e = terrain.entry;
      const ex = entry.x - half, ez = entry.z - half;
      const far = new Float32Array([ex, ez, ex - e.dx * 140, ez - e.dz * 140]);
      const hw = HALF_WIDTH[KIND_AVENUE];
      b.ribbon(far, 2, hw + 0.09, 0.03, CURB);
      b.ribbon(far, 2, hw, 0.045, ASPHALT);
      b.ribbon(far, 2, 0.02, 0.056, LINE, -0.045);
      b.ribbon(far, 2, 0.02, 0.056, LINE, 0.045);
      this.sign.visible = true;
      this.sign.position.set(ex + e.dx * 1.5 - e.dz * 1.3, 0, ez + e.dz * 1.5 + e.dx * 1.3);
      this.sign.rotation.y = Math.atan2(e.dx, e.dz);
    } else {
      this.sign.visible = false;
    }

    this.mesh.geometry.dispose();
    this.mesh.geometry = b.build();

    // Traffic signals: one lamp per approach, on the right-hand side at the stop line.
    this.lampInfo = [];
    let n = 0;
    q.identity();
    for (const node of net.nodes.values()) {
      if (!node.light || net.degree(node.id) < 3) continue;
      const groups = net.lightGroups(node.id);
      for (const s of net.segsAt(node.id)) {
        if (n >= MAX_LAMPS) break;
        const atA = s.a === node.id;
        const d = Math.min(1.0, s.len * 0.4);
        Network.poseAt(s, atA ? d : s.len - d, pose);
        const dir = atA ? -1 : 1; // direction of travel toward the node
        const tx = pose.tx * dir, tz = pose.tz * dir;
        const off = HALF_WIDTH[s.kind] + 0.16;
        v3.set(pose.x - tz * off - half, 0, pose.z + tx * off - half);
        m4.compose(v3, q, one);
        this.poles.setMatrixAt(n, m4);
        this.lamps.setMatrixAt(n, m4);
        this.lampInfo.push({ node: node.id, group: groups.get(s.id) ?? 0 });
        n++;
      }
    }
    this.poles.count = n;
    this.lamps.count = n;
    this.poles.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    this.updateLights(0);
  }

  updateLights(simTime: number): void {
    for (let i = 0; i < this.lampInfo.length; i++) {
      const l = this.lampInfo[i];
      this.lamps.setColorAt(i, isGreen(simTime, l.node, l.group) ? LAMP_GREEN : LAMP_RED);
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  /** Tint asphalt by congestion. `order` lists segment ids in the same order as `cong`. */
  tint(order: number[], cong: Uint8Array): void {
    const attr = this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!attr || order.length !== cong.length) return;
    for (let k = 0; k < order.length; k++) {
      const r = this.ranges.get(order[k]);
      if (!r) continue;
      const c = Math.min(1, (cong[k] / 255) * 1.5);
      tmp.copy(GRAY).lerp(RED, c);
      for (let v = r[0]; v < r[1]; v++) attr.setXYZ(v, tmp.r, tmp.g, tmp.b);
    }
    attr.needsUpdate = true;
  }
}
