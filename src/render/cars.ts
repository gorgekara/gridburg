import { VEHICLE_SCALE } from '../sim/trafficSpace';
import * as THREE from 'three';
import { MAX_CARS } from '../constants';
import { Builder } from './buildingGeo';

/** Vehicle types match the worker frame: 1 car, 2 van, 3 truck, 4 bus. */
export function vehicleGeometry(type: number): THREE.BufferGeometry {
  const emergency = type === 5 || type === 6;
  const b = new Builder(type);
  const model = type === 5 ? 1 : type === 6 ? 3 : type;
  const length = model >= 3 ? 0.78 : model === 2 ? 0.54 : 0.46;
  // Cars and vans are painted white and tinted per vehicle, so the palette lives in CarLayer.
  const body = [0, 0xffffff, 0xffffff, 0x508e9d, 0xeebc55, 0xe6ecec, 0xd44434][type];
  b.box(0.25, 0.11, length, 0, 0.1, 0, body);
  if (model === 1) {
    b.box(0.22, 0.1, 0.25, 0, 0.21, -0.01, body);
    b.box(0.19, 0.075, 0.015, 0, 0.23, 0.12, 0x283d50);
    b.box(0.19, 0.06, 0.015, 0, 0.23, -0.14, 0x283d50);
  } else if (model === 3) {
    b.box(0.25, 0.18, 0.22, 0, 0.2, 0.25, body);
    b.box(0.27, 0.26, 0.48, 0, 0.16, -0.12, type === 6 ? 0xcc4434 : 0xe1e0d7);
    for (let z = -0.3; z < 0.1; z += 0.08) b.box(0.275, 0.23, 0.012, 0, 0.18, z, 0xb7c1bf);
    b.box(0.22, 0.08, 0.012, 0, 0.28, 0.365, 0x294354);
  } else {
    b.box(0.24, type === 4 ? 0.24 : 0.19, length - 0.04, 0, 0.18, 0, body);
    b.box(0.21, 0.1, 0.015, 0, 0.26, length / 2 - 0.013, 0x294354);
    if (type === 4) {
      for (let z = -0.27; z < 0.32; z += 0.12) b.box(0.25, 0.1, 0.085, 0, 0.27, z, 0x294354);
      b.box(0.18, 0.035, 0.2, 0, 0.42, -0.08, 0xe9e6db);
      b.box(0.18, 0.03, 0.016, 0, 0.38, length / 2 - 0.01, 0x263b38);
    } else {
      b.box(0.248, 0.09, 0.12, 0, 0.26, 0.13, 0x294354);
      b.box(0.015, 0.15, 0.014, 0, 0.2, -length / 2, 0x929d9e);
    }
  }
  for (const x of [-0.13, 0.13]) for (const z of [-length * 0.31, length * 0.31]) {
    b.box(0.05, 0.1, 0.1, x, 0.055, z, 0x252b30);
    b.box(0.055, 0.04, 0.045, x, 0.085, z, 0x859299);
  }
  for (const x of [-0.085, 0.085]) {
    b.box(0.05, 0.035, 0.016, x, 0.14, length / 2 + 0.005, 0xffedb0);
    b.box(0.045, 0.035, 0.016, x, 0.14, -length / 2 - 0.005, 0xbd3934);
    b.box(0.035, 0.025, 0.03, x * 1.7, 0.25, length * 0.22, 0x687b86);
  }
  b.box(0.23, 0.025, 0.018, 0, 0.105, length / 2 + 0.009, 0xa9b3b5);
  if (emergency) {
    const y = type === 6 ? 0.43 : 0.32;
    b.box(0.19, 0.025, 0.045, 0, y, 0.08, 0x263947);
    b.box(0.08, 0.035, 0.05, -0.05, y + 0.025, 0.08, 0x428dff);
    b.box(0.08, 0.035, 0.05, 0.05, y + 0.025, 0.08, 0xff5343);
    if (type === 6) {
      for (const x of [-0.085, 0.085]) b.box(0.025, 0.025, 0.4, x, 0.45, -0.12, 0xd5dddd);
      for (let z = -0.3; z < 0.1; z += 0.07) b.box(0.17, 0.025, 0.018, 0, 0.45, z, 0xd5dddd);
    } else b.box(0.255, 0.06, 0.2, 0, 0.14, 0, 0x315b89);
  }
  const geometry = b.build(); geometry.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE); return geometry;
}
/** Head and tail lamps, drawn additively after dark. The lamps light up; the road stays dark. */
function lightGeometry(type: number): THREE.BufferGeometry {
  const model = type === 5 ? 1 : type === 6 ? 3 : type;
  const length = model >= 3 ? 0.78 : model === 2 ? 0.54 : 0.46;
  const pos: number[] = [], col: number[] = [];
  const lamp = (x: number, y: number, z: number, w: number, h: number, c: number[]): void => {
    const g = new THREE.BoxGeometry(w, h, 0.03).toNonIndexed(), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z); col.push(...c); }
    g.dispose();
  };
  const front = length / 2, warm = [1, 0.93, 0.72], red = [1, 0.12, 0.08];
  for (const x of [-0.085, 0.085]) {
    lamp(x, 0.158, front + 0.012, 0.055, 0.04, warm);
    lamp(x, 0.158, -front - 0.012, 0.05, 0.04, red);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  return g;
}

// Weighted like a real car park: mostly white, black, silver and grey, with a few bright ones.
const CAR_COLORS = [0xf1f1ec, 0xf1f1ec, 0x26292d, 0x26292d, 0xb4b9bd, 0xb4b9bd, 0x6b7076, 0xa8312b, 0x2e5c9a, 0x1f3350, 0x355d45, 0xd9a93a, 0xcdbb97, 0xd66f2c, 0x6fa6c8, 0x6a2230];
const VAN_COLORS = [0xf1f1ec, 0xf1f1ec, 0xf1f1ec, 0xb4b9bd, 0x6b7076, 0x2e4f7c, 0xb13a2f, 0x3f6b4a, 0xe0b43c, 0x26292d];
const vehicleColor = (type: number, id: number): number => {
  const palette = type === 1 ? CAR_COLORS : VAN_COLORS;
  const h = Math.imul(id ^ (id >>> 15), 0x2c1b3c6d) >>> 0;
  return palette[(h ^ (h >>> 12)) % palette.length];
};

const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
const pitchQ = new THREE.Quaternion(), pitchAxis = new THREE.Vector3(1, 0, 0);
const one = new THREE.Vector3(1, 1, 1), axis = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
export class CarLayer {
  readonly mesh = new THREE.Group();
  private vehicles: THREE.InstancedMesh[] = [];
  private lights: THREE.InstancedMesh[] = [];
  private lightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  constructor() {
    for (let type = 1; type <= 6; type++) {
      const mesh = new THREE.InstancedMesh(vehicleGeometry(type), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), MAX_CARS);
      if (type === 1 || type === 2) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3).fill(1), 3);
      mesh.castShadow = true; mesh.count = 0; mesh.frustumCulled = false;
      this.vehicles.push(mesh); this.mesh.add(mesh);
      const lights = new THREE.InstancedMesh(lightGeometry(type), this.lightMaterial, MAX_CARS);
      lights.count = 0; lights.frustumCulled = false; lights.renderOrder = 2; lights.visible = false;
      this.lights.push(lights); this.mesh.add(lights);
    }
  }
  /** 0 by day, 1 at night: fades the head and tail lamps. */
  setNight(night: number): void {
    const on = night > 0.05;
    this.lightMaterial.opacity = Math.min(1, night * 1.3);
    for (const m of this.lights) m.visible = on;
  }
  update(prev: Float32Array, next: Float32Array, alpha: number, prevIds?: Uint32Array, nextIds?: Uint32Array, heights?: Float32Array, prevHeights?: Float32Array, pitch?: Float32Array): void {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < MAX_CARS; i++) {
      const o = i * 4, type = Math.round(next[o + 3]);
      if (type < 1 || type > 6) continue;
      let y = heights?.[i] ?? 0;
      let x = next[o], z = next[o + 1], a = next[o + 2];
      if ((!prevIds || !nextIds || prevIds[i] === nextIds[i]) && prev[o + 3] === type && Math.abs(prev[o] - x) + Math.abs(prev[o + 1] - z) < 1.5) {
        y = (prevHeights?.[i] ?? y) + (y - (prevHeights?.[i] ?? y)) * alpha;
        x = prev[o] + (x - prev[o]) * alpha; z = prev[o + 1] + (z - prev[o + 1]) * alpha;
        const da = Math.atan2(Math.sin(a - prev[o + 2]), Math.cos(a - prev[o + 2]));
        a = prev[o + 2] + da * alpha;
      }
      if (y < -0.22) continue; // vehicles disappear beneath the tunnel portal
      pos.set(x, y, z); q.setFromAxisAngle(axis, a); q.multiply(pitchQ.setFromAxisAngle(pitchAxis, pitch?.[i] ?? 0)); matrix.compose(pos, q, one);
      const slot = counts[type - 1]++, mesh = this.vehicles[type - 1];
      mesh.setMatrixAt(slot, matrix);
      if (type <= 2) mesh.setColorAt(slot, color.setHex(vehicleColor(type, nextIds?.[i] ?? i)));
      if (y > -0.05) this.lights[type - 1].setMatrixAt(slot, matrix);
      else this.lights[type - 1].setMatrixAt(slot, matrix.makeScale(0, 0, 0));
    }
    this.vehicles.forEach((mesh, i) => {
      mesh.count = counts[i]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.lights[i].count = counts[i]; this.lights[i].instanceMatrix.needsUpdate = true;
    });
  }
}
