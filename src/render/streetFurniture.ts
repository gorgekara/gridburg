import * as THREE from 'three';
import { GRID, N_TILES, T_BUS, tileHash } from '../constants';
import { HALF_WIDTH, KIND_AVENUE, KIND_HIGHWAY } from '../roads/network';
import type { Network } from '../roads/network';
import { roadHeight } from '../roads/structures';
import { Builder } from './buildingGeo';
import { sample } from './pedestrians';

const CAP = 4000;
const CURB_TOP = 0.031;

/** Street furniture, each modelled facing +z (towards the road) with its base at y = 0. */
function pieces(): THREE.BufferGeometry[] {
  const make = (seed: number, draw: (b: Builder) => void): THREE.BufferGeometry => { const b = new Builder(seed); draw(b); return b.build(); };
  return [
    make(1, b => { // bench
      b.box(0.11, 0.008, 0.03, 0, 0.03, 0, 0x8a6240);
      b.box(0.11, 0.028, 0.006, 0, 0.042, -0.015, 0x8a6240);
      for (const x of [-0.045, 0.045]) b.box(0.006, 0.03, 0.028, x, 0, 0, 0x3a4046);
    }),
    make(2, b => { // litter bin
      b.cyl(0.013, 0.045, 0, 0, 0, 0x3f6b4a, 8);
      b.cyl(0.015, 0.005, 0, 0.045, 0, 0x2c4a34, 8);
    }),
    make(3, b => { // fire hydrant
      b.cyl(0.008, 0.035, 0, 0, 0, 0xc8382f, 8);
      b.cyl(0.01, 0.006, 0, 0.035, 0, 0xc8382f, 8);
      b.box(0.026, 0.006, 0.006, 0, 0.02, 0, 0xc8382f);
    }),
    make(4, b => { // tree in a pit
      b.box(0.05, 0.004, 0.05, 0, 0, 0, 0x5b4a3a);
      b.cyl(0.006, 0.12, 0, 0, 0, 0x6b4f36, 6);
      b.cyl(0.045, 0.07, 0, 0.1, 0, 0x4f7f3d, 8);
      b.cyl(0.032, 0.04, 0, 0.17, 0, 0x5f8f45, 8);
    }),
    make(5, b => { // bike rack with a bike
      for (const x of [-0.03, 0, 0.03]) b.box(0.004, 0.028, 0.03, x, 0, 0, 0x9aa3a8);
      b.box(0.004, 0.022, 0.05, -0.015, 0.004, 0.005, 0x2f6fb7);
      b.box(0.004, 0.006, 0.05, -0.015, 0.024, 0.005, 0x2f6fb7);
    }),
    make(6, b => { // planter with flowers
      b.box(0.07, 0.025, 0.03, 0, 0, 0, 0x9c9488);
      b.box(0.062, 0.012, 0.024, 0, 0.025, 0, 0x4f7f3d);
      for (const x of [-0.02, 0, 0.02]) b.box(0.008, 0.006, 0.008, x, 0.036, 0, [0xd8453b, 0xe0a021, 0xe07fb0][Math.round(x * 50 + 1)]);
    }),
    make(7, b => { // post box
      b.box(0.022, 0.05, 0.018, 0, 0, 0, 0xc8382f);
      b.box(0.024, 0.006, 0.02, 0, 0.05, 0, 0xa82e27);
      b.box(0.014, 0.003, 0.002, 0, 0.038, 0.01, 0x2a2f36);
    }),
    make(8, b => { // bollards
      for (const x of [-0.04, 0, 0.04]) { b.cyl(0.005, 0.035, x, 0, 0, 0x4a5056, 6); b.cyl(0.0055, 0.004, x, 0.028, 0, 0xe8e2d2, 6); }
    }),
    make(9, b => { // bus shelter
      b.box(0.16, 0.004, 0.05, 0, 0.1, 0, 0x5d6469);
      b.box(0.16, 0.09, 0.004, 0, 0.01, -0.024, 0xa9cbd8);
      for (const x of [-0.078, 0.078]) b.box(0.004, 0.1, 0.05, x, 0, 0, 0x5d6469);
      b.box(0.1, 0.006, 0.02, 0, 0.03, -0.012, 0x8a6240);
      b.box(0.004, 0.13, 0.004, 0.1, 0, 0.02, 0x5d6469);
      b.box(0.03, 0.03, 0.004, 0.1, 0.1, 0.02, 0x2f6fb7);
    }),
  ];
}
/** Which piece goes where: a mix weighted towards trees, bins and benches. */
const MIX = [3, 3, 3, 0, 0, 1, 1, 2, 4, 5, 6, 7];
const SHELTER = 8;

/**
 * The small things at the kerb that only matter at eye level: benches, bins, hydrants, street trees,
 * bike racks, planters, post boxes and bollards, plus a shelter at every bus stop. They sit on the
 * outer edge of the pavement, clear of the walking line, and are shown only on the street.
 */
export class StreetFurnitureLayer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private net: Network | null = null;
  private version = -1;
  private stops = '';

  constructor() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.meshes = pieces().map(g => {
      const m = new THREE.InstancedMesh(g, mat, CAP);
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      this.group.add(m);
      return m;
    });
    this.group.visible = false;
  }

  setVisible(on: boolean): void { this.group.visible = on; }

  rebuild(net: Network, kind: Uint8Array, raster: { accSeg: Int32Array; accX: Float32Array; accZ: Float32Array }): void {
    let stops = '';
    for (let i = 0; i < N_TILES; i++) if (kind[i] === T_BUS) stops += i + ',';
    if (net === this.net && net.version === this.version && stops === this.stops) return;
    this.net = net; this.version = net.version; this.stops = stops;
    const counts = this.meshes.map(() => 0), obj = new THREE.Object3D(), half = GRID / 2;
    const put = (type: number, x: number, y: number, z: number, facing: number): void => {
      if (counts[type] >= CAP) return;
      obj.position.set(x, y, z); obj.rotation.set(0, facing, 0); obj.updateMatrix();
      this.meshes[type].setMatrixAt(counts[type]++, obj.matrix);
    };
    for (const seg of net.segs.values()) {
      if (seg.structure || seg.kind === KIND_HIGHWAY) continue;
      const off = HALF_WIDTH[seg.kind] + 0.078;
      const gap = seg.kind === KIND_AVENUE ? 0.55 : 0.8;
      for (const side of [-1, 1]) {
        // Leave the corners clear, where the pavements meet at the junction.
        for (let s = 0.7, n = 0; s < seg.len - 0.7; s += gap, n++) {
          const h = tileHash(seg.id * 131 + n * 17 + (side > 0 ? 7 : 0));
          if (h < 0.35) continue;
          const at = sample(seg, s);
          const x = at.x - at.tz * off * side - half, z = at.z + at.tx * off * side - half;
          // Turn each piece to face the road: its +z towards the centre line.
          const facing = Math.atan2(at.tz * side, -at.tx * side);
          put(MIX[Math.floor(h * 1000) % MIX.length], x, CURB_TOP, z, facing);
        }
      }
    }
    // A shelter on the kerb in front of each bus stop.
    for (let i = 0; i < N_TILES; i++) {
      if (kind[i] !== T_BUS || raster.accSeg[i] < 0) continue;
      const cx = i % GRID + 0.5, cz = Math.floor(i / GRID) + 0.5;
      const dx = raster.accX[i] - cx, dz = raster.accZ[i] - cz, d = Math.hypot(dx, dz) || 1;
      const seg = net.segs.get(raster.accSeg[i]);
      const back = seg ? HALF_WIDTH[seg.kind] + 0.08 : 0.44;
      put(SHELTER, raster.accX[i] - dx / d * back - half, CURB_TOP + (seg ? roadHeight(seg, 0) : 0), raster.accZ[i] - dz / d * back - half, Math.atan2(dx, dz));
    }
    this.meshes.forEach((m, t) => { m.count = counts[t]; m.instanceMatrix.needsUpdate = true; });
  }
}
