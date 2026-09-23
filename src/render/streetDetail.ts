import * as THREE from 'three';
import {
  GRID, idx, inBounds, tileHash, isService, isZone, SERVICES,
  T_RES, T_COM, T_IND, T_OFFICE, T_FARM, T_LEISURE, T_PARK,
} from '../constants';
import { HALF_WIDTH, KIND_LANE, KIND_ROAD, KIND_AVENUE, isMotorway } from '../roads/network';
import type { Network } from '../roads/network';
import type { RSeg } from '../roads/network';
import type { Raster } from '../roads/raster';
import type { Terrain } from '../terrain';
import { buildingRotation } from '../placement';
import { VARIANTS } from './buildingGeo';
import type { VisualDetail } from './detail';

/**
 * Street-level detail, streamed in around the camera while walking or driving: the things nobody sees
 * from above but everybody sees on the pavement. Kerb stones, paving joints, gutters, drains, manholes,
 * patched and cracked asphalt, street name signs, traffic signs, parking meters, utility poles and
 * their wires, road works; mailboxes, bins, garden paths, flower beds, sheds, washing lines,
 * trampolines and barbecues behind the houses; air-conditioning units, drainpipes and satellite dishes
 * on the walls; café tables, awnings, A-boards and dumpsters by the shops; flagpoles and planters by
 * the offices; pallets, barrels, containers and forklifts in the yards; hay bales and tractors on the
 * farms; grass, wildflowers, rocks, bushes and fallen logs on open ground; reeds and lily pads along
 * the river.
 *
 * The map is cut into chunks of CHUNK × CHUNK cells. Only chunks near the camera exist at all, each one
 * a single merged mesh; the nearest are built at full detail (the grass, the litter, the paving
 * joints), the rest at a coarser level, and chunks that fall behind are thrown away. A few chunks are
 * built per frame, nearest first, within a time budget, so walking into a new street never stalls.
 */

const CHUNK = 4;
/** How far detail reaches, and how far the finest of it reaches, in cells, at each graphics level. */
const REACH: Record<VisualDetail, { far: number; fine: number }> = {
  0: { far: 8, fine: 3.5 },
  1: { far: 12, fine: 5.5 },
  2: { far: 16, fine: 7.5 },
};
/** Milliseconds a frame may spend building chunks. */
const BUDGET = 5;
const HALF = GRID / 2;
const PAVE = 0.031;
const ASPHALT_TOP = 0.046;
/** The kerb strip beyond the asphalt is this wide. */
const KERB = 0.09;
/** Where a lot's own surface lies: a house's lawn, the paved plaza of the rest, bare ground for yards and farms. */
const lotTop = (k: number, l: number): number => k === T_RES && l === 1 ? 0.012 : k === T_RES || k === T_COM || k === T_OFFICE || k === T_LEISURE ? 0.014 : 0;

/** What the detail is built from: the game's own state, read fresh for each chunk. */
export interface DetailSource {
  kind: Uint8Array;
  level: Uint8Array;
  raster: Raster;
  net: Network;
  terrain: Terrain;
  /** Terraform edits: tiles raised or dug get no lot detail, only what grows on the slopes. */
  terraform: Uint8Array;
  /** Relief height at scene coordinates (x, z), as the hill layer draws it. */
  relief(x: number, z: number): number;
  /** The water's surface on a tile, or NaN where it is dry. */
  surface(tile: number): number;
  /** A building's walls, in its own frame (+z towards its street), or null where it has none. */
  body(kind: number, level: number, variant: number): Body | null;
}
export interface Body { x0: number; x1: number; z0: number; z1: number; h: number }

// ---- geometry --------------------------------------------------------------------------------------

const scratch = new THREE.Color();
/** Colours are authored as sRGB hex and stored linear, like the rest of the scene's vertex colours. */
const linear = new Map<number, [number, number, number]>();
function rgb(hex: number): [number, number, number] {
  let c = linear.get(hex);
  if (!c) { scratch.setHex(hex); c = [scratch.r, scratch.g, scratch.b]; linear.set(hex, c); }
  return c;
}

/**
 * A fast mesh writer for small props: flat-shaded triangles with vertex colours, placed in a local
 * frame (`at`) that is moved and turned about y. Local +z is the frame's front.
 */
class Kit {
  private pos: number[] = [];
  private col: number[] = [];
  private ox = 0; private oy = 0; private oz = 0; private c = 1; private s = 0;
  private cr = 1; private cg = 1; private cb = 1;
  /** A small random shift in brightness for each piece, so no two bins are quite alike. */
  jitter = 0;

  get triangles(): number { return this.pos.length / 9; }

  at(x: number, y: number, z: number, yaw = 0): this {
    this.ox = x; this.oy = y; this.oz = z; this.c = Math.cos(yaw); this.s = Math.sin(yaw);
    return this;
  }

  private paint(hex: number): void {
    const [r, g, b] = rgb(hex), k = 1 + this.jitter;
    this.cr = r * k; this.cg = g * k; this.cb = b * k;
  }

  private v(x: number, y: number, z: number): void {
    this.pos.push(this.ox + x * this.c + z * this.s, this.oy + y, this.oz - x * this.s + z * this.c);
    this.col.push(this.cr, this.cg, this.cb);
  }

  private tri(a: number[], b: number[], c: number[]): void {
    this.v(a[0], a[1], a[2]); this.v(b[0], b[1], b[2]); this.v(c[0], c[1], c[2]);
  }

  private quad4(a: number[], b: number[], c: number[], d: number[]): void {
    this.tri(a, b, c); this.tri(a, c, d);
  }

  /** A box with its base at y, centred on (x, z), turned by `yaw` about its own centre. No bottom face. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number, yaw = 0): void {
    this.paint(color);
    const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
    const p = (u: number, t: number, yy: number): number[] => [x + u * c + t * s, yy, z - u * s + t * c];
    const a0 = p(-hw, -hd, y), b0 = p(hw, -hd, y), c0 = p(hw, hd, y), d0 = p(-hw, hd, y);
    const a1 = p(-hw, -hd, y + h), b1 = p(hw, -hd, y + h), c1 = p(hw, hd, y + h), d1 = p(-hw, hd, y + h);
    this.quad4(a1, d1, c1, b1);
    this.quad4(a0, a1, b1, b0);
    this.quad4(b0, b1, c1, c0);
    this.quad4(c0, c1, d1, d0);
    this.quad4(d0, d1, a1, a0);
  }

  /** An upright prism (a cylinder with few sides), or a cone with `top` 0. */
  prism(x: number, y: number, z: number, r: number, h: number, color: number, seg = 6, top = r): void {
    this.paint(color);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      const q0 = [x + Math.cos(a0) * top, y + h, z + Math.sin(a0) * top], q1 = [x + Math.cos(a1) * top, y + h, z + Math.sin(a1) * top];
      if (top > 0) { this.quad4(p0, q0, q1, p1); this.tri([x, y + h, z], q1, q0); } else this.tri(p0, q0, p1);
    }
  }

  /** A flat, upward-facing rectangle, turned by `yaw`. */
  quad(x: number, y: number, z: number, w: number, d: number, color: number, yaw = 0): void {
    this.paint(color);
    const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
    const p = (u: number, t: number): number[] => [x + u * c + t * s, y, z - u * s + t * c];
    this.quad4(p(-hw, -hd), p(-hw, hd), p(hw, hd), p(hw, -hd));
  }

  /** A flat, upward-facing disc. */
  disc(x: number, y: number, z: number, r: number, color: number, seg = 8): void {
    this.paint(color);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r]);
    }
  }

  /** A rough lump: a squashed octahedron with its corners pushed about, for rocks, bushes and crowns. */
  lump(x: number, y: number, z: number, r: number, color: number, squash = 0.8, rnd: () => number = Math.random): void {
    this.paint(color);
    const k = (): number => 0.8 + rnd() * 0.4;
    const top = [x, y + r * squash * 2 * k(), z], bottom = [x, y, z];
    const mid = y + r * squash * k();
    const ring = [0, 1, 2, 3, 4, 5].map(i => { const a = i / 6 * Math.PI * 2 + rnd() * 0.4; const rr = r * k(); return [x + Math.cos(a) * rr, mid, z + Math.sin(a) * rr]; });
    for (let i = 0; i < 6; i++) {
      const a = ring[i], b = ring[(i + 1) % 6];
      this.tri(a, top, b);
      this.tri(a, b, bottom);
    }
  }

  /** A thin square beam from one local point to another: wires, rails, handles, branches. */
  beam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number, color: number): void {
    this.paint(color);
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz) || 1;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    // Two directions across the beam.
    let ax = -uz, ay = 0, az = ux;
    if (Math.hypot(ax, az) < 1e-3) { ax = 1; ay = 0; az = 0; }
    const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
    const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax;
    const h = t / 2;
    const corner = (px: number, py: number, pz: number, i: number): number[] => {
      const sa = i === 0 || i === 3 ? -h : h, sb = i < 2 ? -h : h;
      return [px + ax * sa + bx * sb, py + ay * sa + by * sb, pz + az * sa + bz * sb];
    };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad4(corner(x0, y0, z0, i), corner(x0, y0, z0, j), corner(x1, y1, z1, j), corner(x1, y1, z1, i));
    }
  }

  /** A cylinder lying on its side along local x (turned by `yaw`): logs, hay bales, pipes, wheels. */
  log(x: number, y: number, z: number, r: number, len: number, color: number, yaw = 0, seg = 7): void {
    this.paint(color);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const p = (u: number, a: number): number[] => {
      const lx = u, ly = r + Math.sin(a) * r, lz = Math.cos(a) * r;
      return [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    };
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.quad4(p(-len / 2, a0), p(-len / 2, a1), p(len / 2, a1), p(len / 2, a0));
      this.tri(p(len / 2, a0), p(len / 2, a1), [x + (len / 2) * c, y + r, z - (len / 2) * s]);
      this.tri(p(-len / 2, a1), p(-len / 2, a0), [x - (len / 2) * c, y + r, z + (len / 2) * s]);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** A small seeded random stream. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length) % list.length];

// ---- palettes --------------------------------------------------------------------------------------

const GRASS = [0x5f8a45, 0x6b9950, 0x78a257, 0x557d3d, 0x87ab5f];
const FLOWERS = [0xe8e2d0, 0xf2c94c, 0xd8453b, 0xb784d6, 0xf09ac0, 0x6fa8dc, 0xf5a14a];
const ROCK = [0x8d8a80, 0x9a968c, 0x7b786f, 0xa8a398];
const BUSH = [0x4f7a3c, 0x5d8a45, 0x466f36, 0x5a8040];
const BIN = [0x3f6b4a, 0x4a5a6a, 0x3a4a7a, 0x6a4a3a, 0x505050];
const CLOTH = [0xe8e2d0, 0xd8453b, 0x6fa8dc, 0xf2c94c, 0x9ac27f, 0xf09ac0];
const AWNING = [0xc8382f, 0x2f6f4f, 0x2f5f9f, 0xd98a2b, 0x7a3f7a, 0x3f7f8f];
const BARREL = [0x2f5f9f, 0xc8382f, 0xe0b030, 0x3f7f4f, 0x6a6a6a];
const CONTAINER = [0xb5452f, 0x2f6f9f, 0x3f7f4f, 0xd98a2b, 0x7a7f86];
const WOOD = 0x8a6240, WOOD_DARK = 0x6b4f36, METAL = 0x9aa3a8, DARK = 0x2f3338, POLE = 0x5d6469;

// ---- the layer -------------------------------------------------------------------------------------

interface Chunk { key: number; mesh: THREE.Mesh | null; fine: boolean; signature: number }

export class StreetDetailLayer {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  private chunks = new Map<number, Chunk>();
  private source: DetailSource | null = null;
  private active = false;
  private reach = REACH[1];
  private frame = 0;
  /** Stats for the debugger: chunks alive and triangles drawn. */
  stats = { chunks: 0, triangles: 0, built: 0 };

  constructor() {
    this.group.visible = false;
  }

  setDetail(detail: VisualDetail): void {
    this.reach = REACH[detail];
  }

  /** Street view on or off: off throws every chunk away. */
  setActive(on: boolean, source: DetailSource | null = null): void {
    this.active = on;
    this.source = source;
    this.group.visible = on;
    if (!on) this.clear();
  }

  clear(): void {
    for (const c of this.chunks.values()) this.drop(c);
    this.chunks.clear();
    this.stats = { chunks: 0, triangles: 0, built: this.stats.built };
  }

  private drop(c: Chunk): void {
    if (!c.mesh) return;
    this.group.remove(c.mesh);
    c.mesh.geometry.dispose();
    c.mesh = null;
  }

  /**
   * Stream chunks in and out around the camera. `urgent` builds everything in reach at once (on
   * stepping into the street) instead of a few chunks per frame.
   */
  update(camera: THREE.Vector3, urgent = false): void {
    const src = this.source;
    if (!this.active || !src) return;
    this.frame++;
    const cx = camera.x + HALF, cz = camera.z + HALF, { far, fine } = this.reach;
    const n = Math.ceil(GRID / CHUNK);
    // Chunks that have fallen behind go first.
    for (const [key, c] of this.chunks) {
      const d = this.distance(key, cx, cz);
      if (d > far + CHUNK) { this.drop(c); this.chunks.delete(key); }
    }
    // Every so often, look for chunks whose streets or buildings changed under them.
    const recheck = this.frame % 20 === 0;
    const wanted: { key: number; d: number; fine: boolean; signature: number }[] = [];
    const r = Math.ceil(far / CHUNK) + 1, kx = Math.floor(cx / CHUNK), kz = Math.floor(cz / CHUNK);
    for (let z = kz - r; z <= kz + r; z++) for (let x = kx - r; x <= kx + r; x++) {
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const key = z * n + x, d = this.distance(key, cx, cz);
      if (d > far) continue;
      const wantFine = d < fine;
      const have = this.chunks.get(key);
      if (have && have.fine === wantFine && !recheck) continue;
      const signature = this.signature(x, z, src);
      if (have && have.fine === wantFine && have.signature === signature) continue;
      wanted.push({ key, d, fine: wantFine, signature });
    }
    wanted.sort((a, b) => a.d - b.d);
    const start = performance.now();
    for (const w of wanted) {
      if (!urgent && performance.now() - start > BUDGET) break;
      this.buildChunk(w.key, w.fine, w.signature, src);
    }
    let triangles = 0;
    for (const c of this.chunks.values()) if (c.mesh) triangles += (c.mesh.geometry.attributes.position.count / 3) | 0;
    this.stats.chunks = this.chunks.size;
    this.stats.triangles = triangles;
  }

  /** Distance from a point (map coordinates) to the nearest point of a chunk. */
  private distance(key: number, x: number, z: number): number {
    const n = Math.ceil(GRID / CHUNK), cx = (key % n) * CHUNK, cz = Math.floor(key / n) * CHUNK;
    const dx = Math.max(cx - x, 0, x - (cx + CHUNK)), dz = Math.max(cz - z, 0, z - (cz + CHUNK));
    return Math.hypot(dx, dz);
  }

  /** A fingerprint of everything a chunk is built from, so it is rebuilt only when that changes. */
  private signature(kx: number, kz: number, src: DetailSource): number {
    let h = src.net.version | 0;
    for (let z = kz * CHUNK - 1; z <= kz * CHUNK + CHUNK; z++) for (let x = kx * CHUNK - 1; x <= kx * CHUNK + CHUNK; x++) {
      if (!inBounds(x, z)) continue;
      const i = idx(x, z);
      h = (Math.imul(h, 31) + src.kind[i] * 7 + src.level[i] * 3 + src.terraform[i] * 11 + src.raster.cover[i]) | 0;
    }
    return h;
  }

  private buildChunk(key: number, fine: boolean, signature: number, src: DetailSource): void {
    const old = this.chunks.get(key);
    if (old) this.drop(old);
    const n = Math.ceil(GRID / CHUNK), x0 = (key % n) * CHUNK, z0 = Math.floor(key / n) * CHUNK;
    const kit = new Kit();
    new ChunkBuilder(kit, src, x0, z0, fine).build();
    const geometry = kit.build();
    let mesh: THREE.Mesh | null = null;
    if (geometry) {
      mesh = new THREE.Mesh(geometry, this.material);
      mesh.receiveShadow = true;
      // Only the nearest detail casts shadows: the far chunks would cost a lot for shadows no one sees.
      mesh.castShadow = fine;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.chunks.set(key, { key, mesh, fine, signature });
    this.stats.built++;
  }
}

// ---- what goes in a chunk --------------------------------------------------------------------------

/** One chunk's worth of detail. Coordinates in here are map coordinates unless they say scene. */
class ChunkBuilder {
  private readonly rnd: () => number;
  private readonly kit: Kit;
  private readonly src: DetailSource;
  private readonly x0: number;
  private readonly z0: number;
  private readonly fine: boolean;
  constructor(kit: Kit, src: DetailSource, x0: number, z0: number, fine: boolean) {
    this.kit = kit; this.src = src; this.x0 = x0; this.z0 = z0; this.fine = fine;
    this.rnd = stream(x0 * 7919 + z0 * 104729 + (fine ? 1 : 0));
  }

  private inside(x: number, z: number): boolean {
    return x >= this.x0 && x < this.x0 + CHUNK && z >= this.z0 && z < this.z0 + CHUNK;
  }

  build(): void {
    this.roads();
    for (let z = this.z0; z < this.z0 + CHUNK; z++) for (let x = this.x0; x < this.x0 + CHUNK; x++) {
      if (!inBounds(x, z)) continue;
      this.tile(idx(x, z));
    }
  }

  // ---- roads ----

  private roads(): void {
    const { net } = this.src;
    const pad = 1.6;
    for (const seg of net.segs.values()) {
      if (seg.structure) continue;
      if (seg.maxX < this.x0 - pad || seg.minX > this.x0 + CHUNK + pad || seg.maxZ < this.z0 - pad || seg.minZ > this.z0 + CHUNK + pad) continue;
      this.road(seg);
    }
    // Street name signs at the corners of junctions.
    for (const node of net.nodes.values()) {
      if (!this.inside(node.x, node.z) || node.ring || net.degree(node.id) < 3) continue;
      this.nameSign(node.id);
    }
  }

  /** How far from each end of a segment its pavement is clear of the junction there. */
  private endGap(seg: RSeg, node: number): number {
    const { net } = this.src;
    if (net.degree(node) < 2) return 0.08;
    let hw = 0;
    for (const s of net.segsAt(node)) if (s.id !== seg.id) hw = Math.max(hw, HALF_WIDTH[s.kind]);
    return hw + KERB + 0.12;
  }

  private road(seg: RSeg): void {
    const kit = this.kit, rnd = this.rnd, fine = this.fine;
    const hw = HALF_WIDTH[seg.kind], motor = isMotorway(seg.kind);
    const gapA = this.endGap(seg, seg.a), gapB = seg.len - this.endGap(seg, seg.b);
    const at = (s: number) => sampleSeg(seg, s);
    const segHash = tileHash(seg.id * 977 + 13);

    // Pavement: paving joints across it and a crisp kerb stone edge along it, and a gutter beside it.
    if (fine && !motor) {
      for (let s = gapA; s < gapB; s += 0.07) {
        const p = at(s);
        if (!this.inside(p.x, p.z)) continue;
        const yaw = Math.atan2(p.tx, p.tz);
        for (const side of [-1, 1]) {
          const nx = -p.tz * side, nz = p.tx * side;
          const mid = hw + KERB / 2;
          kit.jitter = 0;
          kit.at(p.x + nx * mid - HALF, PAVE + 0.0006, p.z + nz * mid - HALF, yaw).quad(0, 0, 0, KERB, 0.003, 0x9c998f);
          // Kerb stones: one per joint, a shade lighter, standing a hair proud of the paving.
          kit.jitter = (rnd() - 0.5) * 0.08;
          kit.at(p.x + nx * (hw + 0.006) - HALF, PAVE - 0.004, p.z + nz * (hw + 0.006) - HALF, yaw).box(0, 0, 0, 0.012, 0.0052, 0.066, 0xd2cec4);
          // Gutter on the asphalt against the kerb.
          kit.jitter = 0;
          kit.at(p.x + nx * (hw - 0.012) - HALF, ASPHALT_TOP + 0.0004, p.z + nz * (hw - 0.012) - HALF, yaw).quad(0, 0, 0, 0.022, 0.07, 0x40424a);
          // A fallen leaf, a bottle cap, a scrap of paper: the odd bit of litter in the gutter and on the paving.
          if (rnd() < 0.12) {
            const off = rnd() < 0.5 ? hw - 0.01 : hw + 0.02 + rnd() * 0.06;
            kit.jitter = (rnd() - 0.5) * 0.2;
            kit.at(p.x + nx * off - HALF, (off < hw ? ASPHALT_TOP : PAVE) + 0.0012, p.z + nz * off - HALF, rnd() * 6);
            kit.quad(0, 0, 0, 0.006 + rnd() * 0.006, 0.004 + rnd() * 0.006, pick(rnd, [0xb5864f, 0xd98a2b, 0x8a6a3a, 0xe8e2d0, 0xc8382f, 0x9ac27f]));
          }
        }
      }
    }

    // Asphalt wear: patches, cracks, oil stains, all flush with the surface.
    if (fine) {
      for (let s = 0.2; s < seg.len - 0.2; s += 0.6) {
        const p = at(s + rnd() * 0.4);
        if (!this.inside(p.x, p.z) || rnd() < 0.35) continue;
        const across = (rnd() * 2 - 1) * hw * 0.85, yaw = Math.atan2(p.tx, p.tz) + (rnd() - 0.5) * 0.3;
        const x = p.x - p.tz * across - HALF, z = p.z + p.tx * across - HALF;
        const what = rnd();
        kit.jitter = 0;
        if (what < 0.4) {
          kit.at(x, ASPHALT_TOP + 0.0007, z, yaw).quad(0, 0, 0, 0.05 + rnd() * 0.12, 0.08 + rnd() * 0.2, pick(rnd, [0x3f4047, 0x55565e, 0x47484f]));
        } else if (what < 0.8) {
          // A crack: a zigzag of thin dark strokes.
          let cx = 0, cz = 0, a = rnd() * Math.PI;
          kit.at(x, ASPHALT_TOP + 0.0008, z, 0);
          for (let k = 0; k < 4; k++) {
            const l = 0.03 + rnd() * 0.05, nx = cx + Math.cos(a) * l, nz = cz + Math.sin(a) * l;
            kit.quad((cx + nx) / 2, 0, (cz + nz) / 2, 0.003, l, 0x2e2f35, Math.atan2(nx - cx, nz - cz));
            cx = nx; cz = nz; a += (rnd() - 0.5) * 1.6;
          }
        } else if (!motor) {
          kit.at(x, ASPHALT_TOP + 0.0007, z, 0).disc(0, 0, 0, 0.012 + rnd() * 0.02, 0x383940, 7);
        }
      }
    }

    // Manholes in the lanes and drains at the kerb.
    for (let s = 0.9 + segHash * 1.3; s < seg.len - 0.4; s += 1.7 + rnd() * 0.8) {
      const p = at(s);
      if (!this.inside(p.x, p.z)) continue;
      const lane = (rnd() < 0.5 ? -1 : 1) * hw * (motor ? 0.3 : 0.45);
      const x = p.x - p.tz * lane - HALF, z = p.z + p.tx * lane - HALF;
      kit.jitter = 0;
      kit.at(x, ASPHALT_TOP + 0.0009, z, 0).disc(0, 0, 0, 0.026, 0x55575c, 10);
      kit.disc(0, 0.0003, 0, 0.021, 0x3a3c41, 10);
      if (fine) for (const o of [-0.01, 0, 0.01]) kit.quad(o, 0.0006, 0, 0.002, 0.034, 0x4c4e53);
    }
    if (!motor) for (let s = Math.max(gapA, 0.5) + segHash; s < gapB; s += 1.15) {
      const p = at(s);
      if (!this.inside(p.x, p.z)) continue;
      const side = Math.floor(s) % 2 ? 1 : -1, off = hw - 0.016;
      const x = p.x - p.tz * off * side - HALF, z = p.z + p.tx * off * side - HALF;
      kit.jitter = 0;
      kit.at(x, ASPHALT_TOP + 0.0009, z, Math.atan2(p.tx, p.tz)).quad(0, 0, 0, 0.024, 0.05, 0x26282c);
      if (fine) for (let k = -2; k <= 2; k++) kit.quad(0, 0.0004, k * 0.009, 0.02, 0.003, 0x55575c);
    }

    if (motor) return;

    // Kerbside furniture of the road itself: signs, meters, poles and wires.
    const { kind, level } = this.src;
    const frontage = (p: { x: number; z: number; tx: number; tz: number }, side: number): number => {
      const d = hw + KERB + 0.4, tx = Math.floor(p.x - p.tz * d * side), tz = Math.floor(p.z + p.tx * d * side);
      if (!inBounds(tx, tz)) return -1;
      const i = idx(tx, tz);
      return level[i] > 0 || !isZone(kind[i]) ? kind[i] : -1;
    };
    const kerbAt = (p: { x: number; z: number; tx: number; tz: number }, side: number, off = hw + 0.022) => ({
      x: p.x - p.tz * off * side - HALF, z: p.z + p.tx * off * side - HALF, face: Math.atan2(p.tz * side, -p.tx * side),
    });

    // Traffic signs every few cells, alternating sides.
    for (let s = Math.max(gapA, 0.9) + segHash * 2; s < gapB - 0.4; s += 3.1 + rnd()) {
      const p = at(s);
      if (!this.inside(p.x, p.z)) continue;
      const side = rnd() < 0.5 ? -1 : 1, k = kerbAt(p, side);
      if (this.src.net.onRoad(k.x + HALF, k.z + HALF, seg.id, 0.02)) continue;
      // Facing the traffic that comes towards it on its own side of the road.
      this.sign(k.x, k.z, Math.atan2(-p.tx * side, -p.tz * side), seg.oneway ? 'oneway' : pick(rnd, seg.kind === KIND_AVENUE ? ['limit', 'noparking', 'limit', 'crossing'] : ['limit', 'noparking', 'children', 'limit']));
    }

    // Parking meters outside shops and offices.
    for (let s = Math.max(gapA, 0.4); s < gapB; s += 0.42) {
      const p = at(s);
      if (!this.inside(p.x, p.z)) continue;
      for (const side of [-1, 1]) {
        const k = frontage(p, side);
        if (k !== T_COM && k !== T_OFFICE) continue;
        if (tileHash(Math.floor(s * 10) * 31 + seg.id * 7 + (side + 1)) < 0.45) continue;
        const m = kerbAt(p, side, hw + 0.018);
        kit.jitter = 0;
        kit.at(m.x, PAVE, m.z, m.face);
        kit.box(0, 0, 0, 0.005, 0.07, 0.005, POLE);
        kit.box(0, 0.07, 0, 0.014, 0.022, 0.01, 0x7a8288);
        kit.box(0, 0.08, 0.0052, 0.009, 0.008, 0.0005, 0xd8e0e6);
      }
    }

    // Wooden utility poles carrying wires along the house streets.
    if (seg.kind === KIND_LANE || seg.kind === KIND_ROAD) {
      const side = segHash < 0.5 ? -1 : 1;
      const posts: { x: number; z: number; face: number }[] = [];
      for (let s = Math.max(gapA, 0.3); s < gapB; s += 1.25) {
        const p = at(s), k = frontage(p, side);
        if (k !== T_RES && k !== T_FARM && k !== 0) continue;
        posts.push(kerbAt(p, side, hw + 0.03));
      }
      const top = 0.36;
      posts.forEach((q, i) => {
        const here = this.inside(q.x + HALF, q.z + HALF);
        if (here) {
          kit.jitter = (rnd() - 0.5) * 0.1;
          kit.at(q.x, PAVE, q.z, q.face);
          kit.prism(0, 0, 0, 0.007, top, 0x6b5238, 6, 0.006);
          kit.box(0, top - 0.03, 0, 0.1, 0.008, 0.008, 0x5a4530, Math.PI / 2);
          for (const o of [-0.04, 0, 0.04]) kit.prism(0, top - 0.022, o, 0.003, 0.01, 0xd8d4c8, 4);
          if (i % 3 === 1) kit.prism(0.016, top - 0.12, 0, 0.012, 0.03, 0x7a8288, 6); // a transformer
        }
        const next = posts[i + 1];
        if (!next || !here) return;
        // Three wires to the next pole, sagging in the middle.
        const d = Math.hypot(next.x - q.x, next.z - q.z);
        if (d > 1.6) return;
        kit.at(0, 0, 0, 0);
        for (const o of [-0.04, 0, 0.04]) {
          const ox = Math.cos(q.face) * o, oz = -Math.sin(q.face) * o;
          const ax = q.x + ox, az = q.z + oz, bx = next.x + ox, bz = next.z + oz, y = PAVE + top - 0.01, sag = 0.035;
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          kit.beam(ax, y, az, mx, y - sag, mz, 0.0018, 0x2a2c30);
          kit.beam(mx, y - sag, mz, bx, y, bz, 0.0018, 0x2a2c30);
        }
      });
    }

    // Now and then, road works: cones round a hole and a barrier.
    if (this.fine && segHash > 0.93 && seg.len > 2) {
      const p = at(seg.len / 2);
      if (this.inside(p.x, p.z)) {
        const lane = hw * 0.45, x = p.x - p.tz * lane - HALF, z = p.z + p.tx * lane - HALF, yaw = Math.atan2(p.tx, p.tz);
        kit.jitter = 0;
        kit.at(x, ASPHALT_TOP, z, yaw);
        kit.quad(0, 0.001, 0, 0.12, 0.2, 0x5b4a3a);
        for (const [cx, cz] of [[-0.08, -0.13], [0.08, -0.13], [-0.08, 0.13], [0.08, 0.13], [0, -0.16], [0, 0.16]]) {
          kit.box(cx, 0, cz, 0.018, 0.003, 0.018, DARK);
          kit.prism(cx, 0.003, cz, 0.007, 0.03, 0xf07a1a, 6, 0.0015);
          kit.prism(cx, 0.013, cz, 0.0052, 0.006, 0xf2f2ee, 6, 0.004);
        }
        kit.box(0, 0, -0.11, 0.14, 0.004, 0.01, 0xd8453b);
        kit.box(0, 0.028, -0.11, 0.14, 0.012, 0.004, 0xf2f2ee);
        for (const bx of [-0.06, 0.06]) kit.box(bx, 0, -0.11, 0.004, 0.04, 0.004, DARK);
        kit.box(0.05, 0, 0.05, 0.03, 0.02, 0.03, 0x6b6560);
      }
    }
  }

  /** A traffic sign on a pole, its face towards the traffic. */
  private sign(x: number, z: number, face: number, what: string): void {
    const kit = this.kit;
    kit.jitter = 0;
    kit.at(x, PAVE, z, face);
    kit.box(0, 0, 0, 0.005, 0.17, 0.005, POLE);
    const y = 0.15;
    switch (what) {
      case 'limit':
        kit.box(0, y, 0.004, 0.036, 0.036, 0.002, 0xd8453b);
        kit.box(0, y + 0.004, 0.0052, 0.028, 0.028, 0.0005, 0xf2f2ee);
        kit.box(-0.005, y + 0.011, 0.0056, 0.004, 0.014, 0.0005, DARK);
        kit.box(0.005, y + 0.011, 0.0056, 0.008, 0.014, 0.0005, DARK);
        break;
      case 'noparking':
        kit.box(0, y, 0.004, 0.034, 0.034, 0.002, 0xc8382f);
        kit.box(0, y + 0.004, 0.0052, 0.026, 0.026, 0.0005, 0x2f5f9f);
        kit.beam(-0.011, y + 0.006, 0.0058, 0.011, y + 0.028, 0.0058, 0.004, 0xc8382f);
        break;
      case 'oneway':
        kit.box(0, y, 0.004, 0.05, 0.018, 0.002, 0x2f5f9f);
        kit.box(-0.004, y + 0.007, 0.0052, 0.03, 0.004, 0.0005, 0xf2f2ee);
        kit.box(0.014, y + 0.004, 0.0052, 0.006, 0.01, 0.0005, 0xf2f2ee);
        break;
      case 'children':
      case 'crossing':
        kit.box(0, y, 0.004, 0.036, 0.036, 0.002, what === 'crossing' ? 0x2f5f9f : 0xf2f2ee);
        kit.box(0, y + 0.006, 0.0052, 0.024, 0.024, 0.0005, what === 'crossing' ? 0xf2f2ee : 0xd8453b);
        kit.box(0, y + 0.01, 0.0056, 0.006, 0.014, 0.0005, DARK);
        break;
    }
  }

  /** A street name sign on the corner of a junction: a pole with a blade along each of two streets. */
  private nameSign(node: number): void {
    const { net } = this.src;
    const n = net.nodes.get(node)!;
    const arms = net.segsAt(node).filter(s => !s.structure && !isMotorway(s.kind));
    if (arms.length < 2) return;
    const dir = (s: RSeg): { x: number; z: number } => {
      const fromA = s.a === node, i = fromA ? 1 : s.n - 1;
      const px = s.pts[i * 2], pz = s.pts[i * 2 + 1];
      const d = Math.hypot(px - n.x, pz - n.z) || 1;
      return { x: (px - n.x) / d, z: (pz - n.z) / d };
    };
    const a = dir(arms[0]), b = dir(arms[1]);
    // The corner between the first two arms, just behind the kerb of both.
    let bx = a.x + b.x, bz = a.z + b.z;
    const bl = Math.hypot(bx, bz);
    if (bl < 0.2) { bx = -a.z; bz = a.x; } else { bx /= bl; bz /= bl; }
    const hw = Math.max(HALF_WIDTH[arms[0].kind], HALF_WIDTH[arms[1].kind]);
    const r = (hw + KERB * 0.7) * 1.414;
    const x = n.x + bx * r, z = n.z + bz * r;
    if (net.onRoad(x, z, -1, 0.01)) return;
    const kit = this.kit;
    kit.jitter = 0;
    kit.at(x - HALF, PAVE, z - HALF, 0);
    kit.box(0, 0, 0, 0.006, 0.22, 0.006, POLE);
    kit.prism(0, 0.22, 0, 0.004, 0.006, POLE, 6, 0.001);
    const colors = [0x2f6f4f, 0x2f5f9f];
    [a, b].forEach((d, k) => {
      const yaw = Math.atan2(d.x, d.z), y = 0.19 + k * 0.016;
      kit.box(Math.sin(yaw) * 0.028, y, Math.cos(yaw) * 0.028, 0.002, 0.013, 0.06, colors[k], yaw);
      kit.box(Math.sin(yaw) * 0.028, y + 0.004, Math.cos(yaw) * 0.028, 0.0028, 0.005, 0.04, 0xf2f2ee, yaw);
    });
  }

  // ---- tiles ----

  private tile(i: number): void {
    const { kind, level, terrain, raster, terraform } = this.src;
    const x = i % GRID, z = Math.floor(i / GRID);
    if (terrain.water[i]) { this.water(i, x, z); return; }
    if (raster.cover[i]) return;
    const k = kind[i];
    const shaped = terraform[i] !== 0;
    if (terrain.shore[i]) this.shore(i, x, z);
    if (shaped || !k) { this.wild(i, x, z, shaped ? 0.6 : 1); return; }
    if (isZone(k)) {
      if (!level[i]) { this.emptyLot(i, x, z); return; }
      this.lot(i);
      return;
    }
    if (isService(k)) this.service(i, k);
  }

  /** Open ground: grass, wildflowers, rocks, bushes, now and then a sapling, a log or mushrooms. */
  private wild(i: number, x: number, z: number, density: number): void {
    const kit = this.kit, rnd = this.rnd, fine = this.fine;
    const ground = (px: number, pz: number): number => this.src.relief(px - HALF, pz - HALF);
    const tufts = Math.round((fine ? 22 : 5) * density);
    for (let t = 0; t < tufts; t++) {
      const px = x + rnd(), pz = z + rnd(), y = ground(px, pz);
      this.tuft(px - HALF, y, pz - HALF);
    }
    if (fine) for (let f = 0; f < 4 * density; f++) {
      if (rnd() < 0.5) continue;
      // A drift of wildflowers of one colour.
      const cx = x + rnd(), cz = z + rnd(), color = pick(rnd, FLOWERS);
      for (let k = 0; k < 5; k++) {
        const px = cx + (rnd() - 0.5) * 0.12, pz = cz + (rnd() - 0.5) * 0.12;
        const y = ground(px, pz), h = 0.012 + rnd() * 0.012;
        kit.jitter = 0;
        kit.at(px - HALF, y, pz - HALF, 0);
        kit.box(0, 0, 0, 0.0015, h, 0.0015, 0x4f7a3c);
        kit.jitter = (rnd() - 0.5) * 0.15;
        kit.box(0, h, 0, 0.006, 0.004, 0.006, color, rnd());
      }
    }
    const h = tileHash(i * 13 + 5);
    if (h < 0.35 * density) {
      const px = x + 0.15 + rnd() * 0.7, pz = z + 0.15 + rnd() * 0.7;
      kit.jitter = (rnd() - 0.5) * 0.15;
      kit.at(px - HALF, ground(px, pz) - 0.004, pz - HALF, 0).lump(0, 0, 0, 0.015 + rnd() * 0.03, pick(rnd, ROCK), 0.55, rnd);
      if (rnd() < 0.5) kit.lump(0.03, 0, 0.01, 0.01 + rnd() * 0.012, pick(rnd, ROCK), 0.5, rnd);
    }
    if (h > 0.55) {
      const px = x + 0.15 + rnd() * 0.7, pz = z + 0.15 + rnd() * 0.7, r = 0.03 + rnd() * 0.035;
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.at(px - HALF, ground(px, pz), pz - HALF, 0).lump(0, 0, 0, r, pick(rnd, BUSH), 0.7, rnd);
      kit.lump(r * 0.7, 0, r * 0.3, r * 0.7, pick(rnd, BUSH), 0.7, rnd);
    }
    if (h > 0.9) {
      // A young tree.
      const px = x + 0.3 + rnd() * 0.4, pz = z + 0.3 + rnd() * 0.4, th = 0.1 + rnd() * 0.08;
      kit.jitter = 0;
      kit.at(px - HALF, ground(px, pz), pz - HALF, 0);
      kit.prism(0, 0, 0, 0.006, th, WOOD_DARK, 5, 0.004);
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.lump(0, th * 0.7, 0, 0.045, pick(rnd, BUSH), 0.9, rnd);
    } else if (h > 0.82 && fine) {
      // A fallen log, with a few mushrooms at its foot.
      const px = x + 0.2 + rnd() * 0.6, pz = z + 0.2 + rnd() * 0.6, yaw = rnd() * Math.PI;
      kit.jitter = (rnd() - 0.5) * 0.1;
      kit.at(px - HALF, ground(px, pz) - 0.006, pz - HALF, yaw).log(0, 0, 0, 0.014, 0.16, WOOD_DARK, 0, 7);
      kit.jitter = 0;
      for (let m = 0; m < 3; m++) {
        const mx = (rnd() - 0.5) * 0.12, mz = 0.03 + rnd() * 0.02;
        kit.box(mx, 0.006, mz, 0.003, 0.008, 0.003, 0xe8e2d0);
        kit.prism(mx, 0.013, mz, 0.007, 0.004, pick(rnd, [0xc8382f, 0xb5864f, 0xe8e2d0]), 6, 0.002);
      }
    }
  }

  /** A few blades of grass: three thin green spikes. */
  private tuft(x: number, y: number, z: number): void {
    const kit = this.kit, rnd = this.rnd;
    kit.jitter = (rnd() - 0.5) * 0.25;
    kit.at(x, y, z, 0);
    const color = pick(rnd, GRASS);
    for (let k = 0; k < 3; k++) {
      const a = rnd() * Math.PI * 2, d = 0.004;
      kit.prism(Math.cos(a) * d, 0, Math.sin(a) * d, 0.0035, 0.012 + rnd() * 0.014, color, 3, 0);
    }
  }

  /** Reeds and stones on the bank beside the water. */
  private shore(i: number, x: number, z: number): void {
    const kit = this.kit, rnd = this.rnd, { terrain } = this.src;
    let wx = 0, wz = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (inBounds(nx, nz) && terrain.water[idx(nx, nz)]) { wx += dx; wz += dz; }
    }
    if (!wx && !wz) return;
    const clumps = this.fine ? 4 : 2;
    for (let c = 0; c < clumps; c++) {
      // Along the water's edge of the cell.
      const u = rnd(), edge = 0.42 + rnd() * 0.08;
      const px = x + 0.5 + wx * edge + (wz ? u - 0.5 : 0), pz = z + 0.5 + wz * edge + (wx ? u - 0.5 : 0);
      const y = this.src.relief(px - HALF, pz - HALF);
      kit.at(px - HALF, y, pz - HALF, 0);
      const stems = this.fine ? 7 : 4;
      for (let k = 0; k < stems; k++) {
        const ox = (rnd() - 0.5) * 0.06, oz = (rnd() - 0.5) * 0.06, h = 0.05 + rnd() * 0.05;
        kit.jitter = (rnd() - 0.5) * 0.2;
        kit.prism(ox, -0.01, oz, 0.0028, h, pick(rnd, [0x7a8f45, 0x8a9a55, 0x6b8040]), 3, 0);
        if (rnd() < 0.3) { kit.jitter = 0; kit.prism(ox, h * 0.7, oz, 0.0035, 0.014, 0x6b4a2a, 5); }
      }
    }
    if (this.fine && rnd() < 0.6) {
      const px = x + 0.5 + wx * 0.4 + (rnd() - 0.5) * 0.6, pz = z + 0.5 + wz * 0.4 + (rnd() - 0.5) * 0.6;
      kit.jitter = (rnd() - 0.5) * 0.1;
      kit.at(px - HALF, this.src.relief(px - HALF, pz - HALF) - 0.005, pz - HALF, 0).lump(0, 0, 0, 0.012 + rnd() * 0.015, pick(rnd, ROCK), 0.5, rnd);
    }
    void i;
  }

  /** Lily pads floating in the still water by the banks. */
  private water(i: number, x: number, z: number): void {
    if (!this.fine) return;
    const { terrain } = this.src;
    let land = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (inBounds(nx, nz) && !terrain.water[idx(nx, nz)]) land++;
    }
    const level = this.src.surface(i);
    if (!land || level !== level || tileHash(i * 7 + 3) < 0.55) return;
    const kit = this.kit, rnd = this.rnd;
    const cx = x + 0.2 + rnd() * 0.6, cz = z + 0.2 + rnd() * 0.6;
    for (let k = 0; k < 6; k++) {
      const px = cx + (rnd() - 0.5) * 0.25, pz = cz + (rnd() - 0.5) * 0.25;
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.at(px - HALF, level + 0.004, pz - HALF, 0).disc(0, 0, 0, 0.012 + rnd() * 0.012, 0x4f8a3c, 7);
      if (rnd() < 0.25) { kit.jitter = 0; kit.box(0, 0.001, 0, 0.007, 0.004, 0.007, pick(rnd, [0xf2f2ee, 0xf09ac0]), rnd()); }
    }
  }

  /** A zoned lot nobody has built on yet: long grass and a sign saying what it is for. */
  private emptyLot(i: number, x: number, z: number): void {
    this.wild(i, x, z, 0.7);
    if (!this.fine || tileHash(i * 17 + 1) < 0.6) return;
    const { raster } = this.src;
    if (raster.accSeg[i] < 0) return;
    const cx = x + 0.5, cz = z + 0.5, dx = raster.accX[i] - cx, dz = raster.accZ[i] - cz, d = Math.hypot(dx, dz) || 1;
    const px = cx + dx / d * 0.38, pz = cz + dz / d * 0.38, face = Math.atan2(dx, dz);
    const color = this.src.kind[i] === T_RES ? 0x5fae4f : this.src.kind[i] === T_COM ? 0x3f7fd0 : 0xd0a03f;
    const kit = this.kit;
    kit.jitter = 0;
    kit.at(px - HALF, 0, pz - HALF, face);
    for (const o of [-0.03, 0.03]) kit.box(o, 0, 0, 0.005, 0.1, 0.005, WOOD);
    kit.box(0, 0.06, 0.003, 0.08, 0.045, 0.004, 0xf2f2ee);
    kit.box(0, 0.085, 0.0055, 0.07, 0.012, 0.001, color);
    kit.box(0, 0.068, 0.0055, 0.05, 0.004, 0.001, 0x6a6a6a);
  }

  /** The frame of a built lot: its centre in the scene and the way its front faces. */
  private lotFrame(i: number): { x: number; z: number; yaw: number } {
    const { raster } = this.src;
    const tx = raster.lotX[i], tz = raster.lotZ[i];
    const yaw = raster.accSeg[i] >= 0 ? buildingRotation(raster.accX[i] - tx, raster.accZ[i] - tz) : 0;
    return { x: tx - HALF, z: tz - HALF, yaw };
  }

  private lot(i: number): void {
    const { kind, level } = this.src;
    const k = kind[i], l = level[i], v = Math.floor(tileHash(i) * VARIANTS) % VARIANTS;
    const body = this.src.body(k, l, v);
    const f = this.lotFrame(i);
    const top = lotTop(k, l);
    this.remember(f.x, top, f.z, f.yaw);
    this.kit.at(f.x, top, f.z, f.yaw);
    const rnd = stream(i * 2654435761 + (this.fine ? 7 : 3));
    if (body) this.walls(body, k, l, rnd);
    switch (k) {
      case T_RES: if (l === 1) this.house(i, body, rnd); else this.flats(i, body, l, rnd); break;
      case T_COM: this.shop(i, body, l, rnd); break;
      case T_OFFICE: this.office(i, body, rnd); break;
      case T_IND: this.yard(body, l, rnd); break;
      case T_FARM: this.farm(i, rnd); break;
      case T_LEISURE: this.leisure(i, body, rnd); break;
    }
  }

  /** Things fixed to a building's walls: drainpipes, air conditioners, meters, dishes, vents. */
  private walls(b: Body, k: number, l: number, rnd: () => number): void {
    const kit = this.kit;
    if (b.x1 - b.x0 < 0.1 || b.h < 0.2) return;
    const eave = Math.min(b.h, 1.4);
    kit.jitter = 0;
    // Drainpipes down the back corners and down the front ones of lower buildings.
    for (const [x, z] of [[b.x0 + 0.012, b.z0 - 0.006], [b.x1 - 0.012, b.z0 - 0.006]]) kit.box(x, 0, z, 0.01, eave, 0.01, 0x6b7879);
    if (b.h < 0.9) for (const x of [b.x0 - 0.006, b.x1 + 0.006]) kit.box(x, 0, b.z1 - 0.02, 0.01, eave, 0.01, 0x6b7879);
    // Air conditioners on the side walls, one per floor or so.
    const floors = Math.max(1, Math.min(12, Math.floor((b.h - 0.1) / 0.31)));
    for (const side of [-1, 1]) {
      const wx = side < 0 ? b.x0 : b.x1;
      for (let f = 0; f < floors; f++) {
        if (rnd() < (l === 1 ? 0.5 : 0.55)) continue;
        const y = 0.12 + f * 0.31 + rnd() * 0.05, z = b.z0 + 0.06 + rnd() * Math.max(0.01, b.z1 - b.z0 - 0.12);
        if (y > b.h - 0.1) continue;
        kit.box(wx + side * 0.016, y, z, 0.032, 0.03, 0.05, 0xd8d8d2);
        kit.box(wx + side * 0.0325, y + 0.006, z, 0.001, 0.018, 0.036, 0x6a6e72);
        kit.box(wx + side * 0.01, y - 0.004, z, 0.02, 0.004, 0.04, 0x8a8e92);
      }
    }
    // Gas and electricity meters by the base of a side wall.
    const mx = rnd() < 0.5 ? b.x0 - 0.008 : b.x1 + 0.008;
    kit.box(mx, 0.02, b.z1 - 0.08, 0.016, 0.04, 0.03, 0xe8e4d8);
    kit.box(mx, 0.03, b.z1 - 0.12, 0.012, 0.028, 0.024, 0x9a9e94);
    // A satellite dish high on a side or back wall.
    if (rnd() < (k === T_RES ? 0.45 : 0.2)) {
      const sx = rnd() < 0.5 ? b.x0 - 0.02 : b.x1 + 0.02, y = Math.min(eave - 0.06, 0.2 + rnd() * (eave - 0.25));
      kit.box(sx, y, b.z0 + 0.1, 0.02, 0.004, 0.004, METAL);
      kit.prism(sx, y - 0.018, b.z0 + 0.1, 0.02, 0.006, 0xe8e8e2, 8, 0.024);
      kit.box(sx, y - 0.012, b.z0 + 0.1, 0.003, 0.02, 0.003, METAL);
    }
    // A vent grille or two at the foot of the back wall of the bigger buildings.
    if (l > 1 || k !== T_RES) for (let n = 0; n < 2; n++) kit.box(b.x0 + 0.1 + rnd() * Math.max(0.01, b.x1 - b.x0 - 0.2), 0.02, b.z0 - 0.002, 0.05, 0.03, 0.004, 0x5a5e62);
    // Rooftop clutter on the low buildings you can see the top of from the street.
    if (b.h < 1.1 && k !== T_RES) {
      for (let n = 0; n < 3; n++) {
        const x = b.x0 + 0.08 + rnd() * Math.max(0.01, b.x1 - b.x0 - 0.16), z = b.z0 + 0.08 + rnd() * Math.max(0.01, b.z1 - b.z0 - 0.16);
        if (rnd() < 0.5) { kit.box(x, b.h, z, 0.06, 0.04, 0.05, 0xb8b8b2); kit.prism(x, b.h + 0.04, z, 0.016, 0.004, 0x5a5e62, 8); }
        else kit.prism(x, b.h, z, 0.008, 0.05, METAL, 6);
      }
    }
  }

  /** A house: mailbox, bins, a path to the door, flower beds, and a back garden full of life. */
  private house(i: number, b: Body | null, rnd: () => number): void {
    const kit = this.kit, fine = this.fine;
    const front = b ? b.z1 : 0.3, back = b ? b.z0 : -0.25, left = b ? b.x0 : -0.3, right = b ? b.x1 : 0.3;
    kit.jitter = 0;
    // Mailbox at the front edge, and the path from the pavement to the door.
    kit.box(-0.36, 0, 0.44, 0.005, 0.06, 0.005, WOOD);
    kit.box(-0.36, 0.06, 0.44, 0.014, 0.014, 0.026, pick(rnd, [0x2f3338, 0xc8382f, 0x2f5f9f, 0xe8e2d0]));
    if (front < 0.47) kit.quad(0.1, 0.0015, (front + 0.48) / 2, 0.07, 0.48 - front, 0xb5aa98);
    if (fine && front < 0.47) for (let s = front + 0.02; s < 0.47; s += 0.035) kit.quad(0.1, 0.002, s, 0.068, 0.002, 0x9a8f7e);
    // Wheelie bins beside the house.
    const binX = right + 0.05 < 0.45 ? right + 0.045 : left - 0.045;
    if (Math.abs(binX) < 0.44) for (const [n, color] of [[0, pick(rnd, BIN)], [1, pick(rnd, BIN)]] as [number, number][]) {
      const z = front - 0.03 - n * 0.045;
      kit.box(binX, 0, z, 0.034, 0.05, 0.036, color);
      kit.box(binX, 0.05, z, 0.037, 0.005, 0.04, color);
      kit.log(binX, -0.0005, z - 0.016, 0.004, 0.034, DARK, 0, 5);
    }
    // Flower beds along the front wall.
    if (front < 0.44) {
      for (let x = left + 0.02; x < right - 0.02; x += 0.03) {
        if (Math.abs(x - 0.1) < 0.05) continue;
        kit.jitter = (rnd() - 0.5) * 0.2;
        kit.lump(x, 0, front + 0.02, 0.014, pick(rnd, BUSH), 0.7, rnd);
        if (fine && rnd() < 0.6) { kit.jitter = 0; kit.box(x, 0.016, front + 0.02, 0.006, 0.005, 0.006, pick(rnd, FLOWERS), rnd()); }
      }
    }
    // Grass and daisies in the front lawn, either side of the path.
    if (fine && front < 0.44) {
      for (let t = 0; t < 8; t++) {
        const lx = (rnd() < 0.5 ? -1 : 1) * (0.06 + rnd() * 0.36), lz = front + 0.04 + rnd() * (0.44 - front - 0.04);
        if (Math.abs(lx - 0.1) < 0.05) continue;
        const [sx, sz] = this.toScene(lx, lz);
        this.tuft(sx, this.saved[1], sz);
      }
      kit.at(...this.saved);
      for (let t = 0; t < 5; t++) {
        const lx = -0.4 + rnd() * 0.8, lz = front + 0.03 + rnd() * Math.max(0.01, 0.44 - front - 0.03);
        if (Math.abs(lx - 0.1) < 0.05) continue;
        kit.jitter = 0;
        kit.box(lx, 0, lz, 0.004, 0.0015, 0.004, 0xf2f2ee, rnd());
        kit.box(lx, 0.0015, lz, 0.0015, 0.0006, 0.0015, 0xf2c94c);
      }
    }
    // Now and then the neighbourhood cat, sitting on the fence.
    if (fine && tileHash(i * 47 + 5) < 0.08) {
      const side = rnd() < 0.5 ? -1 : 1, z = -0.1 - rnd() * 0.3, x = side * 0.47, color = pick(rnd, [0x2a2a2a, 0xd98a2b, 0xf2f2ee, 0x7a7a7a]);
      kit.jitter = 0;
      kit.box(x, 0.1, z, 0.012, 0.014, 0.022, color);
      kit.box(x, 0.114, z + 0.012, 0.011, 0.01, 0.01, color);
      kit.prism(x - 0.003, 0.124, z + 0.012, 0.0022, 0.004, color, 3, 0);
      kit.prism(x + 0.003, 0.124, z + 0.012, 0.0022, 0.004, color, 3, 0);
      kit.beam(x, 0.104, z - 0.011, x + side * 0.004, 0.07, z - 0.014, 0.003, color);
    }
    // The back garden: lawn, a tree, and whatever this family keeps there.
    const gz0 = -0.44, gz1 = back - 0.03;
    const room = gz1 - gz0;
    if (fine) {
      for (let t = 0; t < 14; t++) {
        const [sx, sz] = this.toScene(rnd() * 0.84 - 0.42, gz0 + rnd() * Math.max(0.02, room));
        this.tuft(sx, this.saved[1], sz);
      }
      kit.at(...this.saved);
    }
    if (room > 0.12) {
      const h = tileHash(i * 29 + 3);
      if (h < 0.35) {
        // Washing line between two posts, with the week's laundry.
        kit.jitter = 0;
        const z = gz0 + room * 0.5, y = 0.1;
        for (const x of [-0.3, 0.3]) kit.box(x, 0, z, 0.006, y + 0.01, 0.006, METAL);
        kit.beam(-0.3, y, z, 0.3, y, z, 0.0015, 0xe8e8e2);
        for (let x = -0.24; x < 0.25; x += 0.07) {
          if (rnd() < 0.3) continue;
          kit.jitter = (rnd() - 0.5) * 0.1;
          kit.box(x, y - 0.04, z, 0.035 + rnd() * 0.02, 0.038, 0.002, pick(rnd, CLOTH));
        }
      } else if (h < 0.55) {
        // A trampoline.
        kit.jitter = 0;
        const x = rnd() < 0.5 ? -0.2 : 0.2, z = gz0 + room * 0.55;
        for (let a = 0; a < 6; a++) kit.box(x + Math.cos(a) * 0.075, 0, z + Math.sin(a) * 0.075, 0.004, 0.035, 0.004, METAL);
        kit.disc(x, 0.035, z, 0.085, 0x2f5f9f, 12);
        kit.disc(x, 0.0355, z, 0.07, DARK, 12);
      } else if (h < 0.75) {
        // A garden shed.
        const x = rnd() < 0.5 ? -0.3 : 0.3, z = gz0 + 0.08;
        kit.jitter = (rnd() - 0.5) * 0.1;
        kit.box(x, 0, z, 0.14, 0.1, 0.12, pick(rnd, [0x8a6240, 0x6f8a6a, 0xa89a7a, 0x7a5a3a]));
        kit.box(x, 0.1, z, 0.16, 0.012, 0.14, 0x5a4a3a);
        kit.box(x, 0, z + 0.061, 0.05, 0.08, 0.002, 0x5a3b2a);
      }
      const extra = tileHash(i * 31 + 9);
      if (extra < 0.4) {
        // Patio table, chairs and a barbecue by the back door.
        kit.jitter = 0;
        const x = -0.05, z = gz1 - 0.06;
        kit.box(x, 0, z, 0.006, 0.035, 0.006, METAL);
        kit.disc(x, 0.035, z, 0.03, 0xe8e8e2, 8);
        for (const a of [0, 2.1, 4.2]) this.chair(x + Math.cos(a) * 0.045, z + Math.sin(a) * 0.045, a + Math.PI / 2, 0xe8e8e2);
        kit.box(x + 0.14, 0, z, 0.03, 0.045, 0.022, DARK);
        kit.box(x + 0.14, 0.045, z, 0.034, 0.012, 0.024, 0x3a3c40);
      } else if (extra < 0.6) {
        // Vegetable beds.
        for (let r = 0; r < 3; r++) {
          const z = gz0 + 0.06 + r * 0.05;
          kit.jitter = 0;
          kit.box(0.2, 0, z, 0.16, 0.012, 0.035, 0x5b4a3a);
          for (let x = 0.13; x < 0.28; x += 0.025) { kit.jitter = (rnd() - 0.5) * 0.2; kit.lump(x, 0.012, z, 0.008, 0x5f8f45, 0.8, rnd); }
        }
      } else if (extra < 0.75) {
        // A paddling pool and a ball.
        kit.jitter = 0;
        kit.prism(0.15, 0, gz0 + room * 0.5, 0.06, 0.012, 0x6fa8dc, 10);
        kit.disc(0.15, 0.0125, gz0 + room * 0.5, 0.05, 0x9fd0ee, 10);
        kit.lump(-0.1, 0, gz0 + room * 0.3, 0.01, 0xd8453b, 1, rnd);
      }
      if (tileHash(i * 37 + 1) < 0.5) {
        // A garden tree.
        const x = rnd() < 0.5 ? -0.3 : 0.3, z = gz0 + room * 0.3;
        kit.jitter = 0;
        kit.prism(x, 0, z, 0.008, 0.14, WOOD_DARK, 5, 0.005);
        kit.jitter = (rnd() - 0.5) * 0.2;
        kit.lump(x, 0.1, z, 0.06, pick(rnd, BUSH), 0.9, rnd);
        kit.lump(x + 0.03, 0.14, z, 0.04, pick(rnd, BUSH), 0.9, rnd);
      }
      if (fine && rnd() < 0.5) {
        // A bicycle leaning on the side wall.
        const x = rnd() < 0.5 ? left - 0.015 : right + 0.015;
        if (Math.abs(x) < 0.44) this.bicycle(x, back + 0.08, Math.PI / 2, pick(rnd, [0x2f6fb7, 0xc8382f, 0x3f3f3f, 0x3f8f4f]));
      }
    }
  }

  private saved: [number, number, number, number] = [0, 0, 0, 0];
  /** Remember the current lot frame, so a helper that places things in the scene can hand it back. */
  private remember(x: number, y: number, z: number, yaw: number): void { this.saved = [x, y, z, yaw]; }
  /** Local lot coordinates to the scene, for helpers that need a scene point. */
  private toScene(lx: number, lz: number): [number, number] {
    const [x, , z, yaw] = this.saved;
    return [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
  }

  private chair(x: number, z: number, yaw: number, color: number): void {
    const kit = this.kit;
    kit.box(x, 0, z, 0.018, 0.02, 0.018, color, yaw);
    kit.box(x - Math.sin(yaw) * 0.008, 0.02, z - Math.cos(yaw) * 0.008, 0.018, 0.018, 0.003, color, yaw);
  }

  private bicycle(x: number, z: number, yaw: number, color: number): void {
    const kit = this.kit, c = Math.cos(yaw), s = Math.sin(yaw);
    kit.jitter = 0;
    for (const o of [-0.022, 0.022]) {
      // Wheels as thin rings of four beams.
      const wx = x + o * s, wz = z + o * c, r = 0.014;
      for (let a = 0; a < 6; a++) {
        const a0 = a / 6 * Math.PI * 2, a1 = (a + 1) / 6 * Math.PI * 2;
        kit.beam(wx + Math.cos(a0) * r * s, r + Math.sin(a0) * r, wz + Math.cos(a0) * r * c, wx + Math.cos(a1) * r * s, r + Math.sin(a1) * r, wz + Math.cos(a1) * r * c, 0.002, DARK);
      }
    }
    kit.beam(x - 0.022 * s, 0.014, z - 0.022 * c, x, 0.03, z, 0.003, color);
    kit.beam(x + 0.022 * s, 0.014, z + 0.022 * c, x, 0.03, z, 0.003, color);
    kit.beam(x - 0.006 * s, 0.03, z - 0.006 * c, x + 0.016 * s, 0.03, z + 0.016 * c, 0.003, color);
    kit.box(x - 0.008 * s, 0.032, z - 0.008 * c, 0.006, 0.003, 0.01, DARK, yaw);
    kit.beam(x + 0.018 * s - 0.008 * c, 0.036, z + 0.018 * c + 0.008 * s, x + 0.018 * s + 0.008 * c, 0.036, z + 0.018 * c - 0.008 * s, 0.002, DARK);
  }

  /** Flats and towers: bike racks, a bin store, planters and an intercom by the door. */
  private flats(i: number, b: Body | null, l: number, rnd: () => number): void {
    const kit = this.kit;
    const front = b ? b.z1 : 0.38, left = b ? b.x0 : -0.35, right = b ? b.x1 : 0.35, back = b ? b.z0 : -0.3;
    kit.jitter = 0;
    // Planters either side of the entrance, and an intercom.
    if (front < 0.45) for (const x of [-0.12, 0.12]) {
      kit.box(x, 0, front + 0.025, 0.05, 0.03, 0.03, 0x9c9488);
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.lump(x, 0.03, front + 0.025, 0.02, pick(rnd, BUSH), 0.8, rnd);
      kit.jitter = 0;
    }
    kit.box(0.1, 0.06, (b ? b.z1 : 0.38) + 0.002, 0.012, 0.02, 0.004, 0x5a5e62);
    // Bike rack with a few bikes against one side.
    const side = tileHash(i * 3) < 0.5 ? -1 : 1, sx = side < 0 ? left - 0.03 : right + 0.03;
    if (Math.abs(sx) < 0.45) {
      for (let n = 0; n < 4; n++) {
        const z = front - 0.05 - n * 0.045;
        kit.box(sx, 0, z, 0.004, 0.03, 0.03, METAL);
        if (rnd() < 0.6) this.bicycle(sx, z, Math.PI / 2 * side, pick(rnd, [0x2f6fb7, 0xc8382f, 0x3f3f3f, 0x3f8f4f, 0xe0a021]));
      }
    }
    // The bin store behind: a low enclosure with big bins.
    const bx = side < 0 ? right - 0.12 : left + 0.12;
    const bz = back - 0.07;
    if (bz > -0.46) {
      kit.box(bx, 0, bz - 0.035, 0.2, 0.06, 0.006, 0x8f8e88);
      for (const o of [-0.1, 0.1]) kit.box(bx + o, 0, bz, 0.006, 0.06, 0.07, 0x8f8e88);
      for (let n = 0; n < 3; n++) {
        const x = bx - 0.06 + n * 0.06, color = pick(rnd, [0x4a5a6a, 0x3f6b4a, 0x6a6a6a, 0x3a4a7a]);
        kit.box(x, 0.004, bz, 0.05, 0.05, 0.05, color);
        kit.box(x, 0.054, bz, 0.052, 0.006, 0.054, color);
        for (const o of [-0.018, 0.018]) kit.prism(x + o, 0, bz + 0.018, 0.004, 0.004, DARK, 5);
      }
    }
    // Balcony life on the lower floors of flats: a plant pot, a chair, washing on a rail.
    if (b && l === 2 && this.fine) {
      for (let y = 0.53; y < Math.min(b.h - 0.2, 1.6); y += 0.31) {
        if (rnd() < 0.5) continue;
        kit.jitter = (rnd() - 0.5) * 0.2;
        kit.lump(b.x0 + 0.05 + rnd() * (b.x1 - b.x0 - 0.1), y, b.z1 + 0.012, 0.012, pick(rnd, BUSH), 0.8, rnd);
      }
    }
    if (this.fine) for (let t = 0; t < 6; t++) {
      const lx = rnd() < 0.5 ? -0.43 + rnd() * 0.06 : 0.37 + rnd() * 0.06, lz = -0.4 + rnd() * 0.8;
      if (lx > left - 0.02 && lx < right + 0.02 && lz > back && lz < front) continue;
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.lump(lx, 0, lz, 0.016, pick(rnd, BUSH), 0.7, rnd);
    }
  }

  /** A shop: an awning, a sign board on the pavement, café tables, crates by the door, a dumpster behind. */
  private shop(i: number, b: Body | null, l: number, rnd: () => number): void {
    const kit = this.kit;
    const front = b ? b.z1 : 0.4, left = b ? b.x0 : -0.4, right = b ? b.x1 : 0.4, back = b ? b.z0 : -0.35;
    const w = right - left;
    kit.jitter = 0;
    const color = AWNING[Math.floor(tileHash(i * 5) * AWNING.length)];
    // A striped awning over the shop front.
    if (l < 3 || rnd() < 0.5) {
      const y = 0.2, depth = 0.07;
      for (let x = left + 0.02, n = 0; x < right - 0.02; x += 0.04, n++) {
        const seg = Math.min(0.04, right - 0.02 - x);
        kit.beam(x + seg / 2, y + 0.03, front + 0.002, x + seg / 2, y, front + depth, 0.0001 + seg, n % 2 ? 0xf2f2ee : color);
      }
      kit.box((left + right) / 2, y - 0.012, front + depth - 0.002, w - 0.04, 0.012, 0.003, color);
    }
    // A blade sign sticking out from the facade.
    if (rnd() < 0.6) {
      const x = rnd() < 0.5 ? left + 0.03 : right - 0.03, y = 0.26 + rnd() * 0.1;
      kit.box(x, y + 0.04, front + 0.01, 0.004, 0.004, 0.02, DARK);
      kit.box(x, y, front + 0.03, 0.006, 0.05, 0.035, pick(rnd, AWNING));
      kit.box(x, y + 0.01, front + 0.03, 0.007, 0.03, 0.025, 0xf2f2ee);
    }
    // An A-board and a potted bay tree by the door; crates of produce in front of a grocer.
    if (front < 0.47) {
      const z = Math.min(0.47, front + 0.04);
      kit.beam(-0.2, 0, z - 0.008, -0.2, 0.045, z, 0.024, 0x2f3338);
      kit.beam(-0.2, 0, z + 0.008, -0.2, 0.045, z, 0.024, 0x2f3338);
      kit.box(-0.2, 0.012, z + 0.0075, 0.018, 0.022, 0.0012, 0xf2f2ee, 0);
      for (const x of [0.08, -0.08]) {
        kit.prism(x, 0, front + 0.02, 0.012, 0.022, 0x9c6b4a, 7, 0.015);
        kit.jitter = (rnd() - 0.5) * 0.2;
        kit.lump(x, 0.03, front + 0.02, 0.018, 0x3f6f3a, 1, rnd);
        kit.prism(x, 0.02, front + 0.02, 0.0025, 0.012, WOOD_DARK, 4);
        kit.jitter = 0;
      }
      if (tileHash(i * 11) < 0.35) for (let n = 0; n < 3; n++) {
        const x = 0.2 + n * 0.045;
        kit.box(x, 0, front + 0.025, 0.04, 0.02, 0.03, WOOD);
        for (let m = 0; m < 3; m++) kit.lump(x - 0.012 + m * 0.012, 0.02, front + 0.025, 0.007, pick(rnd, [0xd8453b, 0xe0a021, 0x7fae4f, 0xf5a14a]), 1, rnd);
      }
    }
    if (this.fine) this.pigeons(rnd, front, 3);
    // Café tables with parasols where the pavement in front is the shop's own.
    if (front < 0.36 && tileHash(i * 13 + 2) < 0.5) {
      for (const x of [left + 0.1, (left + right) / 2, right - 0.1]) {
        const z = front + (0.47 - front) / 2;
        kit.box(x, 0, z, 0.005, 0.035, 0.005, DARK);
        kit.disc(x, 0.035, z, 0.022, 0xe8e2d0, 8);
        for (const o of [-0.03, 0.03]) this.chair(x + o, z, o < 0 ? Math.PI / 2 : -Math.PI / 2, 0x3a3c40);
        kit.box(x, 0.035, z, 0.003, 0.07, 0.003, METAL);
        kit.prism(x, 0.1, z, 0.06, 0.02, color, 8, 0.004);
      }
    }
    // Round the back: a dumpster, trash bags and pallets of deliveries.
    const bz = back - 0.07;
    if (bz > -0.44) {
      const x = (left + right) / 2 + (rnd() - 0.5) * 0.2;
      kit.box(x, 0.006, bz, 0.12, 0.06, 0.07, pick(rnd, [0x2f6f4f, 0x2f5f9f, 0x4a4e52]));
      kit.box(x, 0.066, bz, 0.124, 0.006, 0.074, 0x3a3c40);
      for (const o of [-0.05, 0.05]) kit.prism(x + o, 0, bz + 0.025, 0.005, 0.006, DARK, 5);
      for (let n = 0; n < 3; n++) { kit.jitter = (rnd() - 0.5) * 0.2; kit.lump(x + 0.09 + n * 0.02, 0, bz + (rnd() - 0.5) * 0.04, 0.014, 0x2a2c30, 0.9, rnd); }
      kit.jitter = 0;
      this.pallet(x - 0.13, bz, rnd() < 0.5 ? 1 : 2);
    }
  }

  /** A few pigeons pecking about in front of a building. */
  private pigeons(rnd: () => number, front: number, most: number): void {
    if (front > 0.42 || rnd() < 0.5) return;
    const kit = this.kit, n = 1 + Math.floor(rnd() * most);
    kit.jitter = 0;
    for (let k = 0; k < n; k++) {
      const x = -0.35 + rnd() * 0.7, z = front + 0.02 + rnd() * (0.46 - front), yaw = rnd() * Math.PI * 2, c = Math.sin(yaw), d = Math.cos(yaw);
      const body = pick(rnd, [0x8a8e96, 0x7a7e86, 0x9a9ea6, 0x5a5e66]);
      kit.box(x, 0.003, z, 0.007, 0.007, 0.012, body, yaw);
      kit.box(x + c * 0.007, 0.008, z + d * 0.007, 0.005, 0.005, 0.005, 0x5a6a7a, yaw);
      kit.box(x + c * 0.0105, 0.009, z + d * 0.0105, 0.0015, 0.0015, 0.003, 0xd98a2b, yaw);
      kit.box(x - c * 0.008, 0.005, z - d * 0.008, 0.006, 0.002, 0.006, 0x4a4e56, yaw);
    }
  }

  private pallet(x: number, z: number, stack: number): void {
    const kit = this.kit;
    for (let s = 0; s < stack; s++) {
      const y = s * 0.012;
      for (const o of [-0.022, 0, 0.022]) kit.box(x + o, y, z, 0.008, 0.006, 0.06, WOOD_DARK);
      for (const o of [-0.022, 0, 0.022]) kit.box(x, y + 0.006, z + o, 0.06, 0.004, 0.012, WOOD);
    }
  }

  /** An office: flagpoles, a row of planters, benches, bollards and a sculpture on the plaza. */
  private office(i: number, b: Body | null, rnd: () => number): void {
    const kit = this.kit;
    const front = b ? b.z1 : 0.4, left = b ? b.x0 : -0.4, right = b ? b.x1 : 0.4;
    kit.jitter = 0;
    if (front < 0.44) {
      const z = (front + 0.47) / 2;
      for (let x = -0.36; x <= 0.36; x += 0.12) {
        kit.prism(x, 0, 0.455, 0.006, 0.03, 0x4a5056, 6);
        kit.prism(x, 0.024, 0.455, 0.0065, 0.004, 0xe8e2d2, 6);
      }
      for (const x of [left + 0.06, right - 0.06]) {
        kit.box(x, 0, z, 0.08, 0.03, 0.04, 0x8f8e88);
        kit.jitter = (rnd() - 0.5) * 0.2;
        for (const o of [-0.022, 0.022]) kit.lump(x + o, 0.03, z, 0.018, pick(rnd, BUSH), 0.8, rnd);
        kit.jitter = 0;
      }
    }
    if (this.fine) this.pigeons(rnd, front, 4);
    // Three flagpoles.
    if (tileHash(i * 19) < 0.6) {
      const flags = [pick(rnd, [0x2f5f9f, 0xc8382f, 0x2f6f4f]), 0xf2f2ee, pick(rnd, [0xe0a021, 0x2f5f9f, 0xc8382f])];
      for (let n = 0; n < 3; n++) {
        const x = right + 0.025 < 0.44 ? right + 0.03 : left - 0.03, z = front - 0.03 - n * 0.06;
        kit.prism(x, 0, z, 0.003, 0.4, METAL, 5, 0.002);
        kit.box(x, 0.33, z + 0.025, 0.002, 0.04, 0.05, flags[n]);
      }
    }
    // A sculpture: blocks stacked at angles.
    if (tileHash(i * 23 + 4) < 0.3 && front < 0.36) {
      const x = 0.26, z = (front + 0.47) / 2;
      kit.box(x, 0, z, 0.05, 0.012, 0.05, 0x8f8e88);
      kit.box(x, 0.012, z, 0.02, 0.06, 0.02, 0xc8382f, 0.4);
      kit.box(x, 0.07, z, 0.04, 0.02, 0.01, 0xc8382f, 1.1);
    }
  }

  /** A factory yard: pallets, barrels, crates, a container, a forklift and a chain-link fence. */
  private yard(b: Body | null, l: number, rnd: () => number): void {
    const kit = this.kit, fine = this.fine;
    const back = b ? b.z0 : -0.3, left = b ? b.x0 : -0.4, right = b ? b.x1 : 0.4;
    kit.jitter = 0;
    // Fence round the sides and back.
    const e = 0.47;
    for (let t = -e; t <= e + 1e-6; t += 0.12) {
      kit.box(-e, 0, t, 0.006, 0.09, 0.006, 0x7a8288);
      kit.box(e, 0, t, 0.006, 0.09, 0.006, 0x7a8288);
      kit.box(t, 0, -e, 0.006, 0.09, 0.006, 0x7a8288);
    }
    for (const y of [0.088, 0.03]) {
      kit.box(-e, y, 0, 0.004, 0.004, 2 * e, 0x7a8288);
      kit.box(e, y, 0, 0.004, 0.004, 2 * e, 0x7a8288);
      kit.box(0, y, -e, 2 * e, 0.004, 0.004, 0x7a8288);
    }
    if (fine) for (let t = -e; t < e; t += 0.02) {
      kit.box(-e, 0.03, t, 0.001, 0.058, 0.001, 0x9aa0a6);
      kit.box(e, 0.03, t, 0.001, 0.058, 0.001, 0x9aa0a6);
      kit.box(t, 0.03, -e, 0.001, 0.058, 0.001, 0x9aa0a6);
    }
    // Stuff in the yard behind and beside the shed.
    const spots: [number, number][] = [];
    if (back > -0.3) for (let x = -0.36; x <= 0.36; x += 0.12) spots.push([x, (back - 0.44) / 2 - 0.02]);
    if (left > -0.3) spots.push([(left - 0.44) / 2, 0]);
    if (right < 0.3) spots.push([(right + 0.44) / 2, 0]);
    for (const [x, z] of spots) {
      const what = rnd();
      if (what < 0.25) this.pallet(x, z, 1 + Math.floor(rnd() * 3));
      else if (what < 0.5) {
        for (let n = 0; n < 4; n++) {
          kit.jitter = (rnd() - 0.5) * 0.15;
          const color = pick(rnd, BARREL), bx = x + (n % 2) * 0.03 - 0.015, bz = z + Math.floor(n / 2) * 0.03 - 0.015;
          kit.prism(bx, 0, bz, 0.013, 0.04, color, 8);
          kit.prism(bx, 0.015, bz, 0.0135, 0.004, 0x3a3c40, 8);
        }
        kit.jitter = 0;
      } else if (what < 0.7) {
        kit.jitter = (rnd() - 0.5) * 0.15;
        kit.box(x, 0, z, 0.05, 0.04, 0.05, WOOD, rnd());
        kit.box(x + 0.01, 0.04, z, 0.035, 0.03, 0.035, WOOD, rnd());
        kit.jitter = 0;
      } else if (what < 0.8 && l > 1) {
        // A shipping container, ribbed.
        const color = pick(rnd, CONTAINER);
        kit.box(x, 0, z, 0.1, 0.09, 0.2, color, Math.PI / 2 * Math.round(rnd()));
        if (fine) for (let o = -0.08; o <= 0.08; o += 0.02) kit.box(x + 0.051, 0.005, z + o, 0.003, 0.08, 0.004, color);
      } else if (what < 0.9) {
        this.forklift(x, z, rnd() * Math.PI * 2);
      } else {
        // A cage of gas cylinders.
        kit.box(x, 0, z, 0.07, 0.07, 0.05, 0x7a8288);
        for (let n = 0; n < 4; n++) kit.prism(x - 0.024 + n * 0.016, 0, z, 0.007, 0.06, pick(rnd, [0xe8e2d0, 0x3f7f4f, 0xd98a2b]), 6);
      }
    }
    // Oil stains and puddles on the concrete.
    if (fine) for (let n = 0; n < 4; n++) kit.disc(-0.4 + rnd() * 0.8, 0.0012, -0.4 + rnd() * 0.8, 0.02 + rnd() * 0.03, pick(rnd, [0x3a3c40, 0x5a6068]), 7);
    // Pipes along the back wall.
    if (b && b.h > 0.35) {
      kit.log((left + right) / 2, 0.14, back - 0.02, 0.01, right - left, 0x8a8e92, 0, 7);
      kit.log((left + right) / 2, 0.19, back - 0.02, 0.007, right - left, 0xb5452f, 0, 7);
    }
  }

  private forklift(x: number, z: number, yaw: number): void {
    const kit = this.kit;
    kit.jitter = 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (u: number, w: number): [number, number] => [x + u * c + w * s, z - u * s + w * c];
    let [px, pz] = at(0, 0);
    kit.box(px, 0.008, pz, 0.04, 0.03, 0.06, 0xe0a021, yaw);
    [px, pz] = at(0, -0.02);
    kit.box(px, 0.038, pz, 0.036, 0.012, 0.022, 0x3a3c40, yaw);
    for (const u of [-0.016, 0.016]) { [px, pz] = at(u, 0.012); kit.box(px, 0.038, pz, 0.003, 0.03, 0.003, DARK, yaw); }
    [px, pz] = at(0, 0.012);
    kit.box(px, 0.068, pz, 0.036, 0.003, 0.03, DARK, yaw);
    for (const u of [-0.012, 0.012]) { [px, pz] = at(u, 0.034); kit.box(px, 0.008, pz, 0.004, 0.06, 0.004, 0x3a3c40, yaw); }
    for (const u of [-0.012, 0.012]) { [px, pz] = at(u, 0.05); kit.box(px, 0.004, pz, 0.005, 0.003, 0.03, METAL, yaw); }
    for (const [u, w] of [[-0.022, -0.02], [0.022, -0.02], [-0.022, 0.02], [0.022, 0.02]]) { [px, pz] = at(u, w); kit.log(px, 0, pz, 0.008, 0.008, DARK, yaw, 6); }
  }

  /** A farm: fences of posts and rails, hay bales, a water trough, a tractor, a scarecrow, chickens. */
  private farm(i: number, rnd: () => number): void {
    const kit = this.kit;
    kit.jitter = 0;
    const e = 0.48;
    for (let t = -e; t <= e + 1e-6; t += 0.16) for (const [x, z] of [[-e, t], [e, t], [t, -e]]) kit.box(x, 0, z, 0.008, 0.05, 0.008, WOOD_DARK);
    for (const y of [0.02, 0.042]) {
      kit.box(-e, y, 0, 0.004, 0.006, 2 * e, WOOD);
      kit.box(e, y, 0, 0.004, 0.006, 2 * e, WOOD);
      kit.box(0, y, -e, 2 * e, 0.006, 0.004, WOOD);
    }
    const h = tileHash(i * 41 + 7);
    if (h < 0.5) for (let n = 0; n < 4; n++) {
      kit.jitter = (rnd() - 0.5) * 0.1;
      if (rnd() < 0.5) kit.log(-0.35 + rnd() * 0.7, 0, -0.4 + rnd() * 0.15, 0.02, 0.035, 0xd9b75a, rnd() * Math.PI, 8);
      else kit.box(-0.35 + rnd() * 0.7, 0, -0.4 + rnd() * 0.15, 0.05, 0.028, 0.032, 0xd9b75a, rnd() * Math.PI);
    }
    kit.jitter = 0;
    if (h > 0.4 && h < 0.7) {
      kit.box(0.38, 0, 0.2, 0.03, 0.02, 0.1, 0x7a8288);
      kit.quad(0.38, 0.019, 0.2, 0.024, 0.09, 0x6fa8dc);
    }
    if (h > 0.6) this.tractor(-0.3 + rnd() * 0.2, 0.3, rnd() * Math.PI * 2, pick(rnd, [0xc8382f, 0x3f8f4f, 0x2f5f9f]));
    if (h > 0.25 && h < 0.4) {
      // A scarecrow.
      const x = rnd() * 0.4 - 0.2, z = rnd() * 0.4 - 0.2;
      kit.box(x, 0, z, 0.005, 0.1, 0.005, WOOD_DARK);
      kit.box(x, 0.075, z, 0.07, 0.005, 0.005, WOOD_DARK);
      kit.box(x, 0.05, z, 0.03, 0.04, 0.014, 0x5a6fa0);
      kit.lump(x, 0.09, z, 0.01, 0xd9b75a, 1, rnd);
      kit.prism(x, 0.106, z, 0.018, 0.004, 0x6b4f36, 8, 0.01);
    }
    if (this.fine && h > 0.15 && h < 0.5) for (let n = 0; n < 6; n++) {
      // Chickens.
      const x = 0.1 + rnd() * 0.3, z = -0.3 + rnd() * 0.2, yaw = rnd() * Math.PI * 2;
      kit.box(x, 0.004, z, 0.012, 0.01, 0.018, pick(rnd, [0xf2f2ee, 0xb5864f, 0x6b4a2a]), yaw);
      kit.box(x + Math.sin(yaw) * 0.01, 0.012, z + Math.cos(yaw) * 0.01, 0.006, 0.008, 0.006, 0xf2f2ee, yaw);
      kit.box(x + Math.sin(yaw) * 0.01, 0.02, z + Math.cos(yaw) * 0.01, 0.003, 0.003, 0.006, 0xc8382f, yaw);
    }
  }

  private tractor(x: number, z: number, yaw: number, color: number): void {
    const kit = this.kit, c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (u: number, w: number): [number, number] => [x + u * c + w * s, z - u * s + w * c];
    kit.jitter = 0;
    let [px, pz] = at(0, 0.02);
    kit.box(px, 0.016, pz, 0.034, 0.024, 0.06, color, yaw);
    [px, pz] = at(0, -0.022);
    kit.box(px, 0.016, pz, 0.04, 0.05, 0.034, color, yaw);
    kit.box(px, 0.066, pz, 0.044, 0.004, 0.04, 0x3a3c40, yaw);
    [px, pz] = at(0.008, 0.035);
    kit.prism(px, 0.04, pz, 0.003, 0.02, DARK, 5);
    for (const u of [-0.026, 0.026]) {
      [px, pz] = at(u, -0.022); kit.log(px, 0, pz, 0.018, 0.012, DARK, yaw, 8);
      [px, pz] = at(u, 0.035); kit.log(px, 0, pz, 0.011, 0.01, DARK, yaw, 7);
    }
  }

  /** A leisure lot: sun loungers, parasols and strings of lanterns. */
  private leisure(i: number, b: Body | null, rnd: () => number): void {
    const kit = this.kit;
    const front = b ? b.z1 : 0.2;
    kit.jitter = 0;
    if (front < 0.4) for (let x = -0.3; x <= 0.3; x += 0.15) {
      const z = (front + 0.47) / 2;
      kit.box(x, 0, z, 0.03, 0.012, 0.06, 0xe8e2d0, 0.2 * (rnd() - 0.5));
      kit.box(x, 0.012, z - 0.022, 0.03, 0.02, 0.006, 0xe8e2d0);
    }
    const posts: [number, number][] = [[-0.44, -0.44], [0.44, -0.44], [0.44, 0.44], [-0.44, 0.44]];
    for (const [x, z] of posts) kit.box(x, 0, z, 0.006, 0.18, 0.006, DARK);
    for (let p = 0; p < 4; p++) {
      const [ax, az] = posts[p], [bx, bz] = posts[(p + 1) % 4];
      kit.beam(ax, 0.178, az, (ax + bx) / 2, 0.15, (az + bz) / 2, 0.0015, DARK);
      kit.beam((ax + bx) / 2, 0.15, (az + bz) / 2, bx, 0.178, bz, 0.0015, DARK);
      if (this.fine) for (let t = 0.1; t < 0.95; t += 0.1) {
        const lx = ax + (bx - ax) * t, lz = az + (bz - az) * t, sag = 0.028 * Math.sin(t * Math.PI);
        kit.box(lx, 0.165 - sag, lz, 0.007, 0.009, 0.007, pick(rnd, [0xf2c94c, 0xf5a14a, 0xf2f2ee]));
      }
    }
    void i;
  }

  /** Around a service building: a flagpole, planters, a bench, bins and a bike rack on its frontage. */
  private service(i: number, k: number): void {
    const spec = SERVICES[k];
    if (!spec || spec.decoration) {
      if (k === T_PARK) this.wild(i, i % GRID, Math.floor(i / GRID), 0.5);
      return;
    }
    if (spec.civic === 'leisure') { this.wild(i, i % GRID, Math.floor(i / GRID), 0.6); return; }
    // Only the anchor tile of a building, facing the road it is served from.
    const { raster } = this.src;
    if (raster.accSeg[i] < 0 || tileHash(i * 43) < 0.3) return;
    const cx = i % GRID + 0.5, cz = Math.floor(i / GRID) + 0.5, dx = raster.accX[i] - cx, dz = raster.accZ[i] - cz, d = Math.hypot(dx, dz) || 1;
    const face = Math.atan2(dx, dz);
    const kit = this.kit, rnd = this.rnd;
    kit.jitter = 0;
    kit.at(cx + dx / d * 0.44 - HALF, 0, cz + dz / d * 0.44 - HALF, face);
    kit.prism(0.3, 0, 0, 0.004, 0.42, METAL, 5, 0.0025);
    kit.box(0.3, 0.35, 0.028, 0.002, 0.04, 0.05, pick(rnd, [0x2f5f9f, 0xc8382f, 0x2f6f4f]));
    for (const x of [-0.25, -0.1, 0.1]) {
      kit.box(x, 0, -0.02, 0.07, 0.028, 0.03, 0x9c9488);
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.lump(x, 0.028, -0.02, 0.02, pick(rnd, BUSH), 0.8, rnd);
      kit.jitter = 0;
    }
    kit.prism(-0.35, 0, -0.02, 0.012, 0.045, 0x3f6b4a, 8);
  }
}

/** A point `s` along a segment, with its unit direction. */
function sampleSeg(seg: RSeg, s: number): { x: number; z: number; tx: number; tz: number } {
  const { pts, cum, n } = seg;
  let i = 0;
  while (i < n - 1 && cum[i + 1] < s) i++;
  const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
  const len = cum[i + 1] - cum[i] || 1, u = Math.max(0, Math.min(1, (s - cum[i]) / len));
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz) || 1;
  return { x: x0 + dx * u, z: z0 + dz * u, tx: dx / d, tz: dz / d };
}

/**
 * The walls of a building model, in its own frame: the extent of its tall upright faces (walls rather
 * than fences, kerbs or awnings), and how high they reach.
 */
export function bodyOfGeometry(geometry: THREE.BufferGeometry): Body | null {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, h = 0;
  for (let t = 0; t + 2 < p.count; t += 3) {
    let ymin = Infinity, ymax = -Infinity, xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
    for (let k = 0; k < 3; k++) {
      const x = p.getX(t + k), y = p.getY(t + k), z = p.getZ(t + k);
      ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
    }
    // An upright face (flat in x or in z) from near the ground to well above head height.
    if (ymin > 0.1 || ymax < 0.35 || (xmax - xmin > 1e-4 && zmax - zmin > 1e-4)) continue;
    x0 = Math.min(x0, xmin); x1 = Math.max(x1, xmax); z0 = Math.min(z0, zmin); z1 = Math.max(z1, zmax); h = Math.max(h, ymax);
  }
  if (g !== geometry) g.dispose();
  return Number.isFinite(x0) ? { x0, x1, z0, z1, h } : null;
}

