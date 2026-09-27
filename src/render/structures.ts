import * as THREE from 'three';
import { roadHalf } from '../roads/lanes';
import { Network, KIND_RAMP } from '../roads/network';
import { rampJoin, pairedRoad, rampMouthShape, inMouth } from '../roads/rampMouth';
import type { RSeg } from '../roads/network';
import { roadHeight, tunnelMouth, levelY, isLegacySpan } from '../roads/structures';
import { Builder } from './buildingGeo';
import { MeshBuilder } from './meshBuilder';
import { SweepBuilder, straightPath } from './sweep';
import type { SweepPoint, ProfileVertex } from './sweep';

const OFFSET = 40; // GRID / 2: tile space to world space
const CONCRETE = 0xb9b4a8;
const BAND = 0x8d8a82;
const SOFFIT = 0x9e9a90;
const PARAPET = 0xc2bdb1;
const CAP = 0xd8d4ca;
const WALL = 0xa29e94;
const PIER = 0xb0ab9f;
const FOOTING = 0x86837b;
const POLE = 0x5b6266;
const LAMP = 0xfff0c2;
const DECK_TOP = 0.015; // just under the curb ribbon (0.03) so the road never z-fights the slab
const DECK_BOTTOM = -0.24;
/** Below this the road is on its embankment or the ground: no slab and no parapet there. */
const RAISED = 0.15;
/** A parapet's wall and cap across the deck's edge at `W`: a slim concrete wall with a light coping. */
const PARAPET_TOP = 0.15;
const parapetWall = (W: number): [number, number][] => [[W - 0.07, 0], [W, 0], [W, PARAPET_TOP - 0.025], [W - 0.07, PARAPET_TOP - 0.025]];
const parapetCap = (W: number): [number, number][] => [[W - 0.085, PARAPET_TOP - 0.025], [W + 0.012, PARAPET_TOP - 0.025], [W + 0.012, PARAPET_TOP], [W - 0.085, PARAPET_TOP]];
const BEAM_DEPTH = 0.22;
const EMBANK_TOP = 0.44; // below this deck height the ramp sits on a filled embankment
const PIER_SPACING = 4;

/**
 * Road bridges as solid low-poly structures: a swept slab with fascia bands, parapet walls with caps,
 * lamp posts, twin-column piers with pier caps, and retaining-wall embankments under the ramps.
 */
function buildBridge(seg: RSeg, others: RSeg[], sweep: SweepBuilder, cols: Builder, trim: [number, number], arms: RSeg[] = [], mouths: MouthShape[] = []): void {
  const hw = roadHalf(seg), W = hw + 0.28, len = seg.len;
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  const steps = Math.max(8, Math.ceil(len / 0.35));
  const path: (SweepPoint & { d: number })[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (len * i) / steps;
    Network.poseAt(seg, d, pose);
    path.push({ x: pose.x - OFFSET, y: roadHeight(seg, d), z: pose.z - OFFSET, tx: pose.tx, tz: pose.tz, d });
  }
  const between = (from: number, to: number): SweepPoint[] => path.filter(p => p.d >= from - 1e-6 && p.d <= to + 1e-6);

  // Deck slab: light top, dark fascia bands, chamfered soffit. Only where the road is up off the
  // ground: coming down, the last stretch is on its embankment, and a slab there shows beside it.
  const raised = path.filter(p => p.y >= RAISED);
  if (raised.length >= 2) sweep.sweep(raised, [
    [-W + 0.08, DECK_BOTTOM], [W - 0.08, DECK_BOTTOM], [W, DECK_BOTTOM + 0.1], [W, DECK_TOP], [-W, DECK_TOP], [-W, DECK_BOTTOM + 0.1],
  ], [SOFFIT, BAND, BAND, CONCRETE, BAND, BAND], { capColor: BAND });

  // Parapet walls with a slightly wider cap, trimmed back where the road comes down to the ground, and
  // cut, side by side, wherever a wall would stand on the deck of another road meeting this one up in
  // the air: an exit peeling off keeps its outer wall, and the wall between the two opens up.
  const rail = between(trim[0], len - trim[1]).filter(p => p.y >= RAISED);
  const onOtherDeck = (p: SweepPoint, side: number, extra = 0): boolean => {
    const x = p.x + OFFSET - p.tz * side * (W + extra), z = p.z + OFFSET + p.tx * side * (W + extra);
    // Inside the mouth of a ramp's own lane, which has a parapet of its own round it.
    if (mouths.some(m => inMouth(m, x, z) || nearEdge(m.outer, x, z, 0.4))) return true;
    // The other deck at the wall's own height, or above it but low enough that the wall
    // would poke up into its slab. One well below (an exit already dropping away under this road) is
    // passed over, as is one high enough to clear the wall.
    return arms.some(o => {
      const hit = Network.nearestOn(o, x, z);
      if (hit.dist >= roadHalf(o) + 0.3) return false;
      const rise = roadHeight(o, hit.s) - p.y;
      return rise > -0.3 && rise < PARAPET_TOP - DECK_BOTTOM + 0.05;
    });
  };
  for (const side of [-1, 1]) {
    const flip = (v: readonly [number, number][]): ProfileVertex[] => v.map(([a, u]) => [a * side, u] as const);
    let run: SweepPoint[] = [];
    const flush = (): void => {
      if (run.length >= 2) {
        sweep.sweep(run, flip(parapetWall(W)), PARAPET);
        sweep.sweep(run, flip(parapetCap(W)), CAP);
      }
      run = [];
    };
    for (const p of rail) { if (onOtherDeck(p, side)) flush(); else run.push(p); }
    flush();
  }

  // Stretches of the deck by height: low enough to sit on an embankment, or high on piers. Walks the
  // road's own profile, so a ramp climbing to a level, a level deck and an old hump all come out right.
  const runs = (test: (y: number) => boolean): [number, number][] => {
    const out: [number, number][] = [];
    let from = -1;
    for (let i = 0; i < path.length; i++) {
      const on = test(path[i].y);
      if (on && from < 0) from = path[i].d;
      if ((!on || i === path.length - 1) && from >= 0) { out.push([from, on ? path[i].d : path[i - 1].d]); from = -1; }
    }
    return out.filter(([a, b]) => b - a > 0.05);
  };
  // Where the ramp is low it rests on an embankment held by battered retaining walls.
  // Its top runs just under the road, so the last low stretch down to the ground is carried too.
  // It is only as wide on top as the road and its kerbs, battered out to the ground.
  const top = hw + 0.08;
  const embank: ProfileVertex[] = [[-top - 0.2, -0.1, 1], [top + 0.2, -0.1, 1], [top, -0.01], [-top, -0.01]];
  for (const [a, b] of runs(y => y >= 0.02 && y < EMBANK_TOP)) sweep.sweep(between(a, b), embank, [WALL, WALL, CONCRETE, WALL], { capColor: WALL });

  // Piers: twin octagonal columns on footings, topped by a pier cap under the deck.
  const colAcross = hw * 0.62;
  const piers: number[] = [];
  for (const [a, b] of runs(y => y >= EMBANK_TOP)) {
    const span = b - a, count = Math.max(1, Math.round(span / PIER_SPACING));
    for (let k = 1; k < count; k++) piers.push(a + (span * k) / count);
  }
  const dHigh = runs(y => y >= EMBANK_TOP)[0]?.[0] ?? len / 2;
  for (const d of piers) {
    Network.poseAt(seg, d, pose);
    const h = roadHeight(seg, d), rx = -pose.tz, rz = pose.tx, beamBottom = h + DECK_BOTTOM - BEAM_DEPTH;
    if (beamBottom < 0.15) continue;
    const feet = [-1, 1].map(side => ({ x: pose.x + rx * colAcross * side, z: pose.z + rz * colAcross * side }));
    // Never stand a pier on a road that passes underneath, at whatever level it is.
    if (feet.some(f => others.some(s => { const r = Network.nearestOn(s, f.x, f.z); return r.dist < roadHalf(s) + 0.4 && roadHeight(s, r.s) < h - 0.6; }))) continue;
    const x = pose.x - OFFSET, z = pose.z - OFFSET, reach = W - 0.12;
    sweep.sweep(straightPath(x - rx * reach, h, z - rz * reach, x + rx * reach, h, z + rz * reach),
      [[-0.13, DECK_BOTTOM - BEAM_DEPTH], [0.13, DECK_BOTTOM - BEAM_DEPTH], [0.17, DECK_BOTTOM], [-0.17, DECK_BOTTOM]], PIER, { capColor: BAND });
    for (const f of feet) {
      cols.cyl(0.13, beamBottom + 0.32, f.x - OFFSET, -0.3, f.z - OFFSET, PIER, 8);
      cols.cyl(0.21, 0.16, f.x - OFFSET, -0.1, f.z - OFFSET, FOOTING, 8);
    }
  }

  // A few lamp posts on the parapet caps, alternating sides along the span.
  const lampFrom = Math.max(1.5, dHigh - 1), lampTo = len - lampFrom;
  const lamps = Math.max(1, Math.round((lampTo - lampFrom) / 5));
  for (let k = 0; k <= lamps; k++) {
    const d = lampFrom + ((lampTo - lampFrom) * k) / lamps, side = k % 2 ? 1 : -1;
    Network.poseAt(seg, d, pose);
    const h = roadHeight(seg, d), rx = -pose.tz * side, rz = pose.tx * side, off = W - 0.035;
    // No lamp where its wall is cut for another deck, nor with its arm reaching out over one.
    const at = { x: pose.x - OFFSET, y: h, z: pose.z - OFFSET, tx: pose.tx, tz: pose.tz };
    if (h < RAISED || onOtherDeck(at, side) || onOtherDeck(at, side, -0.35)) continue;
    const x = pose.x - OFFSET + rx * off, z = pose.z - OFFSET + rz * off, top = h + PARAPET_TOP + 0.6;
    cols.cyl(0.028, 0.6, x, h + PARAPET_TOP, z, POLE, 6);
    // Arm and lamp head reach in over the road; paths run inward, so `across` is along the road.
    sweep.sweep(straightPath(x, top, z, x - rx * 0.26, top, z - rz * 0.26), [[-0.018, -0.03], [0.018, -0.03], [0.018, 0], [-0.018, 0]], POLE);
    sweep.sweep(straightPath(x - rx * 0.16, top, z - rz * 0.16, x - rx * 0.32, top, z - rz * 0.32), [[-0.045, -0.055], [0.045, -0.055], [0.045, -0.02], [-0.045, -0.02]], [LAMP, POLE, POLE, POLE], { capColor: POLE });
  }
}

type MouthShape = NonNullable<ReturnType<typeof rampMouthShape>>;

/** Whether (x, z) is within `r` of a polyline sampled finely enough that its points will do. */
function nearEdge(pts: number[], x: number, z: number, r: number): boolean {
  for (let k = 0; k < pts.length; k += 2) if (Math.hypot(pts[k] - x, pts[k + 1] - z) < r) return true;
  return false;
}

/**
 * Up in the air, a ramp lane's mouth on a slab of its own beside the carriageway it leaves or joins,
 * with a parapet along its outer edge from the node to where the ramp's own wall takes over.
 */
function buildMouthDeck(road: RSeg, node: number, shape: MouthShape, sweep: SweepBuilder): void {
  const fromA = road.a === node, count = shape.outer.length / 2, pose = { x: 0, z: 0, tx: 0, tz: 0 };
  const path: SweepPoint[] = [];
  for (let k = 0; k < count; k++) {
    const d = Math.min(road.len, k * 0.1);
    Network.poseAt(road, fromA ? d : road.len - d, pose);
    path.push({ x: pose.x - OFFSET, y: roadHeight(road, fromA ? d : road.len - d), z: pose.z - OFFSET, tx: fromA ? pose.tx : -pose.tx, tz: fromA ? pose.tz : -pose.tz });
  }
  if (path.length < 2) return;
  const s = shape.sgn, a0 = roadHalf(road) + 0.2, a1 = shape.W + 0.28;
  const side = (v: readonly [number, number][]): ProfileVertex[] => v.map(([a, u]) => [a * s, u] as const);
  sweep.sweep(path, side([[a0, DECK_BOTTOM], [a1 - 0.08, DECK_BOTTOM], [a1, DECK_BOTTOM + 0.1], [a1, DECK_TOP], [a0, DECK_TOP]]), [SOFFIT, BAND, BAND, CONCRETE, BAND], { capColor: BAND });
  sweep.sweep(path, side(parapetWall(a1)), PARAPET);
  sweep.sweep(path, side(parapetCap(a1)), CAP);
}

/**
 * Tunnel portals, one at each end, standing on the ground where the approach road meets the mouth.
 * Built in portal space: +z points out along the approach, so the face is at z = 0 and the body of
 * the portal runs back over the bore. Heights are box bases, which is what Builder.box expects.
 */
function buildPortals(seg: RSeg, material: THREE.Material): THREE.Mesh[] {
  const hw = roadHalf(seg), pose = { x: 0, z: 0, tx: 0, tz: 0 }, out: THREE.Mesh[] = [];
  const clear = 0.72; // headroom inside the mouth
  const wall = 0.2, span = hw + 0.14; // inner face of each side wall
  for (const end of [0, seg.len]) {
    const mouth = tunnelMouth(seg, end ? 1 : 0);
    if (mouth === null) continue; // this end is underground: the road carries on down there
    const at = end === 0 ? mouth : seg.len - mouth;
    Network.poseAt(seg, at, pose);
    // Facing out of the tunnel: towards the start for the first portal, towards the end for the last.
    const out_ = end === 0 ? -1 : 1;
    const b = new Builder(seg.id + (end ? 7 : 0));
    // Side walls, sunk slightly into the ground so no seam shows at grade.
    for (const side of [-1, 1]) b.box(wall, clear + 0.36, 1.1, side * (span + wall / 2), -0.08, -0.45, 0x9aa09c);
    // Wing walls splaying out along the approach, stepping down towards the road.
    for (const side of [-1, 1]) {
      b.box(wall * 0.8, 0.5, 0.55, side * (span + wall * 0.6 + 0.06), -0.08, 0.3, 0x8f9591);
      b.box(wall * 0.7, 0.28, 0.45, side * (span + wall * 0.7 + 0.12), -0.08, 0.78, 0x8f9591);
    }
    // Headwall over the mouth, a coping on top, and the dark bore behind the opening.
    b.box(span * 2 + wall * 2, 0.3, 0.26, 0, clear, -0.05, 0xb4b9af);
    b.box(span * 2 + wall * 2 + 0.08, 0.06, 0.34, 0, clear + 0.3, -0.05, 0x8a8f89);
    b.box(span * 2, clear + 0.02, 0.9, 0, -0.02, -0.62, 0x0d151b);
    // A roof slab over the first stretch of bore, flush with the ground behind the headwall.
    b.box(span * 2 + wall * 2, 0.12, 0.8, 0, clear - 0.02, -0.75, 0x7c827e);
    // Lamps either side of the mouth.
    for (const side of [-1, 1]) b.box(0.06, 0.12, 0.04, side * (span - 0.08), clear - 0.2, 0.09, 0xffd688);
    const mesh = new THREE.Mesh(b.build(), material);
    mesh.position.set(pose.x - OFFSET, 0, pose.z - OFFSET);
    mesh.rotation.y = Math.atan2(pose.tx * out_, pose.tz * out_);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}

interface Built { signature: string; meshes: THREE.Mesh[] }

export class StructureLayer {
  readonly group = new THREE.Group();
  private solids = new THREE.Group();
  private guides = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false }));
  /** A dark strip on the ground over every bore, so a tunnel reads from above even when closed up. */
  private traces = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }));
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  private builtNet: Network | null = null;
  private builtVersion = -1;
  /** Finished geometry per span, so an edit elsewhere in the city rebuilds nothing. */
  private built = new Map<number, Built>();
  constructor() {
    this.guides.visible = true; this.guides.renderOrder = 2;
    this.traces.renderOrder = 1; this.traces.frustumCulled = false;
    this.group.add(this.solids, this.traces, this.guides);
  }
  showUnderground(show: boolean): void { this.guides.visible = show; }

  /** Everything a span's geometry depends on: its own shape, and for bridges the roads that suppress piers. */
  private signature(seg: RSeg, surface: RSeg[]): string {
    const last = seg.n * 2;
    let signature = `${seg.kind}:${seg.structure}:${seg.ya ?? 0}:${seg.yb ?? 0}:${seg.len.toFixed(3)}:${seg.pts[0].toFixed(3)},${seg.pts[1].toFixed(3)}:${seg.pts[last].toFixed(3)},${seg.pts[last + 1].toFixed(3)}:${seg.cx.toFixed(3)},${seg.cz.toFixed(3)}`;
    if (seg.structure !== 1) return signature;
    for (const s of surface) {
      if (s.maxX < seg.minX - 2 || s.minX > seg.maxX + 2 || s.maxZ < seg.minZ - 2 || s.minZ > seg.maxZ + 2) continue;
      signature += `|${s.id},${s.kind},${s.cx.toFixed(2)},${s.cz.toFixed(2)},${s.len.toFixed(2)},${s.ya ?? 0},${s.yb ?? 0}`;
    }
    return signature;
  }

  private build(net: Network, seg: RSeg, others: RSeg[]): THREE.Mesh[] {
    if (seg.structure !== 1) return buildPortals(seg, this.material);
    const sweep = new SweepBuilder(), cols = new Builder(1);
    // The parapet stops short of a junction or the ground, but runs on unbroken where one deck
    // carries straight on into the next up in the air.
    // Where the road comes down to the ground the parapet stops short; up in the air it runs to the
    // node, cut only where it would stand on another road's deck (the arms meeting at either end).
    const trim = [seg.a, seg.b].map(id => ((net.nodes.get(id)!.level ?? 0) > 0 ? 0 : 0.9)) as [number, number];
    const arms = [seg.a, seg.b].flatMap(id => ((net.nodes.get(id)!.level ?? 0) > 0 ? net.segsAt(id).filter(o => o.id !== seg.id) : []));
    // Ramp lanes' mouths at either end, up in the air: walls inside one are cut, and the carriageway
    // the ramp shadows carries the mouth on a slab of its own with a parapet round its outer edge.
    const mouths: MouthShape[] = [];
    for (const id of [seg.a, seg.b]) {
      if ((net.nodes.get(id)!.level ?? 0) <= 0 || !rampJoin(net, id)) continue;
      const ramp = net.segsAt(id).find(o => o.kind === KIND_RAMP)!, road = pairedRoad(net, ramp, id);
      const shape = road ? rampMouthShape(net, ramp, road, id) : null;
      if (!shape || !road) continue;
      mouths.push(shape);
      if (road.id === seg.id) buildMouthDeck(seg, id, shape, sweep);
    }
    buildBridge(seg, others, sweep, cols, trim, arms, mouths);
    return [sweep.build(), cols.build()].map(geometry => {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    });
  }

  rebuild(net: Network): void {
    if (net === this.builtNet && net.version === this.builtVersion) return;
    this.builtNet = net; this.builtVersion = net.version;
    const guides = new MeshBuilder(), traces = new MeshBuilder(), pose = { x: 0, z: 0, tx: 0, tz: 0 };
    // Everything a pier might land on: ground roads, and the lower decks of a stack.
    const surface = [...net.segs.values()].filter(s => !s.structure || !isLegacySpan(s));
    const live = new Set<number>();
    for (const seg of net.segs.values()) {
      if (!seg.structure) continue;
      live.add(seg.id);
      const signature = this.signature(seg, surface);
      const cached = this.built.get(seg.id);
      if (cached?.signature !== signature) {
        if (cached) for (const mesh of cached.meshes) { mesh.geometry.dispose(); this.solids.remove(mesh); }
        const meshes = this.build(net, seg, surface.filter(o => o.id !== seg.id));
        this.solids.add(...meshes);
        this.built.set(seg.id, { signature, meshes });
      }
      // Underground route arrows are cheap and depend on the view, so they stay in one mesh.
      if (seg.structure === 2) {
        for (let d = 0; d < seg.len; d += 1) {
          Network.poseAt(seg, d, pose);
          guides.ribbon([pose.x - OFFSET, pose.z - OFFSET, pose.x - OFFSET + pose.tx * 0.65, pose.z - OFFSET + pose.tz * 0.65], 2, 0.12, 0.12, 0x86d9e7);
        }
        // The ground above the bore: one dark band the whole way between the portals, with paler
        // ticks along it, so the route is legible without opening the underground view.
        const hw = roadHalf(seg);
        const step = 0.4;
        // Start past the portal mouth: the ramps are real road, and the band belongs over the bore.
        const ma = tunnelMouth(seg, 0), mb = tunnelMouth(seg, 1);
        const from = ma === null ? 0 : ma + 0.9, to = seg.len - (mb === null ? 0 : mb + 0.9);
        const pts: number[] = [];
        for (let d = from; d <= to + 1e-6; d = Math.min(to, d + step)) {
          Network.poseAt(seg, d, pose);
          pts.push(pose.x - OFFSET, pose.z - OFFSET);
          if (d >= to) break;
        }
        const count = pts.length / 2;
        if (count > 1) {
          traces.ribbon(pts, count, hw + 0.12, 0.02, 0x232a31);
          traces.ribbon(pts, count, hw * 0.78, 0.022, 0x39434c);
          for (let d = from + 0.6; d < to - 0.3; d += 1.4) {
            Network.poseAt(seg, d, pose);
            traces.ribbon([
              pose.x - OFFSET - pose.tz * hw, pose.z - OFFSET + pose.tx * hw,
              pose.x - OFFSET + pose.tz * hw, pose.z - OFFSET - pose.tx * hw,
            ], 2, 0.055, 0.024, 0x6d7a84);
          }
        }
      }
    }
    // Elevated junctions and deck joints: a slab under the node on one column, keyed by the node's
    // negated id alongside the spans.
    for (const n of net.nodes.values()) {
      const level = n.level ?? 0;
      if (level <= 0) continue;
      const arms = net.segsAt(n.id);
      if (!arms.length) continue;
      const key = -n.id, y = levelY(level), r = Math.max(...arms.map(roadHalf)) + 0.28;
      live.add(key);
      const blocked = surface.some(s => { const hit = Network.nearestOn(s, n.x, n.z); return hit.dist < roadHalf(s) + 0.45 && roadHeight(s, hit.s) < y - 0.6; });
      const signature = `${n.x.toFixed(3)},${n.z.toFixed(3)}:${level}:${r.toFixed(3)}:${blocked}`;
      if (this.built.get(key)?.signature === signature) continue;
      const old = this.built.get(key);
      if (old) for (const mesh of old.meshes) { mesh.geometry.dispose(); this.solids.remove(mesh); }
      const cols = new Builder(n.id);
      cols.cyl(r, -DECK_BOTTOM + DECK_TOP, n.x - OFFSET, y + DECK_BOTTOM, n.z - OFFSET, CONCRETE, 18);
      if (!blocked) {
        cols.cyl(0.24, y + DECK_BOTTOM + 0.3, n.x - OFFSET, -0.3, n.z - OFFSET, PIER, 8);
        cols.cyl(0.34, 0.16, n.x - OFFSET, -0.1, n.z - OFFSET, FOOTING, 8);
      }
      const mesh = new THREE.Mesh(cols.build(), this.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.solids.add(mesh);
      this.built.set(key, { signature, meshes: [mesh] });
    }
    for (const [id, entry] of this.built) {
      if (live.has(id)) continue;
      for (const mesh of entry.meshes) { mesh.geometry.dispose(); this.solids.remove(mesh); }
      this.built.delete(id);
    }
    this.guides.geometry.dispose(); this.guides.geometry = guides.build();
    this.traces.geometry.dispose(); this.traces.geometry = traces.build();
  }
}
