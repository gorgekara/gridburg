import * as THREE from 'three';
import { GRID, N_TILES, T_RES, T_COM, T_IND, DIRS8, idx, inBounds, isRoad, isZone, neighbor } from '../constants';
import { buildingGeometry, VARIANTS } from './buildingGeo';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const scl = new THREE.Vector3(1, 1, 1);
const col = new THREE.Color();
const yAxis = new THREE.Vector3(0, 1, 0);

const ZONE_COLOR: Record<number, number> = {
  [T_RES]: 0x62c46a,
  [T_COM]: 0x4f8fe8,
  [T_IND]: 0xe6b93a,
};

// Rotation so the building's front (+z) faces the road in 4-direction d (0=N, 1=E, 2=S, 3=W).
const FACE_ROT = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];

function hash(i: number): number {
  let h = (i * 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const CORNERS: ReadonlyArray<readonly [number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * If a diagonal road link cuts across one of this tile's corners, return that corner as (sx, sz).
 * The two orthogonal neighbors sharing the corner are roads linked diagonally to each other.
 */
function clippedCorner(kind: Uint8Array, link: Uint8Array, i: number): readonly [number, number] | null {
  const x = i % GRID;
  const z = (i / GRID) | 0;
  for (const c of CORNERS) {
    const [sx, sz] = c;
    if (!inBounds(x + sx, z) || !inBounds(x, z + sz)) continue;
    const p = idx(x + sx, z);
    const qq = idx(x, z + sz);
    if (!isRoad(kind[p]) || !isRoad(kind[qq])) continue;
    for (let d = 1; d < 8; d += 2) {
      if (DIRS8[d][0] === -sx && DIRS8[d][1] === sz && (link[p] >> d) & 1) return c;
    }
  }
  return null;
}

function key(kind: number, level: number, variant: number): number {
  return kind * 16 + level * 4 + variant;
}

export class BuildingLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.InstancedMesh>();
  private zones: THREE.InstancedMesh;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    for (const k of [T_RES, T_COM, T_IND]) {
      for (let l = 1; l <= 3; l++) {
        for (let v = 0; v < VARIANTS; v++) {
          const mesh = new THREE.InstancedMesh(buildingGeometry(k, l, v), mat, N_TILES);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.count = 0;
          mesh.frustumCulled = false;
          this.meshes.set(key(k, l, v), mesh);
          this.group.add(mesh);
        }
      }
    }

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
    this.zones.frustumCulled = false;
    this.group.add(this.zones);
  }

  rebuild(kind: Uint8Array, link: Uint8Array, level: Uint8Array): void {
    const half = GRID / 2;
    const counts = new Map<number, number>();
    let nz = 0;
    q.identity();
    for (let i = 0; i < N_TILES; i++) {
      const k = kind[i];
      if (!isZone(k)) continue;
      const x = (i % GRID) - half + 0.5;
      const z = ((i / GRID) | 0) - half + 0.5;
      pos.set(x, 0, z);
      q.identity();
      m4.compose(pos, q, one);
      this.zones.setMatrixAt(nz, m4);
      this.zones.setColorAt(nz, col.setHex(ZONE_COLOR[k]));
      nz++;
      const l = level[i];
      if (l === 0) continue;
      const h = hash(i);
      const variant = Math.floor(h * VARIANTS) % VARIANTS;
      const mesh = this.meshes.get(key(k, l, variant))!;
      const kk = key(k, l, variant);
      const n = counts.get(kk) ?? 0;
      counts.set(kk, n + 1);
      const corner = clippedCorner(kind, link, i);
      if (corner) {
        // A diagonal road crosses this tile's corner: turn 45° to face it, shrink, and step back.
        q.setFromAxisAngle(yAxis, Math.atan2(corner[0], corner[1]));
        pos.set(x - corner[0] * 0.13, 0, z - corner[1] * 0.13);
        scl.set(0.72, 0.9, 0.72);
        m4.compose(pos, q, scl);
      } else {
        // Face the first adjacent road, checking south first so grids look tidy.
        let rot = 0;
        for (const d of [2, 1, 0, 3]) {
          const nb = neighbor(i, d);
          if (nb >= 0 && isRoad(kind[nb])) { rot = FACE_ROT[d]; break; }
        }
        q.setFromAxisAngle(yAxis, rot);
        m4.compose(pos, q, one);
      }
      mesh.setMatrixAt(n, m4);
    }
    for (const [kk, mesh] of this.meshes) {
      mesh.count = counts.get(kk) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.zones.count = nz;
    this.zones.instanceMatrix.needsUpdate = true;
    if (this.zones.instanceColor) this.zones.instanceColor.needsUpdate = true;
  }
}
