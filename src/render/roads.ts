import { roadHeight, PORTAL_AT } from '../roads/structures';
import { Builder } from './buildingGeo';
import { entrySite } from '../roads/entries';
import * as THREE from 'three';
import { GRID } from '../constants';
import { Network, HALF_WIDTH, KIND_AVENUE, KIND_HIGHWAY, KIND_LANE, KIND_ROAD, signalPhase } from '../roads/network';
import type { Pose } from '../roads/network';
import type { Terrain } from '../terrain';
import { MeshBuilder } from './meshBuilder';
import { crossingApproaches } from './crossings';

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
const one = new THREE.Vector3(0.72, 0.72, 0.72);
const LAMP_RED = new THREE.Color(0xff3b30);
const LAMP_AMBER = new THREE.Color(0xffbf35);
const LAMP_OFF = new THREE.Color(0x28312e);
const LAMP_GREEN = new THREE.Color(0x34e36b);
const MAX_LAMPS = 2048;

/** Draws the whole road network as one vertex-colored mesh, rebuilt whenever the network changes. */
export class RoadLayer {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;
  private islands: THREE.Mesh;
  private poles: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private stopSigns: THREE.InstancedMesh;
  private lampInfo: { node: number; group: number }[] = [];
  private ranges = new Map<number, [number, number]>();
  private builtNet: Network | null = null;
  private builtVersion = -1;
  private builtTerrain: Terrain | null = null;
  private sign = new THREE.Group();

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.islands = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    this.islands.castShadow = true;
    this.islands.receiveShadow = true;
    this.islands.frustumCulled = false;
    this.group.add(this.islands);

    const body = new Builder(1);
    body.box(0.08, 0.08, 0.08, 0, 0, 0, 0x4d585d);
    body.box(0.035, 0.75, 0.035, 0, 0.04, 0, 0x707b7e);
    body.box(0.18, 0.38, 0.11, 0, 0.53, 0, 0x20282d);
    body.box(0.2, 0.025, 0.17, 0, 0.91, -0.02, 0x283135);
    for (const y of [0.6, 0.72, 0.84]) body.box(0.14, 0.02, 0.08, 0, y + 0.045, -0.09, 0x283135);
    body.box(0.08, 0.09, 0.08, 0, 0.35, 0, 0xe0b552);
    this.poles = new THREE.InstancedMesh(body.build(), new THREE.MeshStandardMaterial({ vertexColors: true }), MAX_LAMPS);
    const lampGeo = new THREE.CircleGeometry(0.043, 10);
    lampGeo.rotateY(Math.PI); lampGeo.translate(0, 0, -0.061);
    this.lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_LAMPS * 3);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS * 9), 3);
    for (const m of [this.poles, this.lamps]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.poles.castShadow = true;

    // Stop signs: a small octagonal plate on a post, one per approach.
    const signBody = new Builder(2);
    signBody.box(0.03, 0.62, 0.03, 0, 0, 0, 0x8d949a);
    signBody.box(0.26, 0.26, 0.022, 0, 0.5, 0.01, 0xc0392b);
    signBody.box(0.19, 0.19, 0.028, 0, 0.5, 0.015, 0xd9503f);
    signBody.box(0.13, 0.035, 0.032, 0, 0.5, 0.02, 0xf6f2ea);
    this.stopSigns = new THREE.InstancedMesh(signBody.build(), new THREE.MeshStandardMaterial({ vertexColors: true }), MAX_LAMPS);
    this.stopSigns.count = 0;
    this.stopSigns.frustumCulled = false;
    this.stopSigns.castShadow = true;
    this.group.add(this.stopSigns);

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
    // Zoning and building edits also fire a rebuild, so skip unless the network itself moved.
    if (net === this.builtNet && net.version === this.builtVersion && terrain === this.builtTerrain) return;
    this.builtNet = net; this.builtVersion = net.version; this.builtTerrain = terrain;
    const b = new MeshBuilder();
    const decorations = new Builder(17, 0);
    const crossings = crossingApproaches(net);
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

    // Curbs and water-crossing decks first (lowest), then asphalt, then markings.
    for (const s of net.segs.values()) {
      if (s.structure === 2) continue;
      b.heightAt = s.structure ? (x, z) => roadHeight(s, Network.nearestOn(s, x + half, z + half).s) : null;
      const hw = HALF_WIDTH[s.kind];
      const pts = world(s.pts, s.n + 1);
      b.ribbon(pts, s.n + 1, hw + 0.09, 0.03, CURB);
      // Bridges get a solid swept deck in StructureLayer; only a surface road over water keeps the
      // flat deck and rails here.
      let runStart = -1;
      for (let i = 0; i <= s.n + 1; i++) {
        const wet = i <= s.n && s.structure !== 1 && overWater(s.pts[i * 2], s.pts[i * 2 + 1]);
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
    b.heightAt = null;
    for (const n of net.nodes.values()) {
      let hw = 0;
      for (const s of net.segsAt(n.id)) hw = Math.max(hw, HALF_WIDTH[s.kind]);
      if (hw > 0) b.disc(n.x - half, n.z - half, hw + 0.09, 0.031, CURB);
    }
    for (const s of net.segs.values()) {
      if (s.structure === 2) continue;
      b.heightAt = s.structure ? (x, z) => roadHeight(s, Network.nearestOn(s, x + half, z + half).s) : null;
      const pts = world(s.pts, s.n + 1);
      this.ranges.set(s.id, b.ribbon(pts, s.n + 1, HALF_WIDTH[s.kind], 0.045, ASPHALT));
    }
    b.heightAt = null;
    // A tunnel's approaches are ordinary street up to the portal, so draw them as such, running a
    // little way into the mouth where the dark bore takes over.
    for (const s of net.segs.values()) {
      if (s.structure !== 2) continue;
      const hw = HALF_WIDTH[s.kind], reach = Math.min(s.len / 2, PORTAL_AT + 0.45);
      for (const [from, to] of [[0, reach], [s.len - reach, s.len]]) {
        const steps = Math.max(2, Math.ceil((to - from) / 0.3));
        const pts = new Float32Array((steps + 1) * 2);
        for (let k = 0; k <= steps; k++) {
          Network.poseAt(s, from + ((to - from) * k) / steps, pose);
          pts[k * 2] = pose.x - half;
          pts[k * 2 + 1] = pose.z - half;
        }
        b.ribbon(pts, steps + 1, hw + 0.09, 0.03, CURB);
        b.ribbon(pts, steps + 1, hw, 0.045, ASPHALT);
        if (s.kind !== KIND_LANE) b.ribbon(pts, steps + 1, 0.022, 0.056, s.kind === KIND_ROAD ? DASH : LINE);
      }
    }
    for (const n of net.nodes.values()) {
      let hw = 0;
      for (const s of net.segsAt(n.id)) hw = Math.max(hw, HALF_WIDTH[s.kind]);
      if (hw > 0) b.disc(n.x - half, n.z - half, hw, 0.046, ASPHALT);
    }
    roundaboutFlares(net, b);

    // All island details share one geometry and material, independent of roundabout count.
    for (const rb of net.roundabouts()) {
      let hw = 0;
      for (const seg of net.segs.values()) {
        const a = net.nodes.get(seg.a)!, c = net.nodes.get(seg.b)!;
        if (a.ring && c.ring && Math.abs(Math.hypot(a.x - rb.x, a.z - rb.z) - rb.r) < 0.15
          && Math.abs(Math.hypot(c.x - rb.x, c.z - rb.z) - rb.r) < 0.15) hw = Math.max(hw, HALF_WIDTH[seg.kind]);
      }
      const r = rb.r - hw - 0.12, x = rb.x - half, z = rb.z - half;
      if (r <= 0) continue;
      b.disc(x, z, r, 0.052, 0x78a858, 32);
      b.ring(x, z, r * 0.92, r, 0.058, 0xd7cbae, 32);
      // A low fountain, surrounded by four flower beds and two compact evergreen trees.
      // Every radius is a fraction of the usable island, including tree canopies.
      const scale = Math.min(r, 1.5), basin = r * 0.3;
      decorations.cyl(basin, 0.12 * scale, x, 0.055, z, 0xd5c8b0, 20);
      decorations.cyl(basin * 0.85, 0.018, x, 0.055 + 0.12 * scale, z, 0x65bbc6, 20);
      decorations.cyl(scale * 0.065, scale * 0.32, x, 0.07, z, 0xc5c2ac, 8);
      decorations.taper(scale * 0.17, scale * 0.045, scale * 0.075, x, 0.07 + scale * 0.32, z, 0xded6bb, 12);
      decorations.cyl(scale * 0.023, scale * 0.16, x, 0.07 + scale * 0.39, z, 0xbce7e3, 6);
      for (let k = 0; k < 4; k++) {
        const angle = k * Math.PI / 2 + Math.PI / 4;
        const fx = x + Math.cos(angle) * r * 0.62, fz = z + Math.sin(angle) * r * 0.62;
        b.disc(fx, fz, r * 0.19, 0.062, 0x695039, 12);
        b.disc(fx, fz, r * 0.16, 0.066, 0x4f813e, 12);
        for (let j = 0; j < 7; j++) {
          const a = j * Math.PI * 2 / 7;
          b.disc(fx + Math.cos(a) * r * 0.105, fz + Math.sin(a) * r * 0.105, r * 0.044, 0.073,
            [0xf0c45d, 0xdd789b, 0xf3ddd4, 0xb79bd4][k], 6);
        }
      }
      for (const side of [-1, 1]) {
        const tx = x + side * r * 0.65;
        decorations.cyl(scale * 0.025, scale * 0.2, tx, 0.06, z, 0x866144, 6);
        decorations.taper(r * 0.025, r * 0.15, scale * 0.4, tx, 0.06 + scale * 0.14, z, 0x3f7954, 7);
        decorations.taper(0, r * 0.11, scale * 0.32, tx, 0.06 + scale * 0.36, z, 0x579163, 7);
      }
    }
    this.islands.geometry.dispose();
    this.islands.geometry = decorations.build();
    this.islands.visible = this.islands.geometry.hasAttribute('position');

    // Markings.
    for (const s of net.segs.values()) {
      if (s.structure === 2) continue;
      b.heightAt = s.structure ? (x, z) => roadHeight(s, Network.nearestOn(s, x + half, z + half).s) : null;
      const trimA = Math.max(net.degree(s.a) >= 3 ? 1.0 : 0.2, (crossings.get(s.id)?.[0] ?? 0) + 0.23);
      const trimB = Math.max(net.degree(s.b) >= 3 ? 1.0 : 0.2, (crossings.get(s.id)?.[1] ?? 0) + 0.23);
      const from = trimA;
      const to = s.len - trimB;
      if (to - from < 0.5) continue;
      const avenue = s.kind === KIND_AVENUE, highway = s.kind === KIND_HIGHWAY, lane = s.kind === KIND_LANE;
      const wide = avenue || highway;
      // Lane lines sit between carriageway lanes: two each way on an avenue, three on an expressway.
      const lanes = highway ? [0.44, 0.88] : [0.43];
      const divider = highway ? 0.1 : 0.07;
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
      if (s.calm) {
        // Ladders of white bars across the carriageway read as a calmed street.
        const hw = HALF_WIDTH[s.kind];
        for (let d = from + 0.4; d + 0.25 < to; d += 1.5) {
          for (const off of [-hw * 0.55, 0, hw * 0.55]) strip(d, d + 0.25, hw * 0.3, off, WHITE);
        }
      }
      if (s.oneway) {
        for (let d = from + 0.3; d < to; d += 1.6) {
          Network.poseAt(s, d, pose);
          b.arrow(pose.x - half, pose.z - half, pose.tx, pose.tz, 0.2, 0.057, WHITE);
        }
        if (wide) for (let d = from; d + 0.5 < to; d += 1.1) for (const l of lanes) { strip(d, d + 0.5, 0.018, l - 0.22, WHITE); strip(d, d + 0.5, 0.018, -(l - 0.22), WHITE); }
      } else if (wide) {
        // A divider down the middle, a dashed line between each pair of lanes, and an edge line
        // along the shoulder so an expressway reads as three lanes each way.
        strip(from, to, 0.022, -divider, LINE);
        strip(from, to, 0.022, divider, LINE);
        for (let d = from; d + 0.5 < to; d += 1.1) for (const l of lanes) {
          strip(d, d + 0.5, 0.018, l, WHITE);
          strip(d, d + 0.5, 0.018, -l, WHITE);
        }
        const shoulder = HALF_WIDTH[s.kind] - 0.07;
        strip(from, to, 0.02, shoulder, WHITE);
        strip(from, to, 0.02, -shoulder, WHITE);
      } else if (lane) {
        // A lane is a single shared carriageway: no centre line, just a worn edge.
        for (let d = from; d + 0.2 < to; d += 1.4) strip(d, d + 0.2, 0.016, 0, DASH);
      } else {
        for (let d = from; d + 0.3 < to; d += 0.8) strip(d, d + 0.3, 0.022, 0, DASH);
      }
    }

    b.heightAt = null;
    // Crossings belong to ordinary junctions, whether signalized or uncontrolled.
    for (const [id, ends] of crossings) {
      const seg = net.segs.get(id)!;
      for (let end = 0; end < 2; end++) {
        if (!ends[end]) continue;
        Network.poseAt(seg, end === 0 ? ends[end] : seg.len - ends[end], pose);
        const hw = HALF_WIDTH[seg.kind], x = pose.x - half, z = pose.z - half;
        const stripes = Math.max(2, Math.floor((hw * 2 - 0.12) / 0.18));
        const spacing = (hw * 2 - 0.12) / stripes;
        for (let i = 0; i < stripes; i++) {
          const across = (i - (stripes - 1) / 2) * spacing;
          const px = x - pose.tz * across, pz = z + pose.tx * across;
          b.ribbon([px - pose.tx * 0.17, pz - pose.tz * 0.17, px + pose.tx * 0.17, pz + pose.tz * 0.17], 2, spacing * 0.28, 0.06, WHITE);
        }
      }
    }

    // The highway continues off the map so the entry reads as a connection to somewhere.
    this.sign.visible = false;
    for (const entry of net.nodes.values()) {
      if (!entry.entry) continue;
      const e = entrySite(entry.x, entry.z);
      // The drivable approach already reaches the entry node; the painted highway carries on from there.
      const ex = e.x - half, ez = e.z - half;
      const fx = entry.x - half, fz = entry.z - half;
      const far = new Float32Array([fx, fz, fx - e.dx * 140, fz - e.dz * 140]);
      const hw = HALF_WIDTH[KIND_AVENUE];
      b.ribbon(far, 2, hw + 0.09, 0.03, CURB);
      b.ribbon(far, 2, hw, 0.045, ASPHALT);
      b.ribbon(far, 2, 0.02, 0.056, LINE, -0.045);
      b.ribbon(far, 2, 0.02, 0.056, LINE, 0.045);
      this.sign.visible = true;
      this.sign.position.set(ex + e.dx * 1.5 - e.dz * 1.3, 0, ez + e.dz * 1.5 + e.dx * 1.3);
      this.sign.rotation.y = Math.atan2(e.dx, e.dz);
    }

    this.mesh.geometry.dispose();
    this.mesh.geometry = b.build();

    // Stop signs stand on the right-hand kerb of every approach to an all-way stop.
    let signCount = 0;
    q.identity();
    for (const node of net.nodes.values()) {
      if (!node.stop || net.degree(node.id) < 3) continue;
      for (const seg of net.segsAt(node.id)) {
        if (signCount >= MAX_LAMPS) break;
        const atA = seg.a === node.id;
        const along = Math.min(1.0, seg.len * 0.4);
        Network.poseAt(seg, atA ? along : seg.len - along, pose);
        const dir = atA ? -1 : 1;
        const tx = pose.tx * dir, tz = pose.tz * dir;
        const off = HALF_WIDTH[seg.kind] + 0.2;
        v3.set(pose.x - tz * off - half, 0, pose.z + tx * off - half);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-tx, -tz));
        m4.compose(v3, q, one);
        this.stopSigns.setMatrixAt(signCount++, m4);
      }
    }
    this.stopSigns.count = signCount;
    this.stopSigns.instanceMatrix.needsUpdate = true;

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
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tx, tz));
        m4.compose(v3, q, one);
        this.poles.setMatrixAt(n, m4);
        for (let lens = 0; lens < 3; lens++) {
          v3.y = (0.84 - lens * 0.12) * 0.72; m4.compose(v3, q, one);
          this.lamps.setMatrixAt(n * 3 + lens, m4);
        }
        this.lampInfo.push({ node: node.id, group: groups.get(s.id) ?? 0 });
        n++;
      }
    }
    this.poles.count = n;
    this.lamps.count = n * 3;
    this.poles.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    this.updateLights(0);
  }

  updateLights(simTime: number): void {
    for (let i = 0; i < this.lampInfo.length; i++) {
      const l = this.lampInfo[i];
      const phase = signalPhase(simTime, l.node, l.group);
      this.lamps.setColorAt(i * 3, phase === 'red' ? LAMP_RED : LAMP_OFF);
      this.lamps.setColorAt(i * 3 + 1, phase === 'amber' ? LAMP_AMBER : LAMP_OFF);
      this.lamps.setColorAt(i * 3 + 2, phase === 'green' ? LAMP_GREEN : LAMP_OFF);
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

/**
 * Where a street joins a roundabout, sweep its kerbs out into the ring in a curve instead of meeting
 * it at a sharp corner: a wedge of asphalt fills the gap between the arm's edge and the circle, with
 * a curved kerb around it, as in Cities: Skylines.
 */
function roundaboutFlares(net: Network, b: MeshBuilder): void {
  const half = GRID / 2;
  const rings = net.roundabouts();
  const curve = new Float32Array(13 * 2);
  for (const n of net.nodes.values()) {
    if (!n.ring) continue;
    const rb = rings.find(o => Math.abs(Math.hypot(n.x - o.x, n.z - o.z) - o.r) < 0.15);
    if (!rb) continue;
    const segs = net.segsAt(n.id);
    let ringHw = 0;
    for (const s of segs) {
      const other = net.nodes.get(s.a === n.id ? s.b : s.a)!;
      if (other.ring) ringHw = Math.max(ringHw, HALF_WIDTH[s.kind]);
    }
    if (!ringHw) continue;
    const outer = rb.r + ringHw;
    for (const s of segs) {
      const other = net.nodes.get(s.a === n.id ? s.b : s.a)!;
      if (other.ring || s.structure) continue;
      // The arm's direction, leaving the ring.
      const k = s.a === n.id ? 1 : s.n - 1, e = s.a === n.id ? 0 : s.n;
      let ux = s.pts[k * 2] - s.pts[e * 2], uz = s.pts[k * 2 + 1] - s.pts[e * 2 + 1];
      const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const hw = HALF_WIDTH[s.kind], size = Math.min(0.35 + hw * 0.5, s.len * 0.35);
      const centreAngle = Math.atan2(n.z - rb.z, n.x - rb.x);
      for (const side of [-1, 1]) {
        // Where this edge of the arm leaves the ring's outer edge.
        const ox = n.x - uz * side * hw - rb.x, oz = n.z + ux * side * hw - rb.z;
        const wu = ox * ux + oz * uz, disc = wu * wu - (ox * ox + oz * oz) + outer * outer;
        if (disc < 0) continue;
        const t0 = -wu + Math.sqrt(disc);
        const ex = rb.x + ox + ux * t0, ez = rb.z + oz + uz * t0;
        // Start the curve a little way round the circle, away from the arm, and end it down the arm.
        let turn = Math.atan2(ez - rb.z, ex - rb.x) - centreAngle;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        const a = Math.atan2(ez - rb.z, ex - rb.x) + Math.sign(turn || side) * size / outer;
        const ax = rb.x + Math.cos(a) * outer, az = rb.z + Math.sin(a) * outer;
        const bx = ex + ux * size, bz = ez + uz * size;
        const steps = curve.length / 2;
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1), u = 1 - t;
          curve[i * 2] = u * u * ax + 2 * u * t * ex + t * t * bx - half;
          curve[i * 2 + 1] = u * u * az + 2 * u * t * ez + t * t * bz - half;
        }
        b.ribbon(curve, steps, 0.09, 0.03, CURB);
        b.fan(ex - half, ez - half, curve, steps, 0.045, ASPHALT);
      }
    }
  }
}

