import * as THREE from 'three';

const COUNT = 1500;

/**
 * Falling rain: streaks in a box round the camera, each falling, blown by the wind, and put back at the
 * top when it reaches the bottom. In the street the box is small and the streaks short; from the map
 * it is wide and the streaks long, so the rain reads at either scale. One draw.
 */
export class RainLayer {
  readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  /** Each streak's place in the box, 0 to 1 on each axis. */
  private readonly seeds: Float32Array;
  private readonly material = new THREE.LineBasicMaterial({ color: 0xe2eaf2, transparent: true, opacity: 0, depthWrite: false });
  private fall = 0;

  constructor() {
    this.pos = new Float32Array(COUNT * 6);
    this.seeds = new Float32Array(COUNT * 3);
    for (let i = 0; i < this.seeds.length; i++) this.seeds[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  update(dt: number, camera: THREE.Camera, rain: number, windAngle: number, wind: number, street: boolean): void {
    this.lines.visible = rain > 0.02;
    if (!this.lines.visible) return;
    this.material.opacity = Math.min(0.85, 0.3 + rain * 0.6);
    const box = street ? 1.4 : 9, height = street ? 1.2 : 8, len = street ? 0.045 : 0.35;
    // Only as many streaks as the shower has.
    const n = Math.round(COUNT * Math.min(1, 0.25 + rain));
    this.lines.geometry.setDrawRange(0, n * 2);
    this.fall = (this.fall + dt * (street ? 1.1 : 0.9)) % 1;
    const c = camera.position, wx = Math.sin(windAngle) * wind * 0.35, wz = Math.cos(windAngle) * wind * 0.35;
    for (let i = 0; i < n; i++) {
      const sx = this.seeds[i * 3], sy = this.seeds[i * 3 + 1], sz = this.seeds[i * 3 + 2];
      // Each streak falls at its own phase, and the box follows the camera.
      const y = 1 - ((sy + this.fall * (0.8 + sx * 0.4)) % 1);
      const x = c.x + (sx - 0.5) * box * 2, z = c.z + (sz - 0.5) * box * 2, top = c.y - height * 0.3 + y * height;
      const o = i * 6;
      this.pos[o] = x; this.pos[o + 1] = top; this.pos[o + 2] = z;
      this.pos[o + 3] = x - wx * len; this.pos[o + 4] = top - len; this.pos[o + 5] = z - wz * len;
    }
    (this.lines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
