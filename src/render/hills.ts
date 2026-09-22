import * as THREE from 'three';
import { GRID, N_TILES } from '../constants';
import { hillLevel, HILL_STEP } from '../extras';

/** Vertices per cell along each axis: fine enough for a rounded mound, coarse enough to rebuild often. */
const RES = 2;
const SIZE = GRID * RES + 1;

/**
 * Earth the player has piled up. Each raised cell contributes a storey of height; the field is
 * blurred into rounded mounds and ridges and drawn as one mesh over the valley floor, shaded from
 * grass at the foot to bare rock on the highest tops.
 */
export class HillLayer {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private heights = new Float32Array(SIZE * SIZE);
  private signature = '';

  constructor() {
    const geo = new THREE.PlaneGeometry(GRID, GRID, SIZE - 1, SIZE - 1);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(SIZE * SIZE * 3), 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** Ground height above the valley floor at scene coordinates (x, z). */
  heightAt(x: number, z: number): number {
    if (!this.mesh.visible) return 0;
    const gx = (x + GRID / 2) * RES, gz = (z + GRID / 2) * RES;
    const ix = Math.max(0, Math.min(SIZE - 2, Math.floor(gx))), iz = Math.max(0, Math.min(SIZE - 2, Math.floor(gz)));
    const fx = Math.max(0, Math.min(1, gx - ix)), fz = Math.max(0, Math.min(1, gz - iz));
    const h = (px: number, pz: number): number => this.heights[pz * SIZE + px];
    return (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz) + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz;
  }

  rebuild(terraform: Uint8Array): void {
    let signature = '';
    for (let i = 0; i < N_TILES; i++) if (hillLevel(terraform[i])) signature += `${i}:${terraform[i]},`;
    if (signature === this.signature) return;
    this.signature = signature;
    if (!signature) { this.mesh.visible = false; this.heights.fill(0); return; }
    // Sample the per-cell levels onto the fine grid, then blur twice for rounded shoulders.
    let field = new Float32Array(SIZE * SIZE);
    for (let gz = 0; gz < SIZE; gz++) for (let gx = 0; gx < SIZE; gx++) {
      const tx = Math.min(GRID - 1, Math.floor((gx - 0.5) / RES)), tz = Math.min(GRID - 1, Math.floor((gz - 0.5) / RES));
      field[gz * SIZE + gx] = hillLevel(terraform[Math.max(0, tz) * GRID + Math.max(0, tx)]) * HILL_STEP;
    }
    for (let pass = 0; pass < 3; pass++) {
      const out = new Float32Array(SIZE * SIZE);
      for (let gz = 0; gz < SIZE; gz++) for (let gx = 0; gx < SIZE; gx++) {
        let sum = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const x = gx + dx, z = gz + dz;
          if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) continue;
          sum += field[z * SIZE + x]; n++;
        }
        out[gz * SIZE + gx] = sum / n;
      }
      field = out;
    }
    // A little roughness so a ridge is not a perfect dome.
    for (let gz = 0; gz < SIZE; gz++) for (let gx = 0; gx < SIZE; gx++) {
      const i = gz * SIZE + gx;
      if (field[i] > 0.05) field[i] *= 1 + 0.12 * Math.sin(gx * 1.7 + gz * 0.9) * Math.cos(gz * 1.3 - gx * 0.4);
    }
    this.heights = field;
    const geo = this.mesh.geometry, p = geo.getAttribute('position'), c = geo.getAttribute('color'), color = new THREE.Color();
    const grass = new THREE.Color(0x729958), scrub = new THREE.Color(0x9c9a62), rock = new THREE.Color(0x8d8a80);
    let top = 0;
    for (let i = 0; i < p.count; i++) top = Math.max(top, field[i]);
    for (let i = 0; i < p.count; i++) {
      const h = field[i];
      // Sink below the floor where there is no hill, so the mesh never shows through flat ground.
      p.setY(i, h > 0.02 ? h : -0.3);
      const t = top > 0 ? h / top : 0;
      color.copy(grass).lerp(scrub, Math.min(1, t * 1.6)).lerp(rock, Math.max(0, (t - 0.6) / 0.4));
      c.setXYZ(i, color.r, color.g, color.b);
    }
    p.needsUpdate = true; c.needsUpdate = true;
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    this.mesh.visible = true;
  }
}
