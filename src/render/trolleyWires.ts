import * as THREE from 'three';
import { GRID, T_TROLLEY } from '../constants';
import type { Network } from '../roads/network';
import type { Raster } from '../roads/raster';
import { transitNetwork, trolleyPath } from '../sim/transit';
import { transportSignature } from './transport';
import { MeshBuilder } from './meshBuilder';
import { Builder } from './buildingGeo';

/** Contact wire follows the same fixed directed motor lanes used by actual trolleybuses. */
export class TrolleyWireLayer {
  readonly group = new THREE.Group();
  private wire = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  private poles = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  private inputs = -1;
  private network: Network | null = null;
  constructor() { this.group.add(this.wire, this.poles); }
  rebuild(kind: Uint8Array, flags: Uint8Array, raster: Raster, net: Network): void {
    const signature = transportSignature(kind, flags, raster, net);
    if (this.inputs === signature && this.network === net) return;
    this.inputs = signature; this.network = net;
    const path = (a: number, b: number) => trolleyPath(net, raster.accSeg[a], raster.accS[a], raster.accSeg[b], raster.accS[b]);
    const transit = transitNetwork(kind, i => flags[i] === 0 && raster.accSeg[i] >= 0, (a, b) => kind[a] === T_TROLLEY && path(a, b).length > 1);
    const wire = new MeshBuilder(), poles = new Builder(0), half = GRID / 2, drawn = new Set<string>();
    for (const line of transit.lines) {
      if (line.mode !== 'trolley') continue;
      for (const [a, b] of [[line.a, line.b], [line.b, line.a]]) {
        const points = path(a, b);
        for (let i = 1; i < points.length; i++) {
          const p = points[i - 1], q = points[i];
          const key = `${p.x.toFixed(2)},${p.z.toFixed(2)}:${q.x.toFixed(2)},${q.z.toFixed(2)}`;
          if (drawn.has(key)) continue;
          drawn.add(key);
          const flat = [p.x - half, p.z - half, q.x - half, q.z - half];
          for (const offset of [-0.0374, 0.0374]) wire.ribbon(flat, 2, 0.007, 0.818, 0x454d4c, offset);
        }
        // Sparse supports outside the carriageway; contact wires stay above motor lanes.
        for (let i = 0; i < points.length; i += 28) {
          const p = points[i], q = points[Math.min(i + 1, points.length - 1)];
          const dx = q.x - p.x, dz = q.z - p.z, length = Math.hypot(dx, dz);
          if (!length) continue;
          const rx = -dz / length, rz = dx / length;
          const x = p.x - half + rx * p.poleOffset, z = p.z - half + rz * p.poleOffset;
          if (net.onRoad(p.x + rx * p.poleOffset, p.z + rz * p.poleOffset)) continue;
          poles.cyl(0.016, 0.86, x, 0, z, 0x727f7c, 6);
          wire.ribbon([x, z, p.x - half - rx * 0.07, p.z - half - rz * 0.07], 2, 0.012, 0.84, 0x727f7c);
        }
      }
    }
    this.wire.geometry.dispose(); this.wire.geometry = wire.build();
    this.poles.geometry.dispose(); this.poles.geometry = poles.build();
  }
}
