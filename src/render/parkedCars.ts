import * as THREE from 'three';
import { GRID, N_TILES, T_FARM, isZone, tileHash } from '../constants';
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

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    this.meshes = [1, 2].map(type => {
      const g = vehicleGeometry(type); g.scale(SCALE, SCALE, SCALE);
      const m = new THREE.InstancedMesh(g, mat, CAP);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      this.group.add(m);
      return m;
    });
  }

  rebuild(net: Network, kind: Uint8Array, level: Uint8Array): void {
    let built = 0;
    for (let i = 0; i < N_TILES; i++) if (level[i]) built = (built * 31 + i * 4 + level[i] + kind[i] * 7) >>> 0;
    const signature = `${net.version}:${built}:${[...net.segs.values()].filter(x => x.bike).length}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.byTile.clear();
    const half = GRID / 2, obj = new THREE.Object3D(), color = new THREE.Color();
    const counts = [0, 0];
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
