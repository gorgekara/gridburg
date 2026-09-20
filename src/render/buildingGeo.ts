import { T_OFFICE, T_BUS, T_STATION, T_AIRPORT, T_TREATMENT, T_SUBWAY, SERVICES } from '../constants';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET, T_PARK, T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE, T_RECYCLING, T_UNIVERSITY, T_SOLAR, mulberry32 } from '../constants';

const WINDOW_DARK = 0x1f2a3a;
const WINDOW_LIT = 0xffe1a0;
const GLASS = 0x7fb6d6;

/** Accumulates colored parts and merges them into one vertex-colored geometry. */
export class Builder {
  private parts: THREE.BufferGeometry[] = [];
  rnd: () => number;

  constructor(seed: number) {
    this.rnd = mulberry32(seed);
  }

  private paint(src: THREE.BufferGeometry, color: number): void {
    // Merge needs every part indexed the same way; ExtrudeGeometry is non-indexed, so flatten all.
    const g = src.index ? src.toNonIndexed() : src;
    if (g !== src) src.dispose();
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
  }

  /** Box with its base at y, centered on (x, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): void {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    this.paint(g, color);
  }

  /** Vertical cylinder with its base at y. */
  cyl(r: number, h: number, x: number, y: number, z: number, color: number, seg = 10): void {
    const g = new THREE.CylinderGeometry(r, r, h, seg);
    g.translate(x, y + h / 2, z);
    this.paint(g, color);
  }

  /** Tapered vertical cylinder with its base at y. */
  taper(rTop: number, rBottom: number, h: number, x: number, y: number, z: number, color: number, seg = 14): void {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
    g.translate(x, y + h / 2, z);
    this.paint(g, color);
  }

  /** Horizontal pipe along z, centered at (x, y, z). */
  pipe(r: number, len: number, x: number, y: number, z: number, color: number): void {
    const g = new THREE.CylinderGeometry(r, r, len, 10);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this.paint(g, color);
  }

  /** Gable roof: a triangular prism along z sitting on top of a body of width w, plus overhanging planks. */
  gable(w: number, d: number, y: number, rise: number, wallColor: number, roofColor: number): void {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const prism = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    prism.translate(0, y, -d / 2);
    this.paint(prism, wallColor);
    const slope = Math.atan2(rise, w / 2);
    const plankLen = Math.hypot(rise, w / 2) + 0.08;
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(plankLen, 0.04, d + 0.1);
      g.rotateZ(-side * slope);
      g.translate((side * w) / 4, y + rise / 2 + 0.015, 0);
      this.paint(g, roofColor);
    }
  }

  /**
   * Windows on all four facades of a box body (front is +z).
   * A few are lit so towers read as inhabited.
   */
  windows(w: number, h: number, d: number, y0: number, floors: number, perSide: number, lit: number, size = 0.13): void {
    const fh = (h - y0) / floors;
    const wh = Math.min(size, fh * 0.55);
    const ww = size * 0.8;
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh + fh * 0.25;
      for (let j = 0; j < perSide; j++) {
        const t = -0.5 + (j + 0.5) / perSide;
        const color = this.rnd() < lit ? WINDOW_LIT : WINDOW_DARK;
        this.box(ww, wh, 0.02, t * w * 0.85, y, d / 2 + 0.005, color);
        this.box(ww, wh, 0.02, t * w * 0.85, y, -d / 2 - 0.005, this.rnd() < lit ? WINDOW_LIT : WINDOW_DARK);
        this.box(0.02, wh, ww, w / 2 + 0.005, y, t * d * 0.85, this.rnd() < lit ? WINDOW_LIT : WINDOW_DARK);
        this.box(0.02, wh, ww, -w / 2 - 0.005, y, t * d * 0.85, this.rnd() < lit ? WINDOW_LIT : WINDOW_DARK);
      }
    }
  }

  /** Continuous glass bands per floor on all four sides. */
  bands(w: number, h: number, d: number, y0: number, floors: number, color: number, thickness = 0.1): void {
    const fh = (h - y0) / floors;
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh + fh * 0.3;
      this.box(w * 0.9, thickness, d + 0.02, 0, y, 0, color);
      this.box(w + 0.02, thickness, d * 0.9, 0, y, 0, color);
    }
  }

  build(): THREE.BufferGeometry {
    if (!this.parts.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

const RES_WALLS = [0xf3e2c4, 0xe6c7a1, 0xf2d3cc, 0xcfdcd0];
const RES_ROOFS = [0xa8453a, 0x5c4a3d, 0x4a5b6b, 0x7a4b3f];
const APT_WALLS = [0xd9c3a5, 0xc9a98a, 0xe3d6c4, 0xb9b5a8];
const TOWER_WALLS = [0xd8d2c6, 0xc3b8a6, 0xbfc7cc, 0xe0d9cf];
const SHOP_WALLS = [0xe8dcc8, 0xd7c9b6, 0xcfd6dc, 0xe2d2d2];
const AWNINGS = [0xd9483b, 0x2a9d8f, 0xe89b3c, 0x7b5ea7];
const OFFICE_WALLS = [0x9fb4c4, 0x8aa2b6, 0xb3c1cc, 0x7f95a8];
const GLASS_TOWERS = [0x5f93cf, 0x3e6fae, 0x6aa8c9, 0x4b7fb3];
const IND_WALLS = [0xc2bb9f, 0xa89f82, 0xb0aa93, 0x9c9a90];

export const VARIANTS = 4;
const heights = new Map<string, number>();

export function buildingHeight(kind: number, level: number, variant: number): number {
  const key = `${kind}:${level}:${variant}`;
  if (!heights.has(key)) buildingGeometry(kind, level, variant).dispose();
  return heights.get(key)!;
}

/** Distinct roof silhouettes, all contained inside the building footprint. */
function roofDetail(b: Builder, y: number, variant: number): void {
  if (variant === 0) {
    b.box(0.2, 0.12, 0.22, 0.12, y, -0.12, 0x8c9397); // HVAC
    for (const x of [0.06, 0.12, 0.18]) b.box(0.014, 0.012, 0.17, x, y + 0.12, -0.12, 0x4d5960);
  } else if (variant === 1) {
    b.box(0.34, 0.26, 0.3, 0, y, -0.08, 0xd8d2c6); // rooftop room
    b.box(0.37, 0.035, 0.33, 0, y + 0.26, -0.08, 0x5f6a73);
    b.box(0.18, 0.1, 0.02, 0, y + 0.08, 0.08, GLASS);
  } else if (variant === 2) {
    for (const x of [-0.17, 0.17]) { // solar panels and planters
      b.box(0.23, 0.05, 0.28, x, y + 0.04, -0.08, 0x245683);
      b.box(0.2, 0.08, 0.12, x, y, 0.2, 0xa78058);
      b.box(0.18, 0.07, 0.1, x, y + 0.08, 0.2, 0x548454);
    }
  } else {
    b.cyl(0.09, 0.22, -0.14, y + 0.08, -0.12, 0x8f8a80, 8); // tank and antenna
    b.box(0.2, 0.08, 0.2, -0.14, y, -0.12, 0x59636b);
    b.cyl(0.012, 0.4, 0.19, y, -0.18, 0xb9c7d1, 6);
    b.box(0.18, 0.012, 0.012, 0.19, y + 0.31, -0.18, 0xb9c7d1);
  }
}

/** Build the geometry for a (kind, level, variant) triple. Front of the building faces +z. */
export function buildingGeometry(kind: number, level: number, variant: number): THREE.BufferGeometry {
  const b = new Builder(kind * 100 + level * 10 + variant);
  const v = variant % VARIANTS;
  if (kind === T_RES) {
    if (level === 1) {
      const w = [0.5, 0.62, 0.54, 0.6][v], h = [0.4, 0.65, 0.48, 0.72][v], d = [0.56, 0.6, 0.68, 0.58][v];
      b.box(w, h, d, 0, 0, 0, RES_WALLS[v]);
      if (v === 2) {
        b.box(w + 0.06, 0.05, d + 0.06, 0, h, 0, RES_ROOFS[v]);
        roofDetail(b, h + 0.05, v);
      } else b.gable(w, d, h, v === 1 ? 0.28 : 0.2, RES_WALLS[v], RES_ROOFS[v]);
      if (v === 1 || v === 3) b.windows(w, h, d, 0.34, 1, 2, 0.1);
      b.box(0.12, 0.2, 0.02, 0.1, 0, d / 2 + 0.005, 0x5a3b2a);
      b.box(0.1, 0.1, 0.02, -0.13, 0.18, d / 2 + 0.005, WINDOW_DARK);
      b.box(0.1, 0.1, 0.02, 0.13, 0.18, -d / 2 - 0.005, WINDOW_DARK);
      b.box(0.02, 0.1, 0.1, w / 2 + 0.005, 0.18, 0.05, WINDOW_DARK);
      b.box(0.07, 0.24, 0.07, -0.15, h + 0.05, -0.12, 0x6b6560);
      b.box(0.62, 0.02, 0.68, 0, -0.005, 0, 0x8a9a6a);
    } else if (level === 2) {
      const floors = [3, 4, 5, 4][v];
      const w = [0.68, 0.76, 0.64, 0.72][v], h = 0.22 + floors * 0.31, d = [0.68, 0.62, 0.74, 0.7][v];
      b.box(w, h, d, 0, 0, 0, APT_WALLS[v]);
      b.box(w + 0.04, 0.06, d + 0.04, 0, 0, 0, 0x8c8578);
      b.box(w + 0.04, 0.05, d + 0.04, 0, h, 0, 0x6f6a62);
      b.windows(w, h, d, 0.22, floors, v === 2 ? 2 : 3, 0.15);
      if (v === 1 || v === 3) for (let f = 1; f < floors; f++) {
        b.box(0.25, 0.035, 0.12, -0.18, 0.22 + f * 0.31, d / 2 + 0.045, 0x8f8a80);
        b.box(0.25, 0.07, 0.02, -0.18, 0.25 + f * 0.31, d / 2 + 0.095, 0xc9d4db);
      }
      b.box(0.16, 0.24, 0.03, 0, 0, d / 2 + 0.005, 0x3d2c22);
      b.box(0.3, 0.03, 0.12, 0, 0.26, d / 2 + 0.06, 0x6f6a62);
      roofDetail(b, h + 0.05, v);
    } else {
      const floors = [7, 9, 6, 11][v];
      const w = [0.7, 0.65, 0.8, 0.68][v], h = 0.28 + floors * 0.34, d = [0.7, 0.76, 0.64, 0.7][v];
      b.box(w, h, d, 0, 0, 0, TOWER_WALLS[v]);
      b.box(w + 0.05, 0.08, d + 0.05, 0, 0, 0, 0x7a7469);
      b.box(w + 0.03, 0.05, d + 0.03, 0, h, 0, 0x5f5a53);
      b.windows(w, h, d, 0.28, floors, 3, 0.25, 0.12);
      roofDetail(b, h + 0.05, v);
      b.box(0.16, 0.26, 0.03, 0, 0, d / 2 + 0.005, 0x3d2c22);
    }
  } else if (kind === T_COM) {
    if (level === 1) {
      const w = 0.82, h = [0.55, 0.7, 0.48, 0.85][v], d = [0.7, 0.62, 0.76, 0.66][v];
      b.box(w, h, d, 0, 0, 0, SHOP_WALLS[v]);
      b.box(0.5, 0.28, 0.03, -0.1, 0.12, d / 2 + 0.005, GLASS);
      b.box(0.14, 0.38, 0.03, 0.3, 0, d / 2 + 0.005, 0x3d2c22);
      b.box(0.8, 0.04, 0.24, 0, 0.44, d / 2 + 0.1, AWNINGS[v]);
      b.box(0.5, 0.12, 0.05, -0.1, h, d / 2 - 0.03, 0xfff4dc);
      roofDetail(b, h + 0.12, v);
      b.box(0.02, 0.18, 0.3, w / 2 + 0.005, 0.15, 0, WINDOW_DARK);
    } else if (level === 2) {
      const floors = [5, 4, 6, 7][v];
      const w = [0.8, 0.72, 0.76, 0.68][v], h = 0.3 + floors * 0.31, d = 0.76;
      b.box(w, h, d, 0, 0, 0, OFFICE_WALLS[v]);
      b.box(w + 0.04, 0.1, d + 0.04, 0, 0, 0, 0x5c6a75);
      b.bands(w, h, d, 0.3, floors, 0x3d6a85, 0.1);
      b.box(w + 0.03, 0.05, d + 0.03, 0, h, 0, 0x46525c);
      roofDetail(b, h + 0.05, v);
      b.box(0.4, 0.26, 0.03, 0, 0, d / 2 + 0.005, GLASS);
    } else {
      const floors = [12, 9, 15, 11][v];
      const w = [0.8, 0.7, 0.66, 0.76][v], h = floors * 0.35, d = [0.8, 0.74, 0.7, 0.78][v];
      b.box(w, h, d, 0, 0, 0, GLASS_TOWERS[v]);
      b.box(w + 0.05, 0.12, d + 0.05, 0, 0, 0, 0x3a4a5a);
      for (let f = 1; f < floors; f++) {
        b.box(w + 0.02, 0.035, d + 0.02, 0, (h / floors) * f, 0, 0x2a3a4a);
      }
      b.box(0.55, 0.5, 0.55, 0, h, 0, GLASS_TOWERS[v]);
      b.box(0.58, 0.04, 0.58, 0, h + 0.5, 0, 0x2a3a4a);
      roofDetail(b, h + 0.54, v);
      b.box(0.5, 0.3, 0.03, 0, 0, d / 2 + 0.005, 0xbfe3f5);
    }
  } else if (kind === T_OFFICE) {
    const floors = level === 1 ? [2, 3, 2, 4][v] : level === 2 ? [5, 7, 6, 8][v] : [11, 14, 12, 16][v];
    const w = [0.76, 0.65, 0.8, 0.7][v], d = [0.68, 0.8, 0.62, 0.74][v], h = floors * 0.3;
    b.box(w, h, d, 0, 0, 0, [0x759eab, 0x91a5b5, 0x6d98a2, 0x92a6bf][v]);
    b.bands(w, h, d, 0.18, floors, 0x284c68, 0.16);
    for (const x of [-w * 0.3, w * 0.3]) b.box(0.035, h, d + 0.035, x, 0, 0, 0xc9d2d9);
    b.box(w + 0.04, 0.08, d + 0.04, 0, h, 0, 0x536270);
    b.box(0.3, 0.23, 0.03, 0, 0, d / 2 + 0.02, GLASS);
    roofDetail(b, h + 0.08, v);
  } else if (kind === T_IND) {
    const h = [0.42, 0.62, 0.52, 0.7][v] + (level - 1) * 0.32;
    const wall = IND_WALLS[v];
    b.box(0.96, 0.025, 0.96, 0, 0, 0, 0x92928b);
    if (v === 0) { // sawtooth workshop, roof lights and loading bays
      b.box(0.86, h, 0.8, 0, 0.025, 0, wall);
      for (const z of [-0.27, 0, 0.27]) {
        b.box(0.88, 0.12, 0.2, 0, h, z, 0x717873);
        b.box(0.64, 0.035, 0.12, 0, h + 0.12, z, 0xabc8d0);
      }
      for (const x of [-0.24, 0.24]) b.box(0.24, 0.3, 0.03, x, 0.025, 0.41, 0x475058);
    } else if (v === 1) { // brick plant with twin striped stacks
      b.box(0.7, h, 0.76, -0.06, 0.025, 0, 0xa87d63);
      for (const z of [-0.25, 0.19]) {
        b.cyl(0.065, 0.5 + level * 0.18, 0.34, 0.025, z, 0x686960, 10);
        b.cyl(0.07, 0.07, 0.34, 0.38 + level * 0.18, z, 0xc65343, 10);
      }
      b.windows(0.7, h, 0.76, 0.15, level, 3, 0.05);
      b.box(0.3, 0.1, 0.34, -0.13, h + 0.025, 0, 0x738791);
    } else if (v === 2) { // tank farm and a low processing hall
      b.box(0.42, h * 0.7, 0.86, -0.22, 0.025, 0, wall);
      for (const z of [-0.23, 0.23]) {
        b.cyl(0.17, h, 0.23, 0.025, z, 0xc2c5bc, 14);
        b.taper(0.02, 0.17, 0.13, 0.23, h + 0.025, z, 0x919f9b);
      }
      b.pipe(0.04, 0.7, 0.22, 0.2, 0, 0xd2ab58);
      b.box(0.3, 0.26, 0.03, -0.22, 0.025, 0.435, 0x465058);
    } else { // distribution warehouse with solar and container yard
      b.box(0.88, h * 0.72, 0.58, 0, 0.025, -0.13, wall);
      b.box(0.92, 0.05, 0.62, 0, h * 0.72 + 0.025, -0.13, 0x626e76);
      for (const x of [-0.25, 0, 0.25]) {
        b.box(0.19, 0.045, 0.35, x, h * 0.72 + 0.08, -0.13, 0x305a7a);
        b.box(0.2, 0.17, 0.25, x, 0.025, 0.32, x === 0 ? 0xc58f49 : 0x577c83);
        for (let n = 0; n < 4; n++) b.box(0.01, 0.16, 0.255, x - 0.075 + n * 0.05, 0.025, 0.32, 0x8eaaa7);
      }
    }
  }
  else if (kind === T_COAL) {
    b.box(0.92, 0.04, 0.92, 0, 0, 0, 0x6f6a62);
    b.box(0.5, 0.45, 0.55, -0.15, 0.04, 0.1, 0x8d8f94);
    b.box(0.52, 0.06, 0.57, -0.15, 0.49, 0.1, 0x55585e);
    b.windows(0.5, 0.45, 0.55, 0.12, 1, 3, 0.4, 0.1);
    b.taper(0.13, 0.2, 0.75, 0.25, 0.04, -0.2, 0xcfcac0);
    b.cyl(0.055, 1.25, 0.28, 0.04, 0.28, 0x5a5650, 10);
    b.cyl(0.062, 0.07, 0.28, 1.2, 0.28, 0xb8433a, 10);
    b.cyl(0.055, 1.05, 0.1, 0.04, 0.33, 0x5a5650, 10);
    b.cyl(0.062, 0.07, 0.1, 1.0, 0.33, 0xb8433a, 10);
    b.box(0.3, 0.12, 0.25, -0.2, 0.04, -0.3, 0x24262b);
  } else if (kind === T_WIND) {
    b.cyl(0.16, 0.05, 0, 0, 0, 0x8f8a80, 12);
    b.taper(0.03, 0.055, 1.7, 0, 0.05, 0, 0xf2f2ee, 10);
    b.box(0.1, 0.1, 0.24, 0, 1.72, 0.02, 0xe4e4df);
  } else if (kind === T_PUMP) {
    b.box(0.8, 0.04, 0.8, 0, 0, 0, 0x8f9aa3);
    b.box(0.5, 0.36, 0.45, -0.1, 0.04, 0, 0xb9c7d1);
    b.box(0.54, 0.05, 0.49, -0.1, 0.4, 0, 0x4a7fa8);
    b.cyl(0.14, 0.3, 0.27, 0.04, 0.12, 0x4a7fa8, 12);
    b.pipe(0.05, 0.7, 0.27, 0.14, -0.1, 0x3d6a8c);
    b.box(0.14, 0.22, 0.02, -0.1, 0.04, 0.23, 0x2c3b47);
  } else if (kind === T_TOWER) {
    b.box(0.6, 0.03, 0.6, 0, 0, 0, 0x8f9aa3);
    for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) b.box(0.05, 1.0, 0.05, x, 0.03, z, 0x7d8790);
    b.cyl(0.04, 1.0, 0, 0.03, 0, 0x6b757d, 8);
    b.cyl(0.32, 0.4, 0, 1.0, 0, 0xcfe0ec, 16);
    b.cyl(0.34, 0.05, 0, 1.18, 0, 0x4a7fa8, 16);
    b.taper(0.02, 0.33, 0.16, 0, 1.4, 0, 0xa9bccb, 16);
  } else if (kind === T_OUTLET) {
    b.box(0.8, 0.04, 0.8, 0, 0, 0, 0x8a857a);
    b.box(0.5, 0.3, 0.4, 0.1, 0.04, 0.05, 0xa39d8f);
    b.box(0.54, 0.05, 0.44, 0.1, 0.34, 0.05, 0x6d5b3c);
    b.pipe(0.11, 0.75, -0.25, 0.15, -0.05, 0x6d5b3c);
    b.cyl(0.13, 0.22, 0.2, 0.04, -0.27, 0x7c705a, 12);
    b.box(0.14, 0.2, 0.02, 0.1, 0.04, 0.255, 0x2f2a22);
  }
  if (kind === T_PARK) {
    b.box(0.96, 0.04, 0.96, 0, 0, 0, 0x72a765);
    b.box(0.17, 0.02, 0.96, 0, 0.04, 0, 0xdcc9a0);
    for (const x of [-0.3, 0.3]) for (const z of [-0.28, 0.28]) {
      b.cyl(0.035, 0.25, x, 0.04, z, 0x7d6245, 6);
      b.taper(0.04, 0.2, 0.45, x, 0.22, z, 0x43815b, 8);
    }
    b.box(0.26, 0.08, 0.1, 0.25, 0.08, 0, 0xa78058);
  } else if (kind === T_SOLAR) {
    b.box(0.96, 0.04, 0.96, 0, 0, 0, 0x8d9a82);
    for (const z of [-0.3, 0, 0.3]) {
      b.box(0.78, 0.08, 0.24, 0, 0.15, z, 0x245683);
      for (const x of [-0.25, 0, 0.25]) b.box(0.012, 0.01, 0.24, x, 0.23, z, 0xa9c9db);
    }
  } else if (kind === T_RECYCLING) {
    b.box(0.94, 0.04, 0.94, 0, 0, 0, 0x949c96);
    b.box(0.85, 0.48, 0.5, 0, 0.04, -0.15, 0x8eb1a3);
    b.box(0.89, 0.06, 0.55, 0, 0.52, -0.15, 0x397565);
    for (const x of [-0.3, 0, 0.3]) b.box(0.2, 0.2, 0.25, x, 0.04, 0.3, x === 0 ? 0x528abc : 0xdbc268);
  } else if ([T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE, T_UNIVERSITY].includes(kind)) {
    const accent = kind === T_CLINIC ? 0xcb5656 : kind === T_FIRE ? 0xba483b : kind === T_POLICE ? 0x426b9d : kind === T_SCHOOL ? 0xd49d4e : 0x8a70ad;
    const height = kind === T_UNIVERSITY ? 1.55 : kind === T_POLICE ? 0.95 : 0.65;
    b.box(0.96, 0.04, 0.96, 0, 0, 0, 0xa3aaad);
    b.box(0.82, height, 0.68, 0, 0.04, -0.05, kind === T_SCHOOL ? 0xd7b996 : 0xdce0df);
    b.box(0.86, 0.07, 0.72, 0, height + 0.04, -0.05, accent);
    b.windows(0.82, height, 0.68, 0.22, kind === T_UNIVERSITY ? 3 : 1, 3, 0.13, 0.14);
    b.box(0.26, 0.3, 0.035, 0, 0.04, 0.3, 0x345166);
    if (kind === T_CLINIC) {
      b.box(0.3, 0.08, 0.03, 0, height - 0.05, 0.315, accent);
      b.box(0.08, 0.3, 0.03, 0, height - 0.16, 0.318, accent);
    } else if (kind === T_FIRE) {
      for (const x of [-0.25, 0.25]) b.box(0.22, 0.35, 0.035, x, 0.04, 0.31, 0x984b40);
      b.box(0.17, 0.2, 0.16, 0.25, 0.04, 0.39, 0xdc4b3e);
    } else if (kind === T_UNIVERSITY) {
      for (const x of [-0.25, 0, 0.25]) b.cyl(0.035, 0.5, x, 0.04, 0.4, 0xf1e4cb, 8);
      b.box(0.7, 0.06, 0.2, 0, 0.54, 0.4, accent);
      b.cyl(0.18, 0.3, 0, height + 0.11, -0.05, accent, 12);
    } else {
      b.cyl(0.015, 0.5, 0.32, height + 0.11, 0, 0xb6bdc4, 6);
      b.box(0.2, 0.12, 0.02, 0.37, height + 0.46, 0, accent);
    }
  }
  if (kind === T_BUS) {
    b.box(0.92, 0.03, 0.7, 0, 0, 0, 0xb9b6ad);
    for (const x of [-0.35, 0.35]) b.box(0.035, 0.55, 0.035, x, 0.03, -0.16, 0x405566);
    b.box(0.75, 0.36, 0.025, 0, 0.13, -0.17, GLASS);
    b.box(0.82, 0.045, 0.48, 0, 0.58, -0.02, 0xeab75c);
    b.box(0.56, 0.08, 0.12, 0, 0.16, -0.05, 0x8a7458);
    b.box(0.025, 0.72, 0.025, 0.41, 0.03, 0.2, 0x56606b);
    b.box(0.17, 0.2, 0.03, 0.41, 0.55, 0.2, 0x2f86af);
  } else if (kind === T_STATION) {
    // Two-level station hall: street-level ticket hall, then an upper concourse whose floor sits at
    // viaduct height (1.12) so the footbridge from the elevated platforms (TransportLayer) lands on it
    // from whichever side the line runs. The concourse face is inset 0.25 from the 3x2 footprint.
    b.box(2.96, 0.05, 1.96, 1, 0, 0.5, 0xb9b6ad);
    b.box(2.5, 0.91, 1.5, 1, 0.05, 0.5, 0xd9d4c8);
    b.box(2.2, 0.4, 1.52, 1, 0.26, 0.5, GLASS);
    b.box(2.52, 0.4, 1.2, 1, 0.26, 0.5, GLASS);
    for (const z of [-0.26, 1.26]) b.box(0.36, 0.5, 0.02, 1, 0.05, z, 0x2f4658);
    for (const x of [-0.26, 2.26]) b.box(0.02, 0.5, 0.36, x, 0.05, 0.5, 0x2f4658);
    b.box(0.6, 0.04, 0.16, 1, 0.58, 1.33, 0x426c85);
    b.box(0.6, 0.04, 0.16, 1, 0.58, -0.33, 0x426c85);
    b.box(2.64, 0.16, 1.64, 1, 0.96, 0.5, 0xb9b4a8);
    b.box(2.5, 0.38, 1.5, 1, 1.12, 0.5, 0x9cc3d6);
    for (let x = -0.25; x <= 2.26; x += 0.3125) for (const z of [-0.26, 1.26]) b.box(0.03, 0.38, 0.03, x, 1.12, z, 0x536470);
    for (let z = -0.25; z <= 1.26; z += 0.375) for (const x of [-0.26, 2.26]) b.box(0.03, 0.38, 0.03, x, 1.12, z, 0x536470);
    b.box(2.8, 0.07, 1.8, 1, 1.5, 0.5, 0x426c85);
    for (const [d, y] of [[1.5, 1.57], [1.1, 1.63], [0.6, 1.68]]) b.box(2.6, 0.06, d, 1, y, 0.5, 0x6e9cb6);
    b.box(0.3, 2.05, 0.3, 2.15, 0.05, 1.2, 0xcfc9bc);
    b.box(0.34, 0.06, 0.34, 2.15, 2.1, 1.2, 0x426c85);
    for (const [dx, dz, w, d] of [[0, 0.155, 0.18, 0.02], [0, -0.155, 0.18, 0.02], [0.155, 0, 0.02, 0.18], [-0.155, 0, 0.02, 0.18]]) {
      b.box(w, 0.18, d, 2.15 + dx, 1.8, 1.2 + dz, 0xf2efe6);
    }
    b.box(0.5, 0.14, 0.03, 0.2, 1.52, -0.42, 0xc44536);
  } else if (kind === T_AIRPORT) {
    b.box(7.96, 0.035, 2.96, 3.5, 0, 1, 0x80946c);
    b.box(7.6, 0.025, 0.85, 3.5, 0.035, 0, 0x515860);
    for (let x = 0.2; x < 7; x += 0.65) b.box(0.32, 0.008, 0.045, x, 0.063, 0, 0xf0eee1);
    for (const x of [0, 7]) for (const z of [-0.25, -0.1, 0.1, 0.25]) b.box(0.2, 0.008, 0.06, x, 0.063, z, 0xffffff);
    b.box(4.8, 0.025, 0.85, 3.5, 0.035, 0.9, 0xa7aba4);
    b.box(2.5, 0.5, 0.75, 3, 0.04, 1.9, 0xdce0db);
    b.box(2.6, 0.08, 0.8, 3, 0.54, 1.9, 0x658698);
    b.box(2.3, 0.24, 0.02, 3, 0.2, 1.515, GLASS);
    b.box(0.24, 1.25, 0.24, 5, 0.04, 1.9, 0xc3ccc8);
    b.box(0.55, 0.28, 0.5, 5, 1.29, 1.9, 0x4d7892);
    b.box(0.6, 0.07, 0.55, 5, 1.57, 1.9, 0xe1e2d9);
  } else if (kind === T_SUBWAY) { // metro entrance: stairwell under a glass canopy and an M pylon
    b.box(0.96, 0.03, 0.96, 0, 0, 0, 0xb3b0a8);
    b.box(0.34, 0.012, 0.52, -0.1, 0.03, 0.02, 0x1d2226);
    for (let n = 0; n < 5; n++) b.box(0.32, 0.01, 0.03, -0.1, 0.034, 0.24 - n * 0.1, 0x3a4046);
    for (const x of [-0.285, 0.085]) b.box(0.03, 0.13, 0.54, x, 0.03, 0.02, 0x8f959a);
    b.box(0.4, 0.13, 0.03, -0.1, 0.03, -0.26, 0x8f959a);
    for (const x of [-0.29, 0.09]) for (const z of [-0.24, 0.26]) b.box(0.025, 0.4, 0.025, x, 0.03, z, 0x5a6570);
    b.box(0.46, 0.03, 0.62, -0.1, 0.43, 0.02, 0x5a6570);
    b.box(0.42, 0.012, 0.58, -0.1, 0.46, 0.02, GLASS);
    b.box(0.045, 0.62, 0.045, 0.32, 0.03, 0.3, 0x56606b);
    b.box(0.17, 0.17, 0.06, 0.32, 0.6, 0.3, 0x2e6fd8);
    b.box(0.03, 0.1, 0.01, 0.28, 0.635, 0.335, 0xf2f2f2);
    b.box(0.03, 0.1, 0.01, 0.36, 0.635, 0.335, 0xf2f2f2);
    b.box(0.07, 0.03, 0.01, 0.32, 0.69, 0.335, 0xf2f2f2);
    b.box(0.2, 0.08, 0.14, 0.27, 0.03, -0.26, 0x8a7458);
    b.box(0.17, 0.08, 0.11, 0.27, 0.11, -0.26, 0x5d8a45);
  } else if (kind === T_TREATMENT) {
    b.box(0.96, 0.05, 0.96, 0, 0, 0, 0x99aaa2);
    for (const x of [-0.23, 0.23]) {
      b.cyl(0.2, 0.2, x, 0.05, -0.05, 0xcbd1c8, 16);
      b.cyl(0.17, 0.015, x, 0.24, -0.05, x < 0 ? 0x638e7e : 0x62a9bd, 16);
      b.box(0.35, 0.035, 0.035, x, 0.26, -0.05, 0x657c80);
    }
    b.box(0.7, 0.32, 0.2, 0, 0.05, -0.34, 0xd4dfd8);
    b.pipe(0.05, 0.35, 0.23, 0.12, 0.3, 0x577d8c);
  }
  const geometry = b.build();
  // The frontmost building detail meets the lot's +z boundary; rotation then faces it
  // toward the road. Keep the tile center fixed so zoning, picking and saves agree.
  geometry.computeBoundingBox();
  if (kind !== T_WIND && !SERVICES[kind]?.footprint && geometry.boundingBox) {
    geometry.translate(0, 0, 0.5 - geometry.boundingBox.max.z);
    geometry.computeBoundingBox();
  }
  heights.set(`${kind}:${level}:${variant}`, geometry.boundingBox!.max.y);
  // The lot is added after the facade shift so it always fills the tile.
  const lot = lotGeometry(kind, level, v);
  if (!lot) return geometry;
  const merged = mergeGeometries([geometry, lot], false)!;
  geometry.dispose(); lot.dispose();
  merged.computeBoundingBox(); merged.computeBoundingSphere();
  return merged;
}

/** Ground of a zoned lot in tile space (front edge at +z): fenced gardens for houses, paving for everything bigger. */
function lotGeometry(kind: number, level: number, v: number): THREE.BufferGeometry | null {
  if (kind !== T_RES && kind !== T_COM && kind !== T_OFFICE) return null;
  const b = new Builder(kind * 31 + level * 7 + v), e = 0.47;
  if (kind === T_RES && level === 1) {
    b.box(0.96, 0.012, 0.96, 0, 0, 0, [0x7fa35f, 0x86a864, 0x7a9d5c, 0x8aab68][v]);
    const fence = [0xefebe0, 0x9a7650, 0xefebe0, 0x6f5a45][v], top = 0.1;
    // Back and side fences; the house itself closes the front of the lot.
    for (const side of [-1, 1]) {
      b.box(0.018, 0.018, 2 * e, side * e, top - 0.03, 0, fence);
      b.box(0.018, 0.018, 2 * e, side * e, top - 0.075, 0, fence);
    }
    b.box(2 * e, 0.018, 0.018, 0, top - 0.03, -e, fence);
    b.box(2 * e, 0.018, 0.018, 0, top - 0.075, -e, fence);
    for (let t = -e; t <= e + 0.001; t += 0.094) {
      b.box(0.022, top, 0.022, -e, 0, t, fence);
      b.box(0.022, top, 0.022, e, 0, t, fence);
      b.box(0.022, top, 0.022, t, 0, -e, fence);
    }
    // A garden shrub in the back corner.
    const sx = v % 2 ? 0.3 : -0.3;
    b.cyl(0.075, 0.11, sx, 0.01, -0.33, 0x4f7a3c, 7);
    b.cyl(0.05, 0.07, sx, 0.1, -0.33, 0x5d8a45, 7);
    return b.build();
  }
  // Concrete plaza with a kerb and a tree pit.
  b.box(0.96, 0.014, 0.96, 0, 0, 0, [0xb4b2aa, 0xaaa9a3, 0xbcb8ae, 0xa7a8a4][v]);
  b.box(0.96, 0.024, 0.03, 0, 0, -0.465, 0x8f8e88);
  for (const side of [-1, 1]) b.box(0.03, 0.024, 0.96, side * 0.465, 0, 0, 0x8f8e88);
  for (const x of [-0.25, 0, 0.25]) b.box(0.004, 0.0165, 0.96, x, 0, 0, 0x97968f);
  return b.build();
}

/** Three-bladed rotor in the XY plane, centered on the hub. */
export function rotorGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.BoxGeometry(0.07, 0.62, 0.02);
    g.translate(0, 0.33, 0);
    g.rotateZ((k * Math.PI * 2) / 3);
    parts.push(g);
  }
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.06, 10);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  return mergeGeometries(flat, false)!;
}
