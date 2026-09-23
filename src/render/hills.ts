import * as THREE from 'three';
import { GRID, N_TILES } from '../constants';
import type { Terrain } from '../terrain';
import { riverSamples, riverDistance, landscapeHeight } from './landscape';

/** Vertices per cell along each axis: fine enough for a rounded mound, coarse enough to rebuild often. */
const RES = 2;
/** How far beyond the map the relief reaches, so the river's channel carries on off it in the same style. */
const MARGIN = 24;
/** Half the width of the ground the relief covers, in world units from the map's centre. */
export const RELIEF_EXTENT = GRID / 2 + MARGIN;
const SPAN = GRID + 2 * MARGIN;
export const RELIEF_SIZE = SPAN * RES + 1;
const SIZE = RELIEF_SIZE;
/** Where the relief mesh sinks under the ground so it neither fights with it nor shows. */
const HIDDEN = -0.03;
/** How far under the landscape's own surface the unused relief sits, so it never shows through it. */
const UNDER = 0.15;

/**
 * The relief of the valley floor: the river's channel, whatever the player has dug, and whatever
 * they have piled up. On the map the tile heights come from the water simulation's ground; beyond
 * it the river's channel is cut to the same depth along the river's course into the hills. The
 * field is blurred into rounded banks, mounds, ridges and basins and drawn as one mesh over the
 * ground, shaded from grass at the foot to bare rock on the highest tops, and from earth on a
 * channel's walls to gravel on its bed. The ground is cut away wherever the field dips below it,
 * so the channels and pits show through.
 */
export class HillLayer {
  readonly group = new THREE.Group();
  /** The cut field as a texture (relative to the ground), for the ground to cut its holes by. */
  readonly pitTexture: THREE.DataTexture;
  private mesh: THREE.Mesh;
  /** The blurred field, relative to the ground under it. */
  private heights = new Float32Array(SIZE * SIZE);
  /** The ground under each point: flat on the map, the landscape beyond it. */
  private base = new Float32Array(SIZE * SIZE);
  /** The river's channel beyond the map, cut once per map. */
  private offCut = new Float32Array(SIZE * SIZE);
  /** The seed's own hills under each point. */
  private rawBase = new Float32Array(SIZE * SIZE);
  /** The landscape's surface under each point, channel and all: unused relief tucks in beneath it. */
  private under = new Float32Array(SIZE * SIZE);
  private signature = '';

  constructor() {
    const geo = new THREE.PlaneGeometry(SPAN, SPAN, SIZE - 1, SIZE - 1);
    geo.rotateX(-Math.PI / 2);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(SIZE * SIZE * 3), 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    this.pitTexture = new THREE.DataTexture(this.heights, SIZE, SIZE, THREE.RedFormat, THREE.FloatType);
    this.pitTexture.minFilter = this.pitTexture.magFilter = THREE.LinearFilter;
    this.pitTexture.needsUpdate = true;
  }

  /** Relief height relative to the ground at scene coordinates (x, z): negative in a pit or channel. */
  heightAt(x: number, z: number): number {
    if (!this.mesh.visible) return 0;
    const gx = (x + RELIEF_EXTENT) * RES, gz = (z + RELIEF_EXTENT) * RES;
    const ix = Math.max(0, Math.min(SIZE - 2, Math.floor(gx))), iz = Math.max(0, Math.min(SIZE - 2, Math.floor(gz)));
    const fx = Math.max(0, Math.min(1, gx - ix)), fz = Math.max(0, Math.min(1, gz - iz));
    const h = (px: number, pz: number): number => this.heights[pz * SIZE + px];
    return (h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz) + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz;
  }

  /**
   * Cut the river's channel beyond the map, once per map: as deep as the bed is where the river
   * enters (`floor.before`) and leaves (`floor.after`), following the river's course into the hills.
   */
  setTerrain(t: Terrain, floor: { before: number; after: number }): void {
    const samples = riverSamples(t);
    const { rawBase, offCut, under } = this;
    // A map without a river has nothing to carve beyond its edge, and no hills of its own.
    if (!samples.length) { rawBase.fill(0); offCut.fill(0); under.fill(0); this.applyBase(); return; }
    // Where the river crosses the map edge on its way in (if it comes from outside at all) and on its
    // way out: the channel beyond each crossing keeps the depth the bed has there.
    const inside = (p: { x: number; z: number }): boolean => Math.abs(p.x) < GRID / 2 && Math.abs(p.z) < GRID / 2;
    const from = samples.findIndex(inside), to = samples.length - 1 - [...samples].reverse().findIndex(inside);
    const entry = from > 0 ? samples[from] : null, exit = samples[Math.max(0, to)];
    for (let gz = 0; gz < SIZE; gz++) for (let gx = 0; gx < SIZE; gx++) {
      const i = gz * SIZE + gx, x = gx / RES - RELIEF_EXTENT, z = gz / RES - RELIEF_EXTENT;
      under[i] = landscapeHeight(x, z, t.seed, samples) - 0.025;
      if (Math.abs(x) <= GRID / 2 && Math.abs(z) <= GRID / 2) { rawBase[i] = 0; offCut[i] = 0; continue; }
      rawBase[i] = landscapeHeight(x, z, t.seed, samples, false);
      // Full depth inside the channel, sloping up to the bank over a cell and a half either side.
      const { distance } = riverDistance(x, z, samples);
      const s = Math.max(0, Math.min(1, (0.8 - distance) / 1.6));
      const nearer = entry && Math.hypot(x - entry.x, z - entry.z) < Math.hypot(x - exit.x, z - exit.z) ? floor.before : floor.after;
      // The landscape carves the channel beyond the map itself; the relief only blends into it at the edge.
      // Carried on past the edge only so the blur keeps the channel full depth up to it.
      offCut[i] = nearer * s * s * (3 - 2 * s);
    }
    this.applyBase();
  }

  private applyBase(): void {
    for (let gz = 0; gz < SIZE; gz++) for (let gx = 0; gx < SIZE; gx++) {
      const i = gz * SIZE + gx;
      this.base[i] = this.rawBase[i];
    }
    this.signature = '';
  }

  /**
   * `ground` is the height of every tile as the water simulation sees it: the river bed below the
   * bank, dug ground below it too, hills above, filled ground level. The river's channel is cut the
   * same way as anything the player digs.
   */
  rebuild(ground: Float32Array): void {
    let hash = 0;
    for (let i = 0; i < N_TILES; i++) hash = (Math.imul(hash, 31) + Math.round(ground[i] * 100)) | 0;
    const signature = `${hash}`;
    if (signature === this.signature) return;
    this.signature = signature;
    // Sample the per-cell levels onto the fine grid, then blur for rounded shoulders and basins.
    let field = new Float32Array(SIZE * SIZE);
    for (let gz = 0; gz < SIZE; gz++) for (let gx = 0; gx < SIZE; gx++) {
      const tx = Math.floor((gx - 0.5) / RES) - MARGIN, tz = Math.floor((gz - 0.5) / RES) - MARGIN;
      const i = gz * SIZE + gx;
      field[i] = tx >= 0 && tz >= 0 && tx < GRID && tz < GRID ? ground[tz * GRID + tx] : this.offCut[i];
    }
    for (let pass = 0; pass < 5; pass++) {
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
    // A little roughness so a ridge is not a perfect dome, nor a basin a perfect bowl.
    for (let gz = 0; gz < SIZE; gz++) for (let gx = 0; gx < SIZE; gx++) {
      const i = gz * SIZE + gx;
      if (Math.abs(field[i]) > 0.05) field[i] *= 1 + 0.12 * Math.sin(gx * 1.7 + gz * 0.9) * Math.cos(gz * 1.3 - gx * 0.4);
    }
    this.heights.set(field);
    this.pitTexture.needsUpdate = true;
    const geo = this.mesh.geometry, p = geo.getAttribute('position'), c = geo.getAttribute('color'), color = new THREE.Color();
    const grass = new THREE.Color(0x729958), scrub = new THREE.Color(0x9c9a62), rock = new THREE.Color(0x8d8a80);
    const earth = new THREE.Color(0x7a6647), gravel = new THREE.Color(0x718b80), meadow = new THREE.Color(0x9eb878);
    let top = 0, shown = false;
    for (let i = 0; i < p.count; i++) top = Math.max(top, field[i]);
    for (let i = 0; i < p.count; i++) {
      const h = field[i], visible = h > 0.02 || h < HIDDEN;
      shown ||= visible;
      // Under the ground wherever there is neither hill nor pit, so the mesh never shows through it.
      // Beyond the map the landscape mesh is far coarser than this one, so it has to sink further.
      // Beyond the map the landscape carves the channel itself, so the relief stops at the edge; and
      // wherever the relief is not in use it tucks in just under the landscape's own surface.
      const gx = i % SIZE, gz = Math.floor(i / SIZE), outside = Math.abs(gx / RES - RELIEF_EXTENT) > GRID / 2 + 0.5 || Math.abs(gz / RES - RELIEF_EXTENT) > GRID / 2 + 0.5;
      const tucked = this.under[i] < HIDDEN ? Math.min(this.base[i] + HIDDEN, this.under[i] - UNDER) : this.base[i] + HIDDEN;
      // The landscape is cut flat along the road corridors, so beyond the map the relief hides under
      // the lower of the landscape's surface and level ground; only a channel takes it below level.
      p.setY(i, outside ? Math.min(this.under[i], 0) - UNDER : visible ? this.base[i] + h : tucked);
      // The same patchy grass as the landscape around it, so the relief's edge does not show.
      const wx = gx / RES - RELIEF_EXTENT, wz = gz / RES - RELIEF_EXTENT, patch = (Math.sin(wx * 0.21) * Math.cos(wz * 0.17) + 1) / 2;
      grass.setHex(0x729958).lerp(meadow, patch * 0.48);
      if (h < 0) {
        // Grass at the lip, earth down the wall, gravel on the floor.
        const d = -h;
        color.copy(grass).lerp(earth, Math.min(1, Math.max(0, d - 0.04) / 0.5)).lerp(gravel, Math.max(0, Math.min(1, (d - 0.9) / 0.8)));
      } else {
        const t = top > 0 ? h / top : 0;
        color.copy(grass).lerp(scrub, Math.min(1, t * 1.6)).lerp(rock, Math.max(0, (t - 0.6) / 0.4));
      }
      c.setXYZ(i, color.r, color.g, color.b);
    }
    p.needsUpdate = true; c.needsUpdate = true;
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    this.mesh.visible = shown;
  }
}
