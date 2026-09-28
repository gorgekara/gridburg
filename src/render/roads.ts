import { roadHeight, tunnelMouth, levelY } from '../roads/structures';
import { Builder } from './buildingGeo';
import { entrySite } from '../roads/entries';
import * as THREE from 'three';
import { GRID, tileHash } from '../constants';
import { Network, HALF_WIDTH, KIND_AVENUE, KIND_HIGHWAY, KIND_LANE, KIND_ROAD, KIND_MOTORWAY, KIND_RAMP, KIND_HIGHWAY2, isCarriageway } from '../roads/network';
import type { Pose, RSeg } from '../roads/network';
import type { Terrain } from '../terrain';
import { MeshBuilder } from './meshBuilder';
import { crossingApproaches } from '../roads/crossings';
import { stopLine } from '../roads/control';
import { junctionPaint, chevronSpots } from './junctionMarks';
import { rampJoin, rampMouthShape } from '../roads/rampMouth';
import type { JunctionMarks, SignSpot } from './junctionMarks';
import { laneTapers, edgeAt, sideHalf, roadHalf, lanesFor, laneCentre, taperLength, approachLanes, oneWay, ringLaneCount, carriageHalf, PARK_W, TREE_W } from '../roads/lanes';
import type { Tapers } from '../roads/lanes';
import { planFor, movements, stateIn, fixedClock, moveKey, crossingState, crossingFrom, allTurns, turnName } from '../roads/signals';
import type { SignalPlan, SignalState } from '../roads/signals';

/** Each side's edge at every sample of a segment, following any taper. */
function edges(s: RSeg, tapers: Tapers, extra = 0): { left: Float32Array; right: Float32Array } {
  const left = new Float32Array(s.n + 1), right = new Float32Array(s.n + 1);
  for (let i = 0; i <= s.n; i++) {
    right[i] = edgeAt(s, 1, s.cum[i], tapers) + extra;
    left[i] = edgeAt(s, -1, s.cum[i], tapers) + extra;
  }
  return { left, right };
}
/** Whether a segment's lanes differ from its kind's, so its markings come from its own lane layout. */
const customLanes = (s: RSeg, tapers: Tapers): boolean => !!(s.addR || s.addL) || tapers.has(s.id);

const ASPHALT = 0x4c4d55;
const CURB = 0xb9b6ad;
/** The planted verge of a tree-lined street. */
const VERGE = 0x6f9a55;
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
const TACTILE = 0xe2b93b, MEDIAN_GRASS = 0x6f9f52, APRON = 0xb3a58c;
/** How far short of a junction an avenue's median stops, leaving room for its turn bay. */
const MEDIAN_BAY = 1.5;
/** How long a marked parking bay is along a parking lane. */
export const PARK_BAY = 0.42;
/** The darker transverse bars of a rumble strip on an expressway's shoulder. */
const RUMBLE = 0x2c2d31;
const WALK = new THREE.Color(0xf4f1e8), DONT_WALK = new THREE.Color(0xff7a1a), PED_OFF = new THREE.Color(0x2a2a2a);
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
  /** Each signal head: its junction, the plan it runs, and the movements of the approach it faces. */
  private lampInfo: { node: number; plan: SignalPlan; keys: string[] }[] = [];
  private ranges = new Map<number, [number, number]>();
  private builtNet: Network | null = null;
  private builtVersion = -1;
  private builtTerrain: Terrain | null = null;
  readonly signs: THREE.Group[] = [];
  /** What the last rebuild painted and put up at junctions and curves. */
  marks: JunctionMarks = { stopLines: 0, giveWays: 0, yieldSigns: 0, chevrons: 0, gores: 0, ramps: 0, pedHeads: 0, splitters: 0, medians: 0, barriers: 0, guardrails: 0, medianTrees: 0, rumbles: 0, banSigns: 0, streetTrees: 0, parkingBays: 0 };
  /** Pedestrian signal heads: a box on a post at each end of a signalled crossing, and its lamp. */
  readonly pedHeads: THREE.InstancedMesh;
  private pedLamps: THREE.InstancedMesh;
  pedInfo: { node: number; plan: SignalPlan; from: string[]; crossTime: number }[] = [];
  readonly yieldSigns: THREE.InstancedMesh;
  /** Round 'no left turn', 'no right turn' and 'no straight on' signs, for turns a junction bans. */
  readonly banSigns: Record<'Left' | 'Straight' | 'Right', THREE.InstancedMesh>;
  readonly rails: THREE.Mesh;
  readonly heads: THREE.InstancedMesh;
  readonly arms: THREE.InstancedMesh;
  readonly chevrons: THREE.InstancedMesh;

  private wet = { value: 0 };
  /** How wet the roads are, 0 to 1. */
  setWet(wet: number): void { this.wet.value = wet; }

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    // Wet roads: darker, and glossy enough to catch the sky and the lamps.
    mat.onBeforeCompile = shader => {
      shader.uniforms.cityWet = this.wet;
      shader.fragmentShader = 'uniform float cityWet;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 1.0 - 0.28 * cityWet;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.32, cityWet);');
    };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.islands = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    this.islands.castShadow = true;
    this.islands.receiveShadow = true;
    this.islands.frustumCulled = false;
    this.group.add(this.islands);
    this.rails = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    this.rails.frustumCulled = false;
    this.group.add(this.rails);

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
    // Overhead heads, and the mast arms that carry them (a unit length along +x, stretched per arm).
    const head = new Builder(5);
    // Placed at the ground plus 0.62 and scaled like the poles (0.72): the box holds the lenses (drawn
    // separately, 0.55–0.73 up) and a hanger rises to the arm at 0.95.
    head.box(0.14, 0.36, 0.1, 0, -0.16, 0, 0x20282d);
    head.box(0.02, 0.26, 0.02, 0, 0.2, 0, 0x707b7e);
    this.heads = new THREE.InstancedMesh(head.build(), new THREE.MeshStandardMaterial({ vertexColors: true }), MAX_LAMPS);
    const armGeo = new THREE.BoxGeometry(1, 0.035, 0.035);
    armGeo.translate(0.5, 0.95, 0);
    this.arms = new THREE.InstancedMesh(armGeo, new THREE.MeshStandardMaterial({ color: 0x707b7e }), MAX_LAMPS);
    for (const m of [this.heads, this.arms]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; this.group.add(m); }

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

    // Yield signs: a red-rimmed white triangle, point down, on a post.
    const yieldBody = new Builder(3);
    yieldBody.box(0.03, 0.62, 0.03, 0, 0, 0, 0x8d949a);
    const tri = (r: number, z: number): THREE.BufferGeometry => {
      const shape = new THREE.Shape();
      for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3; if (k) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      const g = new THREE.ShapeGeometry(shape);
      g.translate(0, 0.52, z);
      return g;
    };
    yieldBody.add(tri(0.17, 0.018), 0xc0392b);
    yieldBody.add(tri(0.11, 0.022), 0xf6f2ea);
    this.yieldSigns = new THREE.InstancedMesh(yieldBody.build(), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide }), MAX_LAMPS);
    // Chevron boards: yellow, with a black arrowhead, on a post.
    const chevronBody = new Builder(4);
    chevronBody.box(0.025, 0.5, 0.025, 0, 0, 0, 0x8d949a);
    chevronBody.box(0.2, 0.22, 0.02, 0, 0.42, 0, 0xe8c547);
    for (const [dy, turn] of [[0.05, 0.6], [-0.05, -0.6]] as const) {
      const bar = new THREE.BoxGeometry(0.12, 0.035, 0.024);
      bar.rotateZ(turn); bar.translate(0, 0.42 + dy, 0);
      chevronBody.add(bar, 0x1d1d1d);
    }
    this.chevrons = new THREE.InstancedMesh(chevronBody.build(), new THREE.MeshStandardMaterial({ vertexColors: true }), MAX_LAMPS);
    for (const m of [this.yieldSigns, this.chevrons]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; this.group.add(m); }
    // A banned turn: a white disc ringed in red on a post, the forbidden arrow in black, slashed in red.
    const banSign = (turn: 'Left' | 'Straight' | 'Right'): THREE.InstancedMesh => {
      const body = new Builder(7);
      body.box(0.03, 0.62, 0.03, 0, 0, 0, 0x8d949a);
      const disc = (r: number, z: number): THREE.BufferGeometry => { const g = new THREE.CircleGeometry(r, 20); g.translate(0, 0.54, z); return g; };
      body.add(disc(0.15, 0.018), 0xc0392b);
      body.add(disc(0.12, 0.021), 0xf6f2ea);
      const bar = (w: number, h: number, x: number, y: number, rot = 0, color = 0x1d1d1d, z = 0.024): void => {
        const g = new THREE.BoxGeometry(w, h, 0.004); g.rotateZ(rot); g.translate(x, 0.54 + y, z); body.add(g, color);
      };
      // The arrow: a stem up from below the middle, bent the way of the turn, with a head.
      bar(0.022, 0.1, 0, -0.03);
      if (turn === 'Straight') { bar(0.022, 0.06, 0, 0.04); bar(0.05, 0.02, -0.015, 0.07, -0.8); bar(0.05, 0.02, 0.015, 0.07, 0.8); }
      else {
        const s = turn === 'Left' ? -1 : 1;
        bar(0.08, 0.022, s * 0.03, 0.02);
        bar(0.045, 0.018, s * 0.06, 0.035, s * -0.8); bar(0.045, 0.018, s * 0.06, 0.005, s * 0.8);
      }
      bar(0.24, 0.024, 0, 0, -0.8, 0xc0392b, 0.028);
      const mesh = new THREE.InstancedMesh(body.build(), new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide }), MAX_LAMPS);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = true; this.group.add(mesh);
      return mesh;
    };
    this.banSigns = { Left: banSign('Left'), Straight: banSign('Straight'), Right: banSign('Right') };
    // Pedestrian heads: a small box on a short post, its lamp facing across the road.
    const pedBody = new Builder(6);
    pedBody.box(0.025, 0.42, 0.025, 0, 0, 0, 0x707b7e);
    pedBody.box(0.1, 0.12, 0.06, 0, 0.4, 0, 0x20282d);
    this.pedHeads = new THREE.InstancedMesh(pedBody.build(), new THREE.MeshStandardMaterial({ vertexColors: true }), MAX_LAMPS);
    const pedLamp = new THREE.PlaneGeometry(0.07, 0.08);
    pedLamp.rotateY(Math.PI); pedLamp.translate(0, 0.46, -0.032);
    this.pedLamps = new THREE.InstancedMesh(pedLamp, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_LAMPS);
    this.pedLamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS * 3), 3);
    for (const m of [this.pedHeads, this.pedLamps]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }

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
    this.marks = { stopLines: 0, giveWays: 0, yieldSigns: 0, chevrons: 0, gores: 0, ramps: 0, pedHeads: 0, splitters: 0, medians: 0, barriers: 0, guardrails: 0, medianTrees: 0, rumbles: 0, banSigns: 0, streetTrees: 0, parkingBays: 0 };
    const b = new MeshBuilder();
    const decorations = new Builder(17, 0);
    const crossings = crossingApproaches(net);
    const tapers = laneTapers(net);
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
      const hw = roadHalf(s);
      const pts = world(s.pts, s.n + 1);
      const kerb = edges(s, tapers, 0.09);
      b.band(pts, s.n + 1, kerb.left, kerb.right, 0.03, CURB);
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
      // Up on a level the disc sits on the deck; underground there is nothing to draw.
      if ((n.level ?? 0) < 0) continue;
      let hw = Infinity;
      for (const s of net.segsAt(n.id)) hw = Math.min(hw, nodeEdge(s, n.id, tapers, Math.min));
      const ny = levelY(n.level ?? 0);
      b.heightAt = ny ? () => ny : null;
      if (Number.isFinite(hw)) b.disc(n.x - half, n.z - half, hw + 0.09, 0.031, CURB);
    }
    b.heightAt = null;
    for (const s of net.segs.values()) {
      if (s.structure === 2) continue;
      b.heightAt = s.structure ? (x, z) => roadHeight(s, Network.nearestOn(s, x + half, z + half).s) : null;
      const pts = world(s.pts, s.n + 1);
      const e = edges(s, tapers);
      // A tree-lined street is paved only to its verge; the verge beyond is planted.
      const tw = s.trees ? TREE_W : 0;
      const aL = tw ? e.left.map(v => v - tw) : e.left, aR = tw ? e.right.map(v => v - tw) : e.right;
      this.ranges.set(s.id, b.band(pts, s.n + 1, aL, aR, 0.045, ASPHALT));
      if (tw) {
        b.band(pts, s.n + 1, aR.map(v => -v), e.right, 0.049, VERGE);
        b.band(pts, s.n + 1, e.left, aL.map(v => -v), 0.049, VERGE);
        // A low kerb along the inside of each verge.
        b.band(pts, s.n + 1, aR.map(v => -v), aR.map(v => v + 0.035), 0.055, CURB);
        b.band(pts, s.n + 1, aL.map(v => v + 0.035), aL.map(v => -v), 0.055, CURB);
      }
    }
    b.heightAt = null;
    // A tunnel's approaches are ordinary street up to the portal, so draw them as such, running a
    // little way into the mouth where the dark bore takes over.
    for (const s of net.segs.values()) {
      if (s.structure !== 2) continue;
      // Up to each mouth, from any end that is on the ground.
      const ends: [number, number][] = [];
      const ma = tunnelMouth(s, 0), mb = tunnelMouth(s, 1);
      if (ma !== null) ends.push([0, Math.min(s.len / 2, ma + 0.45)]);
      if (mb !== null) ends.push([s.len - Math.min(s.len / 2, mb + 0.45), s.len]);
      // An old tunnel's approach is level up to its portal; one between levels eases down to its mouth.
      b.heightAt = s.ya || s.yb ? (x, z) => Math.max(-0.12, roadHeight(s, Network.nearestOn(s, x + half, z + half).s)) : null;
      for (const [from, to] of ends) {
        const steps = Math.max(2, Math.ceil((to - from) / 0.3));
        const pts = new Float32Array((steps + 1) * 2);
        for (let k = 0; k <= steps; k++) {
          Network.poseAt(s, from + ((to - from) * k) / steps, pose);
          pts[k * 2] = pose.x - half;
          pts[k * 2 + 1] = pose.z - half;
        }
        b.band(pts, steps + 1, sideHalf(s, -1) + 0.09, sideHalf(s, 1) + 0.09, 0.03, CURB);
        b.band(pts, steps + 1, sideHalf(s, -1), sideHalf(s, 1), 0.045, ASPHALT);
        if (s.kind !== KIND_LANE) b.ribbon(pts, steps + 1, 0.022, 0.056, s.kind === KIND_ROAD ? DASH : LINE);
      }
      b.heightAt = null;
    }
    for (const n of net.nodes.values()) {
      if ((n.level ?? 0) < 0) continue;
      let hw = 0;
      // Where a ramp leaves or joins a carriageway, the ramp's own lane widens one side only: a disc
      // as wide as that would bulge out of the other side, so it is only as wide as the roads are.
      const join = rampJoin(net, n.id);
      for (const s of net.segsAt(n.id)) hw = Math.max(hw, join ? HALF_WIDTH[s.kind] : nodeEdge(s, n.id, tapers, Math.max));
      const ny = levelY(n.level ?? 0);
      b.heightAt = ny ? () => ny : null;
      if (hw > 0) b.disc(n.x - half, n.z - half, hw, 0.046, ASPHALT);
    }
    b.heightAt = null;
    roundaboutFlares(net, b);
    this.marks.splitters += splitterIslands(net, b);
    junctionFillets(net, b, tapers);
    rampGores(net, b, this.marks);

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
      // A truck apron round the island: paving a long vehicle's rear wheels may cross.
      b.ring(x, z, r, Math.min(rb.r - 0.05, r + 0.12), 0.047, APRON, 40);
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
    // Trees down the planted median of every two-way avenue, every two cells, where the median runs
    // (see the markings below: clear of each junction, short of it by the turn bay).
    for (const s of net.segs.values()) {
      if (s.kind !== KIND_AVENUE || s.oneway || s.structure || customLanes(s, tapers)) continue;
      const clearA = Math.max(net.degree(s.a) >= 3 ? 1.0 : 0.2, (crossings.get(s.id)?.[0] ?? 0) + 0.23) + (net.degree(s.a) >= 3 ? MEDIAN_BAY : 0);
      const clearB = Math.max(net.degree(s.b) >= 3 ? 1.0 : 0.2, (crossings.get(s.id)?.[1] ?? 0) + 0.23) + (net.degree(s.b) >= 3 ? MEDIAN_BAY : 0);
      const m0 = clearA + 0.6, m1 = s.len - clearB - 0.6;
      if (m1 - m0 < 0) continue;
      const count = Math.floor((m1 - m0) / 2) + 1, start = m0 + ((m1 - m0) - (count - 1) * 2) / 2;
      for (let k = 0; k < count; k++) {
        Network.poseAt(s, start + k * 2, pose);
        const x = pose.x - half, z = pose.z - half, v = tileHash(s.id * 977 + k) ;
        decorations.cyl(0.018, 0.16, x, 0.07, z, 0x7a5a3e, 6);
        decorations.taper(0.075 + v * 0.02, 0.012, 0.3 + v * 0.08, x, 0.16, z, v > 0.5 ? 0x4f8a50 : 0x5d9656, 7);
        this.marks.medianTrees++;
      }
    }
    // Street trees down each planted verge, every cell and a half, clear of the junctions and zebras.
    for (const s of net.segs.values()) {
      if (!s.trees || s.structure) continue;
      const clearA = Math.max(net.degree(s.a) >= 3 ? 1.2 : 0.4, (crossings.get(s.id)?.[0] ?? 0) + 0.4);
      const clearB = Math.max(net.degree(s.b) >= 3 ? 1.2 : 0.4, (crossings.get(s.id)?.[1] ?? 0) + 0.4);
      for (let d = clearA; d < s.len - clearB; d += 1.5) for (const side of [1, -1]) {
        Network.poseAt(s, d, pose);
        const off = (sideHalf(s, side) - TREE_W / 2) * side, x = pose.x - half - pose.tz * off, z = pose.z - half + pose.tx * off, v = tileHash(s.id * 131 + Math.round(d * 7) + (side > 0 ? 3 : 0));
        decorations.cyl(0.02, 0.18, x, 0.05, z, 0x7a5a3e, 6);
        decorations.taper(0.08 + v * 0.025, 0.012, 0.32 + v * 0.1, x, 0.18, z, v > 0.5 ? 0x4f8a50 : 0x5d9656, 7);
        this.marks.streetTrees++;
      }
    }
    this.islands.geometry.dispose();
    this.islands.geometry = decorations.build();
    // Barriers and guardrails: their own mesh, which casts no shadow, as it is long and thin.
    const rails = new Builder(18, 0);
    roadsideSafety(net, rails, this.marks);
    this.rails.geometry.dispose();
    this.rails.geometry = rails.build();
    this.rails.visible = this.rails.geometry.hasAttribute('position');
    this.islands.visible = this.islands.geometry.hasAttribute('position');

    // Markings.
    const trims = rampTrims(net);
    for (const s of net.segs.values()) {
      if (s.structure === 2) continue;
      b.heightAt = s.structure ? (x, z) => roadHeight(s, Network.nearestOn(s, x + half, z + half).s) : null;
      const carriageway = isCarriageway(s.kind);
      // Where a slip road splits from or joins a carriageway the two run side by side for a while:
      // the ramp's own lines stop where it is clear of the highway and its paved corner, and the
      // highway keeps its lines through the node except the edge line on the ramp's side, which
      // opens up for the mouth.
      const mouthA = carriageway ? rampMouth(net, s, s.a) : null, mouthB = carriageway ? rampMouth(net, s, s.b) : null;
      const rampTrim = s.kind === KIND_RAMP ? trims.get(s.id) : undefined;
      const trimA = Math.max(rampTrim?.[0] || (mouthA ? 0.2 : net.degree(s.a) >= 3 ? Math.max(1.0, shallowClear(net, s, s.a)) : 0.2), (crossings.get(s.id)?.[0] ?? 0) + 0.23);
      const trimB = Math.max(rampTrim?.[1] || (mouthB ? 0.2 : net.degree(s.b) >= 3 ? Math.max(1.0, shallowClear(net, s, s.b)) : 0.2), (crossings.get(s.id)?.[1] ?? 0) + 0.23);
      const from = trimA;
      const to = s.len - trimB;
      if (to - from < 0.5) continue;
      if (customLanes(s, tapers)) { laneMarkings(net, s, from, to, tapers, b); continue; }
      const avenue = s.kind === KIND_AVENUE, highway = s.kind === KIND_HIGHWAY, lane = s.kind === KIND_LANE;
      const wide = avenue || highway;
      // Lane lines sit between carriageway lanes: two each way on an avenue, three on an expressway.
      const lanes = highway ? [0.44, 0.88] : [0.43];
      const divider = highway ? 0.1 : 0.07;
      const strip = (s0: number, s1: number, halfW: number, offset: number, color: number, y = 0.056): void => {
        const steps = Math.max(1, Math.ceil((s1 - s0) / 0.35));
        const arr = new Float32Array((steps + 1) * 2);
        for (let k = 0; k <= steps; k++) {
          Network.poseAt(s, s0 + ((s1 - s0) * k) / steps, pose);
          arr[k * 2] = pose.x - half;
          arr[k * 2 + 1] = pose.z - half;
        }
        b.ribbon(arr, steps + 1, halfW, y, color, offset);
      };
      if (s.parking) {
        // Parking lanes: a line along the edge of the traffic lanes, and the bays marked across.
        for (const side of [1, -1]) {
          const c = carriageHalf(s, side);
          strip(from, to, 0.012, side * c, WHITE, 0.057);
          // Bays counted from the road's start, so the parked cars (see parkedCars) sit between the lines.
          for (let d = Math.ceil(from / PARK_BAY) * PARK_BAY; d < to; d += PARK_BAY) strip(d, d + 0.018, PARK_W / 2 - 0.02, side * (c + PARK_W / 2), WHITE, 0.057);
        }
        this.marks.parkingBays++;
      }
      if (s.calm) {
        // Ladders of white bars across the carriageway read as a calmed street.
        const hw = HALF_WIDTH[s.kind];
        for (let d = from + 0.4; d + 0.25 < to; d += 1.5) {
          for (const off of [-hw * 0.55, 0, hw * 0.55]) strip(d, d + 0.25, hw * 0.3, off, WHITE);
        }
      }
      if (isCarriageway(s.kind) || s.kind === KIND_RAMP) {
        // Highway carriageways: solid edge lines, dashed lane lines, and arrows showing the flow.
        const edge = HALF_WIDTH[s.kind] - 0.06;
        // Each edge line stops short of a ramp mouth on its own side.
        for (const side of [1, -1]) {
          const openA = mouthA && s.kind !== KIND_RAMP && mouthA.side === side ? mouthA.length : 0;
          const openB = mouthB && s.kind !== KIND_RAMP && mouthB.side === side ? mouthB.length : 0;
          const f = Math.max(from, openA), t = Math.min(to, s.len - openB);
          if (t - f > 0.3) strip(f, t, 0.02, side * edge, side > 0 || s.kind === KIND_RAMP ? WHITE : LINE);
          // From the node to the gore's nose the ramp's traffic is still a lane of the carriageway: a
          // broken lane line there, where the edge line opens for the mouth.
          if (openA) { const nose = Math.min(openA, mouthNose(net, s, s.a)); for (let d = 0.1; d + 0.3 < nose; d += 0.55) strip(d, d + 0.3, 0.018, side * edge, WHITE); }
          if (openB) { const nose = Math.min(openB, mouthNose(net, s, s.b)); for (let d = 0.1; d + 0.3 < nose; d += 0.55) strip(s.len - d - 0.3, s.len - d, 0.018, side * edge, WHITE); }
          // A rumble strip along the shoulder outside the edge line (not on slip roads).
          if (t - f > 0.3 && s.kind !== KIND_RAMP && !s.structure && ++this.marks.rumbles) for (let d = f; d + 0.03 < t; d += 0.14) strip(d, d + 0.03, 0.018, side * (edge + 0.035), RUMBLE);
        }
        const laneLines = s.kind === KIND_MOTORWAY ? [-0.22, 0.22] : s.kind === KIND_HIGHWAY2 ? [0] : [];
        for (let d = from; d + 0.5 < to; d += 1.1) for (const l of laneLines) strip(d, d + 0.5, 0.018, l, WHITE);
        // A sparse set of arrows is enough to show the flow; a carpet of them just looks busy.
        for (let d = from + 1.2; d < to - 0.4; d += isCarriageway(s.kind) ? 7 : 4.5) {
          Network.poseAt(s, d, pose);
          for (const l of s.kind === KIND_MOTORWAY ? [-0.44, 0, 0.44] : s.kind === KIND_HIGHWAY2 ? [-0.25, 0.25] : [0]) b.arrow(pose.x - half - pose.tz * l, pose.z - half + pose.tx * l, pose.tx, pose.tz, 0.12, 0.057, WHITE);
        }
      } else if (s.oneway) {
        // (A roundabout's ring needs no arrows: everyone knows which way it goes.)
        const isRing = !!net.nodes.get(s.a)?.ring && !!net.nodes.get(s.b)?.ring;
        // A two-lane ring gets a broken line between its lanes.
        if (isRing && ringLaneCount(s) === 2) for (let d = 0.1; d + 0.35 < s.len; d += 0.7) strip(d, d + 0.35, 0.018, 0, WHITE);
        for (let d = from + 0.3; d < to && !isRing; d += 1.6) {
          Network.poseAt(s, d, pose);
          b.arrow(pose.x - half, pose.z - half, pose.tx, pose.tz, 0.2, 0.057, WHITE);
        }
        if (wide && !isRing) for (let d = from; d + 0.5 < to; d += 1.1) for (const l of lanes) { strip(d, d + 0.5, 0.018, l - 0.22, WHITE); strip(d, d + 0.5, 0.018, -(l - 0.22), WHITE); }
      } else if (wide) {
        // A divider down the middle, a dashed line between each pair of lanes, and an edge line
        // along the shoulder so an expressway reads as three lanes each way.
        // An avenue gets a raised, planted median, stopping short of each junction for its turn bay,
        // where the double yellow line carries on; an expressway gets a concrete barrier instead.
        const bayA = net.degree(s.a) >= 3 ? MEDIAN_BAY : 0, bayB = net.degree(s.b) >= 3 ? MEDIAN_BAY : 0;
        const m0 = from + bayA, m1 = to - bayB;
        if (avenue && m1 - m0 > 0.6) {
          strip(m0, m1, divider + 0.02, 0, CURB, 0.062);
          strip(m0 + 0.04, m1 - 0.04, divider - 0.005, 0, MEDIAN_GRASS, 0.07);
          for (const [a, c] of [[from, m0], [m1, to]]) if (c - a > 0.05) { strip(a, c, 0.022, -divider, LINE); strip(a, c, 0.022, divider, LINE); }
          this.marks.medians++;
        } else if (!highway || s.structure) {
          // (An expressway on a bridge has no barrier on the deck: it keeps its double line.)
          strip(from, to, 0.022, -divider, LINE);
          strip(from, to, 0.022, divider, LINE);
        }
        for (let d = from; d + 0.5 < to; d += 1.1) for (const l of lanes) {
          strip(d, d + 0.5, 0.018, l, WHITE);
          strip(d, d + 0.5, 0.018, -l, WHITE);
        }
        const shoulder = HALF_WIDTH[s.kind] - 0.07;
        strip(from, to, 0.02, shoulder, WHITE);
        strip(from, to, 0.02, -shoulder, WHITE);
        // An expressway's shoulders get rumble strips outside the edge lines.
        if (highway && !s.structure && (this.marks.rumbles += 2)) for (let d = from; d + 0.03 < to; d += 0.14) for (const side of [1, -1]) strip(d, d + 0.03, 0.018, side * (shoulder + 0.038), RUMBLE);
      } else if (lane) {
        // A lane is a single shared carriageway: no centre line, just a worn edge.
        for (let d = from; d + 0.2 < to; d += 1.4) strip(d, d + 0.2, 0.016, 0, DASH);
      } else {
        for (let d = from; d + 0.3 < to; d += 0.8) strip(d, d + 0.3, 0.022, 0, DASH);
      }
    }

    b.heightAt = null;
    turnArrows(net, b, crossings);
    // Stop lines, give-way teeth and solid approach lines, from the same junction rules the traffic obeys.
    const { yieldSpots } = junctionPaint(net, crossings, b, (s) => { b.heightAt = s.structure ? (x, z) => roadHeight(s, Network.nearestOn(s, x + half, z + half).s) : null; }, this.marks);
    b.heightAt = null;
    const chevronAt = chevronSpots(net, this.marks);
    // Crossings belong to ordinary junctions, whether signalized or uncontrolled.
    for (const [id, ends] of crossings) {
      const seg = net.segs.get(id)!;
      for (let end = 0; end < 2; end++) {
        if (!ends[end]) continue;
        Network.poseAt(seg, end === 0 ? ends[end] : seg.len - ends[end], pose);
        const hwR = sideHalf(seg, 1), hwL = sideHalf(seg, -1), x = pose.x - half, z = pose.z - half;
        const stripes = Math.max(2, Math.floor((hwR + hwL - 0.12) / 0.18));
        const spacing = (hwR + hwL - 0.12) / stripes;
        for (let i = 0; i < stripes; i++) {
          const across = (i - (stripes - 1) / 2) * spacing + (hwR - hwL) / 2;
          const px = x - pose.tz * across, pz = z + pose.tx * across;
          b.ribbon([px - pose.tx * 0.17, pz - pose.tz * 0.17, px + pose.tx * 0.17, pz + pose.tz * 0.17], 2, spacing * 0.28, 0.06, WHITE);
        }
        // The kerb dips to a ramp at each end, with a strip of yellow tactile paving.
        for (const side of [1, -1]) {
          const off = side > 0 ? hwR + 0.045 : -(hwL + 0.045), px = x - pose.tz * off, pz = z + pose.tx * off;
          b.ribbon([px - pose.tx * 0.15, pz - pose.tz * 0.15, px + pose.tx * 0.15, pz + pose.tz * 0.15], 2, 0.038, 0.036, TACTILE);
          this.marks.ramps++;
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
      if (isCarriageway(kind)) { b.ribbon(far, 2, 0.02, 0.056, WHITE, hw - 0.06); b.ribbon(far, 2, 0.02, 0.056, WHITE, -(hw - 0.06)); }
      else { b.ribbon(far, 2, 0.02, 0.056, LINE, -0.045); b.ribbon(far, 2, 0.02, 0.056, LINE, 0.045); }
      // A sign greets traffic coming in: beside the road on the verge, never on the carriageway.
      const inbound = !seg?.oneway || seg.a === entry.id;
      if (!inbound || signs >= this.signs.length) continue;
      const sign = this.signs[signs++];
      const off = hw + 0.95;
      // On the verge to the right of the traffic, unless another carriageway runs there, in which
      // case it stands on the outside of the pair instead of in the median.
      const spot = (side: number, back: number): { x: number; z: number } => ({ x: e.x + e.dx * back - e.dz * off * side, z: e.z + e.dz * back + e.dx * off * side });
      const clear = (q: { x: number; z: number }): boolean => !net.onRoad(q.x, q.z, -1, 0.15);
      // Try the right verge, then the left, a little further in each time, and give up rather than
      // plant the sign in a slip road.
      let at: { x: number; z: number } | null = null;
      for (let back = 1.5; back <= 6 && !at; back += 1.5) for (const side of [1, -1]) if (!at && clear(spot(side, back))) at = spot(side, back);
      if (!at) { signs--; continue; }
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
        const spot = net.vergeSpot(seg, node.id, sideHalf(seg, seg.b === node.id ? 1 : -1) + 0.2, Math.min(1.0, seg.len * 0.4));
        if (!spot) continue;
        const { tx, tz } = spot;
        v3.set(spot.x - half, Math.max(0, levelY(node.level ?? 0)), spot.z - half);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-tx, -tz));
        m4.compose(v3, q, one);
        this.stopSigns.setMatrixAt(signCount++, m4);
      }
    }
    this.stopSigns.count = signCount;
    this.stopSigns.instanceMatrix.needsUpdate = true;
    // Yield signs beside every give-way line, and chevrons round tight curves, facing the traffic.
    const place = (mesh: THREE.InstancedMesh, spots: SignSpot[], face: (tx: number, tz: number) => number): void => {
      let k = 0;
      for (const spot of spots) {
        if (k >= MAX_LAMPS) break;
        // On the ground, or on the deck of the very road it belongs to (never a bridge passing nearby).
        const y = spot.seg && spot.seg.structure === 1 ? Math.max(0, roadHeight(spot.seg, spot.s ?? 0)) : 0;
        v3.set(spot.x - half, y, spot.z - half);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), face(spot.tx, spot.tz));
        m4.compose(v3, q, one);
        mesh.setMatrixAt(k++, m4);
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(this.yieldSigns, yieldSpots, (tx, tz) => Math.atan2(-tx, -tz));
    // A sign for each banned turn on the right-hand verge of the road it is banned from, a little way
    // back from the junction; several on one road stand one behind another.
    const banSpots: Record<'Left' | 'Straight' | 'Right', SignSpot[]> = { Left: [], Straight: [], Right: [] };
    for (const node of net.nodes.values()) {
      if (!node.bans?.length) continue;
      const bans = new Set(node.bans);
      const perArm = new Map<string, number>();
      for (const m of allTurns(net, node.id)) {
        if (!bans.has(m.key)) continue;
        const seg = net.segs.get(m.inSeg);
        if (!seg) continue;
        const arm = `${m.inSeg}${m.inFwd}`, k = perArm.get(arm) ?? 0;
        perArm.set(arm, k + 1);
        const spot = net.vergeSpot(seg, node.id, sideHalf(seg, m.inFwd ? 1 : -1) + 0.2, Math.min(1.4 + k * 0.35, seg.len * 0.6));
        if (spot) { banSpots[turnName(m)].push({ ...spot, seg, s: m.inFwd ? seg.len - 1.4 : 1.4 }); this.marks.banSigns++; }
      }
    }
    for (const turn of ['Left', 'Straight', 'Right'] as const) place(this.banSigns[turn], banSpots[turn], (tx, tz) => Math.atan2(-tx, -tz));
    place(this.chevrons, chevronAt, (tx, tz) => Math.atan2(tx, tz));

    // Traffic signals: a head on a pole on the right-hand side at the stop line, and where two or more
    // lanes arrive, a mast arm over the road with a head above each lane showing that lane's own state.
    this.lampInfo = [];
    let n = 0, h = 0, armCount = 0;
    q.identity();
    const lensAt = (x: number, y0: number, z: number): void => {
      for (let lens = 0; lens < 3; lens++) {
        v3.set(x, y0 + (0.84 - lens * 0.12) * 0.72, z); m4.compose(v3, q, one);
        this.lamps.setMatrixAt(h * 3 + lens, m4);
      }
    };
    for (const node of net.nodes.values()) {
      if (!node.light || net.degree(node.id) < 3) continue;
      const plan = planFor(net, node.id), moves = movements(net, node.id);
      if (!plan.phases.length) continue;
      for (const s of net.segsAt(node.id)) {
        // A road that only leaves the junction has no traffic to control, so no head faces it.
        if (!moves.some(m => m.inSeg === s.id && m.inFwd === (s.b === node.id))) continue;
        if (h >= MAX_LAMPS) break; // every head, on a pole or an arm, takes three lenses
        const spot = net.vergeSpot(s, node.id, sideHalf(s, s.b === node.id ? 1 : -1) + 0.16, Math.min(1.0, s.len * 0.4));
        if (!spot) continue;
        const { tx, tz } = spot;
        const ground = Math.max(0, levelY(node.level ?? 0));
        v3.set(spot.x - half, ground, spot.z - half);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tx, tz));
        m4.compose(v3, q, one);
        this.poles.setMatrixAt(n, m4);
        lensAt(spot.x - half, ground, spot.z - half);
        const fwd = s.b === node.id;
        this.lampInfo.push({ node: node.id, plan, keys: moves.filter(m => m.inSeg === s.id && m.inFwd === fwd).map(m => m.key) });
        n++; h++;
        // The mast arm: from the pole out over every arriving lane, a head centred over each.
        const lanes = lanesFor(net, s, fwd);
        if (lanes < 2 || h + lanes > MAX_LAMPS || armCount >= MAX_LAMPS) continue;
        const back = Math.min(1.0, s.len * 0.4);
        Network.poseAt(s, fwd ? s.len - back : back, pose);
        const dx = fwd ? pose.tx : -pose.tx, dz = fwd ? pose.tz : -pose.tz, rx = -dz, rz = dx;
        const serve = approachLanes(net, node.id, s, fwd);
        let far = Infinity;
        for (let lane = 0; lane < lanes; lane++) {
          const off = laneCentre(net, s, fwd, lane);
          far = Math.min(far, off);
          const hx = pose.x - half + rx * off, hz = pose.z - half + rz * off;
          v3.set(hx, ground + 0.62, hz); m4.compose(v3, q, one);
          this.heads.setMatrixAt(h - n, m4);
          lensAt(hx, ground + 0.12, hz);
          const keys = [...new Set((serve.serve[lane] ?? []).map(e => moveKey(s.id, fwd, serve.exits[e].seg, serve.exits[e].fwd)))];
          this.lampInfo.push({ node: node.id, plan, keys: keys.length ? keys : this.lampInfo[h - 1].keys });
          h++;
        }
        // The arm runs from the pole across to beyond the furthest lane's head.
        const px = spot.x - half, pz = spot.z - half, qx = pose.x - half + rx * (far - 0.12), qz = pose.z - half + rz * (far - 0.12);
        const len = Math.hypot(qx - px, qz - pz);
        v3.set(px, ground, pz);
        const armQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(qz - pz), qx - px));
        m4.compose(v3, armQ, new THREE.Vector3(len, 1, 1));
        this.arms.setMatrixAt(armCount++, m4);
      }
    }
    this.poles.count = n;
    this.heads.count = h - n;
    this.arms.count = armCount;
    this.lamps.count = h * 3;
    for (const m of [this.poles, this.heads, this.arms, this.lamps]) m.instanceMatrix.needsUpdate = true;
    // Pedestrian heads at both ends of every signalled crossing, facing the people waiting across.
    this.pedInfo = [];
    let p = 0;
    for (const [id, ends] of crossings) {
      const seg = net.segs.get(id)!;
      for (let end = 0; end < 2; end++) {
        const nodeId = end ? seg.b : seg.a, node = net.nodes.get(nodeId);
        if (!ends[end] || !node?.light || p + 2 > MAX_LAMPS) continue;
        const plan = planFor(net, nodeId);
        if (!plan.phases.length) continue;
        const from = crossingFrom(plan, seg.id, end as 0 | 1);
        const hwR = sideHalf(seg, 1), hwL = sideHalf(seg, -1);
        Network.poseAt(seg, end ? seg.len - ends[end] : ends[end], pose);
        for (const side of [1, -1]) {
          // Beside the crossing, on the side away from the junction, clear of the people waiting on it.
          const off = side > 0 ? hwR + 0.16 : -(hwL + 0.16), back = (end ? -1 : 1) * 0.26;
          v3.set(pose.x - half - pose.tz * off + pose.tx * back, Math.max(0, levelY(node.level ?? 0)), pose.z - half + pose.tx * off + pose.tz * back);
          // Facing across the road, towards the far kerb, where people waiting on this side look.
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-pose.tz * side, pose.tx * side));
          m4.compose(v3, q, one);
          this.pedHeads.setMatrixAt(p, m4); this.pedLamps.setMatrixAt(p, m4);
          this.pedInfo.push({ node: nodeId, plan, from, crossTime: (hwR + hwL + 0.1) / 0.3 });
          p++;
        }
      }
    }
    this.pedHeads.count = this.pedLamps.count = p;
    this.marks.pedHeads = p;
    this.pedHeads.instanceMatrix.needsUpdate = true; this.pedLamps.instanceMatrix.needsUpdate = true;
    this.updateLights(0);
  }

  /**
   * Light each signal head from its junction's clock (node id, phase, time and green length, four
   * numbers per signal, as the simulation sends them), or from the fixed timeline until it has.
   * A head shows the most permissive state of the movements it controls.
   */
  updateLights(simTime: number, clocks?: Float32Array | null, wall = simTime): void {
    const clock = new Map<number, { phase: number; t: number; len: number }>();
    if (clocks) for (let k = 0; k + 3 < clocks.length; k += 4) clock.set(clocks[k], { phase: clocks[k + 1], t: clocks[k + 2], len: clocks[k + 3] });
    const rank: Record<SignalState, number> = { red: 0, amber: 1, yield: 2, green: 3 };
    for (let i = 0; i < this.lampInfo.length; i++) {
      const l = this.lampInfo[i];
      const c = clock.get(l.node) ?? fixedClock(l.plan, simTime + l.node * 3.7);
      let best: SignalState = 'red';
      for (const key of l.keys) { const st = stateIn(l.plan, c.phase, c.t, c.len, key); if (rank[st] > rank[best]) best = st; }
      // A turn that may go but must give way shows a flashing amber, not a green that looks protected.
      // Flashing by the wall clock, so a paused city's yield heads still flash instead of freezing dark.
      const flash = best === 'yield', lit = Math.floor(wall * 1.6) % 2 === 0;
      this.lamps.setColorAt(i * 3, best === 'red' ? LAMP_RED : LAMP_OFF);
      this.lamps.setColorAt(i * 3 + 1, best === 'amber' || (flash && lit) ? LAMP_AMBER : LAMP_OFF);
      this.lamps.setColorAt(i * 3 + 2, best === 'green' ? LAMP_GREEN : LAMP_OFF);
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
    // Walk, flashing don't-walk, don't-walk.
    for (let i = 0; i < this.pedInfo.length; i++) {
      const info = this.pedInfo[i];
      const c = clock.get(info.node) ?? fixedClock(info.plan, simTime + info.node * 3.7);
      const st = crossingState(info.plan, c.phase, c.t, c.len, info.from, info.crossTime);
      this.pedLamps.setColorAt(i, st === 'walk' ? WALK : st === 'stop' || Math.floor(wall * 2) % 2 === 0 ? DONT_WALK : PED_OFF);
    }
    if (this.pedLamps.instanceColor) this.pedLamps.instanceColor.needsUpdate = true;
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
 * Crash protection on the fast roads: a concrete barrier down the middle of every two-way expressway,
 * and guardrails on posts along the outer edges of expressways, motorway carriageways and slip roads.
 * They stop short of junctions and open for ramp mouths; bridges have their own parapets.
 */
/** How far along `seg` from `node` the other roads meeting there, and the kerbed corners between them, reach. */
/**
 * Where another arm leaves a junction at a shallow angle to this one (a road splitting in two, an exit
 * peeling off), how far along this one the two carriageways still overlap, so its lines stop there
 * instead of running across the other's; 0 where every arm meets it at a proper angle.
 */
function shallowClear(net: Network, seg: RSeg, node: number): number {
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  const dir = (s: RSeg): [number, number] => { Network.poseAt(s, s.a === node ? 0 : s.len, p); const k = s.a === node ? 1 : -1; return [p.tx * k, p.tz * k]; };
  const [tx, tz] = dir(seg);
  const shallow = net.segsAt(node).some(o => {
    if (o === seg) return false;
    const [ox, oz] = dir(o);
    return tx * ox + tz * oz > 0 && Math.abs(tx * oz - tz * ox) < 0.57;
  });
  return shallow ? junctionClear(net, seg, node) : 0;
}

function junctionClear(net: Network, seg: RSeg, node: number): number {
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  const dir = (s: RSeg): [number, number] => { Network.poseAt(s, s.a === node ? 0 : s.len, p); const k = s.a === node ? 1 : -1; return [p.tx * k, p.tz * k]; };
  const [tx, tz] = dir(seg), hw = roadHalf(seg);
  let reach = 0, widest = 0;
  for (const o of net.segsAt(node)) {
    widest = Math.max(widest, roadHalf(o));
    if (o === seg) continue;
    const [ox, oz] = dir(o), dot = tx * ox + tz * oz, cross = Math.abs(tx * oz - tz * ox);
    if (dot < -0.98) continue; // the road carrying straight on
    reach = Math.max(reach, cross < 0.18 ? roadHalf(o) + hw : (roadHalf(o) + hw * Math.abs(dot)) / cross);
  }
  return reach + 0.35 + 0.45 * widest + 0.1;
}

function roadsideSafety(net: Network, d: Builder, marks: JunctionMarks): void {
  const half = GRID / 2, p = { x: 0, z: 0, tx: 0, tz: 0 }, trims = rampTrims(net);
  for (const s of net.segs.values()) {
    if (s.structure || !(s.kind === KIND_HIGHWAY || isCarriageway(s.kind) || s.kind === KIND_RAMP)) continue;
    if (net.nodes.get(s.a)?.ring && net.nodes.get(s.b)?.ring) continue; // not round a roundabout
    // Beyond the map edge (the motorway's approaches) nobody sees them.
    if (s.maxX < -1 || s.minX > GRID + 1 || s.maxZ < -1 || s.minZ > GRID + 1) continue;
    const ramp = s.kind === KIND_RAMP, rt = ramp ? trims.get(s.id) : undefined;
    // Clear of every road crossing at the junction, and of its corner kerbs.
    const endTrim = (node: number, t: number | undefined): number => t || (net.degree(node) >= 3 ? junctionClear(net, s, node) : 0.05);
    const mouthA = !ramp ? rampMouth(net, s, s.a) : null, mouthB = !ramp ? rampMouth(net, s, s.b) : null;
    const run = (s0: number, s1: number, off: number, y: number, t: number, color: number, posts: boolean): boolean => {
      if (s1 - s0 < 0.6) return false;
      const steps = Math.max(1, Math.ceil((s1 - s0) / 1.0));
      let px = 0, pz = 0;
      for (let k = 0; k <= steps; k++) {
        Network.poseAt(s, s0 + ((s1 - s0) * k) / steps, p);
        const x = p.x - p.tz * off - half, z = p.z + p.tx * off - half;
        if (k > 0) d.beam(px, y, pz, x, y, z, t, color);
        if (posts) d.box(0.018, y - 0.02, 0.018, x, 0.03, z, 0x8b9196);
        px = x; pz = z;
      }
      return true;
    };
    for (const side of [1, -1]) {
      const openA = mouthA && mouthA.side === side ? mouthA.length : 0, openB = mouthB && mouthB.side === side ? mouthB.length : 0;
      const s0 = Math.max(endTrim(s.a, rt?.[0]), openA), s1 = s.len - Math.max(endTrim(s.b, rt?.[1]), openB);
      if (run(s0, s1, side * (sideHalf(s, side) + 0.08), 0.085, 0.016, 0xc9cdd0, true)) marks.guardrails++;
    }
    // The barrier stops short of a roundabout, where the splitter island takes over.
    const barrierTrim = (node: number): number => net.nodes.get(node)?.ring ? 3.6 : endTrim(node, undefined);
    if (s.kind === KIND_HIGHWAY && !s.oneway && run(barrierTrim(s.a), s.len - barrierTrim(s.b), 0, 0.055, 0.05, 0xbdbdb5, false)) marks.barriers++;
  }
}

/**
 * A splitter island up every two-way road into a roundabout: a raised, kerbed, grassed wedge between
 * the lanes going in and coming out, widest at the ring and tapering to a point up the arm, narrow
 * enough to stay clear of both lanes' traffic. Returns how many it laid.
 */
function splitterIslands(net: Network, b: MeshBuilder): number {
  const half = GRID / 2, rings = net.roundabouts();
  let count = 0;
  for (const n of net.nodes.values()) {
    if (!n.ring) continue;
    const rb = rings.find(o => Math.abs(Math.hypot(n.x - o.x, n.z - o.z) - o.r) < 0.15);
    if (!rb) continue;
    let ringHw = 0;
    for (const s of net.segsAt(n.id)) if (net.nodes.get(s.a === n.id ? s.b : s.a)!.ring) ringHw = Math.max(ringHw, HALF_WIDTH[s.kind]);
    for (const s of net.segsAt(n.id)) {
      if (s.oneway || s.structure || net.nodes.get(s.a === n.id ? s.b : s.a)!.ring) continue;
      // Clear of the inner lanes' cars on both sides.
      const inner = Math.min(Math.abs(laneCentre(net, s, true, lanesFor(net, s, true) - 1)), Math.abs(laneCentre(net, s, false, lanesFor(net, s, false) - 1)));
      const w0 = Math.max(0.03, Math.min(0.16, inner - 0.13));
      // From just behind the give-way line (which runs up to it) back up the arm.
      const start = Math.max(ringHw + 0.1, stopLine(net, n.id) + 0.05), len = Math.min(2.2, s.len * 0.4 - start);
      if (len < 0.5) continue;
      const k = s.a === n.id ? 1 : s.n - 1, e = s.a === n.id ? 0 : s.n;
      let ux = s.pts[k * 2] - s.pts[e * 2], uz = s.pts[k * 2 + 1] - s.pts[e * 2 + 1];
      const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const rx = -uz, rz = ux, bx = n.x + ux * start - half, bz = n.z + uz * start - half;
      const tip = [bx + ux * len, bz + uz * len];
      const outline = [bx + rx * w0, bz + rz * w0, bx + rx * w0 * 0.6 + ux * len * 0.35, bz + rz * w0 * 0.6 + uz * len * 0.35, tip[0], tip[1],
        bx - rx * w0 * 0.6 + ux * len * 0.35, bz - rz * w0 * 0.6 + uz * len * 0.35, bx - rx * w0, bz - rz * w0];
      b.fan(bx + ux * len * 0.3, bz + uz * len * 0.3, [...outline, outline[0], outline[1]], 6, 0.068, MEDIAN_GRASS);
      b.ribbon([...outline, outline[0], outline[1]], 6, 0.014, 0.07, CURB);
      count++;
    }
  }
  return count;
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
  // (On the ground, or both up on the same deck: a tunnel's roads are out of sight.)
  const others = net.segsAt(node).filter(o => o.id !== seg.id && (isCarriageway(o.kind) || o.kind === KIND_RAMP) && o.structure === seg.structure && o.structure !== 2);
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
  // A ramp is measured along its whole chain of pieces, since its first piece may end while it is
  // still alongside the carriageway; a carriageway only along this one piece.
  const walk = seg.kind === KIND_RAMP;
  let piece = seg, from = node, offset = 0, length = 0.2, side = 1;
  for (let d = 0.2; d < 12; d += 0.2) {
    while (d - offset > piece.len) {
      const far = piece.a === from ? piece.b : piece.a, next = net.segsAt(far).filter(o => o.id !== piece.id);
      if (!walk || next.length !== 1 || next[0].kind !== KIND_RAMP) break;
      offset += piece.len; piece = next[0]; from = far;
    }
    const along = d - offset;
    if (along > piece.len - (walk ? 0 : 0.2)) break;
    Network.poseAt(piece, piece.a === from ? along : piece.len - along, pose);
    const hit = Network.nearestOn(otherSeg, pose.x, pose.z);
    // Which side the other road's nearest point falls on, relative to this road's direction of travel.
    const cross = (hit.x - pose.x) * pose.tz - (hit.z - pose.z) * pose.tx;
    // (The pose's direction is always a → b, whichever end the walk started from.)
    if (piece === seg) side = cross > 0 ? -1 : 1;
    length = d;
    if (hit.dist > clearance) break;
  }
  return { length: walk ? length + 0.3 : Math.min(length + 0.3, seg.len * 0.6), side };
}

/**
 * The gore's nose where a ramp leaves or joins carriageway `road` at `node`: how far out from the
 * node the ramp's near edge leaves the carriageway's own edge (its kerb before any lane was added).
 * Up to there the ramp's traffic is still in a lane of the carriageway, beside the others.
 */
function rampNose(net: Network, ramp: RSeg, road: RSeg, node: number): number {
  const p = { x: 0, z: 0, tx: 0, tz: 0 }, n = net.nodes.get(node)!, fromA = ramp.a === node, roadFromA = road.a === node;
  Network.poseAt(ramp, fromA ? Math.min(1, ramp.len) : Math.max(0, ramp.len - 1), p);
  const rx = p.x - n.x, rz = p.z - n.z;
  // Which side of the carriageway (seen heading away from the node) the ramp goes off to.
  Network.poseAt(road, roadFromA ? Math.min(0.5, road.len) : Math.max(0, road.len - 0.5), p);
  const gx = roadFromA ? p.tx : -p.tx, gz = roadFromA ? p.tz : -p.tz, off = (-gz * rx + gx * rz) > 0 ? 1 : -1;
  for (let d = 0; d < Math.min(ramp.len, 8); d += 0.05) {
    Network.poseAt(ramp, fromA ? d : ramp.len - d, p);
    const tx = fromA ? p.tx : -p.tx, tz = fromA ? p.tz : -p.tz;
    // The ramp's edge on the carriageway's side: the other side from the way the ramp goes off.
    const side = -off;
    const ex = p.x - tz * HALF_WIDTH[KIND_RAMP] * side, ez = p.z + tx * HALF_WIDTH[KIND_RAMP] * side;
    if (Network.nearestOn(road, ex, ez).dist >= HALF_WIDTH[road.kind] - 0.01) return d;
  }
  return Math.min(ramp.len, 8);
}

/**
 * The ramp's own lane carried round into the ramp: where the carriageway was widened for it (the piece
 * before an exit, or after an entrance), its outer kerb runs on straight past the node until it meets
 * the ramp's outer edge, and the ground between is paved, so the lane flows into the ramp with no step.
 */
function rampMouthFill(net: Network, ramp: RSeg, road: RSeg, node: number, b: MeshBuilder): void {
  const shape = rampMouthShape(net, ramp, road, node);
  if (!shape) return;
  const half = GRID / 2;
  const outer = shape.outer.map(v => v - half), inner = shape.inner.map(v => v - half);
  const count = outer.length / 2;
  if (count < 3) return;
  const pts = [...outer];
  for (let k = count - 1; k >= 0; k--) pts.push(inner[k * 2], inner[k * 2 + 1]);
  let mx = 0, mz = 0;
  for (let k = 0; k < pts.length; k += 2) { mx += pts[k]; mz += pts[k + 1]; }
  mx /= pts.length / 2; mz /= pts.length / 2;
  // (A fan joins each point to the next: back to the first, to close it across the node.)
  pts.push(pts[0], pts[1]);
  b.fan(mx, mz, pts, pts.length / 2, 0.045, ASPHALT);
  // The kerb along the widened edge, carried on to where it meets the ramp's.
  const kerb: number[] = [];
  for (let k = 0; k < count; k++) {
    const x = outer[k * 2], z = outer[k * 2 + 1], cx = inner[k * 2], cz = inner[k * 2 + 1];
    const dl = Math.hypot(x - cx, z - cz) || 1;
    kerb.push(x + ((x - cx) / dl) * 0.045, z + ((z - cz) / dl) * 0.045);
  }
  b.ribbon(kerb, count, 0.045, 0.031, CURB);
  // And its edge line, carried round the same way.
  const line: number[] = [];
  for (let k = 0; k < count; k++) {
    const x = outer[k * 2], z = outer[k * 2 + 1], cx = inner[k * 2], cz = inner[k * 2 + 1];
    const dl = Math.hypot(x - cx, z - cz) || 1;
    line.push(x - ((x - cx) / dl) * 0.06, z - ((z - cz) / dl) * 0.06);
  }
  b.ribbon(line, count, 0.02, 0.056, WHITE);
}

/** The gore's nose along carriageway `road` from `node`, for the ramp meeting it there (0 if none). */
function mouthNose(net: Network, road: RSeg, node: number): number {
  const ramp = net.segsAt(node).find(o => o.kind === KIND_RAMP);
  return ramp ? rampNose(net, ramp, road, node) : 0;
}


/** How far the paved corner at a ramp's mouth reaches along the ramp past the point where it is clear of the carriageway. */
const MOUTH_CORNER = 1.2;

/**
 * Where each ramp piece's own lines start and stop: nothing is drawn while the ramp is still in a
 * carriageway's mouth or its paved corner, even when that runs on through a joint into the next piece.
 */
function rampTrims(net: Network): Map<number, [number, number]> {
  const trims = new Map<number, [number, number]>();
  for (const ramp of net.segs.values()) {
    if (ramp.kind !== KIND_RAMP || ramp.structure === 2) continue;
    for (const node of [ramp.a, ramp.b]) {
      const mouth = rampMouth(net, ramp, node);
      if (!mouth) continue;
      let reach = mouth.length + MOUTH_CORNER, piece = ramp, from = node;
      while (reach > 0) {
        let t = trims.get(piece.id);
        if (!t) { t = [0, 0]; trims.set(piece.id, t); }
        const end = piece.a === from ? 0 : 1;
        t[end] = Math.max(t[end], Math.min(piece.len, reach));
        reach -= piece.len;
        const far = piece.a === from ? piece.b : piece.a, next = net.segsAt(far).filter(o => o.id !== piece.id);
        if (reach <= 0 || next.length !== 1 || next[0].kind !== KIND_RAMP) break;
        piece = next[0]; from = far;
      }
    }
  }
  return trims;
}

/**
 * Curved kerb corners at every junction and bend: where two arms meet at an angle, the wedge between
 * their kerbs is paved and the corner rounded off, instead of two square road ends poking into a disc.
 */
/** A segment's edge on one side, or the other, where it meets a node: `pick` chooses between them. */
function nodeEdge(s: RSeg, node: number, tapers: Tapers, pick: (a: number, b: number) => number): number {
  const d = s.a === node ? 0 : s.len;
  return pick(edgeAt(s, 1, d, tapers), edgeAt(s, -1, d, tapers));
}

/**
 * Markings for a road whose lanes were added or taken away, laid out from its own lanes: the centre
 * line of its kind, a dashed line between lanes running the same way, edge lines that follow the
 * kerb into any taper, and arrows in each lane of a one-way road. Lane lines stop where a lane is
 * still opening out or closing up.
 */
function laneMarkings(net: Network, s: RSeg, from: number, to: number, tapers: Tapers, b: MeshBuilder): void {
  const half = GRID / 2;
  const strip = (s0: number, s1: number, halfW: number, off: (d: number) => number, color: number): void => {
    const steps = Math.max(1, Math.ceil((s1 - s0) / 0.35));
    const arr = new Float32Array((steps + 1) * 2), lo = new Float32Array(steps + 1), hi = new Float32Array(steps + 1);
    for (let k = 0; k <= steps; k++) {
      const d = s0 + ((s1 - s0) * k) / steps;
      Network.poseAt(s, d, pose);
      arr[k * 2] = pose.x - half;
      arr[k * 2 + 1] = pose.z - half;
      const o = off(d);
      lo[k] = halfW - o; hi[k] = o + halfW;
    }
    b.band(arr, steps + 1, lo, hi, 0.056, color);
  };
  const t = tapers.get(s.id), len = taperLength(s);
  const tapA = t && (!Number.isNaN(t[0]) || !Number.isNaN(t[1])) ? len : 0;
  const tapB = t && (!Number.isNaN(t[2]) || !Number.isNaN(t[3])) ? len : 0;
  const lf = Math.max(from, tapA), lt = Math.min(to, s.len - tapB);
  const dashes = (off: number): void => { for (let d = lf; d + 0.5 < lt; d += 1.1) strip(d, d + 0.5, 0.018, () => off, WHITE); };
  // Lines between neighbouring lanes going the same way, in the a→b frame.
  for (const fwd of [true, false]) {
    const n = lanesFor(net, s, fwd);
    for (let k = 1; k < n; k++) {
      const between = (laneCentre(net, s, fwd, k - 1) + laneCentre(net, s, fwd, k)) / 2;
      dashes(fwd ? between : -between);
    }
  }
  const highway = isCarriageway(s.kind) || s.kind === KIND_RAMP;
  const wide = s.kind === KIND_AVENUE || s.kind === KIND_HIGHWAY;
  if (s.calm) {
    const hw = roadHalf(s);
    for (let d = from + 0.4; d + 0.25 < to; d += 1.5) for (const off of [-hw * 0.55, 0, hw * 0.55]) strip(d, d + 0.25, hw * 0.3, () => off, WHITE);
  }
  if (highway || wide) {
    // Edge lines, following the kerb in and out of a taper.
    const inset = highway ? 0.06 : 0.07;
    strip(from, to, 0.02, (d) => edgeAt(s, 1, d, tapers) - inset, WHITE);
    strip(from, to, 0.02, (d) => -(edgeAt(s, -1, d, tapers) - inset), highway && s.kind !== KIND_RAMP ? LINE : WHITE);
  }
  if (!oneWay(s)) {
    if (wide) {
      const divider = s.kind === KIND_HIGHWAY ? 0.1 : 0.07;
      strip(from, to, 0.022, () => -divider, LINE);
      strip(from, to, 0.022, () => divider, LINE);
    } else {
      for (let d = from; d + 0.3 < to; d += 0.8) strip(d, d + 0.3, 0.022, () => 0, DASH);
    }
  } else {
    // An arrow in every lane, sparser on a highway.
    const n = lanesFor(net, s, true);
    for (let d = from + 1.2; d < to - 0.4; d += highway ? 7 : 4.5) {
      Network.poseAt(s, d, pose);
      for (let i = 0; i < n; i++) {
        const l = laneCentre(net, s, true, i);
        b.arrow(pose.x - half - pose.tz * l, pose.z - half + pose.tx * l, pose.tx, pose.tz, 0.12, 0.057, WHITE);
      }
    }
  }
}

/**
 * Turn arrows painted in each lane of an approach to a junction, a little before the stop line: one
 * arrow for each way that lane may go, bent towards its turn, so a driver (and the player) can see
 * which lane to be in. Only where there is more than one lane to choose from.
 */
function turnArrows(net: Network, b: MeshBuilder, crossings: Map<number, [number, number]>): void {
  const half = GRID / 2;
  for (const node of net.nodes.values()) {
    if (node.ring || net.degree(node.id) < 3) continue;
    for (const s of net.segsAt(node.id)) {
      if (s.structure) continue;
      const fwd = s.b === node.id;
      if (oneWay(s) && !fwd) continue;
      const n = lanesFor(net, s, fwd);
      if (n < 2) continue;
      const back = (crossings.get(s.id)?.[fwd ? 1 : 0] ?? 0.9) + 0.95;
      if (back > s.len * 0.6) continue;
      const a = approachLanes(net, node.id, s, fwd);
      Network.poseAt(s, fwd ? s.len - back : back, pose);
      const tx = fwd ? pose.tx : -pose.tx, tz = fwd ? pose.tz : -pose.tz;
      for (let i = 0; i < n; i++) {
        const off = laneCentre(net, s, fwd, i), x = pose.x - tz * off - half, z = pose.z + tx * off - half;
        for (const e of a.serve[i]) {
          const angle = a.exits[e].angle, bend = angle > 0.35 ? 0.65 : angle < -0.35 ? -0.65 : 0;
          const c = Math.cos(bend), sn = Math.sin(bend);
          // Turned towards the right of travel for a positive bend.
          b.arrow(x, z, tx * c - tz * sn, tz * c + tx * sn, 0.11, 0.058, WHITE);
        }
      }
    }
  }
}

function junctionFillets(net: Network, b: MeshBuilder, tapers: Tapers): void {
  const half = GRID / 2;
  const curve = new Float32Array(11 * 2);
  const kp = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const n of net.nodes.values()) {
    if (n.ring) continue;
    const arms = net.segsAt(n.id);
    if (arms.length < 2) continue;
    /** A point on an arm's left (+1) or right (-1) kerb `d` along it from the node, with the kerb's direction away from the node. */
    const kerbAt = (arm: { s: RSeg; hwP: number; hwM: number }, side: number, d: number): { x: number; z: number; tx: number; tz: number } => {
      const fromA = arm.s.a === n.id, at = Math.max(0, Math.min(arm.s.len, fromA ? d : arm.s.len - d));
      Network.poseAt(arm.s, at, kp);
      const tx = fromA ? kp.tx : -kp.tx, tz = fromA ? kp.tz : -kp.tz;
      const hw = side > 0 ? arm.hwP : arm.hwM;
      return { x: kp.x - tz * hw * side, z: kp.z + tx * hw * side, tx, tz };
    };
    // Each arm's direction away from the node, from its first polyline piece.
    const dirs = arms.map(s => {
      const fromA = s.a === n.id, k = fromA ? 1 : s.n - 1, e = fromA ? 0 : s.n;
      let ux = s.pts[k * 2] - s.pts[e * 2], uz = s.pts[k * 2 + 1] - s.pts[e * 2 + 1];
      const l = Math.hypot(ux, uz) || 1;
      // Each kerb's own distance from the centre line: +1 is to the right of the direction away from the node.
      const at = fromA ? 0 : s.len;
      const hwP = edgeAt(s, fromA ? 1 : -1, at, tapers), hwM = edgeAt(s, fromA ? -1 : 1, at, tapers);
      return { s, ux: ux / l, uz: uz / l, angle: Math.atan2(uz / l, ux / l), hwP, hwM, hw: Math.max(hwP, hwM) };
    }).sort((p, q) => p.angle - q.angle);
    for (let i = 0; i < dirs.length; i++) {
      const A = dirs[i], B = dirs[(i + 1) % dirs.length];
      let gap = B.angle - A.angle;
      if (i === dirs.length - 1) gap += Math.PI * 2;
      // Only real corners: not the straight-through side of a T, nor a slip road's shallow merge.
      if (gap < 0.35 || gap > 2.95) continue;
      // The kerb of A that faces B, and the kerb of B that faces A.
      const leftA = { x: n.x - A.uz * A.hwP, z: n.z + A.ux * A.hwP }, rightA = { x: n.x + A.uz * A.hwM, z: n.z - A.ux * A.hwM };
      // Which of A's kerbs faces B: the one further along B's direction.
      const facingA = (leftA.x - n.x) * B.ux + (leftA.z - n.z) * B.uz > (rightA.x - n.x) * B.ux + (rightA.z - n.z) * B.uz ? leftA : rightA;
      const leftB = { x: n.x - B.uz * B.hwP, z: n.z + B.ux * B.hwP }, rightB = { x: n.x + B.uz * B.hwM, z: n.z - B.ux * B.hwM };
      const facingB = (leftB.x - n.x) * A.ux + (leftB.z - n.z) * A.uz > (rightB.x - n.x) * A.ux + (rightB.z - n.z) * A.uz ? leftB : rightB;
      // Corner: where the two kerb lines cross.
      const det = A.ux * -B.uz - A.uz * -B.ux;
      if (Math.abs(det) < 1e-4) continue;
      const dx = facingB.x - facingA.x, dz = facingB.z - facingA.z;
      const t = (dx * -B.uz - dz * -B.ux) / det, u = (A.ux * dz - A.uz * dx) / det;
      if (t < -0.2 || u < -0.2 || t > 4 || u > 4) continue;
      let cx = facingA.x + A.ux * t, cz = facingA.z + A.uz * t;
      // Round the corner off with a radius that suits the wider road, but never past the arm's far end.
      // Highway corners are swept wide, as they would be for fast traffic.
      const fast = isCarriageway(A.s.kind) || A.s.kind === KIND_RAMP || isCarriageway(B.s.kind) || B.s.kind === KIND_RAMP;
      const r = Math.min(fast ? 1.1 : 0.35 + Math.max(A.hw, B.hw) * 0.45, Math.max(0.15, A.s.len - t - 0.4), Math.max(0.15, B.s.len - u - 0.4));
      // The curve ends on the kerbs as they really run, not on their tangents at the node: a slip
      // road bending away from a corner used to leave a sliver of pavement pointing along its tangent.
      const sa = kerbAt(A, facingA === leftA ? 1 : -1, t + r), eb = kerbAt(B, facingB === leftB ? 1 : -1, u + r);
      const sx = sa.x, sz = sa.z, ex = eb.x, ez = eb.z;
      // Meet the kerbs tangentially: the control point is where their tangents at the ends cross.
      const det2 = sa.tx * -eb.tz - sa.tz * -eb.tx;
      if (Math.abs(det2) > 1e-4) {
        const ddx = ex - sx, ddz = ez - sz;
        const back = (ddx * -eb.tz - ddz * -eb.tx) / det2, forth = (sa.tx * ddz - sa.tz * ddx) / det2;
        if (back < 0 && forth < 0 && back > -3 && forth > -3) { cx = sx + sa.tx * back; cz = sz + sa.tz * back; }
      }
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
function rampGores(net: Network, b: MeshBuilder, marks: JunctionMarks): void {
  const half = GRID / 2, p = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const ramp of net.segs.values()) {
    if (ramp.kind !== KIND_RAMP || ramp.structure === 2) continue;
    for (const node of [ramp.a, ramp.b]) {
      const mouth = rampMouth(net, ramp, node);
      // Only a shallow merge gets a paved gore; a ramp turning sharply off is an ordinary corner.
      if (!mouth || mouth.length < 2.2) continue;
      const fromA = ramp.a === node;
      // The carriageway that carries on the way the ramp runs.
      Network.poseAt(ramp, fromA ? 0.3 : ramp.len - 0.3, p);
      const rx = (p.x - net.nodes.get(node)!.x), rz = (p.z - net.nodes.get(node)!.z), rl = Math.hypot(rx, rz) || 1;
      let road: RSeg | null = null, best = -1;
      for (const o of net.segsAt(node)) {
        if (o.id === ramp.id || !isCarriageway(o.kind) || o.structure !== ramp.structure) continue;
        Network.poseAt(o, o.a === node ? 0.3 : o.len - 0.3, p);
        const n = net.nodes.get(node)!, dot = ((p.x - n.x) * rx + (p.z - n.z) * rz) / rl / (Math.hypot(p.x - n.x, p.z - n.z) || 1);
        if (dot > best) { best = dot; road = o; }
      }
      if (!road || best < 0.5) continue;
      const length = Math.min(mouth.length + 0.4, 5.5, ramp.len - 0.3, road.len - 0.3);
      b.heightAt = road.structure ? (x, z) => roadHeight(road!, Network.nearestOn(road!, x + half, z + half).s) : null;
      rampMouthFill(net, ramp, road, node, b);
      // The gore starts at its nose, where the ramp's edge leaves the carriageway's; short of that the
      // ramp is still a lane of the carriageway.
      const nose = rampNose(net, ramp, road, node);
      if (length - nose < 0.5) continue;
      b.heightAt = road.structure ? (x, z) => roadHeight(road!, Network.nearestOn(road!, x + half, z + half).s) : null;
      const steps = 10, pts: number[] = [];
      // Out along the carriageway's edge on the ramp's side, then back along the ramp's near edge.
      const roadFromA = road.a === node, rampSide = mouth.side * (fromA ? 1 : -1);
      for (let k = 0; k <= steps; k++) {
        const d = nose + (k / steps) * (length - nose);
        Network.poseAt(road, roadFromA ? d : road.len - d, p);
        const tx = roadFromA ? p.tx : -p.tx, tz = roadFromA ? p.tz : -p.tz;
        // The ramp lies to `rampSide` of the carriageway's direction of travel away from the node.
        const sideSign = ((-tz) * rx + tx * rz) > 0 ? 1 : -1;
        pts.push(p.x - tz * HALF_WIDTH[road.kind] * sideSign - half, p.z + tx * HALF_WIDTH[road.kind] * sideSign - half);
      }
      for (let k = steps; k >= 0; k--) {
        const d = nose + (k / steps) * (length - nose);
        Network.poseAt(ramp, fromA ? d : ramp.len - d, p);
        const tx = fromA ? p.tx : -p.tx, tz = fromA ? p.tz : -p.tz;
        // The ramp's edge that faces the carriageway.
        pts.push(p.x - tz * HALF_WIDTH[KIND_RAMP] * rampSide - half, p.z + tx * HALF_WIDTH[KIND_RAMP] * rampSide - half);
      }
      // Fanned from the middle of the gore, now that it no longer reaches back to the node.
      let mx = 0, mz = 0;
      for (let k = 0; k < pts.length; k += 2) { mx += pts[k]; mz += pts[k + 1]; }
      b.fan(mx / (pts.length / 2), mz / (pts.length / 2), pts, pts.length / 2, 0.045, ASPHALT);
      // The gore painted as drivers know it: a white V round its edges, hatched across inside.
      const edgeRoad = pts.slice(0, (steps + 1) * 2), edgeRamp: number[] = [];
      for (let k = 0; k <= steps; k++) edgeRamp.push(pts[(steps + 1 + (steps - k)) * 2], pts[(steps + 1 + (steps - k)) * 2 + 1]);
      b.ribbon(edgeRoad, steps + 1, 0.018, 0.058, WHITE);
      b.ribbon(edgeRamp, steps + 1, 0.018, 0.058, WHITE);
      for (let k = 2; k < steps; k++) {
        const ax = edgeRoad[k * 2], az = edgeRoad[k * 2 + 1], bx = edgeRamp[(k + 1) * 2], bz = edgeRamp[(k + 1) * 2 + 1];
        if (Math.hypot(edgeRamp[k * 2] - ax, edgeRamp[k * 2 + 1] - az) < 0.12) continue;
        b.ribbon([ax, az, bx, bz], 2, 0.014, 0.058, WHITE);
      }
      marks.gores++;
    }
  }
  b.heightAt = null;
}
