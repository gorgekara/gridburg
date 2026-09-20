import type { Raster } from '../roads/raster';
import { buildingHeight, VARIANTS } from './buildingGeo';
import * as THREE from 'three';
import {
  GRID, N_TILES, SERVICES, F_NO_POWER, F_NO_WATER, F_NO_SEWAGE, F_NO_ROAD, F_DECLINING, isService, isZone, tileHash,
} from '../constants';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3(1, 1, 1);
const col = new THREE.Color();

const C_ROAD = 0xff4d4d;
const C_POWER = 0xffd23f;
const C_WATER = 0x4fb3ff;
const C_SEWAGE = 0x9a6b3a;
// Rough roof heights so markers float just above buildings.


/** Ground pollution as a smooth texture over the map, plus floating markers on buildings with a problem. */
export class OverlayLayer {
  readonly group = new THREE.Group();
  strong = false;
  private tex: THREE.DataTexture;
  private data: Uint8Array;
  private markers: THREE.InstancedMesh;
  private coverTex: THREE.DataTexture;
  private coverData: Uint8Array;
  private coverPlane: THREE.Mesh;

  constructor() {
    this.data = new Uint8Array(GRID * GRID * 4);
    this.tex = new THREE.DataTexture(this.data, GRID, GRID, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID, GRID),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.017;
    plane.renderOrder = 1;
    this.group.add(plane);

    // Service coverage sits just above the pollution wash, hard edged so the reach of each building reads.
    this.coverData = new Uint8Array(GRID * GRID * 4);
    this.coverTex = new THREE.DataTexture(this.coverData, GRID, GRID, THREE.RGBAFormat);
    this.coverTex.magFilter = THREE.LinearFilter;
    this.coverTex.minFilter = THREE.LinearFilter;
    this.coverTex.needsUpdate = true;
    this.coverPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID, GRID),
      new THREE.MeshBasicMaterial({ map: this.coverTex, transparent: true, depthWrite: false }),
    );
    this.coverPlane.rotation.x = -Math.PI / 2;
    // Above the road surface and its markings, so the wash reads across a built-up neighborhood.
    this.coverPlane.position.y = 0.09;
    this.coverPlane.renderOrder = 3;
    this.coverPlane.visible = false;
    this.group.add(this.coverPlane);

    this.markers = new THREE.InstancedMesh(
      new THREE.OctahedronGeometry(0.17),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      N_TILES,
    );
    this.markers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 3), 3);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.group.add(this.markers);
  }

  setPollution(p: Uint8Array): void {
    const gain = this.strong ? 2.2 : 1.0;
    for (let z = 0; z < GRID; z++) {
      const row = GRID - 1 - z; // texture rows run bottom-up, tiles top-down
      for (let x = 0; x < GRID; x++) {
        const v = p[z * GRID + x];
        const o = (row * GRID + x) * 4;
        this.data[o] = this.strong ? 150 : 96;
        this.data[o + 1] = this.strong ? 60 : 70;
        this.data[o + 2] = this.strong ? 30 : 38;
        this.data[o + 3] = Math.min(this.strong ? 235 : 170, v * gain);
      }
    }
    this.tex.needsUpdate = true;
  }

  /** Paint how well the service being placed already covers the map, or clear it with null. */
  setCoverage(cover: Uint8Array | null): void {
    this.coverPlane.visible = !!cover;
    if (!cover) return;
    for (let z = 0; z < GRID; z++) {
      const row = GRID - 1 - z; // texture rows run bottom-up, tiles top-down
      for (let x = 0; x < GRID; x++) {
        const n = cover[z * GRID + x];
        const o = (row * GRID + x) * 4;
        this.coverData[o] = n > 1 ? 90 : 40;
        this.coverData[o + 1] = 235;
        this.coverData[o + 2] = n > 1 ? 120 : 190;
        this.coverData[o + 3] = n ? Math.min(180, 95 + n * 30) : 0;
      }
    }
    this.coverTex.needsUpdate = true;
  }

  setFlags(kind: Uint8Array, level: Uint8Array, flags: Uint8Array, raster: Raster): void {
    const half = GRID / 2;
    let n = 0;
    q.identity();
    for (let i = 0; i < N_TILES; i++) {
      const f = flags[i];
      if (!f) continue;
      const k = kind[i];
      const zone = isZone(k);
      if (zone && level[i] === 0) continue;
      if (!zone && !isService(k)) continue;
      const c = f & F_NO_ROAD ? C_ROAD : f & F_NO_POWER ? C_POWER : f & F_NO_WATER ? C_WATER : f & F_NO_SEWAGE ? C_SEWAGE : f & F_DECLINING ? 0xffa43b : 0;
      if (!c) continue;
      const h = buildingHeight(k, zone ? level[i] : 1, zone ? Math.floor(tileHash(i) * VARIANTS) % VARIANTS : 0);
      const footprint = SERVICES[k]?.footprint;
      pos.set(footprint ? i % GRID + footprint[0] / 2 - half : raster.lotX[i] - half, h + 0.35, footprint ? Math.floor(i / GRID) + footprint[1] / 2 - half : raster.lotZ[i] - half);
      m4.compose(pos, q, scl);
      this.markers.setMatrixAt(n, m4);
      this.markers.setColorAt(n, col.setHex(c));
      n++;
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }

  update(time: number): void {
    this.markers.position.y = Math.sin(time * 2.4) * 0.06;
  }
}
