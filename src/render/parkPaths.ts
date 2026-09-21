import * as THREE from 'three';
import { GRID } from '../constants';
import { PARK_PATH_HALF } from '../parkPaths';
import type { ParkPath } from '../parkPaths';
import { sampleCurve } from '../roads/network';
import { MeshBuilder } from './meshBuilder';

/** One static mesh for all custom park paths, rebuilt only on city edits. */
export class ParkPathLayer {
  readonly group = new THREE.Group();
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  constructor() { this.mesh.receiveShadow = true; this.group.add(this.mesh); }
  rebuild(paths: ParkPath[]): void {
    const b = new MeshBuilder();
    for (const path of paths) {
      const sm = sampleCurve(path);
      const points = Float32Array.from(sm.pts, v => v - GRID / 2);
      b.ribbon(points, sm.n + 1, PARK_PATH_HALF, 0.025, 0xd0be98);
      b.disc(path.ax - GRID / 2, path.az - GRID / 2, PARK_PATH_HALF, 0.025, 0xd0be98);
      b.disc(path.bx - GRID / 2, path.bz - GRID / 2, PARK_PATH_HALF, 0.025, 0xd0be98);
    }
    this.mesh.geometry.dispose(); this.mesh.geometry = b.build();
  }
}
