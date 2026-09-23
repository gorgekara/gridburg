import * as THREE from 'three';
import { GRID, N_TILES } from '../constants';
import { FILLED, hillLevel } from '../extras';
import { MeshBuilder } from './meshBuilder';

const FILL = 0x7a9d5c;

/**
 * Ground the player has filled in: a raised patch of grass laid over the river where it used to
 * run, and a bank under any hill raised in it. Dug ground is cut by the hill layer and its water
 * drawn by the water layers.
 */
export class TerraformLayer {
  readonly group = new THREE.Group();
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  private signature = '';

  constructor() {
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
  }

  /** `river` is the water as generated: raised ground standing in it needs a bank drawn under the hill. */
  rebuild(edits: Uint8Array, river?: Uint8Array): void {
    let signature = '';
    for (let i = 0; i < N_TILES; i++) if (edits[i]) signature += `${i}:${edits[i]},`;
    if (signature === this.signature) return;
    this.signature = signature;
    const ground = new MeshBuilder(), half = GRID / 2;
    const quad = (b: MeshBuilder, x: number, z: number, size: number, y: number, color: number): void => {
      b.ribbon([x - half + 0.5, z - half + 0.5 - size / 2, x - half + 0.5, z - half + 0.5 + size / 2], 2, size / 2, y, color);
    };
    for (let i = 0; i < N_TILES; i++) {
      const x = i % GRID, z = Math.floor(i / GRID);
      if (edits[i] === FILLED || (hillLevel(edits[i]) > 0 && river?.[i])) {
        quad(ground, x, z, 1.04, 0.019, FILL);
      }
    }
    this.mesh.geometry.dispose(); this.mesh.geometry = ground.build();
  }
}
