import * as THREE from 'three';
import { GRID } from '../constants';
import type { Terrain } from '../terrain';
import { MeshBuilder } from './meshBuilder';

const WATER = new THREE.Color(0x3d86c6);
const MURKY = new THREE.Color(0x6e5b2f);
const tmp = new THREE.Color();

/** The river as a smooth ribbon with sandy banks and flow arrows. Sewage tints it downstream. */
export class RiverLayer {
  readonly group = new THREE.Group();
  private bank: THREE.Mesh;
  private water: THREE.Mesh;
  private range: [number, number] = [0, 0];
  private lead = 0; // extrapolated points added before the real samples

  constructor() {
    this.bank = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
    );
    this.water = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.15, side: THREE.DoubleSide }),
    );
    this.bank.receiveShadow = true;
    this.water.receiveShadow = true;
    for (const m of [this.bank, this.water]) { m.frustumCulled = false; this.group.add(m); }
  }

  rebuild(t: Terrain): void {
    const half = GRID / 2;
    const r = t.river;
    // Extend both ends in a straight line so the river runs to the horizon.
    const pts: number[] = [];
    const widths: number[] = [];
    const ext = 70;
    const first = r[0], second = r[1];
    const last = r[r.length - 1], prev = r[r.length - 2];
    const d0x = first.x - second.x, d0z = first.z - second.z;
    const l0 = Math.hypot(d0x, d0z) || 1;
    pts.push(first.x + (d0x / l0) * ext - half, first.z + (d0z / l0) * ext - half);
    widths.push(first.w);
    this.lead = 1;
    for (const p of r) { pts.push(p.x - half, p.z - half); widths.push(p.w); }
    const d1x = last.x - prev.x, d1z = last.z - prev.z;
    const l1 = Math.hypot(d1x, d1z) || 1;
    pts.push(last.x + (d1x / l1) * ext - half, last.z + (d1z / l1) * ext - half);
    widths.push(last.w);
    const count = widths.length;

    const bb = new MeshBuilder();
    bb.ribbon(pts, count, widths.map((w) => w + 0.95), 0.006, 0xcdbf8f);
    this.bank.geometry.dispose();
    this.bank.geometry = bb.build();

    const wb = new MeshBuilder();
    this.range = wb.ribbon(pts, count, widths.map((w) => w + 0.4), 0.014, WATER.getHex());
    // Flow arrows pointing downstream.
    for (let i = 6; i < r.length - 6; i += 9) {
      const a = r[i], b = r[i + 1];
      const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      wb.arrow(a.x - half, a.z - half, (b.x - a.x) / l, (b.z - a.z) / l, 0.45, 0.016, 0x8fc4ee);
    }
    this.water.geometry.dispose();
    this.water.geometry = wb.build();
  }

  /** Per river sample pollution 0..255. */
  tint(pollution: Uint8Array): void {
    const attr = this.water.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const n = (this.range[1] - this.range[0]) / 2;
    for (let i = 0; i < n; i++) {
      const k = Math.max(0, Math.min(pollution.length - 1, i - this.lead));
      const p = pollution.length ? pollution[k] / 255 : 0;
      tmp.copy(WATER).lerp(MURKY, Math.min(1, p * 1.2));
      attr.setXYZ(this.range[0] + i * 2, tmp.r, tmp.g, tmp.b);
      attr.setXYZ(this.range[0] + i * 2 + 1, tmp.r, tmp.g, tmp.b);
    }
    attr.needsUpdate = true;
  }
}
