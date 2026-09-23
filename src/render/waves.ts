import * as THREE from 'three';

/**
 * Ripples on the water, simulated on the GPU as a height field the way the classic WebGL water demo
 * does it: every frame each texel's velocity is pulled towards the average height of its neighbours,
 * so a drop spreads out as a ring and the rings run into each other. Boats, the cascade, rain and a
 * gentle random patter keep the surface alive. The water shaders read the field for their normals,
 * and the beds beneath read its curvature for caustics.
 */

/** The field covers the map and a margin around it, in world units from the map's centre. */
export const WAVE_EXTENT = 48;
const SIZE = 256;
const MAX_DROPS = 24;

/** What every water and bed shader shares: the clock, the sky it reflects, and the ripple field. */
export const waterUniforms = {
  riverTime: { value: 0 },
  skyColor: { value: new THREE.Color(0xc6e4f5) },
  waveTex: { value: null as THREE.Texture | null },
  /** One texel of the field, in its own 0..1 space, and how many world units that is. */
  waveDelta: { value: 1 / SIZE },
  waveTexel: { value: (WAVE_EXTENT * 2) / SIZE },
};

/** Cheap value noise, for the drift of the current and the shimmer on a bed. */
export const NOISE_GLSL = `
  float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float rNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(rHash(i), rHash(i + vec2(1.0, 0.0)), f.x), mix(rHash(i + vec2(0.0, 1.0)), rHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

/** GLSL that turns world XZ into a coordinate in the ripple field. */
export const WAVE_GLSL = `
  uniform sampler2D waveTex; uniform float waveDelta; uniform float waveTexel;
  vec2 waveUv(vec2 xz) { return (xz + ${WAVE_EXTENT.toFixed(1)}) / ${(WAVE_EXTENT * 2).toFixed(1)}; }
  float waveHeight(vec2 xz) { return texture2D(waveTex, waveUv(xz)).r; }
  // Surface normal of the rippled water at a point, up being +y.
  vec3 waveNormal(vec2 xz) {
    vec2 uv = waveUv(xz);
    float l = texture2D(waveTex, uv - vec2(waveDelta, 0.0)).r, r = texture2D(waveTex, uv + vec2(waveDelta, 0.0)).r;
    float d = texture2D(waveTex, uv - vec2(0.0, waveDelta)).r, u = texture2D(waveTex, uv + vec2(0.0, waveDelta)).r;
    // The field's heights are small next to a texel, so the tilt is exaggerated to read as ripples.
    return normalize(vec3((l - r) * 6.0, 2.0 * waveTexel, (d - u) * 6.0));
  }
  // How much the surface curves at a point: dips focus the light below into caustics.
  float waveCurvature(vec2 xz) {
    vec2 uv = waveUv(xz);
    float c = texture2D(waveTex, uv).r;
    float l = texture2D(waveTex, uv - vec2(waveDelta, 0.0)).r, r = texture2D(waveTex, uv + vec2(waveDelta, 0.0)).r;
    float d = texture2D(waveTex, uv - vec2(0.0, waveDelta)).r, u = texture2D(waveTex, uv + vec2(0.0, waveDelta)).r;
    return (l + r + d + u) * 0.25 - c;
  }
`;

export class WaveField {
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private propagate: THREE.ShaderMaterial;
  private splash: THREE.ShaderMaterial;
  private pending: { x: number; z: number; radius: number; strength: number }[] = [];
  private centers = new Float32Array(MAX_DROPS * 2);
  private radii = new Float32Array(MAX_DROPS);
  private strengths = new Float32Array(MAX_DROPS);

  constructor() {
    const make = (): THREE.WebGLRenderTarget => new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
    this.targets = [make(), make()];
    for (const t of this.targets) t.texture.wrapS = t.texture.wrapT = THREE.ClampToEdgeWrapping;
    const vertex = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    this.propagate = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, delta: { value: new THREE.Vector2(1 / SIZE, 1 / SIZE) } },
      vertexShader: vertex,
      fragmentShader: `uniform sampler2D tex; uniform vec2 delta; varying vec2 vUv;
        void main() {
          vec4 info = texture2D(tex, vUv);
          vec2 dx = vec2(delta.x, 0.0), dy = vec2(0.0, delta.y);
          float average = (texture2D(tex, vUv - dx).r + texture2D(tex, vUv + dx).r + texture2D(tex, vUv - dy).r + texture2D(tex, vUv + dy).r) * 0.25;
          // Velocity chases the neighbours' average, damped a little so rings fade as they spread.
          info.g += (average - info.r) * 2.0;
          info.g *= 0.985;
          info.r += info.g;
          info.r *= 0.998;
          gl_FragColor = info;
        }`,
      depthTest: false, depthWrite: false,
    });
    this.splash = new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, count: { value: 0 }, centers: { value: this.centers }, radii: { value: this.radii }, strengths: { value: this.strengths } },
      vertexShader: vertex,
      fragmentShader: `uniform sampler2D tex; uniform int count; uniform vec2 centers[${MAX_DROPS}]; uniform float radii[${MAX_DROPS}]; uniform float strengths[${MAX_DROPS}]; varying vec2 vUv;
        void main() {
          vec4 info = texture2D(tex, vUv);
          for (int i = 0; i < ${MAX_DROPS}; i++) {
            if (i >= count) break;
            float drop = max(0.0, 1.0 - length(centers[i] - vUv) / radii[i]);
            drop = 0.5 - cos(drop * 3.14159265) * 0.5;
            info.r += drop * strengths[i];
          }
          gl_FragColor = info;
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.propagate);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    waterUniforms.waveTex.value = this.targets[0].texture;
  }

  /** Disturb the water at a world position: `radius` in world units, `strength` as a height. */
  drop(x: number, z: number, radius: number, strength: number): void {
    if (this.pending.length < MAX_DROPS * 4) this.pending.push({ x, z, radius, strength });
  }

  /** Apply the queued drops and run the ripples on by `iterations` steps. */
  step(renderer: THREE.WebGLRenderer, iterations = 2): void {
    const previous = renderer.getRenderTarget();
    const pass = (material: THREE.ShaderMaterial): void => {
      const from = this.targets[this.current], to = this.targets[1 - this.current];
      material.uniforms.tex.value = from.texture;
      this.quad.material = material;
      renderer.setRenderTarget(to);
      renderer.render(this.scene, this.camera);
      this.current = 1 - this.current;
    };
    while (this.pending.length) {
      const batch = this.pending.splice(0, MAX_DROPS);
      batch.forEach((d, i) => {
        this.centers[i * 2] = (d.x + WAVE_EXTENT) / (WAVE_EXTENT * 2);
        this.centers[i * 2 + 1] = (d.z + WAVE_EXTENT) / (WAVE_EXTENT * 2);
        this.radii[i] = d.radius / (WAVE_EXTENT * 2);
        this.strengths[i] = d.strength;
      });
      this.splash.uniforms.count.value = batch.length;
      pass(this.splash);
    }
    for (let k = 0; k < iterations; k++) pass(this.propagate);
    renderer.setRenderTarget(previous);
    waterUniforms.waveTex.value = this.targets[this.current].texture;
  }
}
