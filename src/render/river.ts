import * as THREE from 'three';
import { WATER_EDGE } from '../terrain';
import type { Terrain } from '../terrain';
import { MeshBuilder } from './meshBuilder';
import { riverSamples } from './landscape';
import type { RiverSample } from './landscape';
import { GRID } from '../constants';
import { NOISE_GLSL, WAVE_GLSL, waterUniforms } from './waves';

export const WATER = new THREE.Color(0x2f7fae);
/** Where the ribbon goes on the map: under the channel's floor, out of sight. */
const SUNK = -4;
/** Samples (in world space, centred on the map) this far inside its edge belong to the channel; the band at the edge overlaps the sheet to hide the seam. */
const onMap = (s: { x: number; z: number }): boolean => Math.abs(s.x) < GRID / 2 - 0.6 && Math.abs(s.z) < GRID / 2 - 0.6;
const MURKY = new THREE.Color(0x6e5b2f);
const tmp = new THREE.Color();

/**
 * The look of moving water, shared by the river and by whatever it spills: a translucent surface with
 * ripples that drift along `riverUV.x`, lighter towards the edges (`riverUV.y` runs -1..1 across the
 * channel, so |y| near 1 is the shallows), white water where the surface tilts, and on top of that
 * the simulated ripple field for its lighting and a Fresnel sheen of sky at grazing angles.
 * `foam` scales how readily a tilt froths: the river's chutes foam hard, a spreading flood barely.
 */
export function waterMaterial(foam = 26): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.84, depthWrite: false });
  mat.forceSinglePass = true; // A flat water sheet needs only one transparent draw.
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = 'attribute vec2 riverUV;\nvarying vec2 vRiver;\nvarying float vHeight;\nvarying vec3 vWorld;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRiver = riverUV; vHeight = position.y; vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `uniform float riverTime; uniform vec3 skyColor; varying vec2 vRiver; varying float vHeight; varying vec3 vWorld;
      ${NOISE_GLSL}
      ${WAVE_GLSL}
      // Current runs faster mid-channel; x is distance downstream, y is -1..1 across.
      float rFlow(vec2 uv, float t) {
        float speed = 0.55 + 0.6 * (1.0 - uv.y * uv.y);
        vec2 a = vec2((uv.x - t * speed * 1.4) * 0.9, uv.y * 2.2);
        vec2 b = vec2((uv.x - t * speed * 2.1) * 1.9 + 7.3, uv.y * 4.5 + 3.1);
        return rNoise(a) * 0.6 + rNoise(b) * 0.4;
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      // A sheet fades out through its vertex alpha; keep that fade apart from the water's own opacity.
      float vertexFade = diffuseColor.a / max(opacity, 0.0001);
      diffuseColor.a = opacity;
      float across = abs(vRiver.y);
      float depth = 1.0 - across * across;
      vec3 deep = diffuseColor.rgb * 0.72;
      vec3 shallow = mix(diffuseColor.rgb, vec3(0.5, 0.78, 0.74), 0.45);
      diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 0.85, depth));
      diffuseColor.a *= mix(0.86, 1.0, smoothstep(0.0, 0.8, depth));
      float flow = rFlow(vRiver, riverTime);
      float streak = smoothstep(0.58, 0.82, flow) * (0.35 + 0.65 * depth);
      diffuseColor.rgb += vec3(0.08, 0.12, 0.13) * streak;
      float foam = smoothstep(0.84, 1.0, across) * smoothstep(0.45, 0.75, rNoise(vec2(vRiver.x * 2.6 - riverTime * 0.9, vRiver.y * 9.0)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.92), foam * 0.5);
      // White water wherever the bed is tilted: the chute foams, the flats below do not.
      float slope = clamp(length(vec2(dFdx(vHeight), dFdy(vHeight))) * ${foam.toFixed(1)}, 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.92, 0.94), slope * (0.5 + flow * 0.45));
      diffuseColor.a = mix(diffuseColor.a, 0.95, max(slope, foam * 0.5));
      // The ripple field: crests catch a little light, and at a grazing angle the surface turns to sky.
      vec3 wave = waveNormal(vWorld.xz);
      diffuseColor.rgb += vec3(0.06, 0.07, 0.07) * clamp(waveHeight(vWorld.xz) * 8.0, -0.6, 1.0);
      vec3 toEye = normalize(cameraPosition - vWorld);
      float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(wave, toEye), 0.0), 5.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, skyColor, fresnel * 0.5);
      diffuseColor.a = max(diffuseColor.a, fresnel * 0.9) * vertexFade;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float e = 0.08, f0 = rFlow(vRiver, riverTime);
      vec2 grad = vec2(rFlow(vRiver + vec2(e, 0.0), riverTime) - f0, rFlow(vRiver + vec2(0.0, e), riverTime) - f0) / e;
      vec3 ripple = waveNormal(vWorld.xz);
      normal = normalize(normal + (ripple - vec3(0.0, 1.0, 0.0)) * 1.4 + vec3(grad.x, 0.0, grad.y) * 0.04);`);
  };
  return mat;
}

/**
 * The ground under moving water: gravel or mud with caustics playing over it, from the curvature of
 * the ripple field above and a slower shimmer of its own. `fading` makes it translucent, for a bed
 * that has to thin out at a shoreline.
 */
export function bedMaterial(fading = false): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, transparent: fading, depthWrite: !fading });
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = 'varying vec3 vWorld;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `uniform float riverTime; varying vec3 vWorld;
      ${NOISE_GLSL}
      ${WAVE_GLSL}
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float focus = clamp(waveCurvature(vWorld.xz) * 120.0, 0.0, 1.0);
      float web = pow(rNoise(vWorld.xz * 1.9 + vec2(riverTime * 0.31, -riverTime * 0.23)) * 0.6 + rNoise(vWorld.xz * 3.7 - vec2(riverTime * 0.17, riverTime * 0.29)) * 0.4, 3.0);
      diffuseColor.rgb *= 1.0 + focus * 0.9 + web * 0.9;`);
  };
  return mat;
}

/**
 * The river beyond the map: a smooth ribbon with irregular banks and upstream cascades, carrying the
 * river off to the horizon at whatever level it has where it leaves. On the map itself the river is
 * a channel cut into the ground and the water simulation's own surface, so the ribbon is sunk out of
 * sight there. Sewage tints it downstream.
 */
export class RiverLayer {
  readonly group = new THREE.Group();
  private bed: THREE.Mesh;
  private water: THREE.Mesh;
  private range: [number, number] = [0, 0];
  private lead = 0; // extrapolated points added before the real samples
  private samples: RiverSample[] = [];
  private rises = new Float32Array(0);
  private floor = { before: -1.45, after: -1.45 };

  private spray = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 5, 4), new THREE.MeshBasicMaterial({ color: 0xdaeff3, transparent: true, opacity: 0.4, depthWrite: false }), 32);
  private cascade = { x: 0, y: 0, z: 0, dx: 0, dz: 1, w: 2, fall: 0, length: 2.4, lip: 0 };
  private sprayObject = new THREE.Object3D();
  private time = waterUniforms.riverTime;

  update(seconds: number): void {
    this.time.value = seconds;
    const c = this.cascade, obj = this.sprayObject;
    this.spray.visible = c.fall > 0.1;
    // From the water's own level at the lip.
    const level = this.samples.length ? this.rises[c.lip] ?? 0 : 0;
    for (let i = 0; i < 32; i++) {
      // Each drop rides over the lip, down the fall, and throws itself up again at the bottom.
      const age = (seconds * 0.7 + i * 0.618) % 1, across = Math.sin(i * 19.3) * c.w * 0.8;
      const along = (c.length + 1) * age, down = Math.min(1, age * 1.3);
      obj.position.set(
        c.x - c.dz * across + c.dx * along,
        c.y + level + 0.1 - down * down * c.fall + (age > 0.7 ? Math.sin((age - 0.7) / 0.3 * Math.PI) * 0.6 : 0),
        c.z + c.dx * across + c.dz * along,
      );
      obj.scale.setScalar(0.25 + Math.sin(age * Math.PI) * 0.7); obj.updateMatrix(); this.spray.setMatrixAt(i, obj.matrix);
    }
    this.spray.instanceMatrix.needsUpdate = true;
  }

  constructor() {
    this.spray.frustumCulled = false;
    this.group.add(this.spray);
    this.bed = new THREE.Mesh(new THREE.BufferGeometry(), bedMaterial());
    this.water = new THREE.Mesh(new THREE.BufferGeometry(), waterMaterial());
    // Depth testing keeps bridges and boat hulls in front. Draw the surface before transparent
    // wakes/spray, without writing depth that would hide those effects.
    this.water.renderOrder = -1;
    this.water.receiveShadow = true;
    this.bed.receiveShadow = true;
    for (const m of [this.bed, this.water]) { m.frustumCulled = false; this.group.add(m); }
  }

  /** `floor` is how deep the bed lies below the bank where the river enters and leaves the map: the channel beyond keeps that depth. */
  rebuild(t: Terrain, floor: { before: number; after: number } = { before: -1.45, after: -1.45 }): void {
    const samples = riverSamples(t);
    this.samples = samples;
    this.floor = floor;
    if (samples.length < 2) {
      // No river on this map: nothing to draw, and no cascade.
      this.bed.geometry.dispose(); this.bed.geometry = new THREE.BufferGeometry();
      this.water.geometry.dispose(); this.water.geometry = new THREE.BufferGeometry();
      this.cascade = { x: 0, y: 0, z: 0, dx: 0, dz: 1, w: 0, fall: 0, length: 2.4, lip: 0 };
      return;
    }
    this.rises = new Float32Array(samples.length);
    // Spray belongs where the water is actually falling: find the fall's lip, and how far it drops
    // over the next few samples.
    let lip = 0, steepest = 0;
    for (let i = 1; i < samples.length; i++) {
      const drop = samples[i - 1].y - samples[i].y;
      if (drop > steepest) { steepest = drop; lip = i - 1; }
    }
    while (lip > 0 && samples[lip - 1].y - samples[lip].y > 1e-3) lip--;
    let foot = lip;
    while (foot + 1 < samples.length && samples[foot].y - samples[foot + 1].y > 1e-3) foot++;
    const top = samples[lip], bottom = samples[foot];
    const len = Math.hypot(bottom.x - top.x, bottom.z - top.z) || 1;
    this.cascade = { x: top.x, y: top.y, z: top.z, dx: (bottom.x - top.x) / len, dz: (bottom.z - top.z) / len, w: top.w, fall: steepest > 1e-3 ? top.y - bottom.y : 0, length: len, lip };
    const pts = samples.flatMap(p => [p.x, p.z]);
    const widths = samples.map(p => p.w);
    // Where the channel runs through open sea there is no bank to draw, only more water.

    this.lead = Math.max(0, samples.length - t.river.length - 110);
    const count = samples.length;
    const onMapFrom = samples.findIndex(onMap), onMapTo = samples.length - 1 - [...samples].reverse().findIndex(onMap);
    const depth = (i: number): number => i < onMapFrom || onMapFrom < 0 ? floor.before : i > onMapTo ? floor.after : Math.min(floor.before, floor.after);
    const elevate = (geometry: THREE.BufferGeometry, offset: number, atFloor = false): void => {
      const p = geometry.getAttribute('position');
      for (let i = 0; i < p.count / 2; i++) {
        const sample = samples[i % samples.length];
        const y = onMap(sample) ? SUNK + (atFloor ? -0.05 : offset) : sample.y + offset + (atFloor ? depth(i) : 0);
        p.setY(i * 2, y); p.setY(i * 2 + 1, y);
      }
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    };

    // A cool gravel bed on the channel floor, with caustics playing over it.
    const db = new MeshBuilder();
    db.ribbon(pts, count, widths.map(w => w + WATER_EDGE), 0.02, 0x718b80);
    this.bed.geometry.dispose();
    this.bed.geometry = db.build();
    elevate(this.bed.geometry, 0.02, true);
    const bedColors = this.bed.geometry.getAttribute('color');
    const gravel = new THREE.Color();
    for (let i = 0; i < bedColors.count; i++) {
      gravel.setHex(0x718b80).multiplyScalar(0.94 + Math.sin(Math.floor(i / 2) * 1.73) * 0.06);
      bedColors.setXYZ(i, gravel.r, gravel.g, gravel.b);
    }

    const wb = new MeshBuilder();
    this.range = wb.ribbon(pts, count, widths.map((w) => w + WATER_EDGE), 0.014, WATER.getHex());
    this.water.geometry.dispose();
    this.water.geometry = wb.build();
    elevate(this.water.geometry, 0.014);
    this.setLevels(null, new Uint8Array(0));
    // River-space coordinates: distance downstream and position across the channel.
    const uv = new Float32Array(this.water.geometry.getAttribute('position').count * 2);
    let along = 0;
    for (let i = 0; i < count; i++) {
      if (i > 0) along += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      uv.set([along, -1, along, 1], i * 4);
    }
    this.water.geometry.setAttribute('riverUV', new THREE.BufferAttribute(uv, 2));
  }

  /**
   * Set the drawn river to the simulated water level: `water` holds each tile's surface height.
   * Off the map the river carries on at the level it has where it enters or leaves. With no levels
   * yet it sits at its usual depth above the channel floor.
   */
  setLevels(water: Float32Array | null, river: Uint8Array): void {
    const p = this.water.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const samples = this.samples, n = samples.length;
    if (!p || !n) return;
    const usual = (i: number): number => (i < n / 2 ? this.floor.before : this.floor.after) + 1.2;
    const riseAt = (x: number, z: number, i: number): number => {
      if (!water) return usual(i);
      const tx = Math.floor(x + GRID / 2), tz = Math.floor(z + GRID / 2);
      // The sample's own tile, or the nearest river tile beside it where the channel edge runs over the bank.
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const x2 = tx + dx, z2 = tz + dz;
        if (x2 < 0 || z2 < 0 || x2 >= GRID || z2 >= GRID) continue;
        const k = z2 * GRID + x2;
        if (river[k] && water[k] === water[k]) return water[k];
      }
      return usual(i);
    };
    const rises = this.rises;
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      if (Math.abs(s.x) >= GRID / 2 || Math.abs(s.z) >= GRID / 2) continue;
      if (first < 0) first = i;
      last = i;
      rises[i] = riseAt(s.x, s.z, i);
    }
    if (first < 0) return;
    for (let i = 0; i < first; i++) rises[i] = rises[first];
    for (let i = last + 1; i < n; i++) rises[i] = rises[last];
    // A little smoothing along the channel, so the sheet does not step from tile to tile.
    for (let i = 1; i + 1 < n; i++) rises[i] = (rises[i - 1] + rises[i] * 2 + rises[i + 1]) / 4;
    for (let i = 0; i < n; i++) {
      const y = onMap(samples[i]) ? SUNK + 0.014 : samples[i].y + 0.014 + Math.max(this.floor.before - 0.2, rises[i]);
      p.setY(i * 2, y); p.setY(i * 2 + 1, y);
    }
    p.needsUpdate = true;
  }

  /** Where the upstream cascade lands, for the ripples it throws. */
  get cascadeFoot(): { x: number; z: number; w: number; fall: number } { const c = this.cascade; return { x: c.x + c.dx * c.length, z: c.z + c.dz * c.length, w: c.w, fall: c.fall }; }

  /** Per river sample pollution 0..255. */
  tint(pollution: Uint8Array): void {
    const attr = this.water.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const n = (this.range[1] - this.range[0]) / 2;
    for (let i = 0; i < n; i++) {
      const k = Math.max(0, Math.min(pollution.length - 1, i - this.lead));
      const p = pollution.length ? pollution[k] / 255 : 0;
      tmp.copy(WATER).lerp(MURKY, Math.min(1, p * 1.2));
      attr.setXYZ(this.range[0] + i * 2, tmp.r, tmp.g, tmp.b);
      attr.setXYZ(this.range[0] + i * 2 + 1, tmp.r, tmp.g, tmp.b);
    }
    attr.needsUpdate = true;
  }
}
