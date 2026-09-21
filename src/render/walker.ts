import * as THREE from 'three';

/** Eye height of a pedestrian: a car is about 0.3 long, so a person stands a little over 0.1 tall. */
const EYE = 0.13;
const WALK = 0.75; // units per second
const RUN = 2.1;
const RADIUS = 0.06; // how close a walker gets to a wall
const LOOK = 0.0022; // radians per pixel of mouse movement

export interface WalkerHooks {
  /** True where a pedestrian cannot stand: inside a building, in the river, off the map. */
  blocked(x: number, z: number, y: number): boolean;
  /** Height of the ground or road deck underfoot, preferring the one nearest `y`. */
  ground(x: number, z: number, y: number): number;
  /** Called when the walk ends, however it ends. */
  onExit(): void;
}

/**
 * Walking the streets at eye level. The orbit camera is parked while this runs: the mouse turns the
 * head (with pointer lock, or by dragging if the browser refuses it), WASD walks, Shift runs, and
 * buildings and water stop you rather than letting you pass through them. Positions are in scene
 * space, where the map runs from -GRID/2 to GRID/2.
 */
export class Walker {
  active = false;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private dragging = false;
  private saved: { position: THREE.Vector3; quaternion: THREE.Quaternion; near: number; fov: number } | null = null;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: WalkerHooks;

  constructor(camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, hooks: WalkerHooks) {
    this.camera = camera;
    this.canvas = canvas;
    this.hooks = hooks;
    // Some synthetic events carry only a key, not a code, so fall back to one built from the key.
    const code = (e: KeyboardEvent): string => e.code || (e.key.length === 1 ? `Key${e.key.toUpperCase()}` : e.key);
    window.addEventListener('keydown', e => {
      if (!this.active || (e.target as HTMLElement).tagName === 'INPUT') return;
      this.keys.add(code(e));
      if (e.key === 'Escape') { e.stopImmediatePropagation(); this.exit(); }
    }, true);
    window.addEventListener('keyup', e => this.keys.delete(code(e)));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', e => {
      if (!this.active) return;
      e.stopImmediatePropagation();
      if (document.pointerLockElement !== canvas) {
        try { void canvas.requestPointerLock?.(); } catch { /* not allowed here */ }
        this.dragging = true;
      }
    }, true);
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', e => {
      if (!this.active) return;
      if (document.pointerLockElement !== canvas && !this.dragging) return;
      this.yaw -= e.movementX * LOOK;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - e.movementY * LOOK));
    });
    document.addEventListener('pointerlockchange', () => {
      // Leaving pointer lock with Esc is the browser's own exit; make it end the walk too.
      if (this.active && document.pointerLockElement !== canvas && this.lockedOnce) this.exit();
      if (document.pointerLockElement === canvas) this.lockedOnce = true;
    });
  }

  private lockedOnce = false;
  /** Height of the ground under the walker's feet: 0, or a bridge deck. */
  private feet = 0;

  /** Step down onto the street at (x, z), looking along `heading` (radians, 0 = towards -z). */
  enter(x: number, z: number, heading: number): void {
    if (this.active) return;
    this.saved = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), near: this.camera.near, fov: this.camera.fov };
    this.active = true;
    this.lockedOnce = false;
    this.keys.clear();
    this.yaw = heading;
    this.pitch = 0.05;
    this.camera.near = 0.02;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.feet = this.hooks.ground(x, z, 0);
    this.camera.position.set(x, this.feet + EYE, z);
    this.apply();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.dragging = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    if (this.saved) {
      this.camera.position.copy(this.saved.position);
      this.camera.quaternion.copy(this.saved.quaternion);
      this.camera.near = this.saved.near;
      this.camera.fov = this.saved.fov;
      this.camera.updateProjectionMatrix();
    }
    this.hooks.onExit();
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  update(dt: number): void {
    if (!this.active) return;
    const k = this.keys;
    let forward = 0, strafe = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) forward += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) strafe += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) strafe -= 1;
    if (forward || strafe) {
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * dt;
      const len = Math.hypot(forward, strafe);
      // Facing -z at yaw 0, with +x to the right.
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const dx = (fx * forward + -fz * strafe) / len * speed;
      const dz = (fz * forward + fx * strafe) / len * speed;
      const p = this.camera.position;
      // Try each axis on its own, so walking into a wall slides along it instead of sticking.
      if (!this.hits(p.x + dx, p.z)) p.x += dx;
      if (!this.hits(p.x, p.z + dz)) p.z += dz;
      // Climb ramps and bridge decks, then a little bob in the step.
      this.feet += (this.hooks.ground(p.x, p.z, this.feet) - this.feet) * Math.min(1, dt * 14);
      p.y = this.feet + EYE + Math.abs(Math.sin(performance.now() / 1000 * (speed / dt > WALK ? 11 : 7))) * 0.006;
    }
    this.apply();
  }

  private hits(x: number, z: number): boolean {
    const r = RADIUS;
    const y = this.feet, b = this.hooks.blocked;
    return b(x, z, y) || b(x + r, z, y) || b(x - r, z, y) || b(x, z + r, y) || b(x, z - r, y);
  }
}
