import { parkGeometry } from './parkGeo';
import { isDecoration, T_TROLLEY, T_TAXI } from '../constants';
import type { VisualDetail } from './detail';
import { T_OFFICE, T_BUS, T_STATION, T_AIRPORT, T_TREATMENT, T_SUBWAY, SERVICES, T_FARM, T_LEISURE, T_CEMETERY, T_CREMATORIUM, T_POST_OFFICE, T_FLOOD_BARRIER, T_LANDMARK } from '../constants';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET, T_PARK, T_PLAYGROUND, T_SPORTS, T_GARDEN, T_HOSPITAL, T_CITY_HOSPITAL, T_POLICE_HQ, T_DOCKS, T_GAS, T_HYDRO, T_NUCLEAR, T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE, T_RECYCLING, T_UNIVERSITY, T_SOLAR, mulberry32 } from '../constants';

const WINDOW_DARK = 0x1f2a3a;
const WINDOW_LIT = 0xffe1a0;
/** Office lighting: a cool white pane. By day it reads as bright glass; after dark the shader lights it. */
export const OFFICE_LIT = 0xf4f6ff;
const GLASS = 0x7fb6d6;

/** Accumulates colored parts and merges them into one vertex-colored geometry. */
export class Builder {
  private parts: THREE.BufferGeometry[] = [];
  rnd: () => number;
  /** Where the model's own centre sits; lets a multi-tile site be authored around its middle. */
  shift = { x: 0, z: 0 };

  detail: VisualDetail;

  constructor(seed: number, detail: VisualDetail = 1) {
    this.detail = detail;
    this.rnd = mulberry32(seed);
  }

  private paint(src: THREE.BufferGeometry, color: number): void {
    // Merge needs every part indexed the same way; ExtrudeGeometry is non-indexed, so flatten all.
    const g = src.index ? src.toNonIndexed() : src;
    if (g !== src) src.dispose();
    if (this.shift.x || this.shift.z) g.translate(this.shift.x, 0, this.shift.z);
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
    if (w > 0.3 && d > 0.3 && h > 0.3) {
      const part = this.parts[this.parts.length - 1];
      const positions = part.getAttribute('position'), colors = part.getAttribute('color');
      // Subtle baked grounding; retain the authored color at the top of each volume.
      for (let i = 0; i < positions.count; i++) {
        const height = Math.max(0, Math.min(1, (positions.getY(i) - y) / h));
        const shade = 0.88 + height * 0.12;
        colors.setXYZ(i, colors.getX(i) * shade, colors.getY(i) * shade, colors.getZ(i) * shade);
      }
    }
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

  /** A wheel on its side, its axle along x: tyre, rim and hub cap, centred on (x, y, z). */
  wheel(r: number, w: number, x: number, y: number, z: number, tyre: number, rim: number, seg = 12): void {
    const t = new THREE.CylinderGeometry(r, r, w, seg);
    t.rotateZ(Math.PI / 2); t.translate(x, y, z);
    this.paint(t, tyre);
    const out = Math.sign(x) || 1;
    const c = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.006, seg);
    c.rotateZ(Math.PI / 2); c.translate(x + out * (w / 2 + 0.002), y, z);
    this.paint(c, rim);
    const h = new THREE.CylinderGeometry(r * 0.2, r * 0.2, 0.008, 8);
    h.rotateZ(Math.PI / 2); h.translate(x + out * (w / 2 + 0.005), y, z);
    this.paint(h, 0x5d676d);
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
      // Tile courses lie on the roof surface: two triangles each, no hidden faces.
      const courses = Math.max(2, Math.ceil(plankLen / 0.09));
      const tile = new THREE.Color(roofColor).multiplyScalar(0.78).getHex();
      for (let row = 1; row < courses && this.detail > 0; row++) {
        const seam = new THREE.PlaneGeometry(0.009, d + 0.095);
        seam.rotateX(-Math.PI / 2);
        seam.translate(-plankLen / 2 + row * plankLen / courses, 0.021, 0);
        seam.rotateZ(-side * slope);
        seam.translate(side * w / 4, y + rise / 2 + 0.015, 0);
        this.paint(seam, tile);
        if (this.detail === 2) for (let z = -d / 2 + 0.05; z < d / 2; z += 0.12) {
          const joint = new THREE.PlaneGeometry(plankLen / courses * 0.75, 0.006);
          joint.rotateX(-Math.PI / 2);
          joint.translate(-plankLen / 2 + (row - 0.4) * plankLen / courses, 0.022, z + (row % 2) * 0.025);
          joint.rotateZ(-side * slope);
          joint.translate(side * w / 4, y + rise / 2 + 0.015, 0);
          this.paint(joint, tile);
        }
      }
    }
    if (this.detail > 0) this.box(0.045, 0.035, d + 0.11, 0, y + rise + 0.022, 0,
      new THREE.Color(roofColor).multiplyScalar(0.85).getHex());
  }

  /** A facade decal with outward winding; no hidden back or edge faces to render. */
  pane(w: number, h: number, x: number, y: number, z: number, turn: number, color: number): void {
    const g = new THREE.PlaneGeometry(w, h);
    g.rotateY(turn);
    g.translate(x, y + h / 2, z);
    this.paint(g, color);
  }

  /** Frames, glass, a central mullion and a sill: eight triangles versus twelve for a plain box. */
  window(w: number, h: number, along: number, y: number, depth: number, turn: number, color: number): void {
    const sn = Math.sin(turn), cs = Math.cos(turn);
    const layer = (width: number, height: number, bottom: number, offset: number, tint: number): void => {
      this.pane(width, height, along * cs + (depth + offset) * sn, bottom,
        -along * sn + (depth + offset) * cs, turn, tint);
    };
    if (this.detail === 0) { layer(w, h, y, 0, color); return; }
    if (this.detail === 2) {
      layer(w + 0.026, 0.012, y + h + 0.009, 0.003, 0xc2b9a7);
      layer(w, 0.008, y + h * 0.53, 0.004, 0x9aa49e);
    }
    layer(w + 0.018, h + 0.018, y - 0.009, 0, 0x7b817e);
    layer(w, h, y, 0.002, color);
    layer(0.009, h, y, 0.003, 0x9aa49e);
    layer(w + 0.026, 0.012, y - 0.009, 0.004, 0xc2b9a7);
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
        this.window(ww, wh, t * w * 0.85, y, d / 2 + 0.012, 0, color);
        this.window(ww, wh, -t * w * 0.85, y, d / 2 + 0.012, Math.PI, this.rnd() < lit ? WINDOW_LIT : WINDOW_DARK);
        this.window(ww, wh, -t * d * 0.85, y, w / 2 + 0.012, Math.PI / 2, this.rnd() < lit ? WINDOW_LIT : WINDOW_DARK);
        this.window(ww, wh, t * d * 0.85, y, w / 2 + 0.012, -Math.PI / 2, this.rnd() < lit ? WINDOW_LIT : WINDOW_DARK);
      }
    }
  }

  /**
   * Lit offices on a glass facade: panes on every floor, a share of them bright, so a commercial block
   * reads as occupied after dark instead of going black above the shopfronts.
   */
  litPanes(w: number, h: number, d: number, y0: number, floors: number, perSide: number, lit: number, bandY = 0.3): void {
    const fh = (h - y0) / floors;
    const pw = Math.min(0.12, (w * 0.8) / perSide - 0.03), ph = Math.min(0.1, fh * 0.34);
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fh + fh * bandY - ph * 0.1;
      for (let j = 0; j < perSide; j++) {
        const t = -0.5 + (j + 0.5) / perSide;
        if (this.rnd() < lit) this.pane(pw, ph, t * w * 0.82, y, d / 2 + 0.028, 0, OFFICE_LIT);
        if (this.rnd() < lit) this.pane(pw, ph, t * w * 0.82, y, -d / 2 - 0.028, Math.PI, OFFICE_LIT);
        if (this.rnd() < lit) this.pane(pw, ph, w / 2 + 0.028, y, t * d * 0.82, Math.PI / 2, OFFICE_LIT);
        if (this.rnd() < lit) this.pane(pw, ph, -w / 2 - 0.028, y, t * d * 0.82, -Math.PI / 2, OFFICE_LIT);
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

const RES_WALLS = [0xf3e2c4, 0xe6c7a1, 0xf2d3cc, 0xcfdcd0, 0xdcd8c6, 0xeadbb6];
const RES_ROOFS = [0xa8453a, 0x5c4a3d, 0x4a5b6b, 0x7a4b3f, 0x64764f, 0x8f5b39];
const APT_WALLS = [0xd9c3a5, 0xc9a98a, 0xe3d6c4, 0xb9b5a8, 0xcdb79b, 0xd6cab6];
const TOWER_WALLS = [0xd8d2c6, 0xc3b8a6, 0xbfc7cc, 0xe0d9cf, 0xc9b9a2, 0xb7c0bc];
// Shops and mid-rise blocks carry the street's colour: brick, stucco, painted render and tile.
const SHOP_WALLS = [0xe8dcc8, 0xc0674a, 0xcfd6dc, 0xe2d2d2, 0xd8b271, 0x9fb59b];
const BLOCK_WALLS = [0xb9603f, 0xd9c09a, 0x8fa9bb, 0xc7b49a, 0xa8b49c, 0xd3cbbd];
const AWNINGS = [0xd9483b, 0x2a9d8f, 0xe89b3c, 0x7b5ea7, 0x3f7fbf, 0xc76b2e];
const OFFICE_WALLS = [0x759eab, 0x91a5b5, 0x6d98a2, 0x92a6bf, 0xa3a98f, 0xb0a794];
const GLASS_TOWERS = [0x5f93cf, 0x3e6fae, 0x6aa8c9, 0x4b7fb3, 0x5c9c8b, 0x7e88ac];
const IND_WALLS = [0xc2bb9f, 0xa89f82, 0xb0aa93, 0x9c9a90, 0xb6ab8d, 0xa4a89b];

export const VARIANTS = 6;
const heights = new Map<string, number>();

export function buildingHeight(kind: number, level: number, variant: number): number {
  const key = `${kind}:${level}:${variant}`;
  if (!heights.has(key)) buildingGeometry(kind, level, variant).dispose();
  return heights.get(key)!;
}

export const BANNER_COLORS = [0xc4463a, 0x2f6f9e, 0xd8a13c, 0x3f8a63, 0x8c5aa8, 0xd1683c];

/**
 * A shop sign hung on the wall: a cloth panel with a lettering stripe, standing just proud of the
 * facade. Only some buildings carry one, and which sides they use comes from the tile's own variant,
 * so a street gets a mix rather than a uniform row of billboards.
 */
function banners(b: Builder, w: number, h: number, d: number, v: number, seed: number): void {
  const rnd = mulberry32(seed * 2654435761 + v);
  if (rnd() < 0.35) return; // plenty of plain frontages
  const height = Math.min(0.42, h * 0.3);
  const top = Math.min(h - 0.08, 0.35 + rnd() * (h * 0.5));
  const color = BANNER_COLORS[Math.floor(rnd() * BANNER_COLORS.length)];
  const front = rnd() < 0.8, side = rnd() < 0.55 ? (rnd() < 0.5 ? -1 : 1) : 0;
  if (front) {
    const width = w * (0.45 + rnd() * 0.4);
    b.box(width, height, 0.03, (rnd() - 0.5) * (w - width) * 0.6, top, d / 2 + 0.02, color);
    b.box(width * 0.7, height * 0.22, 0.012, (rnd() - 0.5) * 0.05, top + height * 0.38, d / 2 + 0.035, 0xf4efe2);
  }
  if (side) {
    const depth = d * (0.4 + rnd() * 0.4);
    b.box(0.03, height, depth, side * (w / 2 + 0.02), top, (rnd() - 0.5) * (d - depth) * 0.6, color);
    b.box(0.012, height * 0.22, depth * 0.7, side * (w / 2 + 0.035), top + height * 0.38, 0, 0xf4efe2);
  }
}

export const LOGO_COLORS = [0xc8382f, 0x2f6fb7, 0x2e9d6a, 0x7a4fb5, 0xd98f1c, 0x1f8a99];

/**
 * A company mark near the top of the facade: a coloured plate carrying a simple white emblem, lit
 * after dark like a real sign. The emblem is one of a few box patterns chosen by the variant.
 */
function logo(b: Builder, w: number, h: number, d: number, v: number): void {
  const size = Math.min(0.3, w * 0.42), y = h - size - 0.12, z = d / 2 + 0.02;
  if (y < 0.4) return; // a low building has no room for a sign above its windows
  const brand = LOGO_COLORS[v % LOGO_COLORS.length];
  b.box(size, size, 0.03, 0, y, z, brand);
  const m = size * 0.62, f = z + 0.02;
  switch (v % 4) {
    case 0: // stacked bars
      for (const k of [-1, 0, 1]) b.box(m, m * 0.16, 0.02, 0, y + size / 2 + k * m * 0.3 - m * 0.08, f, OFFICE_LIT);
      break;
    case 1: // a ring, drawn as a square frame
      b.box(m, m * 0.16, 0.02, 0, y + size / 2 + m * 0.42 - m * 0.08, f, OFFICE_LIT);
      b.box(m, m * 0.16, 0.02, 0, y + size / 2 - m * 0.42 - m * 0.08, f, OFFICE_LIT);
      for (const k of [-1, 1]) b.box(m * 0.16, m, 0.02, k * m * 0.42, y + size / 2 - m / 2, f, OFFICE_LIT);
      break;
    case 2: // three rising columns
      for (const k of [-1, 0, 1]) b.box(m * 0.2, m * (0.5 + (k + 1) * 0.25), 0.02, k * m * 0.34, y + (size - m) / 2, f, OFFICE_LIT);
      break;
    default: // a solid block with a notch
      b.box(m, m, 0.02, 0, y + (size - m) / 2, f, OFFICE_LIT);
      b.box(m * 0.36, m * 0.36, 0.022, m * 0.2, y + (size - m) / 2 + m * 0.5, f + 0.002, brand);
  }
}

/** Distinct roof silhouettes, all contained inside the building footprint. */
function roofDetail(b: Builder, y: number, variant: number): void {
  if (b.detail === 0) return;
  if (variant === 0) {
    b.box(0.2, 0.12, 0.22, 0.12, y, -0.12, 0x8c9397); // HVAC
    for (const x of [0.06, 0.12, 0.18]) b.box(0.014, 0.012, 0.17, x, y + 0.12, -0.12, 0x4d5960);
  } else if (variant === 1) {
    b.box(0.34, 0.26, 0.3, 0, y, -0.08, 0xd8d2c6); // rooftop room
    b.box(0.37, 0.035, 0.33, 0, y + 0.26, -0.08, 0x5f6a73);
    b.box(0.18, 0.1, 0.02, 0, y + 0.08, 0.08, GLASS);
    // Roof-access ladder, kept inside the rooftop room's width.
    for (const x of [-0.11, -0.05]) b.box(0.008, 0.29, 0.008, x, y, 0.078, 0x879398);
    for (let rung = 0; rung < 5; rung++) b.box(0.06, 0.008, 0.008, -0.08, y + 0.035 + rung * 0.05, 0.079, 0x879398);
  } else if (variant === 2) {
    for (const x of [-0.17, 0.17]) { // solar panels and planters
      b.box(0.23, 0.05, 0.28, x, y + 0.04, -0.08, 0x245683);
      for (const z of [-0.15, -0.08, -0.01]) b.box(0.225, 0.003, 0.004, x, y + 0.09, z, 0x718f9b);
      b.box(0.004, 0.003, 0.275, x, y + 0.09, -0.08, 0x718f9b);
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

/** Open balconies, capped at three per facade so tower detail has a fixed budget. */
function balconies(b: Builder, w: number, d: number, y0: number, floors: number, floorHeight: number): void {
  if (b.detail !== 2) return;
  const x = w * 0.26, depth = Math.min(0.085, 0.49 - d / 2);
  for (let f = 1; f < floors; f += Math.max(1, Math.ceil((floors - 1) / 3))) {
    const y = y0 + f * floorHeight, z = d / 2 + depth;
    b.box(0.2, 0.018, depth + 0.02, x, y, d / 2 + depth / 2, 0xb2b2a6);
    b.box(0.2, 0.008, 0.008, x, y + 0.095, z, 0x74888b);
    for (const dx of [-0.09, 0, 0.09]) b.box(0.006, 0.077, 0.006, x + dx, y + 0.018, z, 0x74888b);
    for (const side of [-1, 1]) b.box(0.006, 0.008, depth, x + side * 0.095, y + 0.095, d / 2 + depth / 2, 0x74888b);
    b.box(0.065, 0.04, 0.035, x + 0.045, y + 0.02, z - 0.023, 0x9b7559);
    b.box(0.07, 0.025, 0.04, x + 0.045, y + 0.06, z - 0.023, 0x577d4c);
  }
}

/** A small roof terrace along the front edge, clear of central roof equipment. */
function terrace(b: Builder, w: number, d: number, y: number, variant: number): void {
  if (b.detail !== 2 || variant === 2) return; // this roof already has solar panels and planters
  const x = -w * 0.15, z = d / 2 - 0.087;
  b.box(0.25, 0.008, 0.145, x, y + 0.002, z, 0x9a8466);
  for (const dx of [-0.09, -0.03, 0.03, 0.09]) b.box(0.004, 0.002, 0.14, x + dx, y + 0.01, z, 0x70634f);
  for (const dx of [-0.12, 0.12]) {
    b.box(0.008, 0.095, 0.008, x + dx, y + 0.008, z + 0.065, 0x728185);
    b.box(0.008, 0.008, 0.13, x + dx, y + 0.1, z, 0x728185);
  }
  b.box(0.25, 0.008, 0.008, x, y + 0.1, z + 0.065, 0x728185);
  b.box(0.075, 0.045, 0.055, x - 0.065, y + 0.01, z, 0x526a6d);
  b.box(0.075, 0.035, 0.012, x - 0.065, y + 0.055, z - 0.025, 0x708b87);
  b.box(0.065, 0.045, 0.055, x + 0.065, y + 0.01, z, 0x997357);
  b.box(0.07, 0.04, 0.06, x + 0.065, y + 0.055, z, 0x59834d);
}

/** Shop display, sign motif and a small menu board, all on the building's own frontage. */
function shopDisplay(b: Builder, w: number, h: number, d: number, variant: number): void {
  if (b.detail !== 2) return;
  const z = d / 2;
  b.pane(w * 0.53, 0.012, -w * 0.12, 0.18, z + 0.025, 0, 0x71817e);
  for (let item = 0; item < 4; item++) {
    const x = -w * 0.34 + item * w * 0.145;
    b.pane(w * 0.075, 0.03 + (item % 2) * 0.025, x, 0.192, z + 0.026, 0,
      [0xb98158, 0x819c74, 0xc1ad79, 0x9e7794][(item + variant) % 4]);
  }
  for (const dx of [-0.11, 0, 0.11]) b.pane(0.065, 0.021, -w * 0.12 + dx, h + 0.047, z - 0.003, 0, AWNINGS[variant]);
  const bx = -w * 0.32;
  b.box(0.09, 0.13, 0.022, bx, 0.015, z + 0.06, 0x916e50);
  b.pane(0.074, 0.096, bx, 0.033, z + 0.072, 0, 0x314e49);
  for (let line = 0; line < 3; line++) b.pane(line === 0 ? 0.05 : 0.036, 0.006, bx, 0.105 - line * 0.021, z + 0.073, 0, 0xc2c5ac);
}

/** Small entrances and planted pots make the ground floor legible from street level. */
function entrance(b: Builder, d: number, x: number, house: boolean): void {
  if (b.detail === 0) return;
  const z = d / 2;
  b.box(house ? 0.19 : 0.36, 0.025, 0.09, x, 0.004, z + 0.055, 0xb7b1a3);
  b.box(house ? 0.16 : 0.32, 0.025, 0.055, x, 0.029, z + 0.035, 0xd0c9ba);
  if (house) {
    b.box(0.21, 0.025, 0.13, x, 0.23, z + 0.05, 0x6d7970);
    for (const side of [-1, 1]) b.box(0.012, 0.2, 0.012, x + side * 0.089, 0.03, z + 0.105, 0xc8bda7);
    b.pane(0.012, 0.024, x + 0.037, 0.105, z + 0.017, 0, 0xc7af73);
  } else {
    for (const side of [-1, 0, 1]) b.pane(0.012, 0.22, x + side * 0.13, 0.03, z + 0.037, 0, 0xb4c2c5);
    for (const side of [-1, 1]) b.pane(0.008, 0.055, x + side * 0.025, 0.1, z + 0.04, 0, 0xd3d5ce);
  }
  if (b.detail === 2) {
    // A planted window box for homes; paired flowering entrance pots for larger buildings.
    const fx = house ? -0.13 : -0.25, fy = house ? 0.14 : 0.07;
    b.box(0.14, 0.04, 0.055, fx, fy, z + 0.04, 0x997252);
    b.box(0.13, 0.024, 0.05, fx, fy + 0.04, z + 0.04, 0x4f7949);
    for (const dx of [-0.04, 0, 0.04]) b.box(0.022, 0.015, 0.022, fx + dx, fy + 0.062, z + 0.04, 0xc86976);
    if (house) for (const side of [-1, 1]) {
      b.pane(0.025, 0.11, -0.13 + side * 0.065, 0.175, z + 0.022, 0, 0x597267);
      for (let slat = 0; slat < 4; slat++) b.pane(0.021, 0.004, -0.13 + side * 0.065, 0.187 + slat * 0.022, z + 0.023, 0, 0x8a9b87);
    }
  }
  const px = house ? -0.2 : 0.25;
  b.box(0.09, 0.065, 0.075, px, 0.01, z + 0.055, 0x977357);
  b.box(0.1, 0.055, 0.08, px, 0.075, z + 0.055, 0x497348);
  b.box(0.064, 0.026, 0.056, px - 0.012, 0.13, z + 0.05, 0x71944c);
}

const CROPS = [0xc9a94e, 0x5f8f3e, 0x8a78b8, 0x79a553, 0xa9b548, 0xd4b13a];
const BARNS = [0xa8423a, 0xb5503d, 0x8e3b33, 0xc9c2b0, 0x9c4a36, 0x6f7f8a];

/** Crop rows across a field, running front to back. */
function rows(b: Builder, x0: number, x1: number, z0: number, z1: number, crop: number, tall: number): void {
  b.box(x1 - x0, 0.012, z1 - z0, (x0 + x1) / 2, 0, (z0 + z1) / 2, 0x7a5b3c); // tilled earth
  for (let x = x0 + 0.04; x < x1 - 0.02; x += 0.07) b.box(0.035, tall, z1 - z0 - 0.04, x, 0.012, (z0 + z1) / 2, crop);
}

/** Farmland: fields that fill the lot, with a barn, then silos, then greenhouses as the farm grows. */
function farm(b: Builder, level: number, v: number): void {
  const crop = CROPS[v], barn = BARNS[v], side = v % 2 ? 1 : -1;
  // Post-and-rail fence round the lot, open at the front for the track.
  for (const s of [-1, 1]) b.box(0.015, 0.05, 0.94, s * 0.47, 0.02, 0, 0x8a6b4b);
  b.box(0.94, 0.05, 0.015, 0, 0.02, -0.47, 0x8a6b4b);
  b.box(0.12, 0.008, 0.94, side * 0.3, 0, 0, 0xa89272); // farm track to the road
  if (level === 1) {
    rows(b, side > 0 ? -0.46 : -0.2, side > 0 ? 0.2 : 0.46, -0.44, 0.44, crop, 0.05);
    b.box(0.24, 0.16, 0.3, side * 0.34, 0, -0.26, barn);
    b.gable(0.24, 0.3, 0.16, 0.1, barn, 0x4f4a45);
    b.box(0.1, 0.12, 0.012, side * 0.34, 0, -0.105, 0x5a3b2a);
  } else if (level === 2) {
    rows(b, side > 0 ? -0.46 : -0.12, side > 0 ? 0.12 : 0.46, -0.44, 0.44, crop, 0.07);
    const bx = side * 0.3;
    b.box(0.3, 0.22, 0.38, bx, 0, -0.2, barn);
    // Gable roof over the offset barn: shift the builder so the prism sits over it.
    const keep = b.shift; b.shift = { x: keep.x + bx, z: keep.z - 0.2 };
    b.gable(0.3, 0.38, 0.22, 0.14, barn, 0x4a4540);
    b.shift = keep;
    b.box(0.14, 0.16, 0.012, bx, 0, -0.005, 0xe8e2d2);
    b.cyl(0.07, 0.42, bx, 0, 0.2, 0xc8ccc8, 12); // silo
    b.taper(0.01, 0.075, 0.07, bx, 0.42, 0.2, 0x8c9396, 12);
    b.box(0.07, 0.05, 0.1, -side * 0.05, 0.012, 0.36, 0x3d7a3a); // tractor
    b.box(0.05, 0.05, 0.04, -side * 0.05, 0.06, 0.34, 0x2a3a3e);
  } else {
    rows(b, -0.46, 0.46, 0.08, 0.44, crop, 0.07);
    // A row of greenhouses and a pair of silos behind them.
    for (const x of [-0.3, 0, 0.3]) {
      b.box(0.26, 0.16, 0.42, x, 0, -0.18, 0xb9d6d4);
      const keep = b.shift; b.shift = { x: keep.x + x, z: keep.z - 0.18 };
      b.gable(0.26, 0.42, 0.16, 0.08, 0xcfe3e0, 0xa7c4c2);
      b.shift = keep;
      for (let z = -0.36; z <= 0.01; z += 0.09) b.box(0.265, 0.2, 0.008, x, 0, z, 0x8aa3a1);
    }
    for (const x of [-0.37, 0.37]) {
      b.cyl(0.06, 0.5, x, 0, 0.02, 0xc8ccc8, 12);
      b.taper(0.01, 0.065, 0.06, x, 0.5, 0.02, 0x8c9396, 12);
    }
  }
}

const HOTEL = [0xe9d8c4, 0xd98f7a, 0xf1ece0, 0x9cc1c9, 0xe6c07a, 0xc7a3c9];
const STRIPES = [0xd8453b, 0x2f7fb8, 0x3f9a5f, 0xe07fb0, 0xe0a021, 0x6a5acd];

/** A café table under a parasol. */
function parasol(b: Builder, x: number, z: number, color: number): void {
  b.cyl(0.006, 0.16, x, 0, z, 0xd9d4c8, 5);
  b.taper(0.006, 0.09, 0.04, x, 0.15, z, color, 8);
  b.cyl(0.04, 0.05, x, 0, z, 0xe8e4da, 8);
}

/** Leisure and tourism: a café with a terrace, then a boutique hotel, then a resort tower with a pool. */
function leisure(b: Builder, level: number, v: number): void {
  const stripe = STRIPES[v], wall = HOTEL[v];
  if (level === 1) {
    const w = 0.66, h = [0.42, 0.5, 0.38, 0.46, 0.55, 0.4][v], d = 0.46;
    b.box(w, h, d, 0, 0, -0.18, wall);
    b.box(w * 0.8, 0.22, 0.02, 0, 0.08, -0.18 + d / 2 + 0.005, GLASS);
    for (let k = 0; k < 6; k++) b.box(w / 6, 0.03, 0.2, -w / 2 + w / 12 + k * w / 6, h - 0.12, 0.13, k % 2 ? 0xf1ece0 : stripe); // striped awning
    b.box(w * 0.5, 0.08, 0.02, 0, h - 0.04, -0.18 + d / 2 + 0.012, stripe); // sign
    for (const [x, z] of [[-0.24, 0.3], [0, 0.34], [0.24, 0.3]] as [number, number][]) parasol(b, x, z, v % 2 ? stripe : 0xf1ece0);
    b.box(0.9, 0.04, 0.03, 0, 0.012, 0.44, 0x5d8a45); // hedge planters along the terrace
    roofDetail(b, h, v);
  } else if (level === 2) {
    const floors = [4, 5, 3, 5, 4, 6][v], w = 0.74, d = 0.6, h = 0.25 + floors * 0.28;
    b.box(w, h, d, 0, 0, -0.08, wall);
    b.box(w + 0.04, 0.05, d + 0.04, 0, h, -0.08, 0x5f5a53);
    b.windows(w, h, d, 0.25, floors, 3, 0.45);
    for (let f = 1; f < floors; f++) b.box(w * 0.9, 0.025, 0.08, 0, 0.25 + f * 0.28 - 0.03, -0.08 + d / 2 + 0.04, 0xd9d4c8); // balconies
    b.box(0.3, 0.2, 0.03, 0, 0, -0.08 + d / 2 + 0.005, GLASS);
    b.box(0.4, 0.025, 0.2, 0, 0.22, -0.08 + d / 2 + 0.1, stripe); // entrance canopy
    b.box(0.05, 0.3, 0.02, w / 2 - 0.02, h * 0.45, -0.08 + d / 2 + 0.02, stripe); // vertical hotel sign
    for (const x of [-0.3, 0.3]) parasol(b, x, 0.38, stripe);
    roofDetail(b, h + 0.05, v);
  } else {
    // Resort: a podium with a pool deck, and a slim tower of rooms.
    const floors = [10, 13, 8, 12, 9, 14][v], w = 0.5, d = 0.42, h = floors * 0.3;
    b.box(0.9, 0.22, 0.86, 0, 0, 0, 0xd9d2c3);
    b.box(0.6, 0.18, 0.02, 0, 0.02, 0.435, GLASS);
    b.box(0.86, 0.02, 0.36, 0, 0.22, 0.22, 0xe6e0d0); // pool deck
    b.box(0.5, 0.025, 0.2, -0.12, 0.225, 0.24, 0x3fa9d0); // pool
    for (const x of [0.22, 0.32]) b.box(0.05, 0.02, 0.12, x, 0.24, 0.24, 0xf1ece0); // loungers
    parasol(b, 0.27, 0.36, stripe);
    b.box(w, h, d, 0, 0.22, -0.2, wall);
    b.windows(w, h, d, 0.1, floors, 3, 0.5, 0.11);
    for (let f = 1; f < floors; f++) b.box(w + 0.03, 0.02, d + 0.03, 0, 0.22 + f * (h / floors), -0.2, 0xbfb8aa);
    b.box(w + 0.04, 0.06, d + 0.04, 0, 0.22 + h, -0.2, 0x4d5860);
    b.box(0.34, 0.12, 0.02, 0, 0.22 + h - 0.2, -0.2 + d / 2 + 0.02, stripe); // name across the top
    roofDetail(b, 0.28 + h, v);
  }
}

/** Build the geometry for a (kind, level, variant) triple. Front of the building faces +z. */
export function buildingGeometry(kind: number, level: number, variant: number, detail: VisualDetail = 1): THREE.BufferGeometry {
  const b = new Builder(kind * 100 + level * 10 + variant, detail);
  const v = variant % VARIANTS;
  if (isDecoration(kind)) {
    parkGeometry(b, kind, variant);
  } else if (kind === T_RES) {
    if (level === 1) {
      const w = [0.5, 0.62, 0.54, 0.6, 0.66, 0.46][v], h = [0.4, 0.65, 0.48, 0.72, 0.44, 0.56][v], d = [0.56, 0.6, 0.68, 0.58, 0.52, 0.7][v];
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
      entrance(b, d, 0.1, true);
      if (b.detail === 2) {
        for (const side of [-1, 1]) {
          b.box(0.025, 0.022, d + 0.065, side * (w / 2 + 0.018), h - 0.012, 0, 0x6b7879);
          b.box(0.015, h - 0.025, 0.015, side * (w / 2 + 0.012), 0.025, -d / 2 + 0.025, 0x6b7879);
        }
        b.box(0.092, 0.022, 0.092, -0.15, h + 0.29, -0.12, 0x80796b);
        b.box(0.05, 0.015, 0.05, -0.15, h + 0.312, -0.12, 0x3d4544);
      }
    } else if (level === 2) {
      const floors = [3, 4, 5, 4, 2, 6][v];
      const w = [0.68, 0.76, 0.64, 0.72, 0.8, 0.6][v], h = 0.22 + floors * 0.31, d = [0.68, 0.62, 0.74, 0.7, 0.66, 0.78][v];
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
      balconies(b, w, d, 0.22, floors, 0.31);
      terrace(b, w, d, h + 0.05, v);
    } else {
      const floors = [7, 9, 6, 11, 5, 8][v];
      const w = [0.7, 0.65, 0.8, 0.68, 0.78, 0.62][v], h = 0.28 + floors * 0.34, d = [0.7, 0.76, 0.64, 0.7, 0.72, 0.8][v];
      b.box(w, h, d, 0, 0, 0, TOWER_WALLS[v]);
      b.box(w + 0.05, 0.08, d + 0.05, 0, 0, 0, 0x7a7469);
      b.box(w + 0.03, 0.05, d + 0.03, 0, h, 0, 0x5f5a53);
      b.windows(w, h, d, 0.28, floors, 3, 0.25, 0.12);
      balconies(b, w, d, 0.28, floors, 0.34);
      terrace(b, w, d, h + 0.05, v);
      roofDetail(b, h + 0.05, v);
      b.box(0.16, 0.26, 0.03, 0, 0, d / 2 + 0.005, 0x3d2c22);
    }
  } else if (kind === T_COM) {
    if (level === 1) {
      const w = [0.82, 0.78, 0.84, 0.7, 0.86, 0.66][v], h = [0.55, 0.7, 0.48, 0.85, 0.42, 0.95][v], d = [0.7, 0.62, 0.76, 0.66, 0.8, 0.58][v];
      b.box(w, h, d, 0, 0, 0, SHOP_WALLS[v]);
      b.box(w * 0.6, 0.28, 0.03, -w * 0.12, 0.12, d / 2 + 0.005, GLASS);
      b.box(0.14, 0.38, 0.03, w * 0.36, 0, d / 2 + 0.005, 0x3d2c22);
      if (v !== 3 && v !== 5) {
        const ay = Math.min(0.44, h - 0.1);
        b.box(w * 0.96, 0.04, 0.24, 0, ay, d / 2 + 0.1, AWNINGS[v]);
        for (let stripe = 0; stripe < 5; stripe++) {
          const x = (stripe - 2) * w * 0.18;
          b.box(w * 0.085, 0.004, 0.238, x, ay + 0.04, d / 2 + 0.1, 0xe4dcc7);
          b.pane(w * 0.085, 0.045, x, ay - 0.005, d / 2 + 0.221, 0, 0xe4dcc7);
        }
      }
      // Shopfront glazing bars and door handle sit just in front of the existing glass.
      for (const side of [-1, 0, 1]) b.pane(0.012, 0.28, -w * 0.12 + side * w * 0.27, 0.12, d / 2 + 0.022, 0, 0xb8c1bc);
      b.pane(0.008, 0.07, w * 0.36 - 0.035, 0.14, d / 2 + 0.022, 0, 0xd2c6a6);
      b.box(w * 0.6, 0.12, 0.05, -w * 0.12, h, d / 2 - 0.03, 0xfff4dc);
      banners(b, w, h, d, v, 11);
      shopDisplay(b, w, h, d, v);
      roofDetail(b, h + 0.12, v);
      b.box(0.02, 0.18, 0.3, w / 2 + 0.005, 0.15, 0, WINDOW_DARK);
    } else if (level === 2) {
      // Two, three or six storeys, and a parapet or a setback top floor rather than one flat slab.
      const floors = [3, 5, 2, 6, 4, 3][v];
      const w = [0.8, 0.72, 0.84, 0.68, 0.76, 0.82][v], h = 0.3 + floors * 0.31, d = [0.76, 0.7, 0.8, 0.66, 0.78, 0.72][v];
      b.box(w, h, d, 0, 0, 0, BLOCK_WALLS[v]);
      b.box(w + 0.04, 0.1, d + 0.04, 0, 0, 0, 0x6b6257);
      b.bands(w, h, d, 0.3, floors, v % 2 ? 0x3d6a85 : 0x4a4139, 0.1);
      b.litPanes(w, h, d, 0.3, floors, 4, 0.42);
      if (v === 1 || v === 4) b.box(w * 0.7, 0.34, d * 0.7, 0, h, 0, BLOCK_WALLS[v]); // setback top floor
      b.box(w + 0.03, 0.05, d + 0.03, 0, h + (v === 1 || v === 4 ? 0.34 : 0), 0, 0x46525c);
      banners(b, w, h, d, v, 27);
      roofDetail(b, h + (v === 1 || v === 4 ? 0.39 : 0.05), v);
      b.box(0.4, 0.26, 0.03, 0, 0, d / 2 + 0.005, GLASS);
      entrance(b, d, 0, false);
    } else {
      const floors = [12, 9, 15, 11, 6, 8][v];
      const w = [0.8, 0.7, 0.66, 0.76, 0.86, 0.72][v], h = floors * 0.35, d = [0.8, 0.74, 0.7, 0.78, 0.84, 0.76][v];
      b.box(w, h, d, 0, 0, 0, GLASS_TOWERS[v]);
      b.box(w + 0.05, 0.12, d + 0.05, 0, 0, 0, 0x3a4a5a);
      for (let f = 1; f < floors; f++) {
        b.box(w + 0.02, 0.035, d + 0.02, 0, (h / floors) * f, 0, 0x2a3a4a);
      }
      b.litPanes(w, h, d, 0, floors, 5, 0.38, 0.35);
      logo(b, w, h, d, v + 2);
      b.box(0.55, 0.5, 0.55, 0, h, 0, GLASS_TOWERS[v]);
      b.box(0.58, 0.04, 0.58, 0, h + 0.5, 0, 0x2a3a4a);
      roofDetail(b, h + 0.54, v);
      b.box(0.5, 0.3, 0.03, 0, 0, d / 2 + 0.005, 0xbfe3f5);
    }
  } else if (kind === T_OFFICE) {
    const floors = level === 1 ? [2, 3, 2, 4, 1, 3][v] : level === 2 ? [5, 7, 6, 8, 3, 4][v] : [11, 14, 12, 16, 7, 9][v];
    const w = [0.76, 0.65, 0.8, 0.7, 0.84, 0.68][v], d = [0.68, 0.8, 0.62, 0.74, 0.78, 0.7][v], h = floors * 0.3;
    b.box(w, h, d, 0, 0, 0, OFFICE_WALLS[v]);
    b.bands(w, h, d, 0.18, floors, 0x284c68, 0.16);
    b.litPanes(w, h, d, 0.18, floors, 4, 0.48, 0.28);
    logo(b, w, h, d, v + level);
    for (const x of [-w * 0.3, w * 0.3]) b.box(0.035, h, d + 0.035, x, 0, 0, 0xc9d2d9);
    b.box(w + 0.04, 0.08, d + 0.04, 0, h, 0, 0x536270);
    b.box(0.3, 0.23, 0.03, 0, 0, d / 2 + 0.02, GLASS);
    roofDetail(b, h + 0.08, v);
    terrace(b, w, d, h + 0.08, v);
    entrance(b, d, 0, false);
  } else if (kind === T_IND) {
    const h = [0.42, 0.62, 0.52, 0.7, 0.48, 0.58][v] + (level - 1) * 0.32;
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
  } else if (kind === T_FARM) {
    farm(b, level, v);
  } else if (kind === T_LEISURE) {
    leisure(b, level, v);
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
  } else if (kind === T_GAS) {
    // A compact turbine hall with two slim stacks and a row of gas tanks.
    b.box(0.92, 0.04, 0.92, 0, 0, 0, 0x777a7c);
    b.box(0.56, 0.36, 0.42, -0.14, 0.04, 0.14, 0xc9ccce);
    b.box(0.58, 0.05, 0.44, -0.14, 0.4, 0.14, 0x3f6f9e);
    b.windows(0.56, 0.36, 0.42, 0.1, 1, 3, 0.3, 0.09);
    for (const x of [0.22, 0.34]) { b.cyl(0.04, 0.95, x, 0.04, 0.22, 0xb9bcbe, 10); b.cyl(0.045, 0.05, x, 0.96, 0.22, 0x3f6f9e, 10); }
    for (const x of [-0.3, -0.05, 0.2]) b.cyl(0.1, 0.24, x, 0.04, -0.28, 0xe9e9e4, 14);
    b.box(0.7, 0.03, 0.03, -0.05, 0.2, -0.28, 0x8c9092);
  } else if (kind === T_HYDRO) {
    // A concrete dam face stepping down to the river behind it (-z), with the generator house on top.
    b.box(0.94, 0.05, 0.94, 0, 0, 0, 0x9a9890);
    b.box(0.94, 0.55, 0.36, 0, 0.05, -0.28, 0xb9b6ac);
    b.box(0.94, 0.3, 0.18, 0, -0.25, -0.52, 0xa7a49a); // spillway apron
    for (const x of [-0.3, 0, 0.3]) b.box(0.16, 0.34, 0.03, x, 0.12, -0.47, 0x2d4d63); // sluice gates
    b.box(0.6, 0.3, 0.34, 0.05, 0.05, 0.14, 0xd4d1c7);
    b.box(0.64, 0.05, 0.38, 0.05, 0.35, 0.14, 0x3a6b8c);
    b.windows(0.6, 0.3, 0.34, 0.1, 1, 3, 0.35, 0.08);
    for (const x of [-0.34, 0.36]) { b.box(0.04, 0.5, 0.04, x, 0.05, 0.3, 0x7c8084); b.box(0.22, 0.03, 0.03, x, 0.52, 0.3, 0x7c8084); }
  } else if (kind === T_CEMETERY) {
    // Lawns in rows of headstones, a gravel path, yew trees and a small chapel, on a 2 x 2 site.
    b.shift = { x: 0.5, z: 0.5 };
    b.box(1.92, 0.02, 1.92, 0, 0, 0, 0x6f9a55);
    b.box(0.16, 0.022, 1.9, 0, 0, 0, 0xcfc4a8); // path
    for (let row = 0; row < 6; row++) for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
      const x = side * (0.22 + k * 0.17), z = -0.75 + row * 0.26;
      b.box(0.07, 0.07 + ((row + k) % 3) * 0.015, 0.025, x, 0.02, z, row % 2 ? 0xb9b6ad : 0xa7a49b);
    }
    for (const [x, z] of [[-0.85, 0.85], [0.85, 0.85], [-0.85, -0.85], [0.85, -0.85]] as [number, number][]) b.taper(0.01, 0.1, 0.34, x, 0.02, z, 0x2f5a37, 8);
    b.box(0.34, 0.3, 0.4, 0, 0.02, 0.72, 0xd9d2c3); // chapel
    b.gable(0.34, 0.4, 0.32, 0.18, 0xd9d2c3, 0x5b5f66);
    b.box(0.06, 0.18, 0.06, 0, 0.5, 0.88, 0xd9d2c3);
    b.box(0.1, 0.012, 0.012, 0, 0.62, 0.88, 0xd9d2c3); // cross arm
    for (const x of [-0.95, 0.95]) b.box(0.02, 0.12, 1.92, x, 0.02, 0, 0x4a4f4a); // railings
    b.box(1.92, 0.12, 0.02, 0, 0.02, -0.95, 0x4a4f4a);
  } else if (kind === T_CREMATORIUM) {
    b.box(0.92, 0.03, 0.92, 0, 0, 0, 0xb8b4aa);
    b.box(0.62, 0.34, 0.5, -0.06, 0.03, 0.05, 0xd6d0c4);
    b.box(0.66, 0.05, 0.54, -0.06, 0.37, 0.05, 0x55595e);
    b.windows(0.62, 0.34, 0.5, 0.12, 1, 3, 0.2, 0.08);
    b.cyl(0.05, 0.75, 0.3, 0.03, -0.25, 0x8f8a80, 10); // chimney
    b.box(0.3, 0.2, 0.03, -0.06, 0.03, 0.31, 0x3a2e28);
    for (const x of [-0.38, 0.38]) b.taper(0.01, 0.08, 0.28, x, 0.03, 0.38, 0x2f5a37, 8);
  } else if (kind === T_POST_OFFICE) {
    b.box(0.92, 0.03, 0.92, 0, 0, 0, 0xb4b2aa);
    b.box(0.74, 0.46, 0.56, 0, 0.03, -0.05, 0xe9e3d6);
    b.box(0.78, 0.06, 0.6, 0, 0.49, -0.05, 0xd9503f);
    b.windows(0.74, 0.46, 0.56, 0.1, 1, 3, 0.35, 0.1);
    b.box(0.5, 0.06, 0.03, 0, 0.36, 0.24, 0xd9503f); // sign band
    b.box(0.2, 0.26, 0.03, 0, 0.03, 0.24, 0x3a4a5a);
    for (const x of [-0.28, 0.28]) { b.box(0.14, 0.08, 0.2, x, 0.03, 0.36, 0xe0a021); b.box(0.12, 0.08, 0.02, x, 0.07, 0.46, 0x2a2f36); } // parked vans
    b.box(0.05, 0.1, 0.05, 0.38, 0.03, 0.42, 0xd9503f); // post box
  } else if (kind === T_FLOOD_BARRIER) {
    // A concrete wall along the bank (-z faces the river) with a pump house behind it.
    b.box(0.98, 0.02, 0.98, 0, 0, 0, 0x9c9a92);
    b.box(0.98, 0.34, 0.16, 0, 0, -0.38, 0xb4b1a8);
    b.box(0.98, 0.04, 0.2, 0, 0.34, -0.38, 0x8a877f);
    for (const x of [-0.3, 0, 0.3]) b.box(0.12, 0.2, 0.03, x, 0.08, -0.47, 0x2d4d63); // gates
    b.box(0.4, 0.26, 0.32, 0.18, 0.02, 0.2, 0xcfc9bb);
    b.box(0.44, 0.04, 0.36, 0.18, 0.28, 0.2, 0x3a6b8c);
    b.pipe(0.035, 0.5, -0.2, 0.12, -0.05, 0x5f6a73);
  } else if (kind === T_LANDMARK) {
    // An observation tower: a slim shaft, a glazed deck near the top, a mast, and a plaza at its foot.
    b.shift = { x: 0.5, z: 0.5 };
    b.box(1.92, 0.025, 1.92, 0, 0, 0, 0xcfc9bb);
    for (let k = 0; k < 4; k++) b.box(0.3, 0.03, 0.3, (k % 2 ? 1 : -1) * 0.6, 0.02, (k < 2 ? 1 : -1) * 0.6, 0x6f9a55);
    b.taper(0.14, 0.26, 3.4, 0, 0.025, 0, 0xe4e0d6, 16);
    b.taper(0.46, 0.2, 0.2, 0, 3.0, 0, 0xd7d2c6, 18);
    b.cyl(0.46, 0.3, 0, 3.2, 0, 0x7fb6d6, 18); // glazed deck
    b.cyl(0.5, 0.06, 0, 3.5, 0, 0xc9453b, 18);
    b.taper(0.03, 0.08, 0.9, 0, 3.56, 0, 0xd7d2c6, 8);
    b.cyl(0.04, 0.04, 0, 4.44, 0, 0xc9453b, 8);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; b.box(0.05, 0.05, 0.05, Math.cos(a) * 0.9, 0.03, Math.sin(a) * 0.9, 0x3a4149); }
  } else if (kind === T_NUCLEAR) {
    // Two hyperbolic cooling towers, a domed reactor and a turbine hall on a 3 x 3 site.
    b.shift = { x: 1, z: 1 };
    b.box(2.94, 0.05, 2.94, 0, 0, 0, 0x8d8f89);
    for (const [x, z] of [[-0.7, -0.6], [0.55, -0.75]] as [number, number][]) {
      b.taper(0.62, 0.42, 1.0, x, 0.05, z, 0xd8d6cf, 20);
      b.taper(0.42, 0.5, 0.75, x, 1.05, z, 0xd8d6cf, 20);
      b.cyl(0.5, 0.04, x, 1.8, z, 0xb4b1a8, 20);
    }
    b.cyl(0.42, 0.7, -0.4, 0.05, 0.75, 0xe6e4dd, 18); // reactor building
    b.taper(0.42, 0.05, 0.35, -0.4, 0.75, 0.75, 0xcfccc3, 18); // dome
    b.box(1.0, 0.55, 0.6, 0.65, 0.05, 0.7, 0xbfc3c6); // turbine hall
    b.box(1.04, 0.05, 0.64, 0.65, 0.6, 0.7, 0x4d6a82);
    b.windows(1.0, 0.55, 0.6, 0.15, 2, 5, 0.35, 0.08);
    b.box(0.08, 0.9, 0.08, 1.25, 0.05, 1.25, 0xb8433a); // stack
    b.box(0.14, 0.06, 0.14, 1.25, 0.95, 1.25, 0xd8d6cf);
    b.shift = { x: 0, z: 0 };
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
  } else if (kind === T_PLAYGROUND) {
    // Sand, a swing frame, a slide and a sandpit: a corner of the block given over to children.
    b.box(0.96, 0.04, 0.96, 0, 0, 0, 0xd9c9a2);
    b.box(0.9, 0.02, 0.9, 0, 0.04, 0, 0xe3d6b4);
    for (const x of [-0.26, 0.26]) { b.box(0.03, 0.34, 0.03, x, 0.05, -0.3, 0x5d7f95); b.box(0.03, 0.34, 0.03, x, 0.05, -0.12, 0x5d7f95); }
    b.box(0.58, 0.035, 0.035, 0, 0.38, -0.21, 0x5d7f95);
    for (const x of [-0.14, 0.14]) { b.box(0.012, 0.2, 0.012, x, 0.18, -0.21, 0x8d9ba5); b.box(0.13, 0.03, 0.06, x, 0.16, -0.21, 0xd4693f); }
    b.box(0.3, 0.26, 0.24, 0.22, 0.05, 0.24, 0x7fae6b);
    b.taper(0.18, 0.02, 0.02, 0.22, 0.31, 0.24, 0xe0b23c, 4);
    b.box(0.16, 0.05, 0.38, 0.06, 0.12, 0.34, 0x4f8fd0);
    b.cyl(0.19, 0.06, -0.26, 0.04, 0.26, 0xc4a87a, 10);
    b.cyl(0.03, 0.22, -0.34, 0.04, -0.3, 0x7d6245, 6);
    b.taper(0.035, 0.16, 0.4, -0.34, 0.2, -0.3, 0x43815b, 8);
  } else if (kind === T_SPORTS) {
    // Two cells square: a marked pitch with goals, a little stand and a path along one edge.
    b.box(1.96, 0.04, 1.96, 0.5, 0, 0.5, 0x5f9755);
    b.box(1.7, 0.02, 1.5, 0.5, 0.04, 0.5, 0x6fae63);
    b.box(1.62, 0.01, 0.03, 0.5, 0.06, 0.5, 0xe8ecdf);
    for (const z of [-0.2, 1.2]) b.box(1.62, 0.01, 0.03, 0.5, 0.06, z, 0xe8ecdf);
    for (const x of [-0.31, 1.31]) b.box(0.03, 0.01, 1.43, x, 0.06, 0.5, 0xe8ecdf);
    for (const x of [-0.3, 1.3]) {
      b.box(0.03, 0.22, 0.44, x, 0.06, 0.5, 0xe4e8e0);
      b.box(0.03, 0.02, 0.44, x, 0.28, 0.5, 0xe4e8e0);
    }
    b.box(1.5, 0.12, 0.3, 0.5, 0.05, 1.3, 0xb9b4a6);
    b.box(1.5, 0.12, 0.18, 0.5, 0.17, 1.38, 0xa8a294);
    for (const x of [-0.35, 1.35]) { b.box(0.04, 0.6, 0.04, x, 0.06, 1.22, 0x7c8890); b.box(0.12, 0.06, 0.05, x, 0.66, 1.22, 0xf0efe4); }
    b.box(1.96, 0.02, 0.26, 0.5, 0.05, -0.38, 0xd7cbaa);
  } else if (kind === T_GARDEN) {
    // Three cells square: lawns, a pond, winding paths and mature trees.
    const rnd = mulberry32(0x9a71 + level);
    b.box(2.96, 0.04, 2.96, 1, 0, 1, 0x63a05c);
    b.box(2.7, 0.02, 2.7, 1, 0.04, 1, 0x72ad66);
    b.box(2.7, 0.02, 0.3, 1, 0.06, 1, 0xd8c9a4);
    b.box(0.3, 0.02, 2.7, 1, 0.06, 1, 0xd8c9a4);
    b.cyl(0.58, 0.03, 1.6, 0.05, 1.75, 0x4e88b4, 18);
    b.cyl(0.46, 0.02, 1.6, 0.07, 1.75, 0x5fa1cb, 18);
    for (const [x, z] of [[0.1, 0.1], [1.9, 0.15], [0.15, 1.95], [2.05, 2.05], [0.5, 2.2], [2.2, 0.9]]) {
      const h = 0.5 + rnd() * 0.35;
      b.cyl(0.05, 0.3, x, 0.05, z, 0x7d6245, 7);
      b.taper(0.06, 0.26, h, x, 0.3, z, rnd() < 0.5 ? 0x3d7a54 : 0x4c8a54, 9);
    }
    for (const [x, z, w, d] of [[1, 0.28, 0.32, 0.12], [1, 1.72, 0.32, 0.12], [0.28, 1, 0.12, 0.32], [1.72, 1, 0.12, 0.32]]) {
      b.box(w, 0.07, d, x, 0.06, z, 0xa78058);
      b.box(w, 0.13, 0.03, x, 0.13, z - d / 2, 0xa78058);
    }
    b.box(0.36, 0.5, 0.36, 2.25, 0.05, 1.7, 0xd6d2c4);
    b.taper(0.3, 0.04, 0.22, 2.25, 0.55, 1.7, 0x8fae9c, 8);
  } else if (kind === T_HOSPITAL || kind === T_CITY_HOSPITAL) {
    // A white clinical block with a red cross, an ambulance bay under a canopy and a roof helipad.
    // The city hospital adds a second ward wing on its 3 x 2 site. Authored around the site centre.
    const big = kind === T_CITY_HOSPITAL;
    b.shift = { x: big ? 1 : 0.5, z: 0.5 };
    const w = big ? 2.7 : 1.7, d = 1.5;
    b.box(w + 0.18, 0.05, d + 0.3, 0, 0, 0.05, 0xb9bcb6); // forecourt
    const low = 1.0;
    b.box(w, low, d * 0.88, 0, 0.05, -0.05, 0xeef0ec);
    b.windows(w, low + 0.05, d * 0.88, 0.2, 3, big ? 7 : 5, 0.35, 0.11);
    const towerW = big ? 1.1 : 0.85, towerH = big ? 2.6 : 1.85, tx = big ? -0.6 : 0;
    b.shift = { x: b.shift.x + tx, z: b.shift.z - 0.2 };
    b.box(towerW, towerH, 0.85, 0, 0.05, 0, 0xf6f7f4);
    b.windows(towerW, towerH + 0.05, 0.85, low + 0.1, big ? 5 : 3, 4, 0.4, 0.1);
    for (const side of [-1, 1]) b.box(0.04, towerH - low, 0.87, side * towerW / 2, low + 0.05, 0, 0x3f86b8);
    const crossY = low + (towerH - low) * 0.5;
    b.box(0.28, 0.08, 0.02, 0, crossY, 0.44, 0xd23a32);
    b.box(0.08, 0.28, 0.02, 0, crossY - 0.1, 0.44, 0xd23a32);
    b.box(towerW * 0.8, 0.04, 0.7, 0, towerH + 0.05, 0, 0x5b6167); // helipad
    b.box(towerW * 0.45, 0.012, 0.06, 0, towerH + 0.09, 0, 0xf2f2ea);
    for (const side of [-1, 1]) b.box(0.06, 0.012, 0.34, side * towerW * 0.2, towerH + 0.09, 0, 0xf2f2ea);
    b.shift = { x: big ? 1 : 0.5, z: 0.5 };
    // Ambulance bay: a red canopy on posts at the front corner.
    const bayX = big ? 0.8 : 0.4;
    b.box(0.6, 0.05, 0.36, bayX, 0.62, d * 0.44 + 0.02, 0xd23a32);
    for (const side of [-1, 1]) b.box(0.04, 0.6, 0.04, bayX + side * 0.25, 0.02, d * 0.44 + 0.16, 0xb9bcb6);
    if (big) {
      b.box(0.9, 1.5, 1.15, 0.85, 0.05, -0.12, 0xe6e9e4);
      b.shift = { x: 1.85, z: 0.38 };
      b.windows(0.9, 1.55, 1.15, 0.2, 4, 3, 0.4, 0.1);
      roofDetail(b, 1.55, 1);
    }
    b.shift = { x: 0, z: 0 };
  } else if (kind === T_POLICE_HQ) {
    // A blue-grey block with a glazed stair tower, a flagpole, antennas and a row of patrol bays.
    b.shift = { x: 0.5, z: 0.5 };
    const w = 1.55, d = 1.2, h = 1.9;
    b.box(w + 0.2, 0.05, 1.8, 0, 0, 0.1, 0x9da3a8);
    b.shift = { x: 0.5, z: 0.35 };
    b.box(w, h, d, 0, 0.05, 0, 0x8793a0);
    b.bands(w, h, d, 0.25, 5, 0x2c4a6e, 0.12);
    b.litPanes(w, h, d, 0.25, 5, 4, 0.5, 0.3);
    b.box(w + 0.04, 0.1, d + 0.04, 0, h + 0.05, 0, 0x3a4a5c);
    b.box(0.34, h + 0.35, 0.34, -0.55, 0.05, 0.36, 0x9fc2d8); // stair tower
    b.box(w * 1.01, 0.14, 0.03, 0, h - 0.35, d / 2 + 0.02, 0x2f5fa8); // blue band
    b.box(0.5, 0.14, 0.02, 0.3, h - 0.35, d / 2 + 0.035, 0xf2f2f2);
    b.cyl(0.02, 0.9, 0.6, h + 0.15, -0.3, 0xd6dadd, 6); // antennas
    b.cyl(0.015, 0.65, 0.42, h + 0.15, -0.45, 0xd6dadd, 6);
    b.shift = { x: 0.5, z: 0.5 };
    b.cyl(0.018, 1.1, -0.68, 0.05, 0.78, 0xdadde0, 6); // flagpole
    b.box(0.26, 0.16, 0.012, -0.55, 0.95, 0.78, 0x2f5fa8);
    for (let k = 0; k < 3; k++) b.box(0.24, 0.012, 0.36, -0.05 + k * 0.28, 0.06, 0.78, 0xe8e8e0); // patrol bays
    b.shift = { x: 0, z: 0 };
  } else if (kind === T_DOCKS) {
    // A quay on the bank: a fish shed, crates, a small crane, and a timber jetty running out over the
    // water behind it (-z), where the boats tie up. The renderer turns the jetty towards the river.
    b.box(0.94, 0.06, 0.94, 0, 0, 0, 0xa19c8f); // concrete apron
    b.box(0.5, 0.36, 0.42, -0.14, 0.06, 0.16, 0xb8573f); // shed
    b.box(0.56, 0.05, 0.48, -0.14, 0.42, 0.16, 0x4d5a63);
    b.box(0.16, 0.2, 0.02, -0.14, 0.06, 0.38, 0x2f2a22);
    for (const [x, z, c] of [[0.24, 0.3, 0x4f7fa8], [0.34, 0.3, 0xc9a24a], [0.29, 0.2, 0x5f8f5a]] as [number, number, number][]) b.box(0.09, 0.08, 0.09, x, 0.06, z, c);
    b.box(0.04, 0.55, 0.04, 0.3, 0.06, -0.18, 0xd9a933); // crane mast
    b.box(0.04, 0.04, 0.42, 0.3, 0.6, -0.38, 0xd9a933);   // jib, reaching out over the jetty
    b.box(0.012, 0.18, 0.012, 0.3, 0.42, -0.56, 0x3a3f44);
    // Timber jetty on piles, out past the bank.
    b.box(0.3, 0.04, 1.35, 0.1, 0.04, -0.95, 0x8a6a45);
    for (let z = -0.45; z > -1.6; z -= 0.28) for (const x of [-0.03, 0.23]) b.box(0.035, 0.18, 0.035, x, -0.12, z, 0x5e4630);
    for (let z = -0.5; z > -1.6; z -= 0.11) b.box(0.3, 0.006, 0.012, 0.1, 0.082, z, 0x6f5436);
    b.box(0.04, 0.1, 0.04, 0.25, 0.08, -1.55, 0x3a3f44); // bollard
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
  if (kind === T_TAXI) {
    b.box(0.94, 0.025, 0.88, 0, 0, 0, 0x657073);
    for (const x of [-0.39, 0.39]) b.box(0.025, 0.008, 0.72, x, 0.026, 0, 0xf4ce4f);
    b.box(0.8, 0.008, 0.025, 0, 0.026, -0.35, 0xf4ce4f);
    b.cyl(0.018, 0.75, 0.36, 0.025, -0.3, 0x596775, 6);
    b.box(0.29, 0.2, 0.035, 0.36, 0.65, -0.3, 0xf7c62f);
    // A black cab pictogram on the yellow stand sign.
    b.box(0.19, 0.055, 0.004, 0.36, 0.695, -0.28, 0x26343a);
    b.box(0.1, 0.04, 0.004, 0.36, 0.75, -0.28, 0x26343a);
    b.box(0.42, 0.05, 0.13, -0.13, 0.16, -0.25, 0xa58d69);
    for (const x of [-0.29, 0.03]) b.box(0.035, 0.16, 0.1, x, 0.03, -0.25, 0x44515a);
  } else if (kind === T_BUS || kind === T_TROLLEY) {
    b.box(0.92, 0.03, 0.7, 0, 0, 0, 0xb9b6ad);
    for (const x of [-0.35, 0.35]) b.box(0.035, 0.55, 0.035, x, 0.03, -0.16, 0x405566);
    b.box(0.75, 0.36, 0.025, 0, 0.13, -0.17, GLASS);
    b.box(0.82, 0.045, 0.48, 0, 0.58, -0.02, 0xeab75c);
    b.box(0.56, 0.08, 0.12, 0, 0.16, -0.05, 0x8a7458);
    b.box(0.025, 0.72, 0.025, 0.41, 0.03, 0.2, 0x56606b);
    b.box(0.17, 0.2, 0.03, 0.41, 0.55, 0.2, kind === T_TROLLEY ? 0x4b9472 : 0x2f86af);
    if (kind === T_TROLLEY) {
      for (const x of [-0.34, 0.34]) b.cyl(0.015, 1.15, x, 0.03, 0.29, 0x73837d, 6);
      b.box(0.72, 0.014, 0.015, 0, 1.17, 0.29, 0x73837d);
      b.pane(0.09, 0.018, 0.41, 0.68, 0.217, 0, 0xe7e8d5);
      b.pane(0.02, 0.085, 0.41, 0.595, 0.217, 0, 0xe7e8d5);
    }
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
  if (!isDecoration(kind) && kind !== T_WIND && !SERVICES[kind]?.footprint && geometry.boundingBox) {
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
  if (kind !== T_RES && kind !== T_COM && kind !== T_OFFICE && kind !== T_LEISURE) return null;
  const b = new Builder(kind * 31 + level * 7 + v), e = 0.47;
  if (kind === T_RES && level === 1) {
    b.box(0.96, 0.012, 0.96, 0, 0, 0, [0x7fa35f, 0x86a864, 0x7a9d5c, 0x8aab68, 0x829f5a, 0x7ba566][v]);
    const fence = [0xefebe0, 0x9a7650, 0xefebe0, 0x6f5a45, 0x8a6b4b, 0xe6e1d4][v], top = 0.1;
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
  b.box(0.96, 0.014, 0.96, 0, 0, 0, [0xb4b2aa, 0xaaa9a3, 0xbcb8ae, 0xa7a8a4, 0xb0ada3, 0xa9aca6][v]);
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
