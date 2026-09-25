import * as THREE from 'three';
import { sideHalf, roadHalf } from '../roads/lanes';
import { GRID } from '../constants';
import { Network, canAddBikeLane } from '../roads/network';
import type { RSeg } from '../roads/network';
import { MeshBuilder } from './meshBuilder';

// Paint the outer asphalt: shifted building lots start just beyond the curb.
// A compact strip leaves the existing motor lanes and their vehicle bodies clear.
export const BIKE_TRACK_HALF = 0.025;
export const BIKE_TRACK_OFFSET = -0.035;
const GREEN = 0x32966c, WHITE = 0xe4f3de;

/** Static, merged geometry: one draw call for every track and its markings. */
export class BikeLaneLayer {
  readonly group = new THREE.Group();
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }));
  private version = -1;
  private network: Network | null = null;

  constructor() {
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  rebuild(net: Network): void {
    if (this.network === net && this.version === net.version) return;
    this.network = net;
    this.version = net.version;
    const b = new MeshBuilder(), half = GRID / 2;
    const pose = { x: 0, z: 0, tx: 0, tz: 0 };
    const trim = (s: RSeg, id: number): number => {
      if (net.degree(id) <= 1) return 0.25;
      let width = roadHalf(s);
      for (const other of net.segsAt(id)) width = Math.max(width, roadHalf(other));
      // Stop before intersection paving/crosswalks; no implied priority across junctions.
      return width + 0.85;
    };
    for (const s of net.segs.values()) {
      if (!s.bike || !canAddBikeLane(s, net)) continue;
      const start = trim(s, s.a), end = s.len - trim(s, s.b);
      if (end - start < 0.35) continue;
      const count = Math.ceil((end - start) / 0.22) + 1;
      const pts: number[] = [];
      for (let i = 0; i < count; i++) {
        Network.poseAt(s, start + (end - start) * i / (count - 1), pose);
        pts.push(pose.x - half, pose.z - half);
      }
      for (const side of [-1, 1]) {
        const offset = side * (sideHalf(s, side) + BIKE_TRACK_OFFSET);
        b.ribbon(pts, count, BIKE_TRACK_HALF, 0.051, GREEN, offset);
        b.ribbon(pts, count, 0.002, 0.054, WHITE, offset - side * 0.021);
        // Repeated compact bicycle pictograms: two wheels, frame and handlebars.
        for (let d = start + 0.65; d < end - 0.4; d += 3.8) {
          Network.poseAt(s, d, pose);
          const tx = pose.tx * side, tz = pose.tz * side;
          const cx = pose.x - half - pose.tz * offset, cz = pose.z - half + pose.tx * offset;
          const point = (along: number, across: number): [number, number] => [cx + (tx * along - tz * across) * 0.27, cz + (tz * along + tx * across) * 0.27];
          const line = (a: [number, number], c: [number, number]): void => { b.ribbon([...a, ...c], 2, 0.002, 0.055, WHITE); };
          for (const along of [-0.12, 0.12]) {
            const [x, z] = point(along, 0);
            b.ring(x, z, 0.00945, 0.01269, 0.055, WHITE, 10);
          }
          line(point(-0.12, 0), point(-0.04, 0.055));
          line(point(-0.04, 0.055), point(0.045, 0));
          line(point(0.045, 0), point(-0.12, 0));
          line(point(-0.04, 0.055), point(0.07, 0.055));
          line(point(0.07, 0.055), point(0.12, 0));
          line(point(0.07, 0.055), point(0.06, 0.073));
          line(point(0.03, 0.073), point(0.09, 0.073));
          const [x, z] = point(0.33, 0);
          b.arrow(x, z, tx, tz, 0.0189, 0.055, WHITE);
        }
      }
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = b.build();
  }
}
