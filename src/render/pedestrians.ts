import * as THREE from 'three';
import { GRID } from '../constants';
import { HALF_WIDTH, KIND_HIGHWAY } from '../roads/network';
import type { Network, RSeg } from '../roads/network';
import { roadHeight } from '../roads/structures';

/** Most people the streets ever hold at once; the city's population sets how many are out. */
const MAX_PEOPLE = 700;
/** A person is about 0.13 tall against a car 0.31 long. */
const HIP = 0.058;
const CURB_TOP = 0.031;

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

function box(w: number, h: number, d: number, y: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y + h / 2, 0);
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
  private net: Network | null = null;
  private version = -1;
  private wanted = 0;
  private night = 0;
  private rnd = 1;

  constructor() {
    const mat = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    // Torso with arms at the sides, a head, and one leg shape drawn twice per person, hinged at the hip.
    const torso = box(0.036, 0.046, 0.022, HIP);
    const arms = [box(0.009, 0.04, 0.012, HIP + 0.004), box(0.009, 0.04, 0.012, HIP + 0.004)];
    arms[0].translate(0.023, 0, 0); arms[1].translate(-0.023, 0, 0);
    const body = mergeBoxes([torso, ...arms]);
    const head = box(0.021, 0.024, 0.021, HIP + 0.05);
    const leg = box(0.013, HIP, 0.014, -HIP);
    this.torso = new THREE.InstancedMesh(body, mat(), MAX_PEOPLE);
    this.head = new THREE.InstancedMesh(head, mat(), MAX_PEOPLE);
    this.legs = new THREE.InstancedMesh(leg, mat(), MAX_PEOPLE * 2);
    for (const m of [this.torso, this.head, this.legs]) {
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3), 3);
      this.group.add(m);
    }
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
    return seg.structure !== 2 && seg.kind !== KIND_HIGHWAY;
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
    const tint = (m: THREE.InstancedMesh, i: number, palette: number[]): void => { m.setColorAt(i, new THREE.Color(palette[Math.floor(this.random() * palette.length)])); };
    const i = this.people.length;
    tint(this.torso, i, SHIRTS); tint(this.head, i, SKIN);
    const trousers = TROUSERS[n % TROUSERS.length];
    this.legs.setColorAt(i * 2, new THREE.Color(trousers)); this.legs.setColorAt(i * 2 + 1, new THREE.Color(trousers));
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
      for (const m of [this.torso, this.head, this.legs]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (this.people.length > target) this.people.length = target;
    const half = GRID / 2, obj = new THREE.Object3D(), leg = new THREE.Object3D();
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
      const off = HALF_WIDTH[p.seg.kind] + 0.045;
      // Right of travel along a → b is (-tz, tx) in this map's axes.
      const x = at.x - at.tz * off * p.side - half, z = at.z + at.tx * off * p.side - half;
      const y = roadHeight(p.seg, p.s) + CURB_TOP;
      const stride = moving ? Math.sin(time * p.speed * 70 + p.phase) : 0;
      obj.position.set(x, y + Math.abs(stride) * 0.004, z);
      obj.rotation.set(0, Math.atan2(at.tx * p.dir, at.tz * p.dir), 0);
      obj.updateMatrix();
      this.torso.setMatrixAt(i, obj.matrix);
      this.head.setMatrixAt(i, obj.matrix);
      for (const k of [0, 1]) {
        leg.position.set(k ? 0.009 : -0.009, HIP, 0);
        leg.rotation.set((k ? 1 : -1) * stride * 0.45, 0, 0);
        leg.updateMatrix();
        leg.matrix.premultiply(obj.matrix);
        this.legs.setMatrixAt(i * 2 + k, leg.matrix);
      }
    });
    this.torso.count = this.head.count = this.people.length;
    this.legs.count = this.people.length * 2;
    for (const m of [this.torso, this.head, this.legs]) m.instanceMatrix.needsUpdate = true;
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
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}
