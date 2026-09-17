import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET, mulberry32 } from '../constants';

const WINDOW_DARK = 0x1f2a3a;
const WINDOW_LIT = 0xffe1a0;
const GLASS = 0x7fb6d6;

/** Accumulates colored parts and merges them into one vertex-colored geometry. */
class Builder {
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

/** Build the geometry for a (kind, level, variant) triple. Front of the building faces +z. */
export function buildingGeometry(kind: number, level: number, variant: number): THREE.BufferGeometry {
  const b = new Builder(kind * 100 + level * 10 + variant);
  const v = variant % VARIANTS;
  if (kind === T_RES) {
    if (level === 1) {
      const w = 0.5, h = 0.4, d = 0.56;
      b.box(w, h, d, 0, 0, 0, RES_WALLS[v]);
      b.gable(w, d, h, 0.2, RES_WALLS[v], RES_ROOFS[v]);
      b.box(0.12, 0.2, 0.02, 0.1, 0, d / 2 + 0.005, 0x5a3b2a);
      b.box(0.1, 0.1, 0.02, -0.13, 0.18, d / 2 + 0.005, WINDOW_DARK);
      b.box(0.1, 0.1, 0.02, 0.13, 0.18, -d / 2 - 0.005, WINDOW_DARK);
      b.box(0.02, 0.1, 0.1, w / 2 + 0.005, 0.18, 0.05, WINDOW_DARK);
      b.box(0.07, 0.24, 0.07, -0.15, h + 0.05, -0.12, 0x6b6560);
      b.box(0.62, 0.02, 0.68, 0, -0.005, 0, 0x8a9a6a);
    } else if (level === 2) {
      const w = 0.68, h = 1.15, d = 0.68;
      b.box(w, h, d, 0, 0, 0, APT_WALLS[v]);
      b.box(w + 0.04, 0.06, d + 0.04, 0, 0, 0, 0x8c8578);
      b.box(w + 0.04, 0.05, d + 0.04, 0, h, 0, 0x6f6a62);
      b.windows(w, h, d, 0.22, 3, 3, 0.15);
      b.box(0.16, 0.24, 0.03, 0, 0, d / 2 + 0.005, 0x3d2c22);
      b.box(0.3, 0.03, 0.12, 0, 0.26, d / 2 + 0.06, 0x6f6a62);
      b.box(0.2, 0.1, 0.2, 0.18, h + 0.05, -0.15, 0x8c8578);
    } else {
      const w = 0.7, h = 2.7, d = 0.7;
      b.box(w, h, d, 0, 0, 0, TOWER_WALLS[v]);
      b.box(w + 0.05, 0.08, d + 0.05, 0, 0, 0, 0x7a7469);
      b.box(w + 0.03, 0.05, d + 0.03, 0, h, 0, 0x5f5a53);
      b.windows(w, h, d, 0.28, 7, 3, 0.25, 0.12);
      b.box(0.22, 0.14, 0.22, 0.18, h + 0.05, 0.14, 0x8f8a80);
      b.cyl(0.08, 0.22, -0.2, h + 0.05, -0.18, 0x6b6560, 8);
      b.box(0.16, 0.26, 0.03, 0, 0, d / 2 + 0.005, 0x3d2c22);
    }
  } else if (kind === T_COM) {
    if (level === 1) {
      const w = 0.82, h = 0.55, d = 0.7;
      b.box(w, h, d, 0, 0, 0, SHOP_WALLS[v]);
      b.box(0.5, 0.28, 0.03, -0.1, 0.12, d / 2 + 0.005, GLASS);
      b.box(0.14, 0.38, 0.03, 0.3, 0, d / 2 + 0.005, 0x3d2c22);
      b.box(0.8, 0.04, 0.24, 0, 0.44, d / 2 + 0.1, AWNINGS[v]);
      b.box(0.5, 0.12, 0.05, -0.1, h, d / 2 - 0.03, 0xfff4dc);
      b.box(0.25, 0.14, 0.25, 0.2, h, -0.15, 0x8f8a80);
      b.box(0.02, 0.18, 0.3, w / 2 + 0.005, 0.15, 0, WINDOW_DARK);
    } else if (level === 2) {
      const w = 0.8, h = 1.85, d = 0.8;
      b.box(w, h, d, 0, 0, 0, OFFICE_WALLS[v]);
      b.box(w + 0.04, 0.1, d + 0.04, 0, 0, 0, 0x5c6a75);
      b.bands(w, h, d, 0.3, 5, 0x3d6a85, 0.1);
      b.box(w + 0.03, 0.05, d + 0.03, 0, h, 0, 0x46525c);
      b.box(0.3, 0.16, 0.3, -0.15, h + 0.05, 0.12, 0x6f7a84);
      b.box(0.4, 0.26, 0.03, 0, 0, d / 2 + 0.005, GLASS);
    } else {
      const w = 0.8, h = 4.3, d = 0.8;
      b.box(w, h, d, 0, 0, 0, GLASS_TOWERS[v]);
      b.box(w + 0.05, 0.12, d + 0.05, 0, 0, 0, 0x3a4a5a);
      for (let f = 1; f < 12; f++) {
        b.box(w + 0.02, 0.035, d + 0.02, 0, (h / 12) * f, 0, 0x2a3a4a);
      }
      b.box(0.55, 0.5, 0.55, 0, h, 0, GLASS_TOWERS[v]);
      b.box(0.58, 0.04, 0.58, 0, h + 0.5, 0, 0x2a3a4a);
      b.cyl(0.015, 0.6, 0.1, h + 0.54, 0.1, 0xcfd6dc, 6);
      b.box(0.5, 0.3, 0.03, 0, 0, d / 2 + 0.005, 0xbfe3f5);
    }
  } else if (kind === T_IND) {
    if (level === 1) {
      const w = 0.86, h = 0.42, d = 0.86;
      b.box(w, h, d, 0, 0, 0, IND_WALLS[v]);
      for (const z of [-0.29, 0, 0.29]) b.box(w + 0.02, 0.08, 0.26, 0, h, z, 0x7d7a70);
      b.box(0.4, 0.3, 0.03, 0, 0, d / 2 + 0.005, 0x4a4a4a);
      b.box(0.1, 0.08, 0.1, 0.3, h + 0.08, -0.29, 0x5f5a53);
      b.box(0.1, 0.08, 0.1, -0.3, h + 0.08, 0.29, 0x5f5a53);
    } else if (level === 2) {
      const w = 0.86, h = 0.7, d = 0.86;
      b.box(w, h, d, 0, 0, 0, IND_WALLS[v]);
      b.box(w + 0.04, 0.06, d + 0.04, 0, 0, 0, 0x6b665e);
      b.cyl(0.07, 0.75, 0.3, h, -0.3, 0x5a5650, 10);
      b.cyl(0.078, 0.06, 0.3, h + 0.69, -0.3, 0xb8433a, 10);
      for (const x of [-0.25, 0.05]) b.box(0.22, 0.1, 0.5, x, h, 0.05, 0x9fb7c6);
      b.box(0.36, 0.34, 0.03, -0.1, 0, d / 2 + 0.005, 0x4a4a4a);
      b.box(0.02, 0.14, 0.5, -w / 2 - 0.005, 0.3, 0, WINDOW_DARK);
    } else {
      const w = 0.9, h = 1.2, d = 0.9;
      b.box(w, h, d, 0, 0, 0, IND_WALLS[v]);
      b.box(w + 0.04, 0.08, d + 0.04, 0, 0, 0, 0x6b665e);
      b.cyl(0.07, 0.9, 0.3, h, -0.3, 0x5a5650, 10);
      b.cyl(0.07, 0.75, 0.12, h, -0.32, 0x5a5650, 10);
      b.cyl(0.078, 0.06, 0.3, h + 0.84, -0.3, 0xb8433a, 10);
      b.cyl(0.16, 0.42, -0.25, h, 0.2, 0xb9b5a8, 12);
      b.cyl(0.16, 0.04, -0.25, h + 0.42, 0.2, 0x8f8a80, 12);
      b.box(0.05, 0.05, 0.5, 0.05, h + 0.2, 0.2, 0x8f8a80);
      b.windows(w, h, d, 0.25, 2, 3, 0.1, 0.14);
      b.box(0.4, 0.36, 0.03, 0.15, 0, d / 2 + 0.005, 0x4a4a4a);
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
