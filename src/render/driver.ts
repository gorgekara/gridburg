import * as THREE from 'three';
import { vehicleGeometry } from './cars';

const ACCEL = 1.2; // units per second squared
const BRAKE = 4;
const TOP = 2.6; // a little under the traffic on an avenue
const BOOST = 4.4;
const REVERSE = 1.1;
const DRAG = 0.6;
const HALF_LENGTH = 0.16, HALF_WIDTH = 0.085;

export interface DriverHooks {
  /** True where a car cannot go: buildings, the river, off the map. `y` is the car's height now. */
  blocked(x: number, z: number, y: number): boolean;
  /** Height of the road or ground under (x, z), preferring the deck nearest to `y`. */
  ground(x: number, z: number, y: number): number;
  onExit(): void;
}

/**
 * Driving a car around town. The orbit camera is parked and a chase camera follows a car of your own:
 * W or ↑ to accelerate, S or ↓ to brake and reverse, A/D to steer, Shift for a burst of speed, Space
 * for the handbrake, V to switch between the chase view and the driver's seat, Esc or M to get out.
 * Buildings and the river stop the car; bridges and ramps carry it up and down.
 */
export class Driver {
  active = false;
  private keys = new Set<string>();
  private car: THREE.Mesh;
  private x = 0; private z = 0; private y = 0;
  private heading = 0; // radians, 0 = towards +z
  private speed = 0;
  private cockpit = false;
  private saved: { position: THREE.Vector3; quaternion: THREE.Quaternion; near: number; fov: number } | null = null;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly hooks: DriverHooks;
  private readonly look = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, hooks: DriverHooks) {
    this.camera = camera;
    this.hooks = hooks;
    this.car = new THREE.Mesh(vehicleGeometry(1), new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xd9412f, roughness: 0.45, metalness: 0.2 }));
    this.car.castShadow = true;
    this.car.visible = false;
    scene.add(this.car);
    const code = (e: KeyboardEvent): string => e.code || (e.key.length === 1 ? `Key${e.key.toUpperCase()}` : e.key);
    window.addEventListener('keydown', e => {
      if (!this.active || (e.target as HTMLElement).tagName === 'INPUT') return;
      const c = code(e);
      this.keys.add(c);
      if (c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
      if (e.key === 'Escape') { e.stopImmediatePropagation(); this.exit(); }
      if (c === 'KeyV' && !e.repeat) this.cockpit = !this.cockpit;
    }, true);
    window.addEventListener('keyup', e => this.keys.delete(code(e)));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Where the car is, in scene space, for anything that wants to follow it. */
  get position(): { x: number; z: number } { return { x: this.x, z: this.z }; }

  /** Start at (x, z) on a road, pointing along `heading` (0 = towards +z). */
  enter(x: number, z: number, heading: number): void {
    if (this.active) return;
    this.saved = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), near: this.camera.near, fov: this.camera.fov };
    this.active = true;
    this.keys.clear();
    this.x = x; this.z = z; this.heading = heading; this.speed = 0;
    this.y = this.hooks.ground(x, z, 0);
    this.camera.near = 0.02;
    this.camera.fov = 68;
    this.camera.updateProjectionMatrix();
    this.car.visible = true;
    this.place();
    this.chase(1);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.car.visible = false;
    if (this.saved) {
      this.camera.position.copy(this.saved.position);
      this.camera.quaternion.copy(this.saved.quaternion);
      this.camera.near = this.saved.near;
      this.camera.fov = this.saved.fov;
      this.camera.updateProjectionMatrix();
    }
    this.hooks.onExit();
  }

  /** Speed in the units the HUD shows, scaled so a street's limit reads about 60 km/h. */
  get kmh(): number { return Math.round(Math.abs(this.speed) * 24); }

  private place(): void {
    this.car.position.set(this.x, this.y, this.z);
    this.car.rotation.set(0, this.heading, 0);
  }

  private hits(x: number, z: number, heading: number): boolean {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    // Four corners and the middle of each end.
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0]]) {
      const px = x + fx * HALF_LENGTH * a + fz * HALF_WIDTH * b, pz = z + fz * HALF_LENGTH * a - fx * HALF_WIDTH * b;
      if (this.hooks.blocked(px, pz, this.y)) return true;
    }
    return false;
  }

  update(dt: number): void {
    if (!this.active) return;
    const k = this.keys;
    const gas = k.has('KeyW') || k.has('ArrowUp'), brake = k.has('KeyS') || k.has('ArrowDown');
    const steer = (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0);
    const top = k.has('ShiftLeft') || k.has('ShiftRight') ? BOOST : TOP;
    if (gas) this.speed += (this.speed < 0 ? BRAKE : ACCEL) * dt;
    else if (brake) this.speed -= (this.speed > 0 ? BRAKE : ACCEL * 0.7) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), DRAG * dt);
    if (k.has('Space')) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), BRAKE * 1.6 * dt);
    this.speed = Math.max(-REVERSE, Math.min(top, this.speed > top ? this.speed - BRAKE * dt : this.speed));
    // Steering bites harder at low speed and gently at speed, and reverses when backing up.
    const grip = Math.min(1, Math.abs(this.speed) / 0.6) / (1 + Math.abs(this.speed) * 0.25);
    const turn = steer * 2.1 * grip * Math.sign(this.speed || 1) * dt;
    const heading = this.heading + turn;
    const nx = this.x + Math.sin(heading) * this.speed * dt, nz = this.z + Math.cos(heading) * this.speed * dt;
    if (!this.hits(nx, nz, heading)) { this.x = nx; this.z = nz; this.heading = heading; }
    else if (!this.hits(nx, this.z, heading)) { this.x = nx; this.heading = heading; this.speed *= 0.9; }
    else if (!this.hits(this.x, nz, heading)) { this.z = nz; this.heading = heading; this.speed *= 0.9; }
    else this.speed = -this.speed * 0.25; // a bump off the wall
    const ground = this.hooks.ground(this.x, this.z, this.y);
    this.y += (ground - this.y) * Math.min(1, dt * 12);
    this.place();
    // Nose up or down on a ramp.
    const ahead = this.hooks.ground(this.x + Math.sin(this.heading) * 0.2, this.z + Math.cos(this.heading) * 0.2, this.y);
    this.car.rotation.x = -Math.atan2(ahead - ground, 0.2);
    this.chase(Math.min(1, dt * 5));
  }

  private chase(blend: number): void {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const want = this.cockpit
      ? new THREE.Vector3(this.x + fx * 0.02, this.y + 0.2, this.z + fz * 0.02)
      : new THREE.Vector3(this.x - fx * 0.85, this.y + 0.36, this.z - fz * 0.85);
    if (this.cockpit) this.camera.position.copy(want);
    else this.camera.position.lerp(want, blend);
    const target = new THREE.Vector3(this.x + fx * 1.4, this.y + (this.cockpit ? 0.17 : 0.12), this.z + fz * 1.4);
    this.look.lerp(target, blend > 0.99 ? 1 : Math.min(1, blend * 2));
    this.camera.lookAt(this.look);
    this.car.visible = !this.cockpit;
  }
}
