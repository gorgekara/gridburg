import * as THREE from 'three';
import { GRID, N_TILES, T_FARM, T_RES, SERVICES, isParking, isZone, tileHash } from '../constants';
import type { Raster } from '../roads/raster';
import { lotScale } from '../placement';
import { VARIANTS } from './buildingGeo';
import { parkingStalls } from './parkingGeo';
import { HALF_WIDTH, KIND_AVENUE, KIND_ROAD } from '../roads/network';
import { Network } from '../roads/network';
import { vehicleColor, vehicleGeometry } from './cars';
import { sample } from './pedestrians';
import { crossingApproaches } from './crossings';

const CAP = 3000;
/** Parked cars are drawn a touch smaller than traffic so they tuck in against the kerb. */
const SCALE = 0.85;
/** Centre of a parked car, measured out from the road's edge: half on the pavement, half on the road. */
export const PARK_INSET = -0.02;
const SLOT = 0.42; // length of a parking space
const CLEAR = 0.3; // extra room past the crossing road's kerb at a junction
const HALF_LENGTH = 0.14, HALF_WIDTH_CAR = 0.075;

interface Parked { x: number; z: number; fx: number; fz: number }

/** House designs narrow enough to leave room for a drive down their right-hand side, inside the fence. */
const DRIVE_VARIANTS = [0, 2, 5];
/** Centre line of a drive across the lot, and how far back it runs from the front (clear of the back-garden shrub). */
const DRIVE_X = 0.385, DRIVE_BACK = -0.2, DRIVE_WIDTH = 0.16;

/** Some houses on a road get a drive down one side with the family car on it. */
export function hasDriveway(tile: number, kind: Uint8Array, level: Uint8Array): boolean {
  if (kind[tile] !== T_RES || level[tile] !== 1) return false;
  const variant = Math.floor(tileHash(tile) * VARIANTS) % VARIANTS;
  return DRIVE_VARIANTS.includes(variant) && tileHash(tile * 13 + 7) < 0.6;
}

/**
 * Cars parked along the kerbs of streets and avenues, half up on the pavement the way narrow European
 * streets do it, so they leave the traffic lanes free. They only park in front of built lots, keep
 * clear of junctions, and each space keeps its car (and colour) until the street or the lot changes.
 */
export class ParkedCarLayer {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[];
  private signature = '';
  /** Parked cars by tile, for the driving mode to bump into. */
  private byTile = new Map<number, Parked[]>();

  /** Paved drives up to the houses. */
  private drives: THREE.InstancedMesh;

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    const drive = new THREE.BoxGeometry(DRIVE_WIDTH, 0.022, 1); drive.translate(0, 0.011, 0);
    this.drives = new THREE.InstancedMesh(drive, new THREE.MeshStandardMaterial({ color: 0xb3aea3, roughness: 0.9 }), N_TILES);
    this.drives.count = 0; this.drives.frustumCulled = false; this.drives.receiveShadow = true;
    this.group.add(this.drives);
    this.meshes = [1, 2].map(type => {
      const g = vehicleGeometry(type); g.scale(SCALE, SCALE, SCALE);
      const m = new THREE.InstancedMesh(g, mat, CAP);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      this.group.add(m);
      return m;
    });
  }

  rebuild(net: Network, kind: Uint8Array, level: Uint8Array, raster?: Raster, rot?: Uint8Array): void {
    let built = 0;
    for (let i = 0; i < N_TILES; i++) if (level[i] || isParking(kind[i])) built = (built * 31 + i * 4 + level[i] + kind[i] * 7 + (rot?.[i] ?? 0) * 3) >>> 0;
    const signature = `${net.version}:${built}:${[...net.segs.values()].filter(x => x.bike).length}:${raster ? 1 : 0}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.byTile.clear();
    const half = GRID / 2, obj = new THREE.Object3D(), color = new THREE.Color();
    const counts = [0, 0];
    const put = (x: number, z: number, angle: number, type: number, id: number): void => {
      const m = type - 1;
      if (counts[m] >= CAP) return;
      obj.position.set(x, 0, z); obj.rotation.set(0, angle, 0); obj.updateMatrix();
      this.meshes[m].setMatrixAt(counts[m], obj.matrix);
      this.meshes[m].setColorAt(counts[m]++, color.setHex(vehicleColor(type, id)));
      const tile = Math.floor(z + half) * GRID + Math.floor(x + half), list = this.byTile.get(tile) ?? [];
      list.push({ x, z, fx: Math.sin(angle), fz: Math.cos(angle) });
      this.byTile.set(tile, list);
    };
    // Mouths of the drives, so nobody parks across them.
    const mouths: { x: number; z: number }[] = [];
    let drives = 0;
    if (raster) for (let i = 0; i < N_TILES; i++) {
      if (isParking(kind[i])) {
        // Bays on a car park, most of them taken.
        const spec = SERVICES[kind[i]], turn = (rot?.[i] ?? 0) & 3, [w, d] = spec.footprint ?? [1, 1];
        const [rw, rd] = turn % 2 ? [d, w] : [w, d];
        let cx: number, cz: number, facing: number;
        if (spec.footprint) { cx = i % GRID + rw / 2; cz = Math.floor(i / GRID) + rd / 2; facing = turn * Math.PI / 2; }
        else {
          cx = raster.lotX[i]; cz = raster.lotZ[i];
          facing = turn ? turn * Math.PI / 2 : raster.accSeg[i] >= 0 ? raster.face[i] : 0;
        }
        const cos = Math.cos(facing), sin = Math.sin(facing), k = spec.footprint ? 1 : lotScale(facing);
        parkingStalls(w, d).forEach((raw, n) => {
          const stall = { ...raw, x: raw.x * k, z: raw.z * k };
          const id = i * 211 + n, h = tileHash(id);
          if (h < 0.3) return;
          // Now and then a car reversed in instead.
          const angle = facing + stall.angle + (h > 0.9 ? Math.PI : 0) + (h - 0.6) * 0.06;
          put(cx - half + stall.x * cos + stall.z * sin, cz - half - stall.x * sin + stall.z * cos, angle, h > 0.93 ? 2 : 1, id);
        });
        continue;
      }
      if (!hasDriveway(i, kind, level) || raster.accSeg[i] < 0) continue;
      const seg = net.segs.get(raster.accSeg[i]);
      if (!seg) continue;
      const lx = raster.lotX[i], lz = raster.lotZ[i], dx = raster.accX[i] - lx, dz = raster.accZ[i] - lz;
      // The kerb, measured forward from the middle of the lot: only houses right on the street get a drive.
      const kerb = Math.hypot(dx, dz) - HALF_WIDTH[seg.kind];
      if (kerb > 0.75 || kerb < 0.45) continue;
      const facing = raster.face[i], cos = Math.cos(facing), sin = Math.sin(facing);
      // On an angled road the house is shrunk into its cell, so its drive tucks in beside it too.
      const k = lotScale(facing), back = DRIVE_BACK * k;
      const at = (x: number, z: number): [number, number] => [lx - half + x * k * cos + z * sin, lz - half - x * k * sin + z * cos];
      const [mx, mz] = at(DRIVE_X, (back + kerb) / 2);
      obj.position.set(mx, 0, mz); obj.rotation.set(0, facing, 0); obj.scale.set(1, 1, kerb - back); obj.updateMatrix();
      this.drives.setMatrixAt(drives++, obj.matrix);
      obj.scale.set(1, 1, 1);
      mouths.push({ x: at(DRIVE_X, kerb)[0], z: at(DRIVE_X, kerb)[1] });
      // Most drives have the car at home, parked nose in or backed up to the house.
      const h = tileHash(i * 17 + 3);
      if (h < 0.8) {
        const [cx, cz] = at(DRIVE_X, 0.06);
        put(cx, cz, facing + (h < 0.45 ? 0 : Math.PI), h > 0.7 ? 2 : 1, i * 7 + 1);
      }
    }
    this.drives.count = drives;
    this.drives.instanceMatrix.needsUpdate = true;
    const crossings = crossingApproaches(net);
    for (const seg of net.segs.values()) {
      // Streets and avenues only: a lane is too narrow, and nobody parks on an expressway, a bridge or in a tunnel.
      if (seg.structure || (seg.kind !== KIND_ROAD && seg.kind !== KIND_AVENUE)) continue;
      // Nor on a roundabout, nor over a kerbside bike track.
      if (seg.bike || net.nodes.get(seg.a)?.ring || net.nodes.get(seg.b)?.ring) continue;
      const off = HALF_WIDTH[seg.kind] + PARK_INSET;
      // Stay back from each end by more than the widest road crossing there.
      const clear = (node: number): number => CLEAR + Math.max(0, ...net.segsAt(node).filter(o => o.id !== seg.id).map(o => HALF_WIDTH[o.kind]));
      // ...and behind the zebra crossing, where there is one.
      const zebra = crossings.get(seg.id) ?? [0, 0];
      const from = Math.max(clear(seg.a), zebra[0] + 0.4), to = seg.len - Math.max(clear(seg.b), zebra[1] + 0.4);
      for (const side of [-1, 1]) {
        for (let s = from, n = 0; s < to; s += SLOT, n++) {
          const id = seg.id * 4099 + n * 2 + (side > 0 ? 1 : 0);
          const h = tileHash(id);
          if (h < 0.42) continue; // an empty space
          const at = sample(seg, s);
          const rx = -at.tz * side, rz = at.tx * side; // towards this kerb
          // Only in front of a built lot on this side of the street.
          const lx = Math.floor(at.x + rx * (off + 0.6)), lz = Math.floor(at.z + rz * (off + 0.6));
          if (lx < 0 || lz < 0 || lx >= GRID || lz >= GRID) continue;
          const lot = lz * GRID + lx;
          if (!isZone(kind[lot]) || !level[lot] || kind[lot] === T_FARM) continue;
          const type = h > 0.9 ? 2 : 1, m = type - 1;
          if (counts[m] >= CAP) continue;
          const x = at.x + rx * off - half, z = at.z + rz * off - half;
          if (net.onRoad(x + half, z + half, seg.id, 0.12)) continue;
          if (mouths.some(m => Math.abs(m.x - x) + Math.abs(m.z - z) < 0.3)) continue;
          // Parked facing the way traffic runs on that side, nose slightly out now and then.
          const fx = at.tx * side, fz = at.tz * side;
          obj.position.set(x, 0, z);
          obj.rotation.set(0, Math.atan2(fx, fz) + (h - 0.66) * 0.08, 0);
          obj.updateMatrix();
          this.meshes[m].setMatrixAt(counts[m], obj.matrix);
          this.meshes[m].setColorAt(counts[m]++, color.setHex(vehicleColor(type, id)));
          const tile = Math.floor(z + half) * GRID + Math.floor(x + half);
          const list = this.byTile.get(tile) ?? [];
          list.push({ x, z, fx, fz });
          this.byTile.set(tile, list);
        }
      }
    }
    this.meshes.forEach((m, i) => {
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  /** True if (x, z) in scene space is inside a parked car. */
  hits(x: number, z: number): boolean {
    const tx = Math.floor(x + GRID / 2), tz = Math.floor(z + GRID / 2);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (const p of this.byTile.get((tz + dz) * GRID + tx + dx) ?? []) {
        const ox = x - p.x, oz = z - p.z;
        const along = ox * p.fx + oz * p.fz, across = ox * p.fz - oz * p.fx;
        if (Math.abs(along) < HALF_LENGTH && Math.abs(across) < HALF_WIDTH_CAR) return true;
      }
    }
    return false;
  }
}
