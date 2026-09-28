import * as THREE from 'three';
import { Emit } from './buildingGeo';

/** A point smoke or steam leaves a building, in the scene. */
export interface Emitter { x: number; y: number; z: number; kind: number; tile: number; always: boolean }

const POOL = 1800;
/** How many of the emitters nearest the camera are running at once. */
const ACTIVE = 260;

/** Per kind: puffs a second, life (s), rise speed, size at birth and at death, colour. */
const KINDS: Record<number, { rate: number; life: number; rise: number; s0: number; s1: number; color: number }> = {
  [Emit.Smoke]: { rate: 1.4, life: 6, rise: 0.22, s0: 0.05, s1: 0.3, color: 0x6f6a64 },
  [Emit.Steam]: { rate: 1.1, life: 3.5, rise: 0.18, s0: 0.04, s1: 0.2, color: 0xf2f4f6 },
  [Emit.Chimney]: { rate: 0.6, life: 5, rise: 0.09, s0: 0.018, s1: 0.09, color: 0xa29e98 },
  [Emit.Haze]: { rate: 0.5, life: 4, rise: 0.15, s0: 0.03, s1: 0.14, color: 0xc4c2bc },
  [Emit.Tower]: { rate: 1.3, life: 7, rise: 0.3, s0: 0.35, s1: 1.1, color: 0xf4f6f8 },
};

interface Puff { x: number; y: number; z: number; age: number; life: number; kind: number; spin: number }

/**
 * Smoke from the factory and power-station stacks, steam from vents and cooling towers, and the house
 * chimneys going in the evening: soft lumps that rise, swell, drift with the wind and thin out. One
 * instanced mesh from a fixed pool; only the emitters nearest the camera run, so a big city costs no
 * more than a small one.
 */
export class SmokeLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly alpha: THREE.InstancedBufferAttribute;
  private puffs: Puff[] = [];
  private emitters: Emitter[] = [];
  private nearby: Emitter[] = [];
  private owed = new Map<Emitter, number>();
  private sortIn = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly axis = new THREE.Vector3(0, 1, 0);

  constructor() {
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(POOL), 1);
    geometry.setAttribute('aAlpha', this.alpha);
    const material = new THREE.MeshLambertMaterial({ transparent: true, depthWrite: false, flatShading: true });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAlpha = aAlpha;');
      shader.fragmentShader = 'varying float vAlpha;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vAlpha;');
    };
    this.mesh = new THREE.InstancedMesh(geometry, material, POOL);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  setEmitters(emitters: Emitter[]): void {
    this.emitters = emitters;
    this.sortIn = 0;
    this.owed.clear();
  }

  /**
   * `running(e)` says how hard an emitter is going now (0 to 1): the caller knows the hour, the weather
   * and whether the building has power.
   */
  update(dt: number, camera: THREE.Vector3, windAngle: number, wind: number, running: (e: Emitter) => number): void {
    // Every so often, pick the emitters nearest the camera.
    if ((this.sortIn -= dt) <= 0) {
      this.sortIn = 1;
      this.nearby = this.emitters
        .map(e => ({ e, d: (e.x - camera.x) ** 2 + (e.z - camera.z) ** 2 }))
        .sort((a, b) => a.d - b.d).slice(0, ACTIVE).map(o => o.e);
    }
    for (const e of this.nearby) {
      const k = KINDS[e.kind], go = running(e);
      if (!k || go <= 0) continue;
      let owed = (this.owed.get(e) ?? Math.random()) + dt * k.rate * go;
      while (owed >= 1 && this.puffs.length < POOL) {
        owed -= 1;
        this.puffs.push({ x: e.x + (Math.random() - 0.5) * k.s0, y: e.y, z: e.z + (Math.random() - 0.5) * k.s0, age: 0, life: k.life * (0.8 + Math.random() * 0.4), kind: e.kind, spin: Math.random() * 6 });
      }
      this.owed.set(e, Math.min(owed, 2));
    }
    const wx = Math.sin(windAngle) * wind, wz = Math.cos(windAngle) * wind;
    let n = 0;
    for (let i = 0; i < this.puffs.length; i++) {
      const f = this.puffs[i];
      f.age += dt;
      if (f.age >= f.life) continue;
      const k = KINDS[f.kind], t = f.age / f.life;
      // Rising fast at first and slowing, bent over by the wind as it goes.
      f.y += k.rise * (1 - t * 0.7) * dt;
      f.x += wx * 0.12 * (0.3 + t) * dt; f.z += wz * 0.12 * (0.3 + t) * dt;
      const size = k.s0 + (k.s1 - k.s0) * Math.sqrt(t);
      this.p.set(f.x, f.y, f.z);
      this.q.setFromAxisAngle(this.axis, f.spin + t);
      this.m.compose(this.p, this.q, this.s.set(size, size * 0.8, size));
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, this.c.setHex(k.color));
      // Fade in quickly, thin out slowly.
      this.alpha.setX(n, Math.min(1, t * 8) * (1 - t) * (f.kind === Emit.Steam || f.kind === Emit.Tower ? 0.75 : 0.6));
      this.puffs[n] = f;
      n++;
    }
    this.puffs.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
