import * as THREE from 'three';
import { GRID, N_TILES, T_ROAD, neighbor } from '../constants';

const GRAY = new THREE.Color(0x4c4d55);
const RED = new THREE.Color(0xd63b2f);
const tmp = new THREE.Color();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3(1, 1, 1);
const yAxis = new THREE.Vector3(0, 1, 0);

export class RoadLayer {
  readonly group = new THREE.Group();
  private slabs: THREE.InstancedMesh;
  private curbs: THREE.InstancedMesh;
  private dashes: THREE.InstancedMesh;
  private slotTile = new Int32Array(N_TILES);
  private count = 0;

  constructor() {
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    this.slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.06, 1), slabMat, N_TILES);
    this.slabs.position.y = 0.03;
    this.slabs.receiveShadow = true;
    this.slabs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 3), 3);

    const curbMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 1 });
    this.curbs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 1), curbMat, N_TILES);
    this.curbs.position.y = 0.025;
    this.curbs.receiveShadow = true;

    const dashMat = new THREE.MeshStandardMaterial({ color: 0xf1d36a, roughness: 0.8 });
    this.dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.02, 0.36), dashMat, N_TILES);
    this.dashes.position.y = 0.07;

    this.group.add(this.curbs, this.slabs, this.dashes);
    this.slabs.count = 0;
    this.curbs.count = 0;
    this.dashes.count = 0;
  }

  /** Rebuild instances from the tile map. */
  rebuild(kind: Uint8Array): void {
    const half = GRID / 2;
    let n = 0;
    let nd = 0;
    q.identity();
    for (let i = 0; i < N_TILES; i++) {
      if (kind[i] !== T_ROAD) continue;
      const x = i % GRID;
      const z = (i / GRID) | 0;
      pos.set(x - half + 0.5, 0, z - half + 0.5);
      // Slab is slightly narrower across than along the road so curbs show on edges.
      const N = neighbor(i, 0) >= 0 && kind[neighbor(i, 0)] === T_ROAD;
      const E = neighbor(i, 1) >= 0 && kind[neighbor(i, 1)] === T_ROAD;
      const S = neighbor(i, 2) >= 0 && kind[neighbor(i, 2)] === T_ROAD;
      const W = neighbor(i, 3) >= 0 && kind[neighbor(i, 3)] === T_ROAD;
      const ns = N || S;
      const ew = E || W;
      let sx = 1;
      let sz = 1;
      if (ns && !ew) sx = 0.82;
      else if (ew && !ns) sz = 0.82;
      else if (!ns && !ew) { sx = 0.82; sz = 0.82; }
      else { sx = 1; sz = 1; }
      scl.set(sx, 1, sz);
      m4.compose(pos, q, scl);
      this.slabs.setMatrixAt(n, m4);
      this.slabs.setColorAt(n, GRAY);
      scl.set(1, 1, 1);
      m4.compose(pos, q, scl);
      this.curbs.setMatrixAt(n, m4);
      this.slotTile[n] = i;
      n++;
      const straightNS = N && S && !E && !W;
      const straightEW = E && W && !N && !S;
      if (straightNS || straightEW) {
        const rot = new THREE.Quaternion().setFromAxisAngle(yAxis, straightEW ? Math.PI / 2 : 0);
        m4.compose(pos, rot, scl);
        this.dashes.setMatrixAt(nd++, m4);
      }
    }
    this.count = n;
    this.slabs.count = n;
    this.curbs.count = n;
    this.dashes.count = nd;
    this.slabs.instanceMatrix.needsUpdate = true;
    this.curbs.instanceMatrix.needsUpdate = true;
    this.dashes.instanceMatrix.needsUpdate = true;
    if (this.slabs.instanceColor) this.slabs.instanceColor.needsUpdate = true;
  }

  /** Tint road slabs by congestion (0..255 per tile). */
  tint(congestion: Uint8Array): void {
    for (let s = 0; s < this.count; s++) {
      const c = congestion[this.slotTile[s]] / 255;
      tmp.copy(GRAY).lerp(RED, Math.min(1, c * 1.4));
      this.slabs.setColorAt(s, tmp);
    }
    if (this.slabs.instanceColor) this.slabs.instanceColor.needsUpdate = true;
  }
}
