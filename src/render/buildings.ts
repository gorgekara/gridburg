import * as THREE from 'three';
import { GRID, N_TILES, T_RES, T_COM, T_IND } from '../constants';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const col = new THREE.Color();

// [width, height, depth] per level (index 0 unused)
const DIMS: Record<number, number[][]> = {
  [T_RES]: [[0, 0, 0], [0.55, 0.5, 0.55], [0.7, 1.3, 0.7], [0.74, 3.0, 0.74]],
  [T_COM]: [[0, 0, 0], [0.7, 0.7, 0.7], [0.8, 2.0, 0.8], [0.82, 4.6, 0.82]],
  [T_IND]: [[0, 0, 0], [0.82, 0.5, 0.82], [0.86, 0.9, 0.86], [0.9, 1.5, 0.9]],
};
const PALETTE: Record<number, number[]> = {
  [T_RES]: [0xf6e3c5, 0xe9c9a2, 0xd8a879, 0xf2d6cf],
  [T_COM]: [0x8fc1e3, 0x5f93cf, 0x3e6fae, 0xa7d3ea],
  [T_IND]: [0xc2bb9f, 0xa89f82, 0x8f8568, 0xb0aa93],
};
const ZONE_COLOR: Record<number, number> = {
  [T_RES]: 0x62c46a,
  [T_COM]: 0x4f8fe8,
  [T_IND]: 0xe6b93a,
};

function hash(i: number): number {
  let h = (i * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export class BuildingLayer {
  readonly group = new THREE.Group();
  private meshes: Record<number, THREE.InstancedMesh> = {};
  private roofs: THREE.InstancedMesh;
  private zones: THREE.InstancedMesh;

  constructor() {
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    for (const k of [T_RES, T_COM, T_IND]) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      const mesh = new THREE.InstancedMesh(box, mat, N_TILES);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 3), 3);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.meshes[k] = mesh;
      this.group.add(mesh);
    }
    // Pyramid roofs for small houses.
    const roofGeo = new THREE.ConeGeometry(0.5, 0.35, 4, 1);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 0.175, 0);
    this.roofs = new THREE.InstancedMesh(
      roofGeo,
      new THREE.MeshStandardMaterial({ color: 0xb8473a, roughness: 0.9 }),
      N_TILES,
    );
    this.roofs.castShadow = true;
    this.roofs.count = 0;
    this.group.add(this.roofs);

    const zoneGeo = new THREE.PlaneGeometry(0.92, 0.92);
    zoneGeo.rotateX(-Math.PI / 2);
    this.zones = new THREE.InstancedMesh(
      zoneGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.42, depthWrite: false }),
      N_TILES,
    );
    this.zones.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 3), 3);
    this.zones.position.y = 0.02;
    this.zones.count = 0;
    this.group.add(this.zones);
  }

  rebuild(kind: Uint8Array, level: Uint8Array): void {
    const half = GRID / 2;
    const counts: Record<number, number> = { [T_RES]: 0, [T_COM]: 0, [T_IND]: 0 };
    let nz = 0;
    let nr = 0;
    q.identity();
    for (let i = 0; i < N_TILES; i++) {
      const k = kind[i];
      if (k < T_RES) continue;
      const x = i % GRID - half + 0.5;
      const z = ((i / GRID) | 0) - half + 0.5;
      pos.set(x, 0, z);
      scl.set(1, 1, 1);
      m4.compose(pos, q, scl);
      this.zones.setMatrixAt(nz, m4);
      this.zones.setColorAt(nz, col.setHex(ZONE_COLOR[k]));
      nz++;
      const l = level[i];
      if (l === 0) continue;
      const h = hash(i);
      const d = DIMS[k][l];
      const jitter = 0.85 + h * 0.3;
      scl.set(d[0], d[1] * jitter, d[2]);
      const mesh = this.meshes[k];
      const n = counts[k]++;
      m4.compose(pos, q, scl);
      mesh.setMatrixAt(n, m4);
      const pal = PALETTE[k];
      col.setHex(pal[Math.floor(h * pal.length) % pal.length]);
      mesh.setColorAt(n, col);
      if (k === T_RES && l === 1) {
        pos.y = d[1] * jitter;
        scl.set(d[0] * 1.5, 1, d[2] * 1.5);
        m4.compose(pos, q, scl);
        this.roofs.setMatrixAt(nr++, m4);
      }
    }
    for (const k of [T_RES, T_COM, T_IND]) {
      const mesh = this.meshes[k];
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.roofs.count = nr;
    this.roofs.instanceMatrix.needsUpdate = true;
    this.zones.count = nz;
    this.zones.instanceMatrix.needsUpdate = true;
    if (this.zones.instanceColor) this.zones.instanceColor.needsUpdate = true;
  }
}
