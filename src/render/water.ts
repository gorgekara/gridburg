import * as THREE from 'three';
import { GRID, idx } from '../constants';
import type { Terrain } from '../terrain';
import { riverSamples, riverDistance } from './landscape';

/**
 * Open water — seas, lakes and the flooded half of a coastal map — drawn from the
 * `terrain.water` tile mask. The river keeps its own ribbon (see river.ts); this layer
 * covers every water tile and simply sits under it.
 *
 * Two flat sheets of greedy-merged quads carry the whole thing:
 *   - the sand fringe at BEACH_Y, over land tiles within SAND_REACH of water
 *   - the water surface at WATER_Y, over water tiles (dilated by one tile, see below)
 *
 * Neither sheet stores per-tile detail. A small signed distance field (tiles from the
 * shoreline, positive in water) is uploaded as a texture and sampled per fragment, which
 * gives three things for free: the drawn edge is the bilinear zero-contour of that field,
 * so it follows the tile boundary with marching-squares corners instead of hard stair
 * steps; depth darkens away from the shore; and the sand blends into the grass colour the
 * landscape uses. Because that contour can bulge up to half a tile into a land tile at a
 * concave corner, the water sheet covers a one-tile dilation of the mask and discards
 * wherever the field says land.
 */

// The river ribbon draws its bank at y=0.006 and its water at y=0.014; staying below both
// keeps the river on top where the two meet, with gaps wide enough to survive the depth
// buffer at full zoom-out (camera far/near is 400/0.5, max orbit distance 170).
export const BEACH_Y = 0.002;
export const WATER_Y = 0.008;

/** How far inland the sand reaches, in tiles, before it dissolves into grass. */
const SAND_REACH = 2.6;
/** How far the sand carries on under the water, so the rounded shoreline shows wet beach in its corners. */
const SAND_WET = 1.2;
/** Half a tile diagonal, the most a tile can render outside the band its centre falls in. */
const SLACK = 0.75;
/** Tiles of replicated coastline kept outside the grid so the field stays valid under the skirt. */
const PAD = 8;
const FIELD = GRID + PAD * 2;
/** Signed distances are stored as a byte over this range, giving 1/16 of a tile of precision. */
const FIELD_RANGE = 8;
/** The landscape mesh spans 360 units; open water at the map edge runs out to meet it. */
const HORIZON = 180;

const WATER_COLOR = 0x2f7fae;
const SAND_COLOR = 0xcdbf8f;

export interface WaterField {
  /** Signed distance to the shoreline in tiles at a world point: positive in water, negative on land. */
  at(x: number, z: number): number;
  /** Byte-encoded field, PAD tiles of replicated coastline on every side. */
  data: Uint8Array;
  size: number;
}

/**
 * Chamfer distance transform of the water mask, in tiles from the nearest cell of the other
 * kind. The grid is padded by replicating its edge tiles outward, so a coastline that runs
 * off the map keeps running, which is what the horizon skirt samples.
 */
export function signedWaterField(t: Terrain): WaterField {
  const n = FIELD, wet = new Uint8Array(n * n), d = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    const gz = Math.min(GRID - 1, Math.max(0, z - PAD));
    for (let x = 0; x < n; x++) {
      const gx = Math.min(GRID - 1, Math.max(0, x - PAD));
      wet[z * n + x] = t.water[idx(gx, gz)] ? 1 : 0;
    }
  }
  // Two chamfer passes per side; ~1.5% off true Euclidean, far below what a shoreline shows.
  const D1 = 1, D2 = Math.SQRT2, FAR = 1e6;
  const sweep = (seed: 0 | 1): Float32Array => {
    const f = new Float32Array(n * n);
    for (let i = 0; i < f.length; i++) f[i] = wet[i] === seed ? 0 : FAR;
    const relax = (i: number, j: number, cost: number): void => { if (f[j] + cost < f[i]) f[i] = f[j] + cost; };
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const i = z * n + x;
      if (z > 0) {
        relax(i, i - n, D1);
        if (x > 0) relax(i, i - n - 1, D2);
        if (x < n - 1) relax(i, i - n + 1, D2);
      }
      if (x > 0) relax(i, i - 1, D1);
    }
    for (let z = n - 1; z >= 0; z--) for (let x = n - 1; x >= 0; x--) {
      const i = z * n + x;
      if (z < n - 1) {
        relax(i, i + n, D1);
        if (x > 0) relax(i, i + n - 1, D2);
        if (x < n - 1) relax(i, i + n + 1, D2);
      }
      if (x < n - 1) relax(i, i + 1, D1);
    }
    return f;
  };
  const toLand = sweep(0), toWater = sweep(1);
  for (let i = 0; i < d.length; i++) d[i] = wet[i] ? toLand[i] : -toWater[i];

  // Clamp before encoding, and keep the clamped values so `at` reads exactly what the shader will.
  const data = new Uint8Array(n * n);
  for (let i = 0; i < d.length; i++) {
    d[i] = Math.max(-FIELD_RANGE, Math.min(FIELD_RANGE, d[i]));
    data[i] = Math.round(((d[i] + FIELD_RANGE) / (FIELD_RANGE * 2)) * 255);
  }
  // Bilinear sample in the same frame the shader uses, so CPU and GPU agree on the shoreline.
  const at = (x: number, z: number): number => {
    const u = x + GRID / 2 + PAD - 0.5, v = z + GRID / 2 + PAD - 0.5;
    const x0 = Math.min(n - 1, Math.max(0, Math.floor(u))), z0 = Math.min(n - 1, Math.max(0, Math.floor(v)));
    const x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
    const fx = Math.min(1, Math.max(0, u - x0)), fz = Math.min(1, Math.max(0, v - z0));
    const a = d[z0 * n + x0], b = d[z0 * n + x1], c = d[z1 * n + x0], e = d[z1 * n + x1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (e - c) * fx) * fz;
  };
  return { at, data, size: n };
}

/** Flat, axis-aligned quads accumulated into one indexed geometry. */
class QuadSheet {
  private pos: number[] = [];
  private index: number[] = [];
  get quads(): number { return this.index.length / 6; }
  /** Rectangle from (x0,z0) to (x1,z1) in world units, facing +Y. */
  add(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const v = this.pos.length / 3;
    this.pos.push(x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1);
    this.index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry(), n = this.pos.length / 3;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Greedy tile merge: widest run on the row, then grown downward while the whole run repeats.
 * Thousands of tiles collapse into a handful of rectangles.
 */
function mergeRuns(mask: Uint8Array, out: (x0: number, z0: number, x1: number, z1: number) => void): void {
  const used = new Uint8Array(mask.length);
  for (let z = 0; z < GRID; z++) {
    for (let x = 0; x < GRID; x++) {
      const i = z * GRID + x;
      if (!mask[i] || used[i]) continue;
      let x1 = x;
      while (x1 + 1 < GRID && mask[z * GRID + x1 + 1] && !used[z * GRID + x1 + 1]) x1++;
      let z1 = z;
      grow: while (z1 + 1 < GRID) {
        for (let xx = x; xx <= x1; xx++) {
          const j = (z1 + 1) * GRID + xx;
          if (!mask[j] || used[j]) break grow;
        }
        z1++;
      }
      for (let zz = z; zz <= z1; zz++) for (let xx = x; xx <= x1; xx++) used[zz * GRID + xx] = 1;
      out(x, z, x1 + 1, z1 + 1);
    }
  }
}

/** Runs of set cells along one edge line, as [start, end) tile indices. */
function edgeRuns(mask: Uint8Array, cell: (n: number) => number): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let n = 0; n <= GRID; n++) {
    const on = n < GRID && mask[cell(n)] === 1;
    if (on && start < 0) start = n;
    else if (!on && start >= 0) { runs.push([start, n]); start = -1; }
  }
  return runs;
}

const RIPPLE = `
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // Open water has no current, so two slow crossed octaves rather than the river's downstream drift.
  float wRipple(vec2 p, float t) {
    vec2 a = p * 0.52 + vec2(t * 0.085, -t * 0.061);
    vec2 b = p * 1.31 + vec2(-t * 0.127, t * 0.164) + 4.7;
    return wNoise(a) * 0.62 + wNoise(b) * 0.38;
  }
`;

/** Open sea, bays and lakes rendered from the tile mask, with a sand fringe and a horizon skirt. */
export class WaterLayer {
  readonly group = new THREE.Group();
  private sand: THREE.Mesh;
  private surface: THREE.Mesh;
  private time = { value: 0 };
  private fieldData = new Uint8Array(FIELD * FIELD);
  private field = new THREE.DataTexture(this.fieldData, FIELD, FIELD, THREE.RedFormat);
  private fieldUniform = { value: this.field };
  /** Tiles covered by open water, so callers can skip work on a dry map. */
  waterTiles = 0;

  constructor() {
    this.field.magFilter = THREE.LinearFilter;
    this.field.minFilter = THREE.LinearFilter;
    this.field.wrapS = THREE.ClampToEdgeWrapping;
    this.field.wrapT = THREE.ClampToEdgeWrapping;
    this.field.generateMipmaps = false;
    this.field.unpackAlignment = 1;
    this.field.needsUpdate = true;

    this.sand = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: SAND_COLOR, roughness: 1, side: THREE.DoubleSide }),
    );
    this.surface = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ color: WATER_COLOR, roughness: 0.22, metalness: 0.1, side: THREE.DoubleSide }),
    );

    (this.sand.material as THREE.MeshStandardMaterial).onBeforeCompile = shader => this.compileSand(shader);
    (this.surface.material as THREE.MeshStandardMaterial).onBeforeCompile = shader => this.compileWater(shader);
    for (const m of [this.sand, this.surface]) { m.frustumCulled = false; m.receiveShadow = true; this.group.add(m); }
  }

  private prelude(shader: THREE.WebGLProgramParametersWithUniforms): void {
    shader.uniforms.waterTime = this.time;
    shader.uniforms.waterField = this.fieldUniform;
    shader.vertexShader = 'varying vec2 vWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWorld = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = `uniform float waterTime; uniform sampler2D waterField; varying vec2 vWorld;
      // Tiles from the shoreline; positive in water. Clamped sampling replicates the coast past the map edge.
      float wField(vec2 p) {
        vec2 uv = (p + vec2(${(GRID / 2 + PAD).toFixed(1)})) / ${FIELD.toFixed(1)};
        return texture2D(waterField, uv).r * ${(FIELD_RANGE * 2).toFixed(1)} - ${FIELD_RANGE.toFixed(1)};
      }
    ` + RIPPLE + shader.fragmentShader;
  }

  private compileWater(shader: THREE.WebGLProgramParametersWithUniforms): void {
    this.prelude(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float wd = wField(vWorld);
      if (wd < 0.0) discard;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float shelf = smoothstep(0.0, 4.5, wd);
      vec3 shallow = mix(diffuseColor.rgb, vec3(0.5, 0.78, 0.74), 0.5);
      vec3 deep = diffuseColor.rgb * mix(0.95, 0.46, smoothstep(1.5, 11.0, wd));
      diffuseColor.rgb = mix(shallow, deep, shelf);
      float ripple = wRipple(vWorld, waterTime);
      diffuseColor.rgb += vec3(0.07, 0.10, 0.11) * smoothstep(0.58, 0.84, ripple) * (0.35 + 0.65 * shelf);
      // Surf gathers on the last half tile before the sand.
      float surf = smoothstep(0.8, 0.05, wd) * smoothstep(0.42, 0.74, wNoise(vWorld * 1.7 + vec2(waterTime * 0.4, -waterTime * 0.25)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.92), surf * 0.6);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float we = 0.35, w0 = wRipple(vWorld, waterTime);
      vec2 wg = vec2(wRipple(vWorld + vec2(we, 0.0), waterTime) - w0, wRipple(vWorld + vec2(0.0, we), waterTime) - w0) / we;
      normal = normalize(normal + vec3(wg.x, 0.0, wg.y) * 0.35);`);
  }

  private compileSand(shader: THREE.WebGLProgramParametersWithUniforms): void {
    this.prelude(shader);
    // Sand stops just inside the water, where the surface takes over, and dissolves inland.
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float wd = wField(vWorld);
      if (wd > ${SAND_WET.toFixed(2)} || wd < ${(-SAND_REACH).toFixed(2)}) discard;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 wet = diffuseColor.rgb * 0.62;
      vec3 dry = diffuseColor.rgb * (1.0 + 0.08 * wNoise(vWorld * 2.3));
      vec3 sand = mix(wet, dry, smoothstep(-0.15, 1.1, -wd));
      // The landscape ground colour, in working (linear) space, so the fringe fades into it.
      float patch = (sin(vWorld.x * 0.21) * cos(vWorld.y * 0.17) + 1.0) * 0.5;
      vec3 grass = mix(vec3(0.168, 0.319, 0.098), vec3(0.389, 0.479, 0.188), patch * 0.48);
      diffuseColor.rgb = mix(sand, grass, smoothstep(${(SAND_REACH - 1.5).toFixed(2)}, ${SAND_REACH.toFixed(2)}, -wd));`);
  }

  update(seconds: number): void {
    this.time.value = seconds;
  }

  rebuild(t: Terrain): void {
    const field = signedWaterField(t);
    this.fieldData.set(field.data);
    this.field.needsUpdate = true;

    const water = t.water;
    let tiles = 0;
    for (let i = 0; i < water.length; i++) if (water[i]) tiles++;
    this.waterTiles = tiles;

    // The zero-contour can reach half a tile into land at concave corners, so the surface covers a
    // one-tile dilation of the mask. The fringe is cut straight from the field, which keeps it to
    // exactly the tiles the shader will actually draw.
    const wet = new Uint8Array(GRID * GRID);
    const shore = new Uint8Array(GRID * GRID);
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      const d = field.at(x + 0.5 - GRID / 2, z + 0.5 - GRID / 2);
      if (d < SAND_WET + SLACK && d > -(SAND_REACH + SLACK)) shore[z * GRID + x] = 1;
      if (!water[z * GRID + x]) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, zz = z + dz;
        if (xx >= 0 && xx < GRID && zz >= 0 && zz < GRID) wet[zz * GRID + xx] = 1;
      }
    }
    // The river ribbon lays its own banks, so the whole fringe stands off it: a partial one would
    // read as a sand halo floating a couple of tiles out from the bank.
    if (t.river.length >= 2) {
      const samples = riverSamples(t), standoff = SAND_REACH + 1.2;
      for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
        const i = z * GRID + x;
        if (!shore[i]) continue;
        if (riverDistance(x + 0.5 - GRID / 2, z + 0.5 - GRID / 2, samples).distance < standoff) shore[i] = 0;
      }
    }

    const half = GRID / 2;
    const sand = new QuadSheet();
    mergeRuns(shore, (x0, z0, x1, z1) => sand.add(x0 - half, z0 - half, x1 - half, z1 - half, BEACH_Y));
    this.sand.geometry.dispose();
    this.sand.geometry = sand.build();

    const surface = new QuadSheet();
    mergeRuns(wet, (x0, z0, x1, z1) => surface.add(x0 - half, z0 - half, x1 - half, z1 - half, WATER_Y));
    // Sea that touches the map edge keeps going to the horizon; the field clamps outward, so the
    // skirt inherits the coastline of the edge tile and discards wherever that tile is land.
    for (const [a, b] of edgeRuns(water, n => idx(n, 0))) surface.add(a - half, -HORIZON, b - half, -half, WATER_Y);
    for (const [a, b] of edgeRuns(water, n => idx(n, GRID - 1))) surface.add(a - half, half, b - half, HORIZON, WATER_Y);
    for (const [a, b] of edgeRuns(water, n => idx(0, n))) surface.add(-HORIZON, a - half, -half, b - half, WATER_Y);
    for (const [a, b] of edgeRuns(water, n => idx(GRID - 1, n))) surface.add(half, a - half, HORIZON, b - half, WATER_Y);
    for (const [cx, cz] of [[0, 0], [GRID - 1, 0], [0, GRID - 1], [GRID - 1, GRID - 1]] as const) {
      if (!water[idx(cx, cz)]) continue;
      const x0 = cx ? half : -HORIZON, x1 = cx ? HORIZON : -half;
      const z0 = cz ? half : -HORIZON, z1 = cz ? HORIZON : -half;
      surface.add(x0, z0, x1, z1, WATER_Y);
    }
    this.surface.geometry.dispose();
    this.surface.geometry = surface.build();
  }

  dispose(): void {
    this.field.dispose();
    for (const m of [this.sand, this.surface]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
  }
}
