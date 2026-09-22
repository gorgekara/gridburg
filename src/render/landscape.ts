import type { VisualDetail } from './detail';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID, mulberry32 } from '../constants';
import type { Terrain } from '../terrain';
import type { Raster } from '../roads/raster';
import { siteOwners } from '../sites';
import type { Network } from '../roads/network';
import { entrySite } from '../roads/entries';

/** Trees keep full detail within this radius, a single cone beyond it, and vanish past the cull. */
const TREE_CULL = 250, TREE_LIMIT = 15000;

export interface RiverSample { x: number; z: number; w: number; y: number }
/** Scenic upstream cascades stay outside the construction grid. */
export function riverSamples(t: Terrain): RiverSample[] {
  const r = t.river, a = r[0], b = r[1], c = r[r.length - 1], d = r[r.length - 2];
  const al = Math.hypot(a.x - b.x, a.z - b.z), cl = Math.hypot(c.x - d.x, c.z - d.z);
  const points: RiverSample[] = [];
  // Beyond the map the channel keeps wandering the way it does inside it, rather than running
  // dead straight to the horizon. The wander starts at zero so it joins the real river seamlessly.
  const phase = (t.seed % 1000) / 53;
  const wander = (n: number, ph: number): number => Math.sin(n / 26 + ph) * 4.5 * Math.min(1, n / 20) + Math.sin(n / 9.5 + ph * 2) * 1.6 * Math.min(1, n / 8);
  // The stream climbs into the hills as a chute rather than a step: the ground mesh is coarse,
  // and anything steeper than this leaves the water standing on a shelf of its own.
  const ux = (a.x - b.x) / al, uz = (a.z - b.z) / al;
  for (let n = 110; n >= 1; n--) {
    const u = Math.max(0, Math.min(1, (n - 7) / 26)), w = wander(n, phase);
    points.push({ x: a.x + ux * n - uz * w - 40, z: a.z + uz * n + ux * w - 40, w: a.w, y: 4 * u * u * (3 - 2 * u) });
  }
  for (const p of r) points.push({ ...p, x: p.x - 40, z: p.z - 40, y: 0 });
  const vx = (c.x - d.x) / cl, vz = (c.z - d.z) / cl;
  for (let n = 1; n <= 110; n++) {
    const w = wander(n, phase + 2.1);
    points.push({ x: c.x + vx * n - vz * w - 40, z: c.z + vz * n + vx * w - 40, w: c.w, y: 0 });
  }
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
  // A shallow trench along the channel. The ground mesh is far coarser than the stream is
  // wide, so without it the interpolated surface cuts up through the water on the bends.
  const trench = 0.4 * Math.max(0, 1 - Math.max(0, distance) / 2.5);
  return bed * Math.min(1, edge / 3) - trench + fade * fade * Math.max(1, hills) * bank * bank;
}

/** Shared near-tree silhouettes, with baked foliage shading and no extra draw calls. */
export function canopyGeometry(leafy: boolean, detail: VisualDetail = 1): THREE.BufferGeometry {
  if (detail === 0) {
    const g = leafy ? new THREE.IcosahedronGeometry(0.78, 0) : new THREE.ConeGeometry(0.62, 2.1, 7);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    return g;
  }
  const parts: THREE.BufferGeometry[] = [];
  for (let layer = 0; layer < 3; layer++) {
    const source = leafy
      ? new THREE.IcosahedronGeometry([0.57, 0.55, 0.5][layer], detail === 2 && layer === 2 ? 1 : 0)
      : new THREE.ConeGeometry([0.62, 0.48, 0.34][layer], [1.05, 0.95, 0.9][layer], detail === 2 ? 9 : 7, 1, true);
    const g = source.index ? source.toNonIndexed() : source;
    if (g !== source) source.dispose();
    if (leafy) {
      g.scale(1, 1.12, 1);
      g.translate([-0.24, 0.23, 0][layer], [-0.16, -0.07, 0.3][layer], [0.02, 0.08, -0.14][layer]);
    } else {
      g.rotateY(layer * 0.4);
      g.translate(0, [-0.42, 0.12, 0.6][layer], 0);
    }
    g.computeVertexNormals();
    const normals = g.getAttribute('normal');
    const colors = new Float32Array(normals.count * 3);
    for (let i = 0; i < normals.count; i++) {
      const shade = 0.78 + layer * 0.055 + Math.max(0, normals.getY(i)) * 0.11;
      colors[i * 3] = shade * 0.96;
      colors[i * 3 + 1] = shade;
      colors[i * 3 + 2] = shade * 0.9;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  }
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}

export class LandscapeLayer {
  readonly group = new THREE.Group();
  private terrain?: Terrain;
  private samples: RiverSample[] = [];
  private entrySignature = "";
  private baseHeights = new Float32Array();
  private natureSites = new Map<number, { bank: number; h: number }>();
  /** Height of player-raised ground, so forests climb the hills instead of vanishing inside them. */
  hillHeight: (x: number, z: number) => number = () => 0;
  private ground = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  private trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.12, 0.8, 5, 1, true), new THREE.MeshStandardMaterial({ color: 0x69523a }), 15000);
  private crowns = new THREE.InstancedMesh(canopyGeometry(false), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 }), 15000);
  private leaves = new THREE.InstancedMesh(canopyGeometry(true), new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 }), 15000);
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
  private detail: VisualDetail = 1;
  constructor() {
    this.ground.receiveShadow = true;
    for (const mesh of [this.trunks, this.crowns, this.leaves, this.rocks]) { mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; }
    this.distant.count = 0; this.distant.frustumCulled = false; this.distant.receiveShadow = true;
    this.distant.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TREE_LIMIT * 3), 3);
    this.group.add(this.ground, this.trunks, this.crowns, this.leaves, this.rocks, this.distant);
  }

  setDetail(detail: VisualDetail): void {
    if (this.detail === detail) return;
    this.detail = detail;
    for (const [mesh, leafy] of [[this.crowns, false], [this.leaves, true]] as const) {
      const previous = mesh.geometry;
      mesh.geometry = canopyGeometry(leafy, detail);
      mesh.boundingSphere = null;
      previous.dispose();
    }
    this.lodDirty = true;
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
      if (d2 > [40 * 40, 70 * 70, 85 * 85][this.detail]) {
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
    const geo = new THREE.PlaneGeometry(360, 360, 150, 150);
    geo.rotateX(-Math.PI / 2);
    const positions = geo.getAttribute('position');
    this.baseHeights = new Float32Array(positions.count);
    const colors = new Float32Array(positions.count * 3), color = new THREE.Color();
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), h = landscapeHeight(x, z, t.seed, this.samples);
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
    // Measured from the gate on the map edge, so the cleared corridor covers the whole off-map approach.
    const entries = [...net.nodes.values()].filter(n => n.entry).map(n => { const e = entrySite(n.x, n.z); return { ...e, x: e.x - 40, z: e.z - 40 }; });
    const roadDistance = (x: number, z: number): number => Math.min(...entries.map(e => {
      const along = (x - e.x) * -e.dx + (z - e.z) * -e.dz;
      return along >= -2 ? Math.abs((x - e.x) * e.dz - (z - e.z) * e.dx) : Infinity;
    }));
    const signature = JSON.stringify(entries);
    if (signature !== this.entrySignature) {
      this.entrySignature = signature;
      const p = this.ground.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        // A broad, gently shouldered cutting, so the road does not look as if it dives into a hillside.
        const x = p.getX(i), z = p.getZ(i), cut = Math.max(0, Math.min(1, (roadDistance(x, z) - 5) / 9));
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
      let site = this.natureSites.get(n);
      if (!site) {
        const bank = riverDistance(x, z, this.samples).distance;
        site = { bank, h: landscapeHeight(x, z, t.seed, this.samples) };
        this.natureSites.set(n, site);
      }
      const { bank } = site;
      const h = site.h + (inside ? this.hillHeight(x, z) : 0);
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
