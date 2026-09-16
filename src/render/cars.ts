import * as THREE from 'three';
import { MAX_CARS } from '../constants';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const zero = new THREE.Vector3(0, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const COLORS = [0xe63946, 0xf4f1de, 0x2a9d8f, 0x264653, 0xe9c46a, 0xf4a261, 0x9d4edd, 0xffffff, 0x1d3557, 0x606c38];

export class CarLayer {
  readonly mesh: THREE.InstancedMesh;

  constructor() {
    const geo = new THREE.BoxGeometry(0.26, 0.18, 0.46);
    geo.translate(0, 0.15, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_CARS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
    this.mesh.castShadow = true;
    const c = new THREE.Color();
    for (let i = 0; i < MAX_CARS; i++) {
      this.mesh.setColorAt(i, c.setHex(COLORS[i % COLORS.length]));
      m4.compose(zero, q, zero);
      this.mesh.setMatrixAt(i, m4);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.mesh.frustumCulled = false;
  }

  /** Interpolate between two worker frames (x, z, angle, active per car). */
  update(prev: Float32Array, next: Float32Array, alpha: number): void {
    for (let i = 0; i < MAX_CARS; i++) {
      const o = i * 4;
      const active = next[o + 3] > 0.5;
      if (!active) {
        m4.compose(zero, q, zero);
        this.mesh.setMatrixAt(i, m4);
        continue;
      }
      let x = next[o];
      let z = next[o + 1];
      let a = next[o + 2];
      if (prev[o + 3] > 0.5) {
        const px = prev[o];
        const pz = prev[o + 1];
        // Snap if the car jumped (new trip reusing the slot).
        if (Math.abs(px - x) + Math.abs(pz - z) < 1.5) {
          x = px + (x - px) * alpha;
          z = pz + (z - pz) * alpha;
          const pa = prev[o + 2];
          let da = a - pa;
          if (da > Math.PI) da -= 2 * Math.PI;
          if (da < -Math.PI) da += 2 * Math.PI;
          a = pa + da * alpha;
        }
      }
      pos.set(x, 0, z);
      q.setFromAxisAngle(yAxis, a);
      m4.compose(pos, q, one);
      this.mesh.setMatrixAt(i, m4);
    }
    q.identity();
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
