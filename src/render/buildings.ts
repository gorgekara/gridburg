import { isDecoration, T_PATH, T_TREE, neighbor } from '../constants';
import type { VisualDetail } from './detail';
import { T_OFFICE, T_FARM, T_LEISURE, T_FLOOD_BARRIER } from '../constants';
import { lotScale } from '../placement';
import * as THREE from 'three';
import { GRID, N_TILES, T_RES, T_COM, T_IND, T_WIND, T_DOCKS, T_HYDRO, SERVICES, isService, isZone, tileHash } from '../constants';
import type { Raster } from '../roads/raster';
import { buildingGeometry, rotorGeometry, VARIANTS } from './buildingGeo';
import { bodyOfGeometry } from './streetDetail';
import type { Body } from './streetDetail';

const m4 = new THREE.Matrix4();
const pivot = new THREE.Matrix4();
const q = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const pos = new THREE.Vector3();
const one = new THREE.Vector3(1, 1, 1);
const lotSize = new THREE.Vector3(1, 1, 1);
const col = new THREE.Color();
const yAxis = new THREE.Vector3(0, 1, 0);
const zAxis = new THREE.Vector3(0, 0, 1);

const ZONE_COLOR: Record<number, number> = {
  [T_RES]: 0x62c46a,
  [T_COM]: 0x4f8fe8,
  [T_IND]: 0xe6b93a,
  [T_OFFICE]: 0xb791e0,
  [T_FARM]: 0xc9a55a,
  [T_LEISURE]: 0xe07fb0,
};
const SERVICE_KINDS = Object.keys(SERVICES).map(Number);

function key(kind: number, level: number, variant: number): number {
  return (kind * 4 + level) * 16 + variant;
}

export class BuildingLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.InstancedMesh>();
  private bodies = new Map<number, Body | null>();
  private zones: THREE.InstancedMesh;
  private rotors: THREE.InstancedMesh;
  private rotorSites: { x: number; z: number; rot: number; phase: number }[] = [];

  private detail: VisualDetail = 1;

  private night = { value: 0 };

  setNight(value: number): void { this.night.value = value; }

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    mat.onBeforeCompile = shader => {
      shader.uniforms.cityNight = this.night;
      shader.fragmentShader = 'uniform float cityNight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Only the warm window glass emits; walls and roofs retain their lighting.
        float windowMask = step(0.95, vColor.r) * step(0.68, vColor.g) * (1.0 - step(0.5, vColor.b));
        totalEmissiveRadiance += vec3(1.0, 0.65, 0.24) * windowMask * cityNight * 1.8;
        // Office floors: the cool white panes on commercial and office facades.
        float officeMask = step(0.88, vColor.r) * step(0.88, vColor.g) * step(0.95, vColor.b);
        totalEmissiveRadiance += vec3(0.82, 0.88, 1.0) * officeMask * cityNight * 1.5;`);
    };
    const add = (k: number, l: number, v: number, cap: number): void => {
      const mesh = new THREE.InstancedMesh(buildingGeometry(k, l, v), mat, cap);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      mesh.userData.tileIds = [];
      mesh.frustumCulled = false;
      this.meshes.set(key(k, l, v), mesh);
      this.group.add(mesh);
    };
    for (const k of [T_RES, T_COM, T_IND, T_OFFICE, T_FARM, T_LEISURE]) {
      for (let l = 1; l <= 3; l++) for (let v = 0; v < VARIANTS; v++) add(k, l, v, N_TILES);
    }
    for (const k of SERVICE_KINDS) for (let v = 0; v < (k === T_PATH || k === T_TREE ? 16 : 1); v++) add(k, 1, v, isDecoration(k) ? N_TILES : 512);

    this.rotors = new THREE.InstancedMesh(rotorGeometry(), new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.6 }), 512);
    this.rotors.castShadow = true;
    this.rotors.count = 0;
    this.rotors.frustumCulled = false;
    this.group.add(this.rotors);

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
    this.zones.visible = false;
    this.zones.frustumCulled = false;
    this.group.add(this.zones);
  }

  /** The walls of a zone building's model, for the street detail to hang things on. */
  body(kind: number, level: number, variant: number): Body | null {
    const k = key(kind, level, variant);
    if (!this.bodies.has(k)) {
      const mesh = this.meshes.get(k);
      this.bodies.set(k, mesh ? bodyOfGeometry(mesh.geometry) : null);
    }
    return this.bodies.get(k) ?? null;
  }

  setDetail(detail: VisualDetail): void {
    if (this.detail === detail) return;
    this.detail = detail;
    this.bodies.clear();
    for (const [id, mesh] of this.meshes) {
      const variant = id % 16, group = Math.floor(id / 16);
      const level = group % 4, kind = Math.floor(group / 4);
      const previous = mesh.geometry;
      mesh.geometry = buildingGeometry(kind, level, variant, detail);
      mesh.boundingSphere = null;
      previous.dispose();
    }
  }

  showZones(show: boolean): void { this.zones.visible = show; }

  rebuild(kind: Uint8Array, level: Uint8Array, raster: Raster, rot?: Uint8Array, water?: Uint8Array, parkPathMask?: Uint8Array): void {
    const half = GRID / 2;
    const counts = new Map<number, number>();
    this.rotorSites = [];
    let nz = 0;
    for (let i = 0; i < N_TILES; i++) {
      const k = kind[i];
      if (k === T_PATH && parkPathMask?.[i]) continue;
      const zone = isZone(k);
      if (!zone && !isService(k)) continue;
      const multi = SERVICES[k]?.footprint;
      const turn = isService(k) ? (rot?.[i] ?? 0) & 3 : 0;
      const tx = multi || isDecoration(k) ? i % GRID + 0.5 : raster.lotX[i];
      const tz = multi || isDecoration(k) ? Math.floor(i / GRID) + 0.5 : raster.lotZ[i];
      pos.set(tx - half, 0, tz - half);
      if (zone) {
        q.identity();
        m4.compose(pos, q, one);
        this.zones.setMatrixAt(nz, m4);
        this.zones.setColorAt(nz, col.setHex(ZONE_COLOR[k]));
        nz++;
        if (level[i] === 0) continue;
      }
      const l = zone ? level[i] : 1;
      let variant = zone ? Math.floor(tileHash(i) * VARIANTS) % VARIANTS : 0;
      if (k === T_PATH) for (let d = 0; d < 4; d++) {
        const n = neighbor(i, d);
        if (n >= 0 && (isDecoration(kind[n]) || raster.cover[n])) variant |= 1 << d;
      }
      // A grove keeps its trees back from a building or a road beside it.
      if (k === T_TREE) for (let d = 0; d < 4; d++) {
        const n = neighbor(i, d);
        if (n >= 0 && (raster.cover[n] || (isZone(kind[n]) && level[n] > 0) || (isService(kind[n]) && !isDecoration(kind[n])))) variant |= 1 << d;
      }
      const kk = key(k, l, variant);
      const mesh = this.meshes.get(kk);
      if (!mesh) continue;
      const n = counts.get(kk) ?? 0;
      if (n >= mesh.instanceMatrix.count) continue;
      counts.set(kk, n + 1);
      // A placed building faces the quarter turn it was given; a grown one faces its road.
      let facing = k === T_PATH ? 0 : turn * Math.PI / 2;
      if (!turn && !multi && !isDecoration(k) && raster.accSeg[i] >= 0) facing = raster.face[i];
      // A dock's jetty and a dam's spillway (their -z side) point at the river, whichever side it is.
      if ((k === T_DOCKS || k === T_HYDRO || k === T_FLOOD_BARRIER) && water) {
        const x = i % GRID, z = Math.floor(i / GRID);
        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = x + dx, nz = z + dz;
          if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && water[nz * GRID + nx]) { facing = Math.atan2(-dx, -dz); break; }
        }
      }
      q.setFromAxisAngle(yAxis, facing);
      if (multi) {
        // Turn the block about the middle of its site, so a rotated footprint still covers its tiles.
        const [w, d] = multi;
        const [rw, rd] = turn % 2 ? [d, w] : [w, d];
        pos.set(tx - half + (rw - 1) / 2, 0, tz - half + (rd - 1) / 2);
        m4.compose(pos, q, one);
        m4.multiply(pivot.makeTranslation(-(w - 1) / 2, 0, -(d - 1) / 2));
      } else {
        // Turned to an angled road, a building shrinks across the ground to stay inside its cell.
        const k = lotScale(facing);
        m4.compose(pos, q, k === 1 ? one : lotSize.set(k, 1, k));
      }
      mesh.setMatrixAt(n, m4);
      mesh.userData.tileIds[n] = i;
      if (k === T_WIND) this.rotorSites.push({ x: pos.x, z: pos.z, rot: facing, phase: tileHash(i) * 6.28 });
    }
    for (const [kk, mesh] of this.meshes) {
      mesh.count = counts.get(kk) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.boundingSphere = null; // Recompute lazily for picking after buildings move or grow.
    }
    this.zones.count = nz;
    this.zones.instanceMatrix.needsUpdate = true;
    if (this.zones.instanceColor) this.zones.instanceColor.needsUpdate = true;
    this.rotors.count = Math.min(512, this.rotorSites.length);
  }

  /** Spin the turbine rotors. */
  update(time: number): void {
    const n = this.rotors.count;
    for (let i = 0; i < n; i++) {
      const s = this.rotorSites[i];
      q.setFromAxisAngle(yAxis, s.rot);
      q2.setFromAxisAngle(zAxis, time * 1.8 + s.phase);
      q.multiply(q2);
      pos.set(s.x + Math.sin(s.rot) * 0.16, 1.77, s.z + Math.cos(s.rot) * 0.16);
      m4.compose(pos, q, one);
      this.rotors.setMatrixAt(i, m4);
    }
    if (n) this.rotors.instanceMatrix.needsUpdate = true;
  }
}
