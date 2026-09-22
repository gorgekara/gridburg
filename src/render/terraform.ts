import * as THREE from 'three';
import { GRID, N_TILES } from '../constants';
import { DUG, FILLED, hillLevel } from '../extras';
import { MeshBuilder } from './meshBuilder';

const POND = 0x3f8fa6;
const BANK = 0xcdbf8f;
const FILL = 0x7a9d5c;

/**
 * Ground the player has shaped. Dug cells are drawn as still water in a sandy rim; filled cells as
 * a raised patch of grass laid over the river where it used to run.
 */
export class TerraformLayer {
  readonly group = new THREE.Group();
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  private water = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }));
  private signature = '';

  constructor() {
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh, this.water);
  }

  /** `river` is the water as generated: raised ground standing in it needs a bank drawn under the hill. */
  rebuild(edits: Uint8Array, river?: Uint8Array): void {
    let signature = '';
    for (let i = 0; i < N_TILES; i++) if (edits[i]) signature += `${i}:${edits[i]},`;
    if (signature === this.signature) return;
    this.signature = signature;
    const ground = new MeshBuilder(), water = new MeshBuilder(), half = GRID / 2;
    const quad = (b: MeshBuilder, x: number, z: number, size: number, y: number, color: number): void => {
      b.ribbon([x - half + 0.5, z - half + 0.5 - size / 2, x - half + 0.5, z - half + 0.5 + size / 2], 2, size / 2, y, color);
    };
    const edited = (x: number, z: number, v: number): boolean => x >= 0 && z >= 0 && x < GRID && z < GRID && edits[z * GRID + x] === v;
    for (let i = 0; i < N_TILES; i++) {
      const x = i % GRID, z = Math.floor(i / GRID);
      if (edits[i] === DUG) {
        quad(ground, x, z, 1.0, 0.004, BANK);
        // The water runs to the cell edge where the next cell is also water, and leaves a rim elsewhere.
        const l = edited(x - 1, z, DUG) ? 0.5 : 0.4, r = edited(x + 1, z, DUG) ? 0.5 : 0.4;
        const u = edited(x, z - 1, DUG) ? 0.5 : 0.4, d = edited(x, z + 1, DUG) ? 0.5 : 0.4;
        const cx = x - half + 0.5 + (r - l) / 2, cz = z - half + 0.5 + (d - u) / 2;
        water.ribbon([cx, cz - (u + d) / 2, cx, cz + (u + d) / 2], 2, (l + r) / 2, 0.012, POND);
      } else if (edits[i] === FILLED || (hillLevel(edits[i]) > 0 && river?.[i])) {
        quad(ground, x, z, 1.04, 0.019, FILL);
      }
    }
    this.mesh.geometry.dispose(); this.mesh.geometry = ground.build();
    this.water.geometry.dispose(); this.water.geometry = water.build();
  }
}
