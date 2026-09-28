import * as THREE from 'three';
import { vehicleGeometry } from '../render/cars';
import type { TrafficCar } from '../render/driver';

/** How much trouble each offence stirs up; every HEAT_PER_STAR is a star, up to five. */
const HEAT_PER_STAR = 50, MAX_STARS = 5;
const HEAT = { pedestrian: 50, crash: 22, police: 45, theft: 30 } as const;
export type Offence = keyof typeof HEAT;
/** The trail the police follow is a point every TRAIL_STEP along the player's path, TRAIL_MAX of them. */
const TRAIL_STEP = 0.05, TRAIL_MAX = 1600;
/** How far back along the trail a squad car turns up, and the spacing between them. */
const SPAWN_BACK = 70, SPAWN_GAP = 22;
/** Close enough, with nothing solid in between, a squad car leaves the trail and drives straight at you. */
const DIRECT = 1.3;
const COP_LENGTH = 0.34;
/** How close a squad car pulls up to the player: alongside, boxing them in, not into them. */
const PULL_UP = 0.36;

export interface WantedHooks {
  ground(x: number, z: number, y: number): number;
  blocked(x: number, z: number, y: number): boolean;
  /** The city's own police cars, patrolling or on a call: they see you too. */
  patrols(): { x: number; z: number }[];
  /** A way in along the roads to near (x, z) from a few units off, for squad cars with no trail to follow. */
  approach(x: number, z: number): { x: number; z: number; y: number }[] | null;
}

/** Where the player is this frame. `top` is how fast the car goes flat out, without the nitrous. */
export interface Suspect { x: number; z: number; y: number; speed: number; top: number; onFoot: boolean }

interface Cop {
  group: THREE.Group; lights: THREE.Mesh[];
  x: number; z: number; y: number; heading: number; speed: number;
  /** How far along the trail, as an absolute index into it. */
  along: number;
  /** Off the trail, driving straight at the player. */
  direct: boolean;
}

/**
 * A wanted level, the way it goes in a crime game. Running people down, or knocking into cars with the
 * police looking on, earns stars; squad cars come up behind along the road you took and chase you,
 * more of them and faster the more stars you have. Stay out of their sight long enough and the stars
 * fade (they flash while you are getting away); let them box you in, stopped, and you are busted.
 */
export class Wanted {
  readonly group = new THREE.Group();
  heat = 0;
  /** 0..1: how close the police are to arresting you. */
  bust = 0;
  /** Seconds since any police saw you. */
  private unseen = 0;
  /** Whether the police have caught sight of you since the stars came: until then there is nothing to escape. */
  private contact = false;
  /** Seconds waiting for a squad car to turn up, for when none can reach you at all. */
  private waiting = 0;
  private trail: { x: number; z: number; y: number }[] = [];
  /** The absolute index of trail[0]: the oldest points are dropped as it grows. */
  private base = 0;
  private cops: Cop[] = [];
  private spawnWait = 0;
  private cooldown = 0;
  private clock = 0;
  private readonly hooks: WantedHooks;
  private readonly geometry = vehicleGeometry(5, 2);
  private readonly materials = {
    car: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.3 }),
    red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
    blue: new THREE.MeshBasicMaterial({ color: 0x2a6bff }),
  };
  onBusted?: (stars: number) => void;
  onEscaped?: () => void;

  constructor(hooks: WantedHooks) {
    this.hooks = hooks;
  }

  get stars(): number { return this.heat <= 0 ? 0 : Math.min(MAX_STARS, Math.ceil(this.heat / HEAT_PER_STAR)); }
  /** Out of sight with stars still showing: they flash while you slip away. */
  get evading(): boolean { return this.stars > 0 && this.contact && this.unseen > 0.6; }
  /** Seconds out of sight it takes to lose the police at the current level. */
  private get escapeTime(): number { return 3 + this.stars * 1.5; }

  /** Something the police care about. A crash or a stolen car only counts when they are close enough to see it. */
  offence(kind: Offence): void {
    if (kind !== 'pedestrian' && this.cooldown > 0) return;
    this.cooldown = kind === 'police' ? 3 : 1;
    this.heat = Math.min(MAX_STARS * HEAT_PER_STAR, this.heat + HEAT[kind]);
    this.unseen = 0;
  }

  /** Is a police car, the city's or one of the chase, within `r` of (x, z)? */
  policeNear(x: number, z: number, r: number): boolean {
    if (this.cops.some(c => Math.hypot(c.x - x, c.z - z) < r)) return true;
    return this.hooks.patrols().some(p => Math.hypot(p.x - x, p.z - z) < r);
  }

  /** The squad cars, for the player's car to bump into. */
  cars(): TrafficCar[] {
    return this.cops.map(c => ({ x: c.x, z: c.z, y: c.y, angle: c.heading, length: COP_LENGTH, police: true }));
  }

  /** Where the squad cars are, for the siren. */
  positions(): { x: number; z: number }[] { return this.cops.map(c => ({ x: c.x, z: c.z })); }

  /** Forget everything: back on the map, or into a race. */
  reset(): void {
    this.heat = 0; this.bust = 0; this.unseen = 0; this.contact = false; this.waiting = 0;
    this.trail = []; this.base = 0;
    this.clearCops();
  }

  private clearCops(): void {
    for (const c of this.cops) this.group.remove(c.group);
    this.cops = [];
    this.spawnWait = 1.5;
  }

  update(dt: number, p: Suspect): void {
    this.clock += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.record(p);
    const stars = this.stars;
    if (!stars) { if (this.cops.length) this.clearCops(); this.bust = 0; this.contact = false; this.waiting = 0; return; }

    // More stars, more squad cars, turning up one after another from back down the road.
    const want = [0, 1, 1, 2, 2, 3][stars];
    this.spawnWait -= dt;
    if (this.cops.length < want && this.spawnWait <= 0) this.spawn(p);

    for (const c of this.cops) this.drive(c, dt, p, stars);
    this.separate();

    // Seen by the chase with nothing in the way (round a corner they lose sight of you), or by a patrol
    // passing close: the clock to getting away starts again.
    const sight = 2.4 + stars * 0.3;
    const seen = this.cops.some(c => {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      return d < 0.8 || d < sight && this.clear(c.x, c.z, p.x, p.z, Math.max(c.y, p.y));
    }) || this.hooks.patrols().some(q => Math.hypot(q.x - p.x, q.z - p.z) < 2);
    if (seen) this.contact = true;
    // The clock to getting away only runs once they have seen you; if no squad car can reach you at
    // all, the trouble blows over in the end anyway.
    this.unseen = seen ? 0 : this.contact ? this.unseen + dt : 0;
    this.waiting = this.contact ? 0 : this.waiting + dt;
    if (this.unseen > this.escapeTime || this.waiting > 12) {
      this.heat = 0; this.bust = 0; this.contact = false; this.waiting = 0; this.clearCops();
      this.onEscaped?.();
      return;
    }

    // Boxed in: a squad car alongside and the car stopped (or caught on foot), and the net closes.
    const gap = Math.min(...this.cops.map(c => Math.hypot(c.x - p.x, c.z - p.z)), Infinity);
    const caught = p.onFoot ? gap < 0.4 : gap < 0.5 && p.speed < 0.3;
    this.bust = caught ? Math.min(1, this.bust + dt / (p.onFoot ? 2 : 3)) : Math.max(0, this.bust - dt * 0.8);
    if (this.bust >= 1) {
      const was = stars;
      this.heat = 0; this.bust = 0; this.contact = false; this.clearCops();
      this.onBusted?.(was);
    }
  }

  /** Leave a trail for the police to follow: they drive where you went. */
  private record(p: Suspect): void {
    const last = this.trail[this.trail.length - 1];
    // A jump (a race reset, getting in somewhere else) starts a fresh trail.
    if (last && Math.hypot(p.x - last.x, p.z - last.z) > 1.5) { this.trail = []; this.base = 0; this.clearCops(); }
    // Evenly spaced, however far the player went this frame: the squad cars count their way along it.
    let tail = this.trail[this.trail.length - 1];
    if (!tail) this.trail.push({ x: p.x, z: p.z, y: p.y });
    else for (let d = Math.hypot(p.x - tail.x, p.z - tail.z); d >= TRAIL_STEP; d -= TRAIL_STEP) {
      const u = TRAIL_STEP / d;
      tail = { x: tail.x + (p.x - tail.x) * u, z: tail.z + (p.z - tail.z) * u, y: tail.y + (p.y - tail.y) * u };
      this.trail.push(tail);
    }
    if (this.trail.length > TRAIL_MAX) {
      const drop = this.trail.length - TRAIL_MAX + 200;
      this.trail.splice(0, drop);
      this.base += drop;
    }
  }

  /** Put a way in along the roads onto the start of the trail. False when there is none. */
  private lengthen(): boolean {
    const first = this.trail[0];
    if (!first || this.cops.length) return false;
    const path = this.hooks.approach(first.x, first.z);
    if (!path || path.length < 2) return false;
    // Resample to the trail's spacing, then the last stretch from the junction to where the trail starts.
    const pts: { x: number; z: number; y: number }[] = [];
    const all = [...path, first];
    for (let i = 0; i + 1 < all.length; i++) {
      const a = all[i], b = all[i + 1], n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / TRAIL_STEP));
      for (let k = 0; k < n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n, y: a.y + (b.y - a.y) * k / n });
    }
    this.trail = pts.concat(this.trail);
    this.base -= pts.length;
    return true;
  }

  private point(abs: number): { x: number; z: number; y: number } {
    const i = Math.max(0, Math.min(this.trail.length - 1, Math.floor(abs - this.base)));
    return this.trail[i];
  }

  private spawn(p: Suspect): void {
    const end = this.base + this.trail.length - 1;
    // Out of sight back down the road: never popping up right beside the player. With too short a
    // trail to come along (standing still where the trouble started), wait for one.
    let at = Math.max(this.base, end - SPAWN_BACK - this.cops.length * SPAWN_GAP);
    while (at > this.base && Math.hypot(this.point(at).x - p.x, this.point(at).z - p.z) < 2) at -= 10;
    at = Math.max(this.base, at);
    if (Math.hypot(this.point(at).x - p.x, this.point(at).z - p.z) < 2) {
      // Too short a trail (standing where the trouble started): they come in along the roads instead,
      // that way in joined onto the front of the trail.
      if (!this.lengthen()) { this.spawnWait = 1; return; }
      at = this.base;
    }
    const q = this.point(at), n = this.point(Math.min(end, at + 2));
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.geometry, this.materials.car);
    body.castShadow = true;
    const lights = [new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), this.materials.red), new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), this.materials.blue)];
    lights[0].position.set(-0.035, 0.26, 0.05); lights[1].position.set(0.035, 0.26, 0.05);
    group.add(body, ...lights);
    group.rotation.order = 'YXZ';
    this.group.add(group);
    const heading = Math.atan2(n.x - q.x, n.z - q.z);
    // They arrive already going: the chase is on.
    this.cops.push({ group, lights, x: q.x, z: q.z, y: q.y, heading, speed: Math.min(p.top, 1.6), along: at, direct: false });
    this.spawnWait = 3.5;
  }

  private clear(ax: number, az: number, bx: number, bz: number, y: number): boolean {
    const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / 0.12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.hooks.blocked(ax + (bx - ax) * t, az + (bz - az) * t, y)) return false;
    }
    return true;
  }

  private drive(c: Cop, dt: number, p: Suspect, stars: number): void {
    const end = this.base + this.trail.length - 1;
    const gap = Math.hypot(p.x - c.x, p.z - c.z);
    // Faster the more stars: a little slower than the car flat out at one star, a little quicker at
    // five, never as quick as the nitrous. Once they have lost sight of you they only cruise, searching,
    // and the gap opens.
    const searching = this.contact && this.unseen > 1.5;
    const top = p.top * (0.84 + stars * 0.04) * (searching ? 0.6 : 1);
    const direct = gap < DIRECT && Math.abs(p.y - c.y) < 0.15 && this.clear(c.x, c.z, p.x, p.z, c.y);
    // Close in flat out, then ease off to the player's pace and pull up a car's length short.
    const behind = direct ? gap : (end - c.along) * TRAIL_STEP;
    const want = behind > 1 ? top : Math.min(top, p.speed * 0.95 + Math.max(0, behind - PULL_UP) * 3);
    c.speed += Math.max(-5 * dt, Math.min(2.6 * dt, want - c.speed));
    if (direct) {
      const aim = Math.atan2(p.x - c.x, p.z - c.z);
      const turn = Math.atan2(Math.sin(aim - c.heading), Math.cos(aim - c.heading));
      c.heading += Math.max(-4 * dt, Math.min(4 * dt, turn));
      const nx = c.x + Math.sin(c.heading) * c.speed * dt, nz = c.z + Math.cos(c.heading) * c.speed * dt;
      if (!this.hooks.blocked(nx, nz, c.y)) { c.x = nx; c.z = nz; } else c.speed *= 0.5;
      c.y += (this.hooks.ground(c.x, c.z, c.y) - c.y) * Math.min(1, dt * 20);
      // Keep its place on the trail: the nearest point ahead of where it had got to.
      let best = Infinity;
      for (let i = Math.floor(c.along); i <= end; i++) {
        const q = this.point(i), d = Math.hypot(q.x - c.x, q.z - c.z);
        if (d < best) { best = d; c.along = i; }
      }
      c.direct = true;
    } else {
      c.along = Math.max(c.along, Math.min(end - PULL_UP / TRAIL_STEP, c.along + c.speed * dt / TRAIL_STEP));
      const i = Math.floor(c.along), q = this.point(i), n = this.point(Math.min(end, i + 1)), u = c.along - i;
      const tx = q.x + (n.x - q.x) * u, tz = q.z + (n.z - q.z) * u, ty = q.y + (n.y - q.y) * u;
      // Back onto the trail smoothly after a straight run at the player.
      const blend = c.direct ? Math.min(1, dt * 6) : 1;
      if (c.direct && Math.hypot(tx - c.x, tz - c.z) < 0.03) c.direct = false;
      c.x += (tx - c.x) * blend; c.z += (tz - c.z) * blend; c.y += (ty - c.y) * blend;
      const ahead = this.point(Math.min(end, i + 3));
      if (Math.hypot(ahead.x - c.x, ahead.z - c.z) > 1e-3) {
        const aim = Math.atan2(ahead.x - c.x, ahead.z - c.z);
        c.heading += Math.atan2(Math.sin(aim - c.heading), Math.cos(aim - c.heading)) * Math.min(1, dt * 10);
      }
    }
    c.group.position.set(c.x, c.y, c.z);
    c.group.rotation.set(0, c.heading, 0);
    const flash = Math.floor(this.clock * 6) % 2 === 0;
    c.lights[0].visible = flash; c.lights[1].visible = !flash;
  }

  /** Squad cars on the same trail keep a car's length apart rather than driving through each other. */
  private separate(): void {
    for (const a of this.cops) for (const b of this.cops) {
      if (a === b) continue;
      const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < COP_LENGTH * 1.1 && a.along < b.along) a.speed = Math.min(a.speed, b.speed * 0.9);
    }
  }
}
