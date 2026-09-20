import * as THREE from 'three';
import type { Terrain } from '../terrain';
import { MeshBuilder } from './meshBuilder';
import { riverSamples } from './landscape';

const WATER = new THREE.Color(0x2f7fae);
const MURKY = new THREE.Color(0x6e5b2f);
const tmp = new THREE.Color();

/** The river as a smooth ribbon with irregular banks, animated ripples and upstream cascades. Sewage tints it downstream. */
export class RiverLayer {
  readonly group = new THREE.Group();
  private bank: THREE.Mesh;
  private water: THREE.Mesh;
  private range: [number, number] = [0, 0];
  private lead = 0; // extrapolated points added before the real samples

  private spray = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 5, 4), new THREE.MeshBasicMaterial({ color: 0xdaeff3, transparent: true, opacity: 0.4, depthWrite: false }), 32);
  private cascade = { x: 0, z: 0, dx: 0, dz: 1, w: 2 };
  private sprayObject = new THREE.Object3D();
  private time = { value: 0 };

  update(seconds: number): void {
    this.time.value = seconds;
    const c = this.cascade, obj = this.sprayObject;
    for (let i = 0; i < 32; i++) {
      const age = (seconds * 0.7 + i * 0.618) % 1, across = Math.sin(i * 19.3) * c.w;
      obj.position.set(c.x - c.dz * across + c.dx * age, 0.15 + Math.sin(age * Math.PI) * 0.65, c.z + c.dx * across + c.dz * age);
      obj.scale.setScalar(0.4 + Math.sin(age * Math.PI) * 1.2); obj.updateMatrix(); this.spray.setMatrixAt(i, obj.matrix);
    }
    this.spray.instanceMatrix.needsUpdate = true;
  }

  constructor() {
    this.spray.frustumCulled = false;
    this.group.add(this.spray);
    this.bank = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
    );
    this.water = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.1, side: THREE.DoubleSide }),
    );
    const mat = this.water.material as THREE.MeshStandardMaterial;
    mat.onBeforeCompile = shader => {
      shader.uniforms.riverTime = this.time;
      shader.vertexShader = 'attribute vec2 riverUV;\nvarying vec2 vRiver;\nvarying float vHeight;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRiver = riverUV; vHeight = position.y;');
      shader.fragmentShader = `uniform float riverTime; varying vec2 vRiver; varying float vHeight;
        float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), f.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // Current runs faster mid-channel; x is distance downstream, y is -1..1 across.
        float rFlow(vec2 uv, float t) {
          float speed = 0.55 + 0.6 * (1.0 - uv.y * uv.y);
          vec2 a = vec2((uv.x - t * speed * 1.4) * 0.9, uv.y * 2.2);
          vec2 b = vec2((uv.x - t * speed * 2.1) * 1.9 + 7.3, uv.y * 4.5 + 3.1);
          return rNoise(a) * 0.6 + rNoise(b) * 0.4;
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float across = abs(vRiver.y);
        float depth = 1.0 - across * across;
        vec3 deep = diffuseColor.rgb * 0.72;
        vec3 shallow = mix(diffuseColor.rgb, vec3(0.5, 0.78, 0.74), 0.45);
        diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 0.85, depth));
        float flow = rFlow(vRiver, riverTime);
        float streak = smoothstep(0.58, 0.82, flow) * (0.35 + 0.65 * depth);
        diffuseColor.rgb += vec3(0.08, 0.12, 0.13) * streak;
        float foam = smoothstep(0.84, 1.0, across) * smoothstep(0.45, 0.75, rNoise(vec2(vRiver.x * 2.6 - riverTime * 0.9, vRiver.y * 9.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.93, 0.92), foam * 0.5);
        float cascade = smoothstep(0.1, 0.6, vHeight) * (1.0 - smoothstep(3.5, 4.0, vHeight));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.9, 0.92), cascade * (0.55 + flow * 0.4));`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float e = 0.08, f0 = rFlow(vRiver, riverTime);
        vec2 grad = vec2(rFlow(vRiver + vec2(e, 0.0), riverTime) - f0, rFlow(vRiver + vec2(0.0, e), riverTime) - f0) / e;
        normal = normalize(normal + vec3(grad.x, 0.0, grad.y) * 0.05);`);
    };
    this.bank.receiveShadow = true;
    this.water.receiveShadow = true;
    for (const m of [this.bank, this.water]) { m.frustumCulled = false; this.group.add(m); }
  }

  rebuild(t: Terrain): void {
    const samples = riverSamples(t);
    const foot = samples[100], next = samples[101], len = Math.hypot(next.x - foot.x, next.z - foot.z);
    this.cascade = { x: foot.x, z: foot.z, dx: (next.x - foot.x) / len, dz: (next.z - foot.z) / len, w: foot.w };
    const pts = samples.flatMap(p => [p.x, p.z]);
    const widths = samples.map(p => p.w);
    this.lead = 110;
    const count = samples.length;
    const elevate = (geometry: THREE.BufferGeometry, offset: number): void => {
      const p = geometry.getAttribute('position');
      for (let i = 0; i < samples.length; i++) {
        p.setY(i * 2, samples[i].y + offset); p.setY(i * 2 + 1, samples[i].y + offset);
      }
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    };

    const bb = new MeshBuilder();
    bb.ribbon(pts, count, widths.map((w, i) => w + 0.85 + Math.sin(i * 0.73) * 0.16), 0.006, 0xcdbf8f);
    this.bank.geometry.dispose();
    this.bank.geometry = bb.build();
    elevate(this.bank.geometry, 0.006);

    const wb = new MeshBuilder();
    this.range = wb.ribbon(pts, count, widths.map((w) => w + 0.4), 0.014, WATER.getHex());
    this.water.geometry.dispose();
    this.water.geometry = wb.build();
    elevate(this.water.geometry, 0.014);
    // River-space coordinates: distance downstream and position across the channel.
    const uv = new Float32Array(this.water.geometry.getAttribute('position').count * 2);
    let along = 0;
    for (let i = 0; i < count; i++) {
      if (i > 0) along += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      uv.set([along, -1, along, 1], i * 4);
    }
    this.water.geometry.setAttribute('riverUV', new THREE.BufferAttribute(uv, 2));
  }

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
