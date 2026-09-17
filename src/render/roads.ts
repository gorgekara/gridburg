import * as THREE from 'three';
import { GRID, N_TILES, T_AVENUE, DIRS8, SQRT2, connected, isRoad } from '../constants';

const GRAY = new THREE.Color(0x4c4d55);
const RED = new THREE.Color(0xd63b2f);
const DASH = new THREE.Color(0xf1d36a);
const LINE = new THREE.Color(0xe8b93c);
const tmp = new THREE.Color();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);

const ROAD_W = 0.82;
const AVE_W = 1.0;
const CURB_EXTRA = 0.18;

/**
 * Roads are drawn as "spokes" from each tile center toward every connected neighbor,
 * plus a disc at the center. The union gives straight slabs, rounded corners and
 * end caps, clean junctions, and 45° diagonals from the same three instanced meshes.
 */
export class RoadLayer {
  readonly group = new THREE.Group();
  private spokes: THREE.InstancedMesh;
  private discs: THREE.InstancedMesh;
  private curbSpokes: THREE.InstancedMesh;
  private curbDiscs: THREE.InstancedMesh;
  private lines: THREE.InstancedMesh;
  private spokeTile = new Int32Array(N_TILES * 8);
  private discTile = new Int32Array(N_TILES);
  private nSpokes = 0;
  private nDiscs = 0;

  constructor() {
    const slabMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
    const curbMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ad, roughness: 1 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });

    // Unit spoke: 1 wide (scaled per instance), 1 long from z=0 to z=1.
    const spokeGeo = new THREE.BoxGeometry(1, 0.06, 1);
    spokeGeo.translate(0, 0, 0.5);
    const discGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.06, 20);
    const curbSpokeGeo = new THREE.BoxGeometry(1, 0.05, 1);
    curbSpokeGeo.translate(0, 0, 0.5);
    const curbDiscGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20);
    const lineGeo = new THREE.BoxGeometry(0.05, 0.02, 1);
    lineGeo.translate(0, 0, 0.5);

    this.spokes = new THREE.InstancedMesh(spokeGeo, slabMat, N_TILES * 8);
    this.discs = new THREE.InstancedMesh(discGeo, slabMat, N_TILES);
    this.curbSpokes = new THREE.InstancedMesh(curbSpokeGeo, curbMat, N_TILES * 8);
    this.curbDiscs = new THREE.InstancedMesh(curbDiscGeo, curbMat, N_TILES);
    this.lines = new THREE.InstancedMesh(lineGeo, lineMat, N_TILES * 16);
    this.spokes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 8 * 3), 3);
    this.discs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 3), 3);
    this.lines.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 16 * 3), 3);

    this.spokes.position.y = 0.03;
    this.discs.position.y = 0.03;
    this.curbSpokes.position.y = 0.025;
    this.curbDiscs.position.y = 0.025;
    this.lines.position.y = 0.07;
    for (const m of [this.spokes, this.discs, this.curbSpokes, this.curbDiscs, this.lines]) {
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }

  /** Rebuild instances from the tile map and diagonal links. */
  rebuild(kind: Uint8Array, link: Uint8Array): void {
    const half = GRID / 2;
    let ns = 0;
    let nd = 0;
    let nl = 0;
    for (let i = 0; i < N_TILES; i++) {
      if (!isRoad(kind[i])) continue;
      const avenue = kind[i] === T_AVENUE;
      const w = avenue ? AVE_W : ROAD_W;
      const cx = (i % GRID) - half + 0.5;
      const cz = ((i / GRID) | 0) - half + 0.5;

      // Center disc
      pos.set(cx, 0, cz);
      q.identity();
      scl.set(w, 1, w);
      m4.compose(pos, q, scl);
      this.discs.setMatrixAt(nd, m4);
      this.discs.setColorAt(nd, GRAY);
      scl.set(w + CURB_EXTRA, 1, w + CURB_EXTRA);
      m4.compose(pos, q, scl);
      this.curbDiscs.setMatrixAt(nd, m4);
      this.discTile[nd] = i;
      nd++;

      let degree = 0;
      for (let d = 0; d < 8; d++) if (connected(kind, link, i, d)) degree++;

      for (let d = 0; d < 8; d++) {
        if (!connected(kind, link, i, d)) continue;
        const [dx, dz] = DIRS8[d];
        const len = (d & 1 ? SQRT2 : 1) / 2;
        const angle = Math.atan2(dx, dz);
        q.setFromAxisAngle(yAxis, angle);
        pos.set(cx, 0, cz);
        scl.set(w, 1, len);
        m4.compose(pos, q, scl);
        this.spokes.setMatrixAt(ns, m4);
        this.spokes.setColorAt(ns, GRAY);
        scl.set(w + CURB_EXTRA, 1, len);
        m4.compose(pos, q, scl);
        this.curbSpokes.setMatrixAt(ns, m4);
        this.spokeTile[ns] = i;
        ns++;

        // Lane markings: dashes on plain roads, a solid double line on avenues. None at junctions.
        if (degree <= 2) {
          if (avenue) {
            for (const side of [-0.05, 0.05]) {
              const ox = Math.cos(angle) * side;
              const oz = -Math.sin(angle) * side;
              pos.set(cx + ox, 0, cz + oz);
              scl.set(0.8, 1, len);
              m4.compose(pos, q, scl);
              this.lines.setMatrixAt(nl, m4);
              this.lines.setColorAt(nl, LINE);
              nl++;
            }
          } else {
            const nx = dx / (d & 1 ? SQRT2 : 1);
            const nz = dz / (d & 1 ? SQRT2 : 1);
            pos.set(cx + nx * 0.18, 0, cz + nz * 0.18);
            scl.set(1, 1, 0.26);
            m4.compose(pos, q, scl);
            this.lines.setMatrixAt(nl, m4);
            this.lines.setColorAt(nl, DASH);
            nl++;
          }
        }
      }
    }
    this.nSpokes = ns;
    this.nDiscs = nd;
    this.spokes.count = ns;
    this.curbSpokes.count = ns;
    this.discs.count = nd;
    this.curbDiscs.count = nd;
    this.lines.count = nl;
    for (const m of [this.spokes, this.discs, this.curbSpokes, this.curbDiscs, this.lines]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Tint road surfaces by congestion (0..255 per tile). */
  tint(congestion: Uint8Array): void {
    for (let s = 0; s < this.nSpokes; s++) {
      const c = congestion[this.spokeTile[s]] / 255;
      tmp.copy(GRAY).lerp(RED, Math.min(1, c * 1.4));
      this.spokes.setColorAt(s, tmp);
    }
    for (let s = 0; s < this.nDiscs; s++) {
      const c = congestion[this.discTile[s]] / 255;
      tmp.copy(GRAY).lerp(RED, Math.min(1, c * 1.4));
      this.discs.setColorAt(s, tmp);
    }
    if (this.spokes.instanceColor) this.spokes.instanceColor.needsUpdate = true;
    if (this.discs.instanceColor) this.discs.instanceColor.needsUpdate = true;
  }
}
