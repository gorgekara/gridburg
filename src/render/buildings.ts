import { isDecoration, T_PATH, T_TREE, neighbor } from '../constants';
import type { VisualDetail } from './detail';
import { T_OFFICE, T_FARM, T_LEISURE, T_FLOOD_BARRIER, T_BUS, T_AIRPORT, T_PUMP, T_OUTLET, T_COAL, T_GAS, T_NUCLEAR } from '../constants';
import { footprint } from '../sites';
import { BAY_SETBACK } from '../roads/busLanes';
import { lotScale } from '../placement';
import * as THREE from 'three';
import { GRID, N_TILES, T_RES, T_COM, T_IND, T_WIND, T_DOCKS, T_HYDRO, SERVICES, isService, isZone, tileHash } from '../constants';
import type { Raster } from '../roads/raster';
import { buildingGeometry, rotorGeometry, emittersOf, VARIANTS, WINDOW_DARK } from './buildingGeo';
import type { Emitter } from './smoke';
import { buildingTint, type Bands } from './character';
import { lotVariant, terraceRun } from './variants';
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
const tint = new THREE.Vector3();
const spot = new THREE.Vector3();
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
/** Roof tiles: slate, terracotta, brown, weathered green, charcoal, red. */
const ROOFS = [0x4a5058, 0xa4523a, 0x6b4a3a, 0x4f6e5a, 0x33363b, 0x8e3b2e, 0x4a5058, 0xa4523a];

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
  /** Where smoke and steam leave the buildings standing now, in the scene. */
  emitters: Emitter[] = [];

  private detail: VisualDetail = 1;

  private night = { value: 0 };
  /** The share of windows lit at this hour: homes, then offices (see `occupancy`). */
  private lit = { value: new THREE.Vector2(0.2, 0.6) };

  setNight(value: number): void { this.night.value = value; }
  setLit(home: number, office: number): void { this.lit.value.set(home, office); }

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const dark = new THREE.Color(WINDOW_DARK);
    mat.onBeforeCompile = shader => {
      shader.uniforms.cityNight = this.night;
      shader.uniforms.cityLit = this.lit;
      shader.uniforms.windowDark = { value: new THREE.Vector3(dark.r, dark.g, dark.b) };
      // Each building has its own wall tint and its own shuffle of which windows are lit.
      shader.vertexShader = 'attribute float pane;\nattribute vec3 aTint;\nattribute float aSeed;\nattribute float aWear;\nattribute vec3 aRoof;\nvarying float vPane;\nvarying vec3 vTint;\nvarying float vWear;\nvarying vec3 vRoof;\nvarying float vUp;\nvarying float vHeight;\nvarying vec3 vWorld;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vTint = aTint; vWear = aWear; vRoof = aRoof; vUp = normal.y; vHeight = position.y;
        vWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vPane = pane;
        if (pane >= 0.0) { float code = floor(pane * 0.5); vPane = code * 2.0 + fract(pane - code * 2.0 + aSeed); }`);
      shader.fragmentShader = 'uniform float cityNight;\nuniform vec2 cityLit;\nuniform vec3 windowDark;\nvarying float vPane;\nvarying vec3 vTint;\nvarying float vWear;\nvarying vec3 vRoof;\nvarying float vUp;\nvarying float vHeight;\nvarying vec3 vWorld;\nfloat paneOn;\nfloat hash1(float n) { return fract(sin(n) * 43758.5453); }\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        // Window glass is known by its colour: the warm homes and the cool offices.
        float windowMask = step(0.95, vColor.r) * step(0.68, vColor.g) * (1.0 - step(0.5, vColor.b));
        float officeMask = step(0.88, vColor.r) * step(0.88, vColor.g) * step(0.95, vColor.b);
        paneOn = 1.0;
        if (vPane >= 0.0) {
          // A pane is lit when its number, made rarer for designs that light few windows, is under
          // the share lit at this hour. An unlit home window is dark glass; an unlit office pane is
          // not there at all, and the glass band behind it shows.
          float code = floor(vPane * 0.5);
          float share = officeMask > 0.5 ? cityLit.y : cityLit.x;
          paneOn = step((vPane - code * 2.0) * code * 0.25, share);
          if (paneOn < 0.5) {
            if (officeMask > 0.5) discard;
            diffuseColor.rgb = windowDark;
          }
        }
        float glass = max(windowMask, officeMask);
        diffuseColor.rgb *= mix(vTint, vec3(1.0), glass * paneOn);
        // Pitched roofs in their own tiles: slate, terracotta, brown, green or charcoal, keeping the
        // light and shade of the courses.
        if (vRoof.r + vRoof.g + vRoof.b > 0.0 && vUp > 0.35 && vUp < 0.97) {
          float luma = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          diffuseColor.rgb = vRoof * (0.7 + luma * 1.2);
        }
        // Weathering on the walls: grime creeping up from the pavement, and dirt streaking down from
        // under each sill and ledge, heavier on the neglected streets.
        if (vUp < 0.3 && glass < 0.5) {
          float grime = 1.0 - smoothstep(0.0, 0.16, vHeight);
          float column = hash1(floor((vWorld.x + vWorld.z) * 42.0) + floor(vHeight / 0.31) * 7.0);
          float streak = step(0.78, column) * (1.0 - fract(vHeight / 0.31 + 0.15)) * step(0.1, vHeight);
          diffuseColor.rgb *= 1.0 - vWear * (grime * 0.32 + streak * 0.22);
        }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Only the lit window glass emits; walls and roofs retain their lighting.
        totalEmissiveRadiance += vec3(1.0, 0.65, 0.24) * windowMask * paneOn * cityNight * 1.8;
        totalEmissiveRadiance += vec3(0.82, 0.88, 1.0) * officeMask * paneOn * cityNight * 1.5;`);
    };
    const add = (k: number, l: number, v: number, cap: number): void => {
      const mesh = new THREE.InstancedMesh(buildingGeometry(k, l, v), mat, cap);
      mesh.userData.tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      mesh.userData.seed = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      mesh.userData.wear = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      mesh.userData.roof = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      withInstanceData(mesh);
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
    // Every empty zone cell along the roads, faintly, so the zone tools show where there is to paint.
    const cellGeo = new THREE.PlaneGeometry(0.9, 0.9);
    cellGeo.rotateX(-Math.PI / 2);
    this.cells = new THREE.InstancedMesh(cellGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false }), N_TILES);
    this.cells.position.y = 0.018;
    this.cells.count = 0;
    this.cells.visible = false;
    this.cells.frustumCulled = false;
    this.group.add(this.cells);
  }

  /** The faint outline of every empty zone cell, shown with the zone overlay. */
  private cells: THREE.InstancedMesh;

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
      withInstanceData(mesh);
      mesh.boundingSphere = null;
      previous.dispose();
    }
  }

  showZones(show: boolean): void { this.zones.visible = show; this.cells.visible = show; }

  rebuild(kind: Uint8Array, level: Uint8Array, raster: Raster, rot?: Uint8Array, water?: Uint8Array, parkPathMask?: Uint8Array, bayTiles?: ReadonlySet<number>, bands?: Bands): void {
    const half = GRID / 2;
    const counts = new Map<number, number>();
    this.rotorSites = [];
    this.emitters = [];
    let nz = 0, nc = 0;
    for (let i = 0; i < N_TILES; i++) {
      const k = kind[i];
      // An empty cell: outlined, turned to its road, unless it stands in the river.
      if (!k && raster.cell[i] >= 0 && !water?.[i]) {
        pos.set(raster.lotX[i] - GRID / 2, 0, raster.lotZ[i] - GRID / 2);
        q.setFromAxisAngle(yAxis, raster.face[i]);
        m4.compose(pos, q, one);
        this.cells.setMatrixAt(nc++, m4);
      }
      if (k === T_PATH && parkPathMask?.[i]) continue;
      const zone = isZone(k);
      if (!zone && !isService(k)) continue;
      const multi = SERVICES[k]?.footprint;
      const turn = isService(k) ? (rot?.[i] ?? 0) & 3 : 0;
      const tx = multi || isDecoration(k) ? i % GRID + 0.5 : raster.lotX[i];
      const tz = multi || isDecoration(k) ? Math.floor(i / GRID) + 0.5 : raster.lotZ[i];
      pos.set(tx - half, 0, tz - half);
      // A bus stop stands back behind its lay-by.
      if (k === T_BUS && !multi && raster.accSeg[i] >= 0 && bayTiles?.has(i)) {
        const dx = tx - raster.accX[i], dz = tz - raster.accZ[i], l = Math.hypot(dx, dz) || 1;
        pos.x += (dx / l) * BAY_SETBACK; pos.z += (dz / l) * BAY_SETBACK;
      }
      if (zone) {
        // A zone painted in a cell is shown in the cell, turned to its road.
        if (raster.cell[i] >= 0) q.setFromAxisAngle(yAxis, raster.face[i]); else q.identity();
        m4.compose(pos, q, one);
        this.zones.setMatrixAt(nz, m4);
        this.zones.setColorAt(nz, col.setHex(ZONE_COLOR[k]));
        nz++;
        if (level[i] === 0) continue;
      }
      const l = zone ? level[i] : 1;
      let variant = zone ? lotVariant(i) : 0;
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
      // A placed building faces the quarter turn it was given; a grown one faces its road, and so does
      // a one-tile service standing in a road-aligned cell of its own.
      let facing = k === T_PATH ? 0 : turn * Math.PI / 2;
      if ((!turn || raster.cell[i] >= 0) && !multi && !isDecoration(k) && raster.accSeg[i] >= 0) facing = raster.face[i];
      // A dock's jetty and a dam's spillway (their -z side) point at the river, whichever side it is.
      if ((k === T_DOCKS || k === T_HYDRO || k === T_FLOOD_BARRIER || k === T_PUMP || k === T_OUTLET) && water) {
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
        // Beside an angled road it turns the rest of the way to face it, shrunk just enough to stay
        // inside its site, so it lines up with the road like the buildings around it.
        const skew = k === T_AIRPORT || isDecoration(k) ? 0 : siteSkew(i, k, turn, rot, raster);
        let scale: THREE.Vector3 = one;
        if (skew) {
          q.setFromAxisAngle(yAxis, facing + skew);
          const c = Math.abs(Math.cos(skew)), sn = Math.abs(Math.sin(skew));
          const f = Math.min(w / (w * c + d * sn), d / (w * sn + d * c));
          scale = lotSize.set(f, 1, f);
        }
        m4.compose(pos, q, scale);
        m4.multiply(pivot.makeTranslation(-(w - 1) / 2, 0, -(d - 1) / 2));
      } else {
        // Turned to an angled road, a building shrinks across the ground to stay inside its cell.
        // In its road-aligned cell a building stands full size; on a bare tile it shrinks to fit.
        const k = raster.cell[i] >= 0 && facing === raster.face[i] ? 1 : lotScale(facing);
        m4.compose(pos, q, k === 1 ? one : lotSize.set(k, 1, k));
      }
      mesh.setMatrixAt(n, m4);
      mesh.userData.tileIds[n] = i;
      for (const [ex, ey, ez, ek] of emittersOf(k, l, variant)) {
        spot.set(ex, ey, ez).applyMatrix4(m4);
        this.emitters.push({ x: spot.x, y: spot.y, z: spot.z, kind: ek, tile: i, always: k === T_COAL || k === T_GAS || k === T_NUCLEAR });
      }
      // A zone building's own paint (a terrace is painted alike), and its own shuffle of lit windows.
      if (zone) buildingTint(terraceRun(i) >= 0 ? terraceRun(i) : i + 7919, bands ? bands.wealth[i] : 1, tint);
      else tint.set(1, 1, 1);
      (mesh.userData.tint as THREE.InstancedBufferAttribute).setXYZ(n, tint.x, tint.y, tint.z);
      (mesh.userData.seed as THREE.InstancedBufferAttribute).setX(n, tileHash(i * 31 + 7));
      // How worn the walls are: by the street's standing and its troubles, and a little by chance.
      const wealth = bands ? bands.wealth[i] : 1, rough = bands ? bands.rough[i] : 0;
      (mesh.userData.wear as THREE.InstancedBufferAttribute).setX(n, zone ? Math.min(1, [0.8, 0.4, 0.2, 0.05][wealth] + rough * 0.2 + tileHash(i * 53 + 1) * 0.2) : 0.3);
      // Tiles for the pitched roofs of homes and shops; a terrace shares its roof as it shares its paint.
      const roofKey = terraceRun(i) >= 0 ? terraceRun(i) : i + 7919;
      if (zone && k !== T_IND && k !== T_FARM) { col.setHex(ROOFS[Math.floor(tileHash(roofKey * 3 + 11) * ROOFS.length)]); (mesh.userData.roof as THREE.InstancedBufferAttribute).setXYZ(n, col.r, col.g, col.b); }
      else (mesh.userData.roof as THREE.InstancedBufferAttribute).setXYZ(n, 0, 0, 0);
      if (k === T_WIND) this.rotorSites.push({ x: pos.x, z: pos.z, rot: facing, phase: tileHash(i) * 6.28 });
    }
    for (const [kk, mesh] of this.meshes) {
      mesh.count = counts.get(kk) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.count) for (const a of ['tint', 'seed', 'wear', 'roof']) (mesh.userData[a] as THREE.InstancedBufferAttribute).needsUpdate = true;
      mesh.boundingSphere = null; // Recompute lazily for picking after buildings move or grow.
    }
    this.zones.count = nz;
    this.cells.count = nc;
    this.cells.instanceMatrix.needsUpdate = true;
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

/** Hang a building mesh's own per-instance tint and seed on its (possibly new) geometry. */
function withInstanceData(mesh: THREE.InstancedMesh): void {
  mesh.geometry.setAttribute('aTint', mesh.userData.tint);
  mesh.geometry.setAttribute('aSeed', mesh.userData.seed);
  mesh.geometry.setAttribute('aWear', mesh.userData.wear);
  mesh.geometry.setAttribute('aRoof', mesh.userData.roof);
  // Geometry built without window numbers (none of ours, but to be safe) lights nothing specially.
  if (!mesh.geometry.getAttribute('pane') && mesh.geometry.getAttribute('position')) {
    mesh.geometry.setAttribute('pane', new THREE.BufferAttribute(new Float32Array(mesh.geometry.getAttribute('position').count).fill(-1), 1));
  }
}

/**
 * How much further than its quarter turn a large building turns to face an angled road beside it:
 * the angle from its front to the road, as the tile of its site nearest the road sees it; 0 beside a
 * road on the grid, or none at all. Within ±45°, so its turned footprint keeps its tiles.
 */
function siteSkew(i: number, k: number, turn: number, rot: Uint8Array | undefined, raster: Raster): number {
  let best = -1, bd = Infinity;
  for (const t of footprint(i, k, rot?.[i] ?? 0)) {
    if (raster.accSeg[t] < 0) continue;
    const dd = Math.hypot(raster.accX[t] - raster.lotX[t], raster.accZ[t] - raster.lotZ[t]);
    if (dd < bd) { bd = dd; best = t; }
  }
  if (best < 0) return 0;
  const d = raster.face[best] - turn * Math.PI / 2, wrapped = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(wrapped) < 0.02 || Math.abs(wrapped) > Math.PI / 4 + 1e-6 ? 0 : wrapped;
}
