import * as THREE from 'three';
import { GRID, N_TILES } from '../constants';

const RIVER = new THREE.Color(0x2f7fae);
const MURK = new THREE.Color(0x5a7e86);

/**
 * Water standing where the river as drawn does not reach: a lake backed up behind a dam, a swollen
 * river over its banks, floodwater spreading across the land. One sheet whose corners take the
 * average surface height of the wet tiles around them, so it lies smooth rather than in steps.
 */
export class FloodLayer {
  readonly mesh: THREE.Mesh;
  private positions = new Float32Array(N_TILES * 4 * 3);
  private colors = new Float32Array(N_TILES * 4 * 3);
  private indices = new Uint32Array(N_TILES * 6);
  private corner = new Float32Array((GRID + 1) * (GRID + 1));
  private corners = new Uint8Array((GRID + 1) * (GRID + 1));
  private time = { value: 0 };

  constructor() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));
    geometry.setDrawRange(0, 0);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.uniforms.floodTime = this.time;
      shader.vertexShader = 'uniform float floodTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += sin(floodTime * 1.7 + position.x * 2.3 + position.z * 1.9) * 0.006;');
    };
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
  }

  update(seconds: number): void { this.time.value = seconds; }

  /** `surface` is the water height per tile, NaN where nothing is to be drawn; `river` marks the tiles that are river to begin with. */
  rebuild(surface: Float32Array | null, river: Uint8Array): void {
    if (!surface) { this.mesh.visible = false; return; }
    const { corner, corners, positions, colors, indices } = this;
    corner.fill(0); corners.fill(0);
    const W = GRID + 1;
    for (let i = 0; i < N_TILES; i++) {
      const h = surface[i];
      if (h !== h) continue;
      const x = i % GRID, z = (i / GRID) | 0;
      for (const c of [z * W + x, z * W + x + 1, (z + 1) * W + x, (z + 1) * W + x + 1]) { corner[c] += h; corners[c]++; }
    }
    const half = GRID / 2;
    let v = 0, n = 0, quads = 0;
    for (let i = 0; i < N_TILES; i++) {
      const h = surface[i];
      if (h !== h) continue;
      const x = i % GRID, z = (i / GRID) | 0;
      const tint = river[i] ? RIVER : MURK;
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const c = (z + dz) * W + x + dx;
        positions[v] = x + dx - half; positions[v + 1] = corner[c] / corners[c] + 0.012; positions[v + 2] = z + dz - half;
        colors[v] = tint.r; colors[v + 1] = tint.g; colors[v + 2] = tint.b;
        v += 3;
      }
      const b = quads * 4;
      indices[n++] = b; indices[n++] = b + 2; indices[n++] = b + 1;
      indices[n++] = b + 1; indices[n++] = b + 2; indices[n++] = b + 3;
      quads++;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.index!.needsUpdate = true;
    g.setDrawRange(0, n);
    g.computeVertexNormals();
    this.mesh.visible = quads > 0;
  }
}
