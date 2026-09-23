import * as THREE from 'three';
import { vehicleGeometry } from './cars';

const REVERSE = 1.1;
const DRAG = 0.6;
const HALF_LENGTH = 0.16, HALF_WIDTH = 0.085;

/** How the car drives: the garage sets these from the car and its upgrades. */
export interface DriverStats {
  /** Top speed and top speed with the nitrous (Shift), in units per second. */
  top: number; boost: number;
  /** Acceleration and braking, units per second squared. */
  accel: number; brake: number;
  /** How hard the tyres hold the car to its heading, per second, gripping and sliding. */
  grip: number; slide: number;
  /** How fast it turns, radians per second at low speed. */
  steer: number;
  /** How far it leans in the corners, 1 standard. */
  roll: number;
}
export const STOCK: DriverStats = { top: 2.6, boost: 4.4, accel: 1.25, brake: 4, grip: 9, slide: 1.1, steer: 2.3, roll: 1 };
/** The car's own footprint as two circles, front and back, for bumping into traffic. */
const BODY_R = 0.088, BODY_OFFSET = 0.075;
const MAX_MARKS = 900, MAX_SMOKE = 70;

/** Another vehicle on the road, in scene space: where it is, which way it points, and how long it is. */
export interface TrafficCar { x: number; z: number; angle: number; length: number; y: number }

export interface DriverHooks {
  /** True where a car cannot go: buildings, the river, off the map. `y` is the car's height now. */
  blocked(x: number, z: number, y: number): boolean;
  /** Height of the road or ground under (x, z), preferring the deck nearest to `y`. */
  ground(x: number, z: number, y: number): number;
  /** Vehicles near (x, z), to bump into. */
  traffic(x: number, z: number, radius: number): TrafficCar[];
  /** A knock against a wall or another car, 0..1 by how hard. */
  impact?(strength: number): void;
  onExit(): void;
}

/**
 * Driving a car around town. The orbit camera is parked and a chase camera follows a car of your own:
 * W or ↑ to accelerate, S or ↓ to brake and reverse, A/D to steer, Shift for a burst of speed, Space
 * for the handbrake, V to switch between the chase view and the driver's seat, Esc or M to get out.
 *
 * The car has momentum of its own, separate from where it points: the tyres pull the two together,
 * hard normally and hardly at all under the handbrake or when the back steps out under power, so it
 * drifts through corners, leaving skid marks and tyre smoke. Buildings, the river and other traffic
 * stop it (the traffic stops for it too); bridges and ramps carry it up and down, pitching front to
 * back on the slope, and it leans in the corners.
 */
export class Driver {
  active = false;
  stats: DriverStats = { ...STOCK };
  /** Held still (a race's countdown): the controls do nothing. */
  frozen = false;
  private keys = new Set<string>();
  private car: THREE.Group;
  private body: THREE.Mesh;
  private x = 0; private z = 0; private y = 0;
  heading = 0; // radians, 0 = towards +z
  /** Momentum, in scene units per second: not always the way the car points. */
  vx = 0; vz = 0;
  private yawRate = 0;
  private roll = 0; private pitch = 0; private squat = 0;
  private cockpit = false;
  private shake = 0;
  private camYaw = 0;
  private saved: { position: THREE.Vector3; quaternion: THREE.Quaternion; near: number; fov: number } | null = null;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly hooks: DriverHooks;
  private readonly look = new THREE.Vector3();
  private marks: THREE.InstancedMesh;
  private markNext = 0;
  private lastMark: [number, number, number, number] | null = null;
  private smoke: THREE.InstancedMesh;
  private puffs: { x: number; y: number; z: number; age: number; life: number; size: number; vx: number; vz: number }[] = [];
  private readonly obj = new THREE.Object3D();
  /** How much the tyres are sliding, 0..1, for the screech. */
  slip = 0;
  /** Joystick input from the touch controls: throttle (-1 brake/reverse .. 1) and steer (-1 right .. 1 left). */
  analog = { throttle: 0, steer: 0 };

  /** Switch between the chase camera and the driver's seat. */
  toggleView(): void { this.cockpit = !this.cockpit; }

  constructor(camera: THREE.PerspectiveCamera, scene: THREE.Scene, hooks: DriverHooks) {
    this.camera = camera;
    this.hooks = hooks;
    this.body = new THREE.Mesh(vehicleGeometry(1, 2), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.3 }));
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.car = new THREE.Group();
    this.car.add(this.body);
    this.car.rotation.order = 'YXZ';
    this.car.visible = false;
    scene.add(this.car);
    // Skid marks: dark strips on the road under the back wheels, the oldest overwritten by the newest.
    const mark = new THREE.PlaneGeometry(1, 1);
    mark.rotateX(-Math.PI / 2);
    this.marks = new THREE.InstancedMesh(mark, new THREE.MeshBasicMaterial({ color: 0x15161a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), MAX_MARKS);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    scene.add(this.marks);
    // Tyre smoke: soft grey puffs that swell and fade.
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xe8e8ea, transparent: true, opacity: 0.32, depthWrite: false, roughness: 1 }), MAX_SMOKE);
    this.smoke.count = 0;
    this.smoke.frustumCulled = false;
    scene.add(this.smoke);
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
  get position(): { x: number; z: number; y: number } { return { x: this.x, z: this.z, y: this.y }; }

  /** Whether the throttle is down, for a race's launch. */
  get throttle(): boolean { return this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.analog.throttle > 0.2; }

  /** Put a different car under the player: its body and how it drives. */
  setCar(geometry: THREE.BufferGeometry, stats: DriverStats): void {
    this.body.geometry.dispose();
    this.body.geometry = geometry;
    this.stats = { ...stats };
  }

  /** Move the car somewhere else (a race's start line), at a standstill. */
  teleport(x: number, z: number, heading: number): void {
    this.x = x; this.z = z; this.heading = heading; this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.y = this.hooks.ground(x, z, this.y);
    this.camYaw = heading;
    this.marks.count = 0; this.lastMark = null;
    this.place();
    this.chase(1, 0);
  }

  /** A shove along the way the car points: a perfect launch. */
  kick(speed: number): void {
    this.vx += Math.sin(this.heading) * speed; this.vz += Math.cos(this.heading) * speed;
  }

  /** Start at (x, z) on a road, pointing along `heading` (0 = towards +z). */
  enter(x: number, z: number, heading: number): void {
    if (this.active) return;
    this.saved = { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), near: this.camera.near, fov: this.camera.fov };
    this.active = true;
    this.keys.clear();
    this.x = x; this.z = z; this.heading = heading; this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.camYaw = heading;
    this.y = this.hooks.ground(x, z, 0);
    this.camera.near = 0.015;
    this.camera.fov = 66;
    this.camera.updateProjectionMatrix();
    this.car.visible = true;
    this.place();
    this.chase(1, 0);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.car.visible = false;
    this.marks.count = 0; this.markNext = 0; this.lastMark = null;
    this.puffs = []; this.smoke.count = 0;
    this.slip = 0;
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
  get kmh(): number { return Math.round(Math.hypot(this.vx, this.vz) * 24); }

  private place(): void {
    this.car.position.set(this.x, this.y, this.z);
    this.car.rotation.set(this.pitch, this.heading, this.roll);
    this.body.position.y = this.squat;
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

  /** Push the car out of any vehicle it has run into, and take the knock off its speed. */
  private bump(): void {
    const others = this.hooks.traffic(this.x, this.z, 0.8);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let worst = 0;
    for (const o of others) {
      if (Math.abs(o.y - this.y) > 0.12) continue; // on a bridge above or below
      const ox = Math.sin(o.angle), oz = Math.cos(o.angle), reach = Math.max(0, o.length / 2 - BODY_R);
      for (const a of [-1, 1]) {
        const px = this.x + fx * BODY_OFFSET * a, pz = this.z + fz * BODY_OFFSET * a;
        // Nearest point on the other car's spine.
        const t = Math.max(-reach, Math.min(reach, (px - o.x) * ox + (pz - o.z) * oz));
        const qx = o.x + ox * t, qz = o.z + oz * t;
        let nx = px - qx, nz = pz - qz;
        const d = Math.hypot(nx, nz), overlap = BODY_R * 2 - d;
        if (overlap <= 0) continue;
        if (d < 1e-4) { nx = -fx; nz = -fz; } else { nx /= d; nz /= d; }
        this.x += nx * overlap; this.z += nz * overlap;
        // Lose the speed going into the other car, and bounce a little off it.
        const into = this.vx * nx + this.vz * nz;
        if (into < 0) {
          this.vx -= nx * into * 1.35; this.vz -= nz * into * 1.35;
          this.vx *= 0.8; this.vz *= 0.8;
          this.yawRate += (nx * fz - nz * fx) * into * 2;
          worst = Math.max(worst, -into);
        }
      }
    }
    if (worst > 0.15) { this.shake = Math.min(1, worst / 2.5); this.hooks.impact?.(Math.min(1, worst / 3)); }
  }

  update(dt: number): void {
    if (!this.active) return;
    const k = this.frozen ? new Set<string>() : this.keys;
    const S = this.stats;
    if (this.frozen) { this.vx *= 0.8; this.vz *= 0.8; }
    const gas = !this.frozen && k.has('KeyW') || k.has('ArrowUp') || this.analog.throttle > 0.2, brake = k.has('KeyS') || k.has('ArrowDown') || this.analog.throttle < -0.2;
    const steer = Math.max(-1, Math.min(1, (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) + this.analog.steer));
    const boost = k.has('ShiftLeft') || k.has('ShiftRight'), handbrake = k.has('Space');
    const top = boost ? S.boost : S.top;
    let fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const speed = Math.abs(this.vx * fx + this.vz * fz);

    // Steering turns the car; how fast depends on speed. The momentum does not turn with it: the tyres
    // have to drag it round, and when they let go the car slides.
    const reversing = this.vx * fx + this.vz * fz < -0.05;
    const bite = Math.min(1, speed / 0.5) / (1 + speed * 0.18);
    const wantYaw = steer * S.steer * bite * (reversing ? -1 : 1) * (handbrake ? 1.6 : 1);
    this.yawRate += (wantYaw - this.yawRate) * Math.min(1, dt * (handbrake ? 5 : 9));
    // Power oversteer: flooring it through a fast corner, or the handbrake, breaks the rear loose.
    const loose = handbrake && speed > 0.6 ? 1 : Math.max(0, Math.min(1, (speed - S.top * 0.73) / 1.2)) * Math.abs(steer) * (gas ? 1 : 0.35);
    this.heading += this.yawRate * dt * (1 + loose * 0.4);
    fx = Math.sin(this.heading); fz = Math.cos(this.heading);
    let forward = this.vx * fx + this.vz * fz, lateral = this.vx * fz - this.vz * fx;

    // Engine, brakes and drag act along the car.
    let accel = 0;
    if (gas) accel = forward < 0 ? S.brake : S.accel * (boost ? 1.4 : 1);
    else if (brake) accel = forward > 0 ? -S.brake : -S.accel * 0.7;
    else accel = -Math.sign(forward) * Math.min(Math.abs(forward) / dt, DRAG);
    if (handbrake) accel -= Math.sign(forward) * Math.min(Math.abs(forward) / dt, S.brake * 0.22);
    forward += accel * dt;
    if (forward > top) forward -= Math.min(forward - top, S.brake * dt);
    forward = Math.max(-REVERSE, forward);
    // The tyres pull the sideways slide back into line, hard when gripping, gently when loose; the
    // slide scrubs off a little speed as it goes.
    const grip = S.grip + (S.slide - S.grip) * loose;
    const before = lateral;
    lateral *= Math.exp(-grip * dt);
    forward -= Math.sign(forward) * Math.min(Math.abs(forward), Math.abs(before - lateral) * 0.08);
    this.vx = fx * forward + fz * lateral;
    this.vz = fz * forward - fx * lateral;
    const slip = speed > 0.5 ? Math.abs(lateral) / Math.max(0.5, Math.hypot(forward, lateral)) : 0;
    this.slip += (Math.min(1, Math.max(0, slip - 0.1) * 3) - this.slip) * Math.min(1, dt * 8);

    // Move, sliding along walls.
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (!this.hits(nx, nz, this.heading)) { this.x = nx; this.z = nz; }
    else if (!this.hits(nx, this.z, this.heading)) { this.x = nx; this.vz *= -0.2; this.vx *= 0.85; this.knock(Math.abs(this.vz) * 5); }
    else if (!this.hits(this.x, nz, this.heading)) { this.z = nz; this.vx *= -0.2; this.vz *= 0.85; this.knock(Math.abs(this.vx) * 5); }
    else { this.knock(Math.hypot(this.vx, this.vz)); this.vx *= -0.25; this.vz *= -0.25; } // a bump off the wall
    this.bump();

    // Sit on the road through both axles, so a ramp pitches the car rather than burying its nose.
    const ax = 0.13;
    const front = this.hooks.ground(this.x + fx * ax, this.z + fz * ax, this.y), rear = this.hooks.ground(this.x - fx * ax, this.z - fz * ax, this.y);
    const ground = (front + rear) / 2;
    this.y += (ground - this.y) * Math.min(1, dt * 22);
    // Lean out of the corner, squat under power and dive under braking.
    const turnAccel = this.yawRate * forward;
    this.roll += (Math.max(-0.09, Math.min(0.09, turnAccel * 0.025 * S.roll)) - this.roll) * Math.min(1, dt * 6);
    const pitchTarget = -Math.atan2(front - rear, ax * 2) + Math.max(-0.05, Math.min(0.05, -accel * 0.012));
    this.pitch += (pitchTarget - this.pitch) * Math.min(1, dt * 10);
    this.squat = Math.sin(performance.now() / 90) * 0.0012 * Math.min(1, speed);
    this.place();

    this.trails(dt, fx, fz);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.chase(Math.min(1, dt * 6), dt);
  }

  private knock(strength: number): void {
    if (strength < 0.3) return;
    this.shake = Math.min(1, strength / 2.5);
    this.hooks.impact?.(Math.min(1, strength / 3));
  }

  /** Skid marks under the back wheels and smoke off them while the tyres slide. */
  private trails(dt: number, fx: number, fz: number): void {
    const obj = this.obj;
    if (this.slip > 0.25 && this.y < 2) {
      const rx = this.x - fx * 0.1, rz = this.z - fz * 0.1;
      const wheels: [number, number][] = [[rx + fz * 0.07, rz - fx * 0.07], [rx - fz * 0.07, rz + fx * 0.07]];
      const last = this.lastMark;
      if (!last || Math.hypot(wheels[0][0] - last[0], wheels[0][1] - last[1]) > 0.025) {
        if (last) wheels.forEach(([wx, wz], w) => {
          const px = last[w * 2], pz = last[w * 2 + 1], len = Math.hypot(wx - px, wz - pz);
          if (len > 0.2) return;
          obj.position.set((wx + px) / 2, this.y + 0.047, (wz + pz) / 2);
          obj.rotation.set(0, Math.atan2(wx - px, wz - pz), 0);
          obj.scale.set(0.022, 1, len + 0.004);
          obj.updateMatrix();
          this.marks.setMatrixAt(this.markNext, obj.matrix);
          this.markNext = (this.markNext + 1) % MAX_MARKS;
          this.marks.count = Math.min(MAX_MARKS, this.marks.count + 1);
        });
        this.lastMark = [wheels[0][0], wheels[0][1], wheels[1][0], wheels[1][1]];
        this.marks.instanceMatrix.needsUpdate = true;
      }
      if (Math.random() < this.slip * dt * 40 && this.puffs.length < MAX_SMOKE) {
        const [wx, wz] = wheels[Math.random() < 0.5 ? 0 : 1];
        this.puffs.push({ x: wx, y: this.y + 0.03, z: wz, age: 0, life: 0.9 + Math.random() * 0.8, size: 0.022 + Math.random() * 0.016, vx: -this.vx * 0.15 + (Math.random() - 0.5) * 0.1, vz: -this.vz * 0.15 + (Math.random() - 0.5) * 0.1 });
      }
    } else this.lastMark = null;
    // Puffs drift, rise, swell and shrink away.
    this.puffs = this.puffs.filter(p => (p.age += dt) < p.life);
    this.puffs.forEach((p, i) => {
      p.x += p.vx * dt; p.z += p.vz * dt; p.y += dt * 0.05;
      const t = p.age / p.life, s = p.size * (1 + t * 2.2) * (1 - t * t);
      obj.position.set(p.x, p.y, p.z); obj.rotation.set(0, 0, 0); obj.scale.setScalar(Math.max(0.001, s)); obj.updateMatrix();
      this.smoke.setMatrixAt(i, obj.matrix);
    });
    this.smoke.count = this.puffs.length;
    this.smoke.instanceMatrix.needsUpdate = true;
  }

  private chase(blend: number, dt: number): void {
    const speed = Math.hypot(this.vx, this.vz);
    // The camera follows where the car is going more than where it points, so a drift shows the car sideways.
    const travel = speed > 0.4 ? Math.atan2(this.vx, this.vz) : this.heading;
    const forwardish = Math.cos(travel - this.heading) > 0 ? travel : this.heading;
    const target = this.heading + Math.atan2(Math.sin(forwardish - this.heading), Math.cos(forwardish - this.heading)) * 0.55;
    this.camYaw += Math.atan2(Math.sin(target - this.camYaw), Math.cos(target - this.camYaw)) * Math.min(1, blend * 1.3);
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const shake = this.shake * this.shake;
    const jitter = (): number => (Math.random() - 0.5) * shake * 0.03;
    if (this.cockpit) {
      this.camera.position.set(this.x + hx * 0.01 + jitter(), this.y + 0.15 + jitter(), this.z + hz * 0.01 + jitter());
      this.look.set(this.x + hx * 1.2, this.y + 0.13, this.z + hz * 1.2);
    } else {
      // Close behind and a little above, pulling back a touch with speed.
      const back = 0.62 + Math.min(0.14, speed * 0.035), up = 0.3 + Math.min(0.05, speed * 0.012);
      const want = new THREE.Vector3(this.x - fx * back + jitter(), this.y + up + jitter(), this.z - fz * back + jitter());
      this.camera.position.lerp(want, blend);
      // Never let the camera sink below the road deck the car is on (a bridge, a ramp).
      this.camera.position.y = Math.max(this.camera.position.y, this.y + 0.1);
      const lookAt = new THREE.Vector3(this.x + fx * 1.6, this.y + 0.13, this.z + fz * 1.6);
      this.look.lerp(lookAt, blend >= 1 ? 1 : Math.min(1, blend * 2));
    }
    this.camera.lookAt(this.look);
    // A wider view the faster you go.
    const fov = 66 + Math.min(10, speed * 2.4);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix(); }
    this.car.visible = !this.cockpit;
  }
}
