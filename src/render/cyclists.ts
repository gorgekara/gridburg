import * as THREE from 'three';
import { sideHalf } from '../roads/lanes';
import { GRID } from '../constants';

import type { Network, RSeg } from '../roads/network';
import { roadHeight } from '../roads/structures';
import { BIKE_TRACK_OFFSET } from './bikeLanes';
import { Builder } from './buildingGeo';
import { sample } from './pedestrians';

const MAX_RIDERS = 240;
const JERSEYS = [0xd8453b, 0x2f6fb7, 0xe0a021, 0x3f9a5f, 0xf1ece0, 0x6a5acd, 0xe07fb0, 0x2a2f36];

interface Rider { seg: RSeg; side: number; s: number; speed: number; phase: number }

function bikeGeometry(): THREE.BufferGeometry {
  const b = new Builder(91);
  for (const z of [-0.028, 0.028]) b.box(0.004, 0.028, 0.028, 0, 0, z, 0x22262b); // wheels, edge on
  b.box(0.004, 0.004, 0.06, 0, 0.026, 0, 0x9aa3a8); // frame
  b.box(0.004, 0.02, 0.004, 0, 0.026, 0.02, 0x9aa3a8); // fork
  b.box(0.018, 0.003, 0.003, 0, 0.046, 0.022, 0x22262b); // bars
  b.box(0.012, 0.004, 0.016, 0, 0.04, -0.016, 0x22262b); // saddle
  b.box(0.011, 0.028, 0.012, 0, 0.012, -0.004, 0x2b3440); // legs
  b.box(0.024, 0.034, 0.016, 0, 0.042, -0.008, 0xffffff); // jersey (tinted)
  b.box(0.016, 0.016, 0.016, 0, 0.076, -0.002, 0xf1c9a5); // head
  b.box(0.018, 0.007, 0.02, 0, 0.088, -0.002, 0x3a4149); // helmet
  return b.build();
}

/** People riding the bike tracks: a few per street that has them, in both directions. Scenery only. */
export class CyclistLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private riders: Rider[] = [];
  private version = -1;
  private net: Network | null = null;

  constructor() {
    this.mesh = new THREE.InstancedMesh(bikeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), MAX_RIDERS);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RIDERS * 3).fill(1), 3);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    this.group.add(this.mesh);
  }

  rebuild(net: Network): void {
    const bikes = [...net.segs.values()].filter(s => s.bike && !s.structure);
    const version = net.version * 997 + bikes.length;
    if (net === this.net && version === this.version) return;
    this.net = net; this.version = version;
    this.riders = [];
    let n = 0;
    for (const seg of bikes) {
      const count = Math.min(6, Math.max(1, Math.round(seg.len / 4)));
      for (let k = 0; k < count && this.riders.length < MAX_RIDERS; k++, n++) {
        this.riders.push({ seg, side: k % 2 ? 1 : -1, s: (k + 0.5) / count * seg.len, speed: 0.32 + ((n * 37) % 10) / 40, phase: n * 1.3 });
        this.mesh.setColorAt(this.riders.length - 1, new THREE.Color(JERSEYS[n % JERSEYS.length]));
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const half = GRID / 2, obj = new THREE.Object3D();
    this.riders.forEach((r, i) => {
      // Ride the right-hand track to the end of the street, then turn round onto the other side.
      r.s += r.side * r.speed * dt;
      if (r.s > r.seg.len - 0.3 || r.s < 0.3) { r.side = -r.side; r.s = Math.max(0.3, Math.min(r.seg.len - 0.3, r.s)); }
      const at = sample(r.seg, r.s);
      const off = sideHalf(r.seg, r.side) + BIKE_TRACK_OFFSET;
      obj.position.set(at.x - at.tz * off * r.side - half, roadHeight(r.seg, r.s) + 0.045, at.z + at.tx * off * r.side - half);
      obj.rotation.set(0, Math.atan2(at.tx * r.side, at.tz * r.side), 0);
      obj.updateMatrix();
      this.mesh.setMatrixAt(i, obj.matrix);
    });
    this.mesh.count = this.riders.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
