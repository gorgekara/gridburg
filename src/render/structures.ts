import * as THREE from 'three';
import { Network, HALF_WIDTH } from '../roads/network';
import type { RSeg } from '../roads/network';
import { roadHeight } from '../roads/structures';
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
const BEAM_DEPTH = 0.22;
const EMBANK_TOP = 0.44; // below this deck height the ramp sits on a filled embankment
const PIER_SPACING = 4;

/**
 * Road bridges as solid low-poly structures: a swept slab with fascia bands, parapet walls with caps,
 * lamp posts, twin-column piers with pier caps, and retaining-wall embankments under the ramps.
 */
function buildBridge(seg: RSeg, surface: RSeg[], sweep: SweepBuilder, cols: Builder): void {
  const hw = HALF_WIDTH[seg.kind], W = hw + 0.28, len = seg.len;
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  const steps = Math.max(8, Math.ceil(len / 0.35));
  const path: (SweepPoint & { d: number })[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (len * i) / steps;
    Network.poseAt(seg, d, pose);
    path.push({ x: pose.x - OFFSET, y: roadHeight(seg, d), z: pose.z - OFFSET, tx: pose.tx, tz: pose.tz, d });
  }
  const between = (from: number, to: number): SweepPoint[] => path.filter(p => p.d >= from - 1e-6 && p.d <= to + 1e-6);

  // Deck slab: light top, dark fascia bands, chamfered soffit.
  sweep.sweep(path, [
    [-W + 0.08, DECK_BOTTOM], [W - 0.08, DECK_BOTTOM], [W, DECK_BOTTOM + 0.1], [W, DECK_TOP], [-W, DECK_TOP], [-W, DECK_BOTTOM + 0.1],
  ], [SOFFIT, BAND, BAND, CONCRETE, BAND, BAND], { capColor: BAND });

  // Parapet walls with a slightly wider cap, trimmed back from the junctions at either end.
  const rail = between(0.9, len - 0.9);
  for (const side of [-1, 1]) {
    const flip = (v: readonly [number, number][]): ProfileVertex[] => v.map(([a, u]) => [a * side, u] as const);
    sweep.sweep(rail, flip([[W - 0.13, 0], [W, 0], [W, 0.17], [W - 0.13, 0.17]]), PARAPET);
    sweep.sweep(rail, flip([[W - 0.155, 0.17], [W + 0.02, 0.17], [W + 0.02, 0.205], [W - 0.155, 0.205]]), CAP);
  }

  // Where the ramp is low it rests on an embankment held by battered retaining walls.
  const dLow = path.find(p => p.y >= 0.15)?.d ?? len / 2;
  const dHigh = path.find(p => p.y >= EMBANK_TOP)?.d ?? len / 2;
  const embank: ProfileVertex[] = [[-W - 0.07, -0.1, 1], [W + 0.07, -0.1, 1], [W - 0.01, DECK_BOTTOM + 0.04], [-W + 0.01, DECK_BOTTOM + 0.04]];
  if (dHigh > dLow) {
    sweep.sweep(between(dLow, dHigh), embank, [WALL, WALL, CONCRETE, WALL], { capColor: WALL });
    sweep.sweep(between(len - dHigh, len - dLow), embank, [WALL, WALL, CONCRETE, WALL], { capColor: WALL });
  }

  // Piers: twin octagonal columns on footings, topped by a pier cap under the deck.
  const span = len - 2 * dHigh, count = Math.max(1, Math.round(span / PIER_SPACING));
  const colAcross = hw * 0.62;
  for (let k = 1; k < count; k++) {
    const d = dHigh + (span * k) / count;
    Network.poseAt(seg, d, pose);
    const h = roadHeight(seg, d), rx = -pose.tz, rz = pose.tx, beamBottom = h + DECK_BOTTOM - BEAM_DEPTH;
    if (beamBottom < 0.15) continue;
    const feet = [-1, 1].map(side => ({ x: pose.x + rx * colAcross * side, z: pose.z + rz * colAcross * side }));
    // Never stand a pier on a road that passes underneath.
    if (feet.some(f => surface.some(s => Network.nearestOn(s, f.x, f.z).dist < HALF_WIDTH[s.kind] + 0.4))) continue;
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
    const h = roadHeight(seg, d), rx = -pose.tz * side, rz = pose.tx * side, off = W - 0.065;
    const x = pose.x - OFFSET + rx * off, z = pose.z - OFFSET + rz * off, top = h + 0.205 + 0.6;
    cols.cyl(0.028, 0.6, x, h + 0.205, z, POLE, 6);
    // Arm and lamp head reach in over the road; paths run inward, so `across` is along the road.
    sweep.sweep(straightPath(x, top, z, x - rx * 0.26, top, z - rz * 0.26), [[-0.018, -0.03], [0.018, -0.03], [0.018, 0], [-0.018, 0]], POLE);
    sweep.sweep(straightPath(x - rx * 0.16, top, z - rz * 0.16, x - rx * 0.32, top, z - rz * 0.32), [[-0.045, -0.055], [0.045, -0.055], [0.045, -0.02], [-0.045, -0.02]], [LAMP, POLE, POLE, POLE], { capColor: POLE });
  }
}

/** Tunnel portals: an abutment wall and headwall at each end of the bore. */
function buildPortals(seg: RSeg, material: THREE.Material): THREE.Mesh[] {
  const hw = HALF_WIDTH[seg.kind], pose = { x: 0, z: 0, tx: 0, tz: 0 }, out: THREE.Mesh[] = [];
  for (const end of [0, seg.len]) {
    Network.poseAt(seg, end, pose);
    const dir = end === 0 ? 1 : -1, b = new Builder(seg.id);
    for (const side of [-1, 1]) b.box(0.19, 0.85, 1.5, side * (hw + 0.1), 0.425, 0.5, 0x999f9b);
    b.box(hw * 2 + 0.39, 0.23, 1.6, 0, 0.86, 0.5, 0xb4b9af);
    b.box(hw * 2, 0.73, 0.04, 0, 0.365, 1.22, 0x101c23);
    for (const side of [-1, 1]) b.box(0.06, 0.14, 0.025, side * (hw - 0.04), 0.61, -0.31, 0xffd688);
    const mesh = new THREE.Mesh(b.build(), material);
    mesh.position.set(pose.x - OFFSET + pose.tx * dir * 0.8, 0, pose.z - OFFSET + pose.tz * dir * 0.8);
    mesh.rotation.y = Math.atan2(pose.tx * dir, pose.tz * dir);
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
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  private builtNet: Network | null = null;
  private builtVersion = -1;
  /** Finished geometry per span, so an edit elsewhere in the city rebuilds nothing. */
  private built = new Map<number, Built>();
  constructor() { this.guides.visible = true; this.guides.renderOrder = 2; this.group.add(this.solids, this.guides); }
  showUnderground(show: boolean): void { this.guides.visible = show; }

  /** Everything a span's geometry depends on: its own shape, and for bridges the roads that suppress piers. */
  private signature(seg: RSeg, surface: RSeg[]): string {
    const last = seg.n * 2;
    let signature = `${seg.kind}:${seg.structure}:${seg.len.toFixed(3)}:${seg.pts[0].toFixed(3)},${seg.pts[1].toFixed(3)}:${seg.pts[last].toFixed(3)},${seg.pts[last + 1].toFixed(3)}:${seg.cx.toFixed(3)},${seg.cz.toFixed(3)}`;
    if (seg.structure !== 1) return signature;
    for (const s of surface) {
      if (s.maxX < seg.minX - 2 || s.minX > seg.maxX + 2 || s.maxZ < seg.minZ - 2 || s.minZ > seg.maxZ + 2) continue;
      signature += `|${s.id},${s.kind},${s.cx.toFixed(2)},${s.cz.toFixed(2)},${s.len.toFixed(2)}`;
    }
    return signature;
  }

  private build(seg: RSeg, surface: RSeg[]): THREE.Mesh[] {
    if (seg.structure !== 1) return buildPortals(seg, this.material);
    const sweep = new SweepBuilder(), cols = new Builder(1);
    buildBridge(seg, surface, sweep, cols);
    return [sweep.build(), cols.build()].map(geometry => {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      return mesh;
    });
  }

  rebuild(net: Network): void {
    if (net === this.builtNet && net.version === this.builtVersion) return;
    this.builtNet = net; this.builtVersion = net.version;
    const guides = new MeshBuilder(), pose = { x: 0, z: 0, tx: 0, tz: 0 };
    const surface = [...net.segs.values()].filter(s => !s.structure);
    const live = new Set<number>();
    for (const seg of net.segs.values()) {
      if (!seg.structure) continue;
      live.add(seg.id);
      const signature = this.signature(seg, surface);
      const cached = this.built.get(seg.id);
      if (cached?.signature !== signature) {
        if (cached) for (const mesh of cached.meshes) { mesh.geometry.dispose(); this.solids.remove(mesh); }
        const meshes = this.build(seg, surface);
        this.solids.add(...meshes);
        this.built.set(seg.id, { signature, meshes });
      }
      // Underground route arrows are cheap and depend on the view, so they stay in one mesh.
      if (seg.structure === 2) {
        for (let d = 0; d < seg.len; d += 1) {
          Network.poseAt(seg, d, pose);
          guides.ribbon([pose.x - OFFSET, pose.z - OFFSET, pose.x - OFFSET + pose.tx * 0.65, pose.z - OFFSET + pose.tz * 0.65], 2, 0.12, 0.12, 0x86d9e7);
        }
      }
    }
    for (const [id, entry] of this.built) {
      if (live.has(id)) continue;
      for (const mesh of entry.meshes) { mesh.geometry.dispose(); this.solids.remove(mesh); }
      this.built.delete(id);
    }
    this.guides.geometry.dispose(); this.guides.geometry = guides.build();
  }
}
