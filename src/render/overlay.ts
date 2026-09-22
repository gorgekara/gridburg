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
  private viewTex: THREE.DataTexture;
  private viewData: Uint8Array;
  private viewPlane: THREE.Mesh;

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

    // Map views (land value, noise, crime...) sit with the coverage wash, above the streets.
    this.viewData = new Uint8Array(GRID * GRID * 4);
    this.viewTex = new THREE.DataTexture(this.viewData, GRID, GRID, THREE.RGBAFormat);
    this.viewTex.magFilter = THREE.LinearFilter;
    this.viewTex.minFilter = THREE.LinearFilter;
    this.viewPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID, GRID),
      new THREE.MeshBasicMaterial({ map: this.viewTex, transparent: true, depthWrite: false }),
    );
    this.viewPlane.rotation.x = -Math.PI / 2;
    this.viewPlane.position.y = 0.095;
    this.viewPlane.renderOrder = 3;
    this.viewPlane.visible = false;
    this.group.add(this.viewPlane);

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

  /**
   * Paint how well the service being placed already covers the map, or clear it with null. The
   * per-tile circles are blurred first: a hard staircase along the edge of a radius reads as an
   * artefact, and the wash is kept light so the city stays the thing you are looking at.
   */
  setCoverage(cover: Uint8Array | null): void {
    this.coverPlane.visible = !!cover;
    if (!cover) return;
    let field = Float32Array.from(cover);
    const blurred = new Float32Array(GRID * GRID);
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const sx = x + dx, sz = z + dz;
          if (sx < 0 || sz < 0 || sx >= GRID || sz >= GRID) continue;
          const weight = dx && dz ? 1 : 2;
          sum += field[sz * GRID + sx] * weight; n += weight;
        }
        blurred[z * GRID + x] = sum / n;
      }
      field = Float32Array.from(blurred);
    }
    for (let z = 0; z < GRID; z++) {
      const row = GRID - 1 - z; // texture rows run bottom-up, tiles top-down
      for (let x = 0; x < GRID; x++) {
        const v = field[z * GRID + x];
        const o = (row * GRID + x) * 4;
        const deep = Math.min(1, Math.max(0, v - 1));
        this.coverData[o] = 40 + deep * 30;
        this.coverData[o + 1] = 230;
        this.coverData[o + 2] = 180 - deep * 50;
        this.coverData[o + 3] = Math.min(72, v * 52);
      }
    }
    this.coverTex.needsUpdate = true;
  }

  /**
   * Paint a map view over the city, or hide it with null. `color` turns a cell's 0..255 value into
   * RGBA; cells it returns null for stay clear.
   */
  setView(values: ArrayLike<number> | null, color?: (v: number, i: number) => [number, number, number, number] | null): void {
    this.viewPlane.visible = !!values;
    if (!values || !color) return;
    for (let z = 0; z < GRID; z++) {
      const row = GRID - 1 - z;
      for (let x = 0; x < GRID; x++) {
        const i = z * GRID + x, o = (row * GRID + x) * 4;
        const c = color(values[i], i);
        if (!c) { this.viewData[o + 3] = 0; continue; }
        this.viewData[o] = c[0]; this.viewData[o + 1] = c[1]; this.viewData[o + 2] = c[2]; this.viewData[o + 3] = c[3];
      }
    }
    this.viewTex.needsUpdate = true;
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
