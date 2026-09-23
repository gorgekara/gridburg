import * as THREE from 'three';
import { GRID } from '../constants';
import { HALF_WIDTH, isMotorway } from '../roads/network';
import type { Network, RSeg } from '../roads/network';
import { roadHeight } from '../roads/structures';

/** Most people the streets ever hold at once; the city's population sets how many are out. */
const MAX_PEOPLE = 700;
/** A person is about 0.13 tall against a car 0.31 long. */
const HIP = 0.058;
const CURB_TOP = 0.031;

const HAIR = [0x2a1d14, 0x4a3222, 0x7a5230, 0xc9a45c, 0x1a1a1a, 0x8a8a8a, 0xb5562f, 0xe0d6c4];
const BAGS = [0x2a2f36, 0x8a5a3c, 0xd8453b, 0x2f5f9f, 0x3f6b4a, 0xe0a021];
const SHIRTS = [0xd8453b, 0x2f6fb7, 0xe0a021, 0x3f9a5f, 0xf1ece0, 0x6a5acd, 0x2a2f36, 0xe07fb0, 0x5fb3b3, 0x8a5a3c];
const SKIN = [0xf1c9a5, 0xd9a47c, 0xa8744f, 0x7a4e32, 0xe8b894];
const TROUSERS = [0x2b3440, 0x3b4a66, 0x5a4a3a, 0x24272b, 0x6b6f76, 0x8a7a5a];

interface Person {
  seg: RSeg;
  /** Which kerb: +1 on the right of the a → b direction, -1 on the left. */
  side: number;
  s: number;
  /** +1 walking a → b, -1 walking b → a. */
  dir: number;
  speed: number;
  phase: number;
  /** Seconds left standing still (window shopping, waiting at a corner). */
  pause: number;
}

function box(w: number, h: number, d: number, y: number, shade = 1, x = 0, z = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y + h / 2, z);
  // A grey level per part: 1 takes the person's own colour for that mesh, darker makes shoes, belts, eyes.
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(shade), 3));
  return g;
}

/**
 * People on the pavements. They walk the kerbside strip of every street, avenue and lane (not the
 * expressways), turn onto another street at each junction, and stop now and then. How many are out
 * follows the population and thins after dark. Pure scenery, like the boats: the simulation's trips
 * are the cars.
 */
export class PedestrianLayer {
  readonly group = new THREE.Group();
  private people: Person[] = [];
  private torso: THREE.InstancedMesh;
  private head: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private arms: THREE.InstancedMesh;
  private hands: THREE.InstancedMesh;
  private hair: THREE.InstancedMesh;
  private bag: THREE.InstancedMesh;
  /** Per person: height, whether they have hair (and how much), and whether they carry a bag. */
  private looks: { height: number; hair: number; bag: number }[] = [];
  private net: Network | null = null;
  private version = -1;
  private wanted = 0;
  private night = 0;
  private rnd = 1;

  constructor() {
    const mat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, vertexColors: true });
    // A torso with shoulders, a collar and a belt; a head with a neck, eyes and a nose; arms and legs
    // hinged at the shoulder and hip so they swing as people walk, with hands and shoes; hair; a bag.
    const torso = mergeBoxes([
      box(0.034, 0.042, 0.021, HIP + 0.004),
      box(0.04, 0.01, 0.022, HIP + 0.036),
      box(0.036, 0.005, 0.0215, HIP + 0.002, 0.25),
      box(0.034, 0.006, 0.02, HIP - 0.004, 0.6),
      box(0.012, 0.004, 0.0222, HIP + 0.041, 0.85),
    ]);
    const head = mergeBoxes([
      box(0.009, 0.006, 0.009, HIP + 0.046),
      box(0.02, 0.023, 0.02, HIP + 0.051),
      box(0.003, 0.003, 0.002, HIP + 0.063, 0.12, -0.0045, 0.0101),
      box(0.003, 0.003, 0.002, HIP + 0.063, 0.12, 0.0045, 0.0101),
      box(0.003, 0.005, 0.003, HIP + 0.057, 0.9, 0, 0.0108),
      box(0.006, 0.0015, 0.002, HIP + 0.0545, 0.55, 0, 0.0101),
    ]);
    const hair = mergeBoxes([
      box(0.022, 0.007, 0.022, HIP + 0.071),
      box(0.022, 0.016, 0.006, HIP + 0.057, 1, 0, -0.009),
      box(0.004, 0.01, 0.018, HIP + 0.062, 1, 0.0105, -0.001),
      box(0.004, 0.01, 0.018, HIP + 0.062, 1, -0.0105, -0.001),
    ]);
    // An arm hangs from the shoulder: a sleeve down to the wrist. Hands are drawn on their own, in skin.
    const arm = box(0.009, 0.038, 0.011, -0.038);
    const hand = box(0.008, 0.008, 0.009, -0.046);
    // A leg with its shoe at the foot.
    const leg = mergeBoxes([box(0.013, HIP - 0.006, 0.014, -HIP + 0.006), box(0.014, 0.007, 0.022, -HIP, 0.18, 0, 0.004)]);
    const bag = mergeBoxes([box(0.03, 0.03, 0.012, HIP + 0.006, 1, 0, -0.017), box(0.028, 0.003, 0.02, HIP + 0.041, 0.7, 0, -0.006)]);
    this.torso = new THREE.InstancedMesh(torso, mat(), MAX_PEOPLE);
    this.head = new THREE.InstancedMesh(head, mat(), MAX_PEOPLE);
    this.hair = new THREE.InstancedMesh(hair, mat(), MAX_PEOPLE);
    this.bag = new THREE.InstancedMesh(bag, mat(), MAX_PEOPLE);
    this.legs = new THREE.InstancedMesh(leg, mat(), MAX_PEOPLE * 2);
    this.arms = new THREE.InstancedMesh(arm, mat(), MAX_PEOPLE * 2);
    this.hands = new THREE.InstancedMesh(hand, mat(), MAX_PEOPLE * 2);
    for (const m of this.meshes) {
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
      this.group.add(m);
    }
  }

  private get meshes(): THREE.InstancedMesh[] {
    return [this.torso, this.head, this.hair, this.bag, this.legs, this.arms, this.hands];
  }

  private random(): number {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return (this.rnd - 1) / 2147483646;
  }

  /** How many people the city puts on the street: grows with population, fewer late at night. */
  setCrowd(population: number, night: number): void {
    this.wanted = Math.min(MAX_PEOPLE, Math.round(30 + population * 0.12));
    this.night = night;
  }

  rebuild(net: Network): void {
    if (net === this.net && net.version === this.version) return;
    this.net = net; this.version = net.version;
    this.people = [];
  }

  private walkable(seg: RSeg): boolean {
    return seg.structure !== 2 && !isMotorway(seg.kind);
  }

  private spawn(): Person | null {
    const net = this.net;
    if (!net) return null;
    // Pick a street weighted by length, so long avenues carry more people than short stubs.
    const segs = [...net.segs.values()].filter(s => this.walkable(s));
    if (!segs.length) return null;
    const total = segs.reduce((n, s) => n + s.len, 0);
    let r = this.random() * total, seg = segs[0];
    for (const s of segs) { r -= s.len; if (r <= 0) { seg = s; break; } }
    const n = this.people.length + this.rnd;
    const p: Person = {
      seg, side: this.random() < 0.5 ? 1 : -1, s: this.random() * seg.len, dir: this.random() < 0.5 ? 1 : -1,
      speed: 0.09 + this.random() * 0.07, phase: this.random() * 6.28, pause: 0,
    };
    const pick = (palette: number[]): THREE.Color => new THREE.Color(palette[Math.floor(this.random() * palette.length)]);
    const i = this.people.length;
    const shirt = pick(SHIRTS), skin = pick(SKIN), trousers = new THREE.Color(TROUSERS[n % TROUSERS.length]);
    this.torso.setColorAt(i, shirt); this.head.setColorAt(i, skin);
    this.hair.setColorAt(i, pick(HAIR)); this.bag.setColorAt(i, pick(BAGS));
    for (const k of [0, 1]) { this.legs.setColorAt(i * 2 + k, trousers); this.arms.setColorAt(i * 2 + k, shirt); this.hands.setColorAt(i * 2 + k, skin); }
    this.looks[i] = { height: 0.9 + this.random() * 0.2, hair: this.random() < 0.1 ? 0 : 1, bag: this.random() < 0.35 ? 1 : 0 };
    return p;
  }

  /** At the end of a street, carry on down another one that meets it, or turn back at a dead end. */
  private turn(p: Person): void {
    const net = this.net!;
    const node = p.dir > 0 ? p.seg.b : p.seg.a;
    const options = net.segsAt(node).filter(s => s.id !== p.seg.id && this.walkable(s));
    if (!options.length || this.random() < 0.08) { p.dir = -p.dir; p.side = -p.side; return; }
    const next = options[Math.floor(this.random() * options.length)];
    const fromA = next.a === node;
    // Keep to the same hand of the person's own direction of travel.
    const hand = p.side * p.dir;
    p.seg = next; p.dir = fromA ? 1 : -1; p.s = fromA ? 0.05 : next.len - 0.05; p.side = hand * p.dir;
    if (this.random() < 0.3) p.pause = 0.6 + this.random() * 2.2; // waiting to cross
  }

  update(dt: number, time: number): void {
    if (!this.net) return;
    // Late at night only a third of the crowd is out.
    const target = Math.round(this.wanted * (1 - this.night * 0.65));
    while (this.people.length < target) {
      const p = this.spawn();
      if (!p) break;
      this.people.push(p);
      for (const m of this.meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (this.people.length > target) this.people.length = target;
    const half = GRID / 2, obj = new THREE.Object3D(), leg = new THREE.Object3D(), hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    this.people.forEach((p, i) => {
      if (!this.net!.segs.has(p.seg.id)) { const q = this.spawn(); if (q) this.people[i] = p = q; }
      let moving = false;
      if (p.pause > 0) p.pause -= dt;
      else {
        p.s += p.dir * p.speed * dt;
        moving = true;
        if (p.s < 0 || p.s > p.seg.len) this.turn(p);
        else if (this.random() < dt * 0.02) p.pause = 1 + this.random() * 3;
      }
      const at = sample(p.seg, Math.max(0, Math.min(p.seg.len, p.s)));
      // The outer half of the pavement: parked cars take the kerb side.
      const off = HALF_WIDTH[p.seg.kind] + 0.066;
      // Right of travel along a → b is (-tz, tx) in this map's axes.
      const x = at.x - at.tz * off * p.side - half, z = at.z + at.tx * off * p.side - half;
      const y = roadHeight(p.seg, p.s) + CURB_TOP;
      const stride = moving ? Math.sin(time * p.speed * 70 + p.phase) : 0;
      const look = this.looks[i] ?? { height: 1, hair: 1, bag: 0 };
      obj.position.set(x, y + Math.abs(stride) * 0.004, z);
      obj.rotation.set(0, Math.atan2(at.tx * p.dir, at.tz * p.dir), 0);
      obj.scale.setScalar(look.height);
      obj.updateMatrix();
      this.torso.setMatrixAt(i, obj.matrix);
      this.head.setMatrixAt(i, obj.matrix);
      this.hair.setMatrixAt(i, look.hair ? obj.matrix : hidden);
      this.bag.setMatrixAt(i, look.bag ? obj.matrix : hidden);
      for (const k of [0, 1]) {
        leg.position.set(k ? 0.009 : -0.009, HIP, 0);
        leg.rotation.set((k ? 1 : -1) * stride * 0.45, 0, 0);
        leg.updateMatrix();
        leg.matrix.premultiply(obj.matrix);
        this.legs.setMatrixAt(i * 2 + k, leg.matrix);
        // Arms swing against the legs, hands at the ends of them.
        leg.position.set(k ? 0.0225 : -0.0225, HIP + 0.042, 0);
        leg.rotation.set((k ? -1 : 1) * stride * 0.5, 0, (k ? 1 : -1) * 0.06);
        leg.updateMatrix();
        leg.matrix.premultiply(obj.matrix);
        this.arms.setMatrixAt(i * 2 + k, leg.matrix);
        this.hands.setMatrixAt(i * 2 + k, leg.matrix);
      }
    });
    this.torso.count = this.head.count = this.hair.count = this.bag.count = this.people.length;
    this.legs.count = this.arms.count = this.hands.count = this.people.length * 2;
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}

/** Point and unit direction a distance s along a street's centre line. */
export function sample(seg: RSeg, s: number): { x: number; z: number; tx: number; tz: number } {
  const { pts, cum, n } = seg;
  let i = 0;
  while (i < n - 1 && cum[i + 1] < s) i++;
  const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
  const len = cum[i + 1] - cum[i] || 1, u = Math.max(0, Math.min(1, (s - cum[i]) / len));
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz) || 1;
  return { x: x0 + dx * u, z: z0 + dz * u, tx: dx / d, tz: dz / d };
}

function mergeBoxes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map(g => g.index ? g.toNonIndexed() : g);
  const count = flat.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3).fill(1);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
