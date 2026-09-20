import * as THREE from 'three';
import { GRID, T_SUBWAY } from '../constants';
import { transitNetwork } from '../sim/transit';
import type { Raster } from '../roads/raster';
import { Builder } from './buildingGeo';
import { transportSignature } from './transport';
import { MeshBuilder } from './meshBuilder';

const LINE_COLORS = [0x2e6fd8, 0xd8452e, 0x2ea86a, 0xe0a52a, 0x8a4fd0, 0x2aa8c4];

interface Run { points: { x: number; z: number }[]; cum: number[]; mesh: THREE.Mesh; phase: number }

/**
 * Metro lines run in straight-ish tunnels between stations, independent of roads.
 * They are only drawn in the underground view, like road tunnels.
 */
export class SubwayLayer {
  readonly group = new THREE.Group();
  private tunnels = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }));
  private trains = new THREE.Group();
  private runs: Run[] = [];
  private signature = '';
  private inputs = -1;

  constructor() {
    this.tunnels.renderOrder = 2;
    this.tunnels.frustumCulled = false;
    this.group.add(this.tunnels, this.trains);
    this.group.visible = false;
  }

  showUnderground(show: boolean): void { this.group.visible = show; }

  rebuild(kind: Uint8Array, flags: Uint8Array, raster: Raster): void {
    const inputs = transportSignature(kind, flags, raster);
    if (inputs === this.inputs) return;
    this.inputs = inputs;
    const transit = transitNetwork(kind, i => flags[i] === 0 && raster.accSeg[i] >= 0, (a, b) => kind[a] === T_SUBWAY && kind[b] === T_SUBWAY);
    const lines = transit.lines.filter(l => l.mode === 'subway');
    const signature = JSON.stringify(lines);
    if (signature === this.signature) return;
    this.signature = signature;
    for (const r of this.runs) r.mesh.geometry.dispose();
    this.trains.clear(); this.runs = [];
    const half = GRID / 2, b = new MeshBuilder();
    const center = (i: number): { x: number; z: number } => ({ x: i % GRID + 0.5 - half, z: Math.floor(i / GRID) + 0.5 - half });
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, depthTest: false });
    lines.forEach((line, n) => {
      const a = center(line.a), c = center(line.b), color = LINE_COLORS[n % LINE_COLORS.length];
      // A gentle S-bend reads as a bored tunnel rather than a ruler line.
      const dx = c.x - a.x, dz = c.z - a.z, len = Math.hypot(dx, dz) || 1, bend = Math.min(2, len * 0.08) * (n % 2 ? 1 : -1);
      const points: { x: number; z: number }[] = [], cum = [0];
      const steps = Math.max(2, Math.ceil(len / 0.5));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, s = Math.sin(t * Math.PI * 2) * bend;
        points.push({ x: a.x + dx * t - dz / len * s, z: a.z + dz * t + dx / len * s });
        if (k) cum.push(cum[k - 1] + Math.hypot(points[k].x - points[k - 1].x, points[k].z - points[k - 1].z));
      }
      const flat = points.flatMap(p => [p.x, p.z]);
      b.ribbon(flat, points.length, 0.2, 0.08, 0x1d2a38);
      b.ribbon(flat, points.length, 0.09, 0.09, color);
      const train = new Builder(n);
      train.box(0.22, 0.14, 0.9, 0, 0.1, 0, color);
      train.box(0.23, 0.05, 0.86, 0, 0.17, 0, 0xe8eef2);
      const mesh = new THREE.Mesh(train.build(), material);
      mesh.renderOrder = 3;
      this.trains.add(mesh);
      this.runs.push({ points, cum, mesh, phase: n * 3.7 });
    });
    for (const line of lines) for (const i of [line.a, line.b]) {
      const p = center(i);
      b.ring(p.x, p.z, 0.32, 0.46, 0.1, 0xf2f2f2, 24);
    }
    this.tunnels.geometry.dispose();
    this.tunnels.geometry = b.build();
  }

  /** Trains shuttle between stations with a dwell at each end. */
  update(time: number): void {
    if (!this.group.visible) return;
    for (const r of this.runs) {
      const len = r.cum.at(-1)!, travel = len / 4, dwell = 2, cycle = (travel + dwell) * 2;
      const t = (time + r.phase) % cycle;
      const leg = t < travel + dwell ? Math.min(1, t / travel) : 1 - Math.min(1, (t - travel - dwell) / travel);
      const d = (leg * leg * (3 - 2 * leg)) * len;
      let n = 1;
      while (n < r.cum.length - 1 && r.cum[n] < d) n++;
      const a = r.points[n - 1], b = r.points[n], f = (d - r.cum[n - 1]) / Math.max(0.001, r.cum[n] - r.cum[n - 1]);
      r.mesh.position.set(a.x + (b.x - a.x) * f, 0.05, a.z + (b.z - a.z) * f);
      r.mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    }
  }
}
