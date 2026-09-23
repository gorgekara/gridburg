import * as THREE from 'three';
import { GRID, N_TILES } from '../constants';
import { WATER, waterMaterial, bedMaterial } from './river';
import { waterUniforms } from './waves';
import type { Terrain } from '../terrain';

/** Grid points per tile: the sheet is sampled finer than the tiles so its shoreline curves rather than steps. */
const R = 2;
const W = GRID * R + 1;
const BED = new THREE.Color(0x4f5c55);
const MURKY = new THREE.Color(0x6e5b2f);

/**
 * Every water surface on the map: the river in its channel, a lake backed up over the banks, a
 * flood spreading across the land, a dug basin filling. It is the same moving water everywhere, on
 * a bed of wet ground, laid as one sheet whose height and depth are interpolated between tiles and
 * feathered to nothing at the shore, so it pools and creeps like water rather than stacking up in
 * tiles. The current drifts downstream along the river and carries on in that direction off it.
 */
export class WaterLayer {
  readonly group = new THREE.Group();
  private water: THREE.Mesh;
  private bed: THREE.Mesh;
  private time = waterUniforms.riverTime;
  private positions = new Float32Array(W * W * 3);
  private bedPositions = new Float32Array(W * W * 3);
  private colors = new Float32Array(W * W * 4);
  private bedColors = new Float32Array(W * W * 4);
  private uv = new Float32Array(W * W * 2);
  private indices = new Uint32Array(GRID * R * GRID * R * 6);
  private depthT = new Float32Array(N_TILES);
  private surfT = new Float32Array(N_TILES);
  private wetT = new Float32Array(N_TILES);
  /** The water level nearest each dry tile, so the sheet's fringe lies level with it rather than dropping into the ground. */
  private nearT = new Float32Array(N_TILES);
  private smoothT = new Float32Array(N_TILES);
  private tintT = new Float32Array(N_TILES * 3);
  /** Distance downstream, per tile: along the river for river tiles, the nearest river's for the rest. */
  private alongT = new Float32Array(N_TILES);
  private flow: Int16Array | null = null;

  constructor() {
    const make = (positions: Float32Array, colors: Float32Array, material: THREE.Material): THREE.Mesh => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('riverUV', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
      g.setIndex(new THREE.BufferAttribute(this.indices, 1));
      g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, material);
      m.frustumCulled = false;
      m.visible = false;
      return m;
    };
    // Wet ground under the sheet: dark mud, fading out with the water.
    this.bed = make(this.bedPositions, this.bedColors, bedMaterial(true));
    this.bed.renderOrder = -2;
    this.water = make(this.positions, this.colors, waterMaterial(8));
    this.water.renderOrder = -1;
    this.water.receiveShadow = true;
    this.group.add(this.bed, this.water);
  }

  update(seconds: number): void { this.time.value = seconds; }

  /** Learn the river's course once per map: which way is downstream, everywhere. */
  setTerrain(t: Terrain): void {
    this.flow = t.flow;
    const along = this.alongT, queue: number[] = [];
    along.fill(NaN);
    for (let i = 0; i < N_TILES; i++) if (t.flow[i] >= 0) { along[i] = t.flow[i] * 0.5; queue.push(i); }
    // Everything else takes the value of the nearest river tile, so a flood's current runs the river's way.
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q], x = i % GRID, z = (i / GRID) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
        const n = nz * GRID + nx;
        if (along[n] !== along[n]) { along[n] = along[i]; queue.push(n); }
      }
    }
    for (let i = 0; i < N_TILES; i++) if (along[i] !== along[i]) along[i] = ((i % GRID) + ((i / GRID) | 0)) * 0.6;
  }

  /**
   * `surface` is the water height of every tile holding water (NaN elsewhere); `levels` gives the
   * ground beneath; `pollution` is the river's dirtiness per sample downstream, which tints it.
   */
  rebuild(surface: Float32Array | null, levels: { ground: Float32Array }, pollution?: Uint8Array): void {
    if (!surface) { this.water.visible = this.bed.visible = false; return; }
    const { depthT, surfT, wetT, tintT, flow } = this;
    let any = false;
    const tint = new THREE.Color();
    for (let i = 0; i < N_TILES; i++) {
      const h = surface[i], wet = h === h;
      depthT[i] = wet ? Math.max(0, h - levels.ground[i]) : 0;
      surfT[i] = wet ? h : 0;
      wetT[i] = wet ? 1 : 0;
      if (wet) any = true;
      const f = flow ? flow[i] : -1, dirt = f >= 0 && pollution && pollution.length ? Math.min(1, pollution[Math.min(pollution.length - 1, f)] / 255 * 1.2) : 0;
      tint.copy(WATER).lerp(MURKY, dirt);
      tintT[i * 3] = tint.r; tintT[i * 3 + 1] = tint.g; tintT[i * 3 + 2] = tint.b;
    }
    if (!any) { this.water.visible = this.bed.visible = false; return; }
    // Soften the depth from tile to tile before sampling it, so the shoreline curves instead of
    // following the tiles' staircase.
    const { smoothT, nearT } = this;
    for (let i = 0; i < N_TILES; i++) {
      const x = i % GRID, z = (i / GRID) | 0;
      let sum = 0, weight = 0, level = -Infinity;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
        const n = nz * GRID + nx, w = (dx === 0 ? 2 : 1) * (dz === 0 ? 2 : 1);
        sum += depthT[n] * w; weight += w;
        if (wetT[n]) level = Math.max(level, surfT[n]);
      }
      smoothT[i] = sum / weight;
      nearT[i] = level;
    }
    // Sample the tile fields at every grid point, blending between the four tile centres around it.
    const { positions, bedPositions, colors, bedColors, uv, indices, alongT } = this;
    const alpha = new Float32Array(W * W);
    const half = GRID / 2, last = GRID - 1;
    for (let gz = 0; gz < W; gz++) for (let gx = 0; gx < W; gx++) {
      const fx = gx / R - 0.5, fz = gz / R - 0.5;
      const x0 = Math.max(0, Math.min(last, Math.floor(fx))), z0 = Math.max(0, Math.min(last, Math.floor(fz)));
      const x1 = Math.min(last, x0 + 1), z1 = Math.min(last, z0 + 1);
      const tx = Math.max(0, Math.min(1, fx - x0)), tz = Math.max(0, Math.min(1, fz - z0));
      const w00 = (1 - tx) * (1 - tz), w10 = tx * (1 - tz), w01 = (1 - tx) * tz, w11 = tx * tz;
      const i00 = z0 * GRID + x0, i10 = z0 * GRID + x1, i01 = z1 * GRID + x0, i11 = z1 * GRID + x1;
      const depth = smoothT[i00] * w00 + smoothT[i10] * w10 + smoothT[i01] * w01 + smoothT[i11] * w11;
      // The sheet lies level at the water's own height, taken from the wet tiles alone: where the
      // bank rises through it the ground hides it, which is what a shoreline is.
      const ww = wetT[i00] * w00 + wetT[i10] * w10 + wetT[i01] * w01 + wetT[i11] * w11;
      const nearby = Math.max(nearT[i00], nearT[i10], nearT[i01], nearT[i11]);
      const surf = ww > 0 ? (surfT[i00] * w00 + surfT[i10] * w10 + surfT[i01] * w01 + surfT[i11] * w11) / ww : Number.isFinite(nearby) ? nearby : 0;
      const along = alongT[i00] * w00 + alongT[i10] * w10 + alongT[i01] * w01 + alongT[i11] * w11;
      // The bed lies on the ground, never above it.
      const floor = Math.min(surf - depth, Math.min(levels.ground[i00], levels.ground[i10], levels.ground[i01], levels.ground[i11]) + 0.02);
      const p = gz * W + gx, v = p * 3, c = p * 4;
      // Fade out where the water thins to nothing.
      const a = Math.min(1, depth / 0.08);
      alpha[p] = a;
      positions[v] = gx / R - half; positions[v + 1] = surf + 0.012; positions[v + 2] = gz / R - half;
      bedPositions[v] = positions[v]; bedPositions[v + 1] = floor + 0.007; bedPositions[v + 2] = positions[v + 2];
      const r = tintT[i00 * 3] * w00 + tintT[i10 * 3] * w10 + tintT[i01 * 3] * w01 + tintT[i11 * 3] * w11;
      const g = tintT[i00 * 3 + 1] * w00 + tintT[i10 * 3 + 1] * w10 + tintT[i01 * 3 + 1] * w01 + tintT[i11 * 3 + 1] * w11;
      const b = tintT[i00 * 3 + 2] * w00 + tintT[i10 * 3 + 2] * w10 + tintT[i01 * 3 + 2] * w01 + tintT[i11 * 3 + 2] * w11;
      colors[c] = r; colors[c + 1] = g; colors[c + 2] = b; colors[c + 3] = a * 0.95;
      bedColors[c] = BED.r; bedColors[c + 1] = BED.g; bedColors[c + 2] = BED.b; bedColors[c + 3] = Math.min(1, a * 1.2);
      // The current drifts downstream; the shallows read as the channel's edge.
      uv[p * 2] = along; uv[p * 2 + 1] = 1 - Math.min(1, depth / 0.3);
    }
    let n = 0;
    for (let gz = 0; gz < GRID * R; gz++) for (let gx = 0; gx < GRID * R; gx++) {
      const a = gz * W + gx, b = a + 1, c = a + W, d = c + 1;
      if (alpha[a] <= 0 && alpha[b] <= 0 && alpha[c] <= 0 && alpha[d] <= 0) continue;
      indices[n++] = a; indices[n++] = c; indices[n++] = b;
      indices[n++] = b; indices[n++] = c; indices[n++] = d;
    }
    for (const mesh of [this.water, this.bed]) {
      const g = mesh.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.attributes.riverUV.needsUpdate = true;
      g.index!.needsUpdate = true;
      g.setDrawRange(0, n);
      g.computeVertexNormals();
      mesh.visible = n > 0;
    }
  }
}
