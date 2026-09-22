import { roadHeight, PORTAL_AT } from '../roads/structures';
import { Builder } from './buildingGeo';
import { entrySite } from '../roads/entries';
import * as THREE from 'three';
import { GRID } from '../constants';
import { Network, HALF_WIDTH, KIND_AVENUE, KIND_HIGHWAY, KIND_LANE, KIND_ROAD, KIND_MOTORWAY, KIND_RAMP, signalPhase } from '../roads/network';
import type { Pose, RSeg } from '../roads/network';
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
  readonly poles: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  readonly stopSigns: THREE.InstancedMesh;
  private lampInfo: { node: number; group: number }[] = [];
  private ranges = new Map<number, [number, number]>();
  private builtNet: Network | null = null;
  private builtVersion = -1;
  private builtTerrain: Terrain | null = null;
  readonly signs: THREE.Group[] = [];

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

    // Highway signs: one beside each road coming in from outside, on the verge to the right of it.
    const green = new THREE.MeshStandardMaterial({ color: 0x1f7a4d }), white = new THREE.MeshStandardMaterial({ color: 0xffffff }), grey = new THREE.MeshStandardMaterial({ color: 0x777777 });
    for (let n = 0; n < 4; n++) {
      const sign = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.06), green);
      board.position.y = 1.25;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.07), white);
      stripe.position.y = 1.25;
      sign.add(board, stripe);
      for (const x of [-0.7, 0.7]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), grey);
        leg.position.set(x, 0.5, 0);
        sign.add(leg);
      }
      sign.traverse((o) => { o.castShadow = true; });
      sign.visible = false;
      this.signs.push(sign);
      this.group.add(sign);
    }
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
      // The kerb disc only has to close the notch where two arms of a bend meet; a big disc under a
      // narrow street meeting a wide avenue used to bulge out past the street's own kerbs.
      let hw = Infinity;
      for (const s of net.segsAt(n.id)) hw = Math.min(hw, HALF_WIDTH[s.kind]);
      if (Number.isFinite(hw)) b.disc(n.x - half, n.z - half, hw + 0.09, 0.031, CURB);
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
    junctionFillets(net, b);
    rampGores(net, b);

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
      const motorwayKind = s.kind === KIND_MOTORWAY || s.kind === KIND_RAMP;
      // Where a slip road splits from or joins a carriageway the two run side by side for a while:
      // the ramp's own lines stop where it is clear of the highway, and the highway keeps its lines
      // through the node except the edge line on the ramp's side, which opens up for the mouth.
      const mouthA = motorwayKind ? rampMouth(net, s, s.a) : null, mouthB = motorwayKind ? rampMouth(net, s, s.b) : null;
      const trimA = Math.max(mouthA ? (s.kind === KIND_RAMP ? mouthA.length : 0.2) : net.degree(s.a) >= 3 ? 1.0 : 0.2, (crossings.get(s.id)?.[0] ?? 0) + 0.23);
      const trimB = Math.max(mouthB ? (s.kind === KIND_RAMP ? mouthB.length : 0.2) : net.degree(s.b) >= 3 ? 1.0 : 0.2, (crossings.get(s.id)?.[1] ?? 0) + 0.23);
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
      if (s.kind === KIND_MOTORWAY || s.kind === KIND_RAMP) {
        // Highway carriageways: solid edge lines, dashed lane lines, and arrows showing the flow.
        const edge = HALF_WIDTH[s.kind] - 0.06;
        // Each edge line stops short of a ramp mouth on its own side.
        for (const side of [1, -1]) {
          const openA = mouthA && s.kind !== KIND_RAMP && mouthA.side === side ? mouthA.length : 0;
          const openB = mouthB && s.kind !== KIND_RAMP && mouthB.side === side ? mouthB.length : 0;
          const f = Math.max(from, openA), t = Math.min(to, s.len - openB);
          if (t - f > 0.3) strip(f, t, 0.02, side * edge, side > 0 || s.kind === KIND_RAMP ? WHITE : LINE);
        }
        if (s.kind === KIND_MOTORWAY) for (let d = from; d + 0.5 < to; d += 1.1) for (const l of [-0.22, 0.22]) strip(d, d + 0.5, 0.018, l, WHITE);
        for (let d = from + 0.5; d < to; d += 2.2) {
          Network.poseAt(s, d, pose);
          for (const l of s.kind === KIND_MOTORWAY ? [-0.44, 0, 0.44] : [0]) b.arrow(pose.x - half - pose.tz * l, pose.z - half + pose.tx * l, pose.tx, pose.tz, 0.13, 0.057, WHITE);
        }
      } else if (s.oneway) {
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
    for (const sign of this.signs) sign.visible = false;
    let signs = 0;
    for (const entry of net.nodes.values()) {
      if (!entry.entry) continue;
      const e = entrySite(entry.x, entry.z);
      const seg = net.segsAt(entry.id)[0];
      const kind = seg?.kind ?? KIND_HIGHWAY;
      // The drivable approach already reaches the entry node; the painted road carries on from there
      // at the same width, so a motorway carriageway does not turn into an avenue at the horizon.
      const fx = entry.x - half, fz = entry.z - half;
      const far = new Float32Array([fx, fz, fx - e.dx * 140, fz - e.dz * 140]);
      const hw = HALF_WIDTH[kind];
      b.ribbon(far, 2, hw + 0.09, 0.03, CURB);
      b.ribbon(far, 2, hw, 0.045, ASPHALT);
      if (kind === KIND_MOTORWAY) { b.ribbon(far, 2, 0.02, 0.056, WHITE, hw - 0.06); b.ribbon(far, 2, 0.02, 0.056, WHITE, -(hw - 0.06)); }
      else { b.ribbon(far, 2, 0.02, 0.056, LINE, -0.045); b.ribbon(far, 2, 0.02, 0.056, LINE, 0.045); }
      // A sign greets traffic coming in: beside the road on the verge, never on the carriageway.
      const inbound = !seg?.oneway || seg.a === entry.id;
      if (!inbound || signs >= this.signs.length) continue;
      const sign = this.signs[signs++];
      const off = hw + 0.95;
      // On the verge to the right of the traffic, unless another carriageway runs there, in which
      // case it stands on the outside of the pair instead of in the median.
      const spot = (side: number): { x: number; z: number } => ({ x: e.x + e.dx * 1.5 - e.dz * off * side, z: e.z + e.dz * 1.5 + e.dx * off * side });
      const clear = (q: { x: number; z: number }): boolean => !net.onRoad(q.x, q.z, -1, 0.15);
      const at = clear(spot(1)) ? spot(1) : spot(-1);
      sign.visible = true;
      sign.position.set(at.x - half, 0, at.z - half);
      sign.rotation.y = Math.atan2(e.dx, e.dz);
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
        // On the verge just back from the crossing road, never on it.
        const spot = net.vergeSpot(seg, node.id, HALF_WIDTH[seg.kind] + 0.2, Math.min(1.0, seg.len * 0.4));
        if (!spot) continue;
        const { tx, tz } = spot;
        v3.set(spot.x - half, 0, spot.z - half);
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
        const spot = net.vergeSpot(s, node.id, HALF_WIDTH[s.kind] + 0.16, Math.min(1.0, s.len * 0.4));
        if (!spot) continue;
        const { tx, tz } = spot;
        v3.set(spot.x - half, 0, spot.z - half);
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

/**
 * Where a ramp meets a carriageway at `node`: how far along `seg` the two roads overlap, and on which
 * side of `seg` (+1 right of a → b, -1 left) the other road lies. Null when no ramp meets there.
 */
function rampMouth(net: Network, seg: RSeg, node: number): { length: number; side: number } | null {
  const others = net.segsAt(node).filter(o => o.id !== seg.id && (o.kind === KIND_MOTORWAY || o.kind === KIND_RAMP) && !o.structure);
  if (!others.length || net.degree(node) !== 3) return null;
  if (seg.kind !== KIND_RAMP && !others.some(o => o.kind === KIND_RAMP)) return null;
  // Pair with the road that runs the same way from the node: a ramp with the carriageway it shadows,
  // a carriageway with the ramp that shadows it, never the arm leading off the other way.
  const at = net.nodes.get(node)!, pose1 = { x: 0, z: 0, tx: 0, tz: 0 }, pose2 = { x: 0, z: 0, tx: 0, tz: 0 };
  const away = (s: RSeg, out: Pose): Pose => { Network.poseAt(s, s.a === node ? Math.min(0.4, s.len) : Math.max(0, s.len - 0.4), out); return out; };
  away(seg, pose1);
  const ux = pose1.x - at.x, uz = pose1.z - at.z;
  const candidates = others.filter(o => seg.kind === KIND_RAMP ? o.kind !== KIND_RAMP : o.kind === KIND_RAMP);
  if (!candidates.length) return null;
  const other = candidates.map(o => { away(o, pose2); return { o, dot: (pose2.x - at.x) * ux + (pose2.z - at.z) * uz }; }).sort((p, q) => q.dot - p.dot)[0];
  if (other.dot <= 0) return null;
  const otherSeg = other.o;
  const clearance = HALF_WIDTH[seg.kind] + HALF_WIDTH[otherSeg.kind] + 0.06;
  const fromA = seg.a === node;
  let length = 0.2, side = 1;
  for (let d = 0.2; d < Math.min(seg.len - 0.2, 12); d += 0.2) {
    Network.poseAt(seg, fromA ? d : seg.len - d, pose);
    const hit = Network.nearestOn(otherSeg, pose.x, pose.z);
    // Which side the other road's nearest point falls on, relative to this road's direction of travel.
    const cross = (hit.x - pose.x) * pose.tz - (hit.z - pose.z) * pose.tx;
    side = (cross > 0 ? -1 : 1) * (fromA ? 1 : -1);
    length = d;
    if (hit.dist > clearance) break;
  }
  return { length: Math.min(length + 0.3, seg.len * 0.6), side };
}

/**
 * Curved kerb corners at every junction and bend: where two arms meet at an angle, the wedge between
 * their kerbs is paved and the corner rounded off, instead of two square road ends poking into a disc.
 */
function junctionFillets(net: Network, b: MeshBuilder): void {
  const half = GRID / 2;
  const curve = new Float32Array(11 * 2);
  for (const n of net.nodes.values()) {
    if (n.ring) continue;
    const arms = net.segsAt(n.id);
    if (arms.length < 2) continue;
    // Each arm's direction away from the node, from its first polyline piece.
    const dirs = arms.map(s => {
      const fromA = s.a === n.id, k = fromA ? 1 : s.n - 1, e = fromA ? 0 : s.n;
      let ux = s.pts[k * 2] - s.pts[e * 2], uz = s.pts[k * 2 + 1] - s.pts[e * 2 + 1];
      const l = Math.hypot(ux, uz) || 1;
      return { s, ux: ux / l, uz: uz / l, angle: Math.atan2(uz / l, ux / l), hw: HALF_WIDTH[s.kind] };
    }).sort((p, q) => p.angle - q.angle);
    for (let i = 0; i < dirs.length; i++) {
      const A = dirs[i], B = dirs[(i + 1) % dirs.length];
      let gap = B.angle - A.angle;
      if (i === dirs.length - 1) gap += Math.PI * 2;
      // Only real corners: not the straight-through side of a T, nor a slip road's shallow merge.
      if (gap < 0.35 || gap > 2.95) continue;
      // The kerb of A that faces B, and the kerb of B that faces A.
      const leftA = { x: n.x - A.uz * A.hw, z: n.z + A.ux * A.hw }, rightA = { x: n.x + A.uz * A.hw, z: n.z - A.ux * A.hw };
      // Which of A's kerbs faces B: the one further along B's direction.
      const facingA = (leftA.x - n.x) * B.ux + (leftA.z - n.z) * B.uz > (rightA.x - n.x) * B.ux + (rightA.z - n.z) * B.uz ? leftA : rightA;
      const leftB = { x: n.x - B.uz * B.hw, z: n.z + B.ux * B.hw }, rightB = { x: n.x + B.uz * B.hw, z: n.z - B.ux * B.hw };
      const facingB = (leftB.x - n.x) * A.ux + (leftB.z - n.z) * A.uz > (rightB.x - n.x) * A.ux + (rightB.z - n.z) * A.uz ? leftB : rightB;
      // Corner: where the two kerb lines cross.
      const det = A.ux * -B.uz - A.uz * -B.ux;
      if (Math.abs(det) < 1e-4) continue;
      const dx = facingB.x - facingA.x, dz = facingB.z - facingA.z;
      const t = (dx * -B.uz - dz * -B.ux) / det, u = (A.ux * dz - A.uz * dx) / det;
      if (t < -0.2 || u < -0.2 || t > 4 || u > 4) continue;
      const cx = facingA.x + A.ux * t, cz = facingA.z + A.uz * t;
      // Round the corner off with a radius that suits the wider road, but never past the arm's far end.
      const r = Math.min(0.35 + Math.max(A.hw, B.hw) * 0.45, Math.max(0.15, A.s.len - t - 0.4), Math.max(0.15, B.s.len - u - 0.4));
      const sx = cx + A.ux * r, sz = cz + A.uz * r, ex = cx + B.ux * r, ez = cz + B.uz * r;
      const steps = curve.length / 2;
      for (let k = 0; k < steps; k++) {
        const f = k / (steps - 1), g = 1 - f;
        curve[k * 2] = g * g * sx + 2 * g * f * cx + f * f * ex - half;
        curve[k * 2 + 1] = g * g * sz + 2 * g * f * cz + f * f * ez - half;
      }
      b.ribbon(curve, steps, 0.09, 0.03, CURB);
      b.fan(n.x - half, n.z - half, curve, steps, 0.045, ASPHALT);
    }
  }
}

/**
 * Where a slip road splits from or joins a carriageway, pave the sliver between the two so the ramp
 * reads as a lane added to the highway that then peels away, rather than a separate road grazing it.
 */
function rampGores(net: Network, b: MeshBuilder): void {
  const half = GRID / 2, p = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const ramp of net.segs.values()) {
    if (ramp.kind !== KIND_RAMP || ramp.structure) continue;
    for (const node of [ramp.a, ramp.b]) {
      const mouth = rampMouth(net, ramp, node);
      if (!mouth) continue;
      const fromA = ramp.a === node;
      // The carriageway that carries on the way the ramp runs.
      Network.poseAt(ramp, fromA ? 0.3 : ramp.len - 0.3, p);
      const rx = (p.x - net.nodes.get(node)!.x), rz = (p.z - net.nodes.get(node)!.z), rl = Math.hypot(rx, rz) || 1;
      let road: RSeg | null = null, best = -1;
      for (const o of net.segsAt(node)) {
        if (o.id === ramp.id || o.kind !== KIND_MOTORWAY || o.structure) continue;
        Network.poseAt(o, o.a === node ? 0.3 : o.len - 0.3, p);
        const n = net.nodes.get(node)!, dot = ((p.x - n.x) * rx + (p.z - n.z) * rz) / rl / (Math.hypot(p.x - n.x, p.z - n.z) || 1);
        if (dot > best) { best = dot; road = o; }
      }
      if (!road || best < 0.5) continue;
      const length = Math.min(mouth.length + 0.6, ramp.len - 0.3, road.len - 0.3);
      const steps = 10, pts: number[] = [];
      // Out along the carriageway's edge on the ramp's side, then back along the ramp's near edge.
      const roadFromA = road.a === node, rampSide = mouth.side * (fromA ? 1 : -1);
      for (let k = 0; k <= steps; k++) {
        const d = (k / steps) * length;
        Network.poseAt(road, roadFromA ? d : road.len - d, p);
        const tx = roadFromA ? p.tx : -p.tx, tz = roadFromA ? p.tz : -p.tz;
        // The ramp lies to `rampSide` of the carriageway's direction of travel away from the node.
        const sideSign = ((-tz) * rx + tx * rz) > 0 ? 1 : -1;
        pts.push(p.x - tz * HALF_WIDTH[KIND_MOTORWAY] * sideSign - half, p.z + tx * HALF_WIDTH[KIND_MOTORWAY] * sideSign - half);
      }
      for (let k = steps; k >= 0; k--) {
        const d = (k / steps) * length;
        Network.poseAt(ramp, fromA ? d : ramp.len - d, p);
        const tx = fromA ? p.tx : -p.tx, tz = fromA ? p.tz : -p.tz;
        // The ramp's edge that faces the carriageway.
        pts.push(p.x - tz * HALF_WIDTH[KIND_RAMP] * rampSide - half, p.z + tx * HALF_WIDTH[KIND_RAMP] * rampSide - half);
      }
      const n = net.nodes.get(node)!;
      b.fan(n.x - half, n.z - half, pts, pts.length / 2, 0.045, ASPHALT);
    }
  }
}
