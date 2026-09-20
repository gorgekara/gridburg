import * as THREE from 'three';
import { GRID, mulberry32 } from '../constants';
import type { Terrain } from '../terrain';
import type { Raster } from '../roads/raster';
import { siteOwners } from '../sites';
import type { Network } from '../roads/network';
import { signedWaterField } from './water';
import { entrySite } from '../roads/entries';

/** Trees keep full detail within this radius, a single cone beyond it, and vanish past the cull. */
const TREE_NEAR = 70, TREE_CULL = 250, TREE_LIMIT = 15000;

export interface RiverSample { x: number; z: number; w: number; y: number }
/** Scenic upstream cascades stay outside the construction grid. */
export function riverSamples(t: Terrain): RiverSample[] {
  const r = t.river, a = r[0], b = r[1], c = r[r.length - 1], d = r[r.length - 2];
  const al = Math.hypot(a.x - b.x, a.z - b.z), cl = Math.hypot(c.x - d.x, c.z - d.z);
  const points: RiverSample[] = [];
  // Only a valley river tumbles in from upstream; a strait or a shipping lane runs flat to the horizon.
  const cascades = t.type === 'river' || t.type === 'lakes';
  for (let n = 110; n >= 1; n--) points.push({ x: a.x + (a.x - b.x) / al * n - 40, z: a.z + (a.z - b.z) / al * n - 40, w: a.w, y: cascades ? Math.max(0, Math.min(4, (n - 10) * 2)) : 0 });
  for (const p of r) points.push({ ...p, x: p.x - 40, z: p.z - 40, y: 0 });
  for (let n = 1; n <= 110; n++) points.push({ x: c.x + (c.x - d.x) / cl * n - 40, z: c.z + (c.z - d.z) / cl * n - 40, w: c.w, y: 0 });
  return points;
}

/**
 * Nearest-sample lookups dominate terrain building. The samples run along the river in
 * order and roughly a unit apart, so a coarse scan followed by a local refinement finds
 * the nearest one in a fraction of the comparisons a full scan needs.
 */
const STRIDE = 12;
export function riverDistance(x: number, z: number, river: RiverSample[]): { distance: number; bed: number } {
  const n = river.length;
  if (!n) return { distance: Infinity, bed: 0 };
  let best = 0, bestSq = Infinity;
  for (let i = 0; i < n; i += STRIDE) {
    const p = river[i], dx = x - p.x, dz = z - p.z, d = dx * dx + dz * dz;
    if (d < bestSq) { bestSq = d; best = i; }
  }
  const from = Math.max(0, best - STRIDE), to = Math.min(n - 1, best + STRIDE);
  for (let i = from; i <= to; i++) {
    const p = river[i], dx = x - p.x, dz = z - p.z, d = dx * dx + dz * dz;
    if (d < bestSq) { bestSq = d; best = i; }
  }
  const p = river[best];
  return { distance: Math.sqrt(bestSq) - p.w, bed: p.y };
}

export function landscapeHeight(x: number, z: number, seed: number, river: RiverSample[]): number {
  const edge = Math.max(Math.abs(x), Math.abs(z)) - GRID / 2;
  if (edge <= 0) return 0;
  const { distance, bed } = riverDistance(x, z, river);
  const fade = Math.min(1, edge / 14); // smooth valley shoulders
  const phase = (seed % 997) / 97;
  const hills = 7 + 6 * Math.sin(x * 0.057 + phase) * Math.cos(z * 0.071 - phase) + 3 * Math.sin(x * 0.13 + z * 0.09);
  const bank = Math.max(0, Math.min(1, (distance - 0.9) / 14));
  return bed * Math.min(1, edge / 3) + fade * fade * Math.max(1, hills) * bank * bank;
}

export class LandscapeLayer {
  readonly group = new THREE.Group();
  private terrain?: Terrain;
  private samples: RiverSample[] = [];
  /** Signed distance to open water; negative on land. Keeps trees and rocks off the sea. */
  private sea: { at(x: number, z: number): number } | null = null;
  private entrySignature = "";
  private baseHeights = new Float32Array();
  private natureSites = new Map<number, { bank: number; h: number }>();
  private ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  private trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.12, 0.8, 5, 1, true), new THREE.MeshStandardMaterial({ color: 0x69523a }), 15000);
  private crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.62, 2.1, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 15000);
  private leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.78, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 15000);
  private rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x899084, roughness: 1 }), 1200);
  /** Distant stand-in: one open cone for the whole tree, no shadow. */
  private distant = new THREE.InstancedMesh(new THREE.ConeGeometry(0.66, 2.2, 5, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 15000);
  // Tree sites, split into detail levels around the camera every time it moves far enough.
  private treeCount = 0;
  private treeX = new Float32Array(TREE_LIMIT);
  private treeZ = new Float32Array(TREE_LIMIT);
  private treeY = new Float32Array(TREE_LIMIT);
  private treeScale = new Float32Array(TREE_LIMIT);
  private treeRot = new Float32Array(TREE_LIMIT);
  private treeLeafy = new Uint8Array(TREE_LIMIT);
  private treeColor = new Float32Array(TREE_LIMIT * 3);
  private lodAt = new THREE.Vector3(1e9, 0, 0);
  private lodDirty = true;
  constructor() {
    this.ground.receiveShadow = true;
    for (const mesh of [this.trunks, this.crowns, this.leaves, this.rocks]) { mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; }
    this.distant.count = 0; this.distant.frustumCulled = false; this.distant.receiveShadow = true;
    this.distant.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TREE_LIMIT * 3), 3);
    this.group.add(this.ground, this.trunks, this.crowns, this.leaves, this.rocks, this.distant);
  }

  /**
   * Near trees keep trunk, crown and shadow; far ones collapse to a single cone and the
   * farthest are dropped entirely, well inside the fog. Refreshed only when the camera moves.
   */
  update(camera: THREE.Vector3): void {
    if (!this.lodDirty && this.lodAt.distanceToSquared(camera) < 36) return;
    this.lodDirty = false;
    this.lodAt.copy(camera);
    const obj = new THREE.Object3D(), color = new THREE.Color();
    let trunks = 0, pines = 0, leafy = 0, far = 0;
    for (let i = 0; i < this.treeCount; i++) {
      const x = this.treeX[i], z = this.treeZ[i], h = this.treeY[i], s = this.treeScale[i];
      const d2 = (x - camera.x) ** 2 + (z - camera.z) ** 2;
      if (d2 > TREE_CULL * TREE_CULL) continue;
      color.fromArray(this.treeColor, i * 3);
      obj.rotation.set(0, this.treeRot[i], 0);
      if (d2 > TREE_NEAR * TREE_NEAR) {
        obj.scale.set(s, s, s);
        obj.position.set(x, h + s * 0.32, z);
        obj.updateMatrix();
        this.distant.setMatrixAt(far, obj.matrix);
        this.distant.setColorAt(far++, color);
        continue;
      }
      obj.scale.setScalar(s);
      obj.position.set(x, h + s * 0.4, z);
      obj.updateMatrix();
      this.trunks.setMatrixAt(trunks++, obj.matrix);
      obj.position.y = h + s * 1.25;
      obj.updateMatrix();
      const mesh = this.treeLeafy[i] ? this.leaves : this.crowns, slot = this.treeLeafy[i] ? leafy++ : pines++;
      mesh.setMatrixAt(slot, obj.matrix);
      mesh.setColorAt(slot, color);
    }
    this.trunks.count = trunks; this.crowns.count = pines; this.leaves.count = leafy; this.distant.count = far;
    for (const mesh of [this.trunks, this.crowns, this.leaves, this.distant]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  rebuild(t: Terrain): void {
    this.terrain = t;
    this.entrySignature = "";
    this.natureSites.clear();
    this.samples = riverSamples(t);
    // Open water runs past the map edge, so the surrounding hills sink under it instead of
    // ringing a coastal map with mountains.
    const sea = signedWaterField(t);
    this.sea = sea;
    const geo = new THREE.PlaneGeometry(360, 360, 150, 150);
    geo.rotateX(-Math.PI / 2);
    const positions = geo.getAttribute('position');
    this.baseHeights = new Float32Array(positions.count);
    const colors = new Float32Array(positions.count * 3), color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      const h = landscapeHeight(x, z, t.seed, this.samples) * Math.max(0, Math.min(1, -sea.at(x, z) / 2));
      positions.setY(i, h - 0.025);
      this.baseHeights[i] = h;
      const patch = (Math.sin(x * 0.21) * Math.cos(z * 0.17) + 1) / 2;
      color.set(0x729958).lerp(new THREE.Color(0x9eb878), patch * 0.48).lerp(new THREE.Color(0x929589), Math.max(0, (h - 7) / 16));
      color.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.ground.geometry.dispose(); this.ground.geometry = geo;
  }
  develop(kind: Uint8Array, raster: Raster, net: Network): void {
    const t = this.terrain;
    if (!t) return;
    const entries = [...net.nodes.values()].filter(n => n.entry).map(n => ({ ...entrySite(n.x, n.z), x: n.x - 40, z: n.z - 40 }));
    const roadDistance = (x: number, z: number): number => Math.min(...entries.map(e => {
      const along = (x - e.x) * -e.dx + (z - e.z) * -e.dz;
      return along >= -2 ? Math.abs((x - e.x) * e.dz - (z - e.z) * e.dx) : Infinity;
    }));
    const signature = JSON.stringify(entries);
    if (signature !== this.entrySignature) {
      this.entrySignature = signature;
      const p = this.ground.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), cut = Math.max(0, Math.min(1, (roadDistance(x, z) - 2.5) / 5));
        p.setY(i, this.baseHeights[i] * cut - 0.025);
      }
      p.needsUpdate = true; this.ground.geometry.computeVertexNormals(); this.ground.geometry.computeBoundingSphere();
    }
    const owners = siteOwners(kind), rnd = mulberry32(t.seed ^ 0x781ef123), obj = new THREE.Object3D(), color = new THREE.Color();
    // One dilated mask beats a 3x3 probe per candidate tree.
    const blockedTiles = new Uint8Array(GRID * GRID);
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const i = z * GRID + x;
      if (!kind[i] && !raster.cover[i] && owners[i] < 0) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx >= 0 && xx < GRID && zz >= 0 && zz < GRID) blockedTiles[zz * GRID + xx] = 1;
      }
    }
    let trees = 0, rocks = 0;
    for (let n = 0; n < 15000; n++) {
      const x = rnd() * 240 - 120, z = rnd() * 240 - 120, s = 0.65 + rnd() * 0.85;
      const tx = Math.floor(x + 40), tz = Math.floor(z + 40), inside = tx >= 0 && tx < GRID && tz >= 0 && tz < GRID;
      if (inside) {
        // Reserve roadside lots, including shifted building facades and every airport tile.
        if (blockedTiles[tz * GRID + tx]) continue;
      } else {
        if (roadDistance(x, z) < 7.5) continue;
      }
      if (this.sea && this.sea.at(x, z) > -0.7) continue;
      let site = this.natureSites.get(n);
      if (!site) {
        const bank = riverDistance(x, z, this.samples).distance;
        site = { bank, h: landscapeHeight(x, z, t.seed, this.samples) };
        this.natureSites.set(n, site);
      }
      const { bank, h } = site;
      if (bank < 1.1) continue;
      if (bank < 2.4 && rocks < 1200) {
        obj.position.set(x, h + 0.08, z); obj.scale.set(s * 0.27, s * 0.17, s * 0.21); obj.rotation.set(0.2, n, 0.3); obj.updateMatrix(); this.rocks.setMatrixAt(rocks++, obj.matrix);
      } else if (trees < TREE_LIMIT && Math.sin(x * 0.09 + t.seed % 17) + Math.cos(z * 0.13) > -0.3) {
        // Keep trees in scale with houses: roughly 1-1.8 tiles tall.
        this.treeX[trees] = x; this.treeZ[trees] = z; this.treeY[trees] = h;
        this.treeScale[trees] = s * 0.58; this.treeRot[trees] = n; this.treeLeafy[trees] = n % 3 === 0 ? 1 : 0;
        color.setHSL(0.26 + (n % 7) * 0.009, 0.28 + (n % 3) * 0.06, 0.23 + (n % 5) * 0.025);
        color.toArray(this.treeColor, trees * 3);
        trees++;
      }
    }
    this.treeCount = trees;
    this.lodDirty = true;
    this.rocks.count = rocks;
    this.rocks.instanceMatrix.needsUpdate = true;
    this.update(this.lodAt.x > 1e8 ? new THREE.Vector3() : this.lodAt);
  }
}
