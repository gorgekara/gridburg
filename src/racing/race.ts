import * as THREE from 'three';
import { RACE_KINDS, routeAt, lineAt, nearestOnRoute, cornerSpeed, planRaces } from './routes';
import type { RaceRoute, RaceKind } from './routes';
import { playerCarGeometry } from './carModels';
import type { CarModel } from './garage';
import { vehicleGeometry } from '../render/cars';
import type { Driver, TrafficCar } from '../render/driver';
import type { Network } from '../roads/network';

/**
 * Street racing: the race spots around town, and a race while one is on. In free driving each race's
 * start is a glowing ring on the road; drive into one and press Enter (or pick it in the garage). A
 * race puts barriers across every side street on the route with arrows pointing the way on, a
 * chequered line across the road at the start and the finish, rivals (or a police car) on the road, a countdown, and a running
 * place, lap, time and wrong-way warning for the HUD.
 */

export interface RaceHud {
  kind: RaceKind; name: string;
  phase: 'countdown' | 'racing' | 'finished';
  countdown: number;
  place: number; racers: number;
  lap: number; laps: number;
  time: number;
  /** Fraction of the whole race done. */
  progress: number;
  wrongWay: boolean; offRoute: boolean;
  score: number; target: number; combo: number;
  /** How close the police are to boxing you in, 0..1. */
  busted: number;
  message: string; messageTime: number;
}

export interface RaceResult {
  race: RaceRoute;
  won: boolean;
  place: number; racers: number;
  time: number;
  score: number;
  busted: boolean;
  /** Share of the purse earned: 1 for a win. */
  share: number;
  reward: number;
  medal: string;
}

interface Rival {
  s: number; speed: number; lane: number; skill: number;
  group: THREE.Group;
  done: number | null;
}

/**
 * Where the start line is painted: on a loop, where the lap starts (the middle of a street, which the
 * grid lines up behind); on a run, a little way in, so the grid has road behind it.
 */
const GRID_START = 1.8;
const startLine = (r: RaceRoute): number => r.loop ? 0 : GRID_START;
/** How many chevrons light the way ahead, and how far apart. */
const GUIDE_CHEVRONS = 18, GUIDE_GAP = 0.4;
/** A vivid amber that stands out against asphalt, road paint and sky alike. */
const GUIDE_COLOR = 0xff9d00;
const RIVAL_MODELS: CarModel[] = ['coupe', 'rally', 'muscle', 'super', 'hatch'];
const RIVAL_PAINTS = [0x2f6fd8, 0xf2b31f, 0x3fae5f, 0x8a3fd8, 0xff7a1f, 0x1f2226, 0xf2f2ee];

export class RaceWorld {
  readonly group = new THREE.Group();
  races: RaceRoute[] = [];
  /** The race being run, if any. */
  race: RaceRoute | null = null;
  hud: RaceHud | null = null;
  /** The race start the car is sitting on in free driving. */
  nearby: RaceRoute | null = null;
  onFinish: ((result: RaceResult) => void) | null = null;
  /** A race began or ended. */
  onRacing: ((racing: boolean) => void) | null = null;
  private markers = new THREE.Group();
  private course = new THREE.Group();
  /** Chevrons flowing along the road ahead, showing the way. */
  private guide: THREE.Mesh;
  private guidePositions = new Float32Array(GUIDE_CHEVRONS * 12 * 3);
  private guideColors = new Float32Array(GUIDE_CHEVRONS * 12 * 3);
  private rivals: Rival[] = [];
  private police: { group: THREE.Group; lights: THREE.Mesh[]; along: number; speed: number } | null = null;
  private trail: { x: number; z: number; y: number; h: number }[] = [];
  private planned = '';
  private progress = 0;
  private started = 0;
  private clock = 0;
  private offTime = 0;
  private launched = false;
  private heldAtGo = false;
  private drift = { banked: 0, chain: 0, chainTime: 0, quiet: 0 };
  private difficulty = 1;
  private readonly materials = {
    ring: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    beam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    car: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.3 }),
    red: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
    blue: new THREE.MeshBasicMaterial({ color: 0x3060ff }),
  };

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.guidePositions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.guideColors, 3));
    this.guide = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }));
    this.guide.frustumCulled = false;
    this.guide.renderOrder = 2;
    this.guide.visible = false;
    this.group.add(this.markers, this.course, this.guide);
  }

  /**
   * Show the way: chevrons glowing on the road for the next few units of the route, flowing forward.
   */
  private showWay(r: RaceRoute, time: number): void {
    // Bright and warm, so the way reads at a glance whatever the race's own colour.
    const color = new THREE.Color(GUIDE_COLOR);
    const pos = this.guidePositions, col = this.guideColors;
    const total = r.loop ? r.length * r.laps : r.length;
    const flow = (time * 1.4) % GUIDE_GAP;
    let v = 0;
    for (let k = 0; k < GUIDE_CHEVRONS; k++) {
      const d = this.progress + 0.5 + k * GUIDE_GAP - flow;
      const visible = d < total - 0.1;
      const p = routeAt(r, d), fade = visible ? 0.35 + 0.65 * (1 - k / GUIDE_CHEVRONS) : 0;
      // A chevron: two slanted bars meeting at the point, lying on the road.
      const nx = -p.tz, nz = p.tx, w = 0.15, back = 0.1, bar = 0.05, y = p.y + (visible ? 0.056 : -5);
      for (const side of [-1, 1]) {
        const tipX = p.x, tipZ = p.z;
        const endX = p.x + nx * w * side - p.tx * back, endZ = p.z + nz * w * side - p.tz * back;
        const quad = [
          [tipX, tipZ], [endX, endZ], [endX - p.tx * bar, endZ - p.tz * bar], [tipX - p.tx * bar, tipZ - p.tz * bar],
        ];
        for (const i of [0, 1, 2, 0, 2, 3]) {
          pos[v * 3] = quad[i][0]; pos[v * 3 + 1] = y; pos[v * 3 + 2] = quad[i][1];
          col[v * 3] = color.r * fade; col[v * 3 + 1] = color.g * fade; col[v * 3 + 2] = color.b * fade;
          v++;
        }
      }
    }
    this.guide.geometry.attributes.position.needsUpdate = true;
    this.guide.geometry.attributes.color.needsUpdate = true;
    this.guide.visible = true;
  }

  /** Plan the city's races again if its roads changed, and set out the start rings. */
  plan(net: Network, seed: number): void {
    const key = `${seed}:${net.version}:${net.segs.size}`;
    if (key === this.planned) return;
    this.planned = key;
    this.races = planRaces(net, seed);
    this.markers.clear();
    for (const r of this.races) {
      const p = routeAt(r, 0), color = RACE_KINDS[r.kind].color;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 40), this.materials.ring.clone());
      (ring.material as THREE.MeshBasicMaterial).color.setHex(color);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, p.y + 0.06, p.z);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 2.4, 32, 1, true), this.materials.beam.clone());
      (beam.material as THREE.MeshBasicMaterial).color.setHex(color);
      beam.position.set(p.x, p.y + 1.2, p.z);
      const marker = new THREE.Group();
      marker.add(ring, beam);
      marker.userData.race = r.id;
      this.markers.add(marker);
    }
  }

  get racing(): boolean { return this.race !== null; }

  /** Show the start rings only while driving freely. */
  setVisible(on: boolean): void {
    this.markers.visible = on && !this.race;
  }

  /** Rivals and the police car, for the player's car to bump into. */
  cars(): TrafficCar[] {
    const out: TrafficCar[] = [];
    for (const r of this.rivals) out.push({ x: r.group.position.x, z: r.group.position.z, y: r.group.position.y, angle: r.group.rotation.y, length: 0.34 });
    if (this.police) out.push({ x: this.police.group.position.x, z: this.police.group.position.z, y: this.police.group.position.y, angle: this.police.group.rotation.y, length: 0.34 });
    return out;
  }

  /** True where a barrier stands across a side street. */
  blocks(x: number, z: number, y: number): boolean {
    if (!this.race) return false;
    for (const b of this.race.barriers) {
      if (Math.abs(b.y - y) > 0.25) continue;
      const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
      const dx = x - b.x, dz = z - b.z;
      const along = dx * rx + dz * rz, across = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
      if (Math.abs(along) < b.width / 2 && Math.abs(across) < 0.05) return true;
    }
    return false;
  }

  /** Start a race: the car on the start line, the course set out, the rivals on the grid. */
  start(race: RaceRoute, driver: Driver, difficulty: number): void {
    this.abort();
    this.race = race;
    this.difficulty = difficulty;
    this.onRacing?.(true);
    // The grid starts a little way past the start line; the player starts at the back, with the road
    // ahead and the rivals in view.
    const rivals = race.kind === 'police' ? 0 : race.rivals;
    const front = startLine(race) - 0.3, back = front - Math.floor(rivals / 2) * 0.5, lane0 = rivals % 2 ? 0.12 : -0.12;
    const p = routeAt(race, back);
    driver.teleport(p.x - p.tz * lane0, p.z + p.tx * lane0, Math.atan2(p.tx, p.tz));
    driver.frozen = true;
    this.progress = back;
    this.started = 0;
    this.clock = 0;
    this.offTime = 0;
    this.launched = false;
    this.heldAtGo = false;
    this.drift = { banked: 0, chain: 0, chainTime: 0, quiet: 0 };
    this.trail = [];
    this.buildCourse(race);
    const racers = race.kind === 'drift' || race.kind === 'police' ? 1 : race.rivals + 1;
    for (let i = 0; i < (race.kind === 'police' ? 0 : race.rivals); i++) {
      const model = RIVAL_MODELS[(i + race.length | 0) % RIVAL_MODELS.length], paint = RIVAL_PAINTS[(i * 3 + (race.length | 0)) % RIVAL_PAINTS.length];
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(playerCarGeometry(model, paint), this.materials.car);
      mesh.castShadow = true;
      group.add(mesh);
      group.rotation.order = 'YXZ';
      this.course.add(group);
      // A staggered grid: two abreast, a car length apart, the player on the front row.
      // Two abreast: the rivals fill the grid from the front, and the player takes the last place.
      const slot = i, row = Math.floor(slot / 2), lane = slot % 2 ? 0.12 : -0.12;
      this.rivals.push({ s: front - row * 0.5, speed: 0, lane, skill: 0.94 + ((i * 7919) % 100) / 100 * 0.1, group, done: null });
    }
    if (race.kind === 'police') {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(vehicleGeometry(5, 2), this.materials.car);
      mesh.castShadow = true;
      const lights = [new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), this.materials.red), new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.04), this.materials.blue)];
      lights[0].position.set(-0.035, 0.26, 0.05); lights[1].position.set(0.035, 0.26, 0.05);
      group.add(mesh, ...lights);
      group.rotation.order = 'YXZ';
      this.course.add(group);
      // The police start a few car lengths back down the road.
      for (let s = back - 2.4; s <= back; s += 0.05) { const q = routeAt(race, s); this.trail.push({ x: q.x, z: q.z, y: q.y, h: Math.atan2(q.tx, q.tz) }); }
      this.police = { group, lights, along: 0, speed: 0 };
    }
    this.hud = {
      kind: race.kind, name: race.name, phase: 'countdown', countdown: 3, place: racers, racers, lap: 1, laps: race.laps,
      time: 0, progress: 0, wrongWay: false, offRoute: false, score: 0, target: race.target, combo: 1, busted: 0, message: '', messageTime: 0,
    };
    this.markers.visible = false;
  }

  /** Stop the race and clear the course away. */
  abort(): void {
    const was = this.race !== null;
    this.race = null;
    this.guide.visible = false;
    this.hud = null;
    for (const r of this.rivals) this.dispose(r.group);
    this.rivals = [];
    if (this.police) this.dispose(this.police.group);
    this.police = null;
    this.course.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.course.clear();
    if (was) this.onRacing?.(false);
  }

  private dispose(g: THREE.Object3D): void {
    g.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    g.removeFromParent();
  }

  /** Put the car back on the route where it left it, facing the right way. */
  reset(driver: Driver): void {
    if (!this.race) return;
    const p = routeAt(this.race, this.progress);
    driver.teleport(p.x, p.z, Math.atan2(p.tx, p.tz));
  }

  /** The player bumped something: in a drift race that ends the chain. */
  impact(strength: number): void {
    if (this.race?.kind === 'drift' && strength > 0.1 && this.drift.chain > 0) {
      this.drift.chain = 0; this.drift.chainTime = 0;
      this.say('Chain lost');
    }
  }

  private say(text: string): void {
    if (this.hud) { this.hud.message = text; this.hud.messageTime = 1.6; }
  }

  // ---- the course ----

  private buildCourse(r: RaceRoute): void {
    const color = RACE_KINDS[r.kind].color;
    // Barriers: striped boards on legs, with chevrons pointing the way on.
    const pos: number[] = [], col: number[] = [];
    const c = new THREE.Color();
    const box = (cx: number, cy: number, cz: number, w: number, h: number, d: number, yaw: number, hex: number): void => {
      const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      g.rotateY(yaw); g.translate(cx, cy + h / 2, cz);
      const p = g.attributes.position;
      c.setHex(hex);
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); col.push(c.r, c.g, c.b); }
      g.dispose();
    };
    for (const b of r.barriers) {
      const rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw), fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      const at = (u: number, v = 0): [number, number] => [b.x + rx * u + fx * v, b.z + rz * u + fz * v];
      const n = Math.max(2, Math.round(b.width / 0.12));
      for (let k = 0; k < n; k++) {
        const u = -b.width / 2 + (k + 0.5) * b.width / n, [x, z] = at(u);
        box(x, b.y + 0.05, z, b.width / n, 0.05, 0.02, b.yaw, k % 2 ? 0xf2f2ee : 0xd8322f);
      }
      for (const u of [-b.width / 2 + 0.03, b.width / 2 - 0.03]) { const [x, z] = at(u); box(x, b.y, z, 0.02, 0.1, 0.05, b.yaw, 0x3a3f45); }
      // Chevrons on a yellow board above: pointing the way the route leaves the junction.
      const way = Math.sign(Math.sin(b.arrow) * rx + Math.cos(b.arrow) * rz) || 1;
      const [sx, sz] = at(0, -0.001);
      box(sx, b.y + 0.1, sz, Math.min(b.width, 0.5), 0.07, 0.015, b.yaw, 0xffc93f);
      // A chevron is two strokes in the board's plane, drawn on both faces.
      const stroke = (u0: number, v0: number, u1: number, v1: number, face: number): void => {
        const du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv);
        const g = new THREE.BoxGeometry(0.011, len, 0.003).toNonIndexed();
        g.rotateZ(Math.atan2(-du, dv));
        g.translate((u0 + u1) / 2, (v0 + v1) / 2, face * 0.009);
        g.rotateY(b.yaw);
        g.translate(b.x, b.y + 0.135, b.z);
        const q = g.attributes.position;
        c.setHex(0x1f2226);
        for (let i = 0; i < q.count; i++) { pos.push(q.getX(i), q.getY(i), q.getZ(i)); col.push(c.r, c.g, c.b); }
        g.dispose();
      };
      for (let k = -1; k <= 1; k++) for (const face of [-1, 1]) {
        const u = k * 0.1;
        stroke(u - way * 0.014, 0.02, u + way * 0.014, 0, face);
        stroke(u + way * 0.014, 0, u - way * 0.014, -0.02, face);
      }
    }
    // A chequered line painted across the road at the start and at the finish (the same line on a
    // loop), which the route puts halfway along a street.
    const line = (d: number): void => {
      const p = routeAt(r, d), yaw = Math.atan2(p.tx, p.tz), rx = Math.cos(yaw), rz = -Math.sin(yaw), w = r.width;
      const cells = Math.max(8, Math.round(w * 2 / 0.06));
      for (let k = 0; k < cells; k++) for (let row = 0; row < 3; row++) {
        const u = -w + (k + 0.5) * (2 * w / cells), v = (row - 1) * 0.05;
        box(p.x + rx * u + p.tx * v, p.y + 0.046, p.z + rz * u + p.tz * v, 2 * w / cells, 0.002, 0.05, yaw, (k + row) % 2 ? 0xf2f2ee : 0x1a1a1a);
      }
    };
    line(startLine(r));
    if (!r.loop) line(r.length);
    // Arrows on the road through every bend, so the way is clear at speed.
    for (let s = 1; s < r.length - 0.5; s += 0.5) {
      const a = routeAt(r, s - 0.5), b = routeAt(r, s + 0.8);
      const turn = Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz);
      if (Math.abs(turn) < 0.5) continue;
      const p = routeAt(r, s), yaw = Math.atan2(p.tx, p.tz);
      for (const up of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.03, 0.002, 0.13).toNonIndexed();
        g.translate(0, 0, 0.05); g.rotateY(yaw + Math.PI + up * 0.6); g.translate(p.x + p.tx * 0.1, p.y + 0.049, p.z + p.tz * 0.1);
        const q = g.attributes.position;
        c.setHex(color);
        for (let i = 0; i < q.count; i++) { pos.push(q.getX(i), q.getY(i), q.getZ(i)); col.push(c.r, c.g, c.b); }
        g.dispose();
      }
      s += 0.7;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.materials.solid);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.course.add(mesh);
  }

  // ---- running it ----

  update(dt: number, driver: Driver, time: number): void {
    // Free driving: pulse the rings and notice when the car sits on one.
    if (!this.race || !this.hud) {
      this.nearby = null;
      if (!driver.active) return;
      const at = driver.position;
      this.markers.children.forEach((m, i) => {
        const race = this.races[i], ring = m.children[0];
        ring.scale.setScalar(1 + Math.sin(time * 3 + i) * 0.06);
        if (race && Math.hypot(ring.position.x - at.x, ring.position.z - at.z) < 0.55 && Math.abs(ring.position.y - at.y) < 0.3) this.nearby = race;
      });
      return;
    }
    const r = this.race, hud = this.hud;
    this.clock += dt;
    hud.messageTime = Math.max(0, hud.messageTime - dt);
    const at = driver.position, speed = Math.hypot(driver.vx, driver.vz);
    const total = r.loop ? r.length * r.laps : r.length;
    if (hud.phase !== 'finished') this.showWay(r, time);
    else this.guide.visible = false;

    if (hud.phase === 'countdown') {
      hud.countdown -= dt;
      this.placeRivals(driver);
      if (driver.throttle) this.heldAtGo = true;
      if (hud.countdown <= 0) {
        hud.phase = 'racing';
        driver.frozen = false;
        this.started = this.clock;
        this.say('Go!');
        // Pressing the throttle as the lights go, not before, is a perfect launch.
        this.launched = !this.heldAtGo;
      }
      return;
    }
    if (hud.phase === 'finished') { this.placeRivals(driver); return; }

    hud.time = this.clock - this.started;
    if (!this.launched && hud.time < 0.35 && driver.throttle) {
      this.launched = true;
      driver.kick(r.kind === 'drag' ? 0.9 : 0.5);
      this.say('Perfect launch!');
    } else if (hud.time >= 0.35) this.launched = true;

    // How far along the route the player is: it only moves forward in small steps, so no shortcuts.
    const lap = r.loop ? Math.floor(this.progress / r.length) : 0;
    const local = this.progress - lap * r.length;
    const hit = nearestOnRoute(r, at.x, at.z, local - 0.8, local + 1.6);
    let next = lap * r.length + hit.s;
    if (!r.loop) next = Math.max(0, Math.min(r.length, next));
    if (hit.dist < r.width + 0.6 && next > this.progress) this.progress = Math.min(total, next);
    hud.offRoute = hit.dist > r.width + 0.9;
    this.offTime = hud.offRoute ? this.offTime + dt : 0;
    if (this.offTime > 4) { this.reset(driver); this.offTime = 0; this.say('Back on the route'); }
    const t = routeAt(r, hit.s);
    const moving = speed > 0.35 ? (driver.vx * t.tx + driver.vz * t.tz) / speed : Math.sin(driver.heading) * t.tx + Math.cos(driver.heading) * t.tz;
    hud.wrongWay = !hud.offRoute && (speed > 0.3 ? moving < -0.4 : false);
    hud.lap = Math.max(1, Math.min(r.laps, Math.floor(this.progress / r.length) + 1));
    hud.progress = Math.max(0, this.progress / total);
    if (r.loop && Math.floor(this.progress / r.length) > lap && this.progress < total) this.say(`Lap ${Math.floor(this.progress / r.length) + 1} of ${r.laps}`);

    this.moveRivals(dt, driver, r, total);
    if (r.kind === 'drift') this.scoreDrift(dt, driver, speed);
    if (r.kind === 'police') this.chase(dt, driver, speed);
    if (hud.busted >= 1) { this.finish(driver, true); return; }

    // Place: rivals ahead on the road, or already home.
    let ahead = 0;
    for (const rv of this.rivals) if (rv.done !== null || rv.s > this.progress) ahead++;
    hud.place = ahead + 1;
    if (this.progress >= total - 0.3) this.finish(driver, false);
  }

  private placeRivals(driver: Driver): void {
    if (!this.race) return;
    for (const rv of this.rivals) this.pose(rv.group, this.race, rv.s, rv.lane);
    void driver;
  }

  /** A rival on the racing line: rounded through the corners, a little to one side, facing its way. */
  private pose(g: THREE.Object3D, r: RaceRoute, s: number, lane: number): void {
    const p = lineAt(r, s), a = lineAt(r, s - 0.12), b = lineAt(r, s + 0.12);
    const y0 = routeAt(r, s).y, y1 = routeAt(r, s + 0.3).y;
    // Through a tight bend the rivals close up towards the line rather than cutting across the kerb.
    const turn = Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz);
    const off = lane * Math.max(0.4, 1 - Math.abs(turn) * 3);
    g.position.set(p.x - p.tz * off, y0, p.z + p.tx * off);
    // Facing along the line, leaning out of the bend a touch.
    g.rotation.set(-Math.atan2(y1 - y0, 0.3), Math.atan2(b.x - a.x, b.z - a.z), Math.max(-0.06, Math.min(0.06, turn * 0.5)));
  }

  private moveRivals(dt: number, driver: Driver, r: RaceRoute, total: number): void {
    const top = driver.stats.top * this.difficulty;
    const at = driver.position;
    for (const rv of this.rivals) {
      if (rv.done !== null) { rv.speed = Math.max(0, rv.speed - dt * 2); rv.s = Math.min(rv.s + rv.speed * dt, total + 2); this.pose(rv.group, r, r.loop ? rv.s : Math.min(r.length, rv.s), rv.lane); continue; }
      // Rubber band: a rival far ahead eases off, one far behind finds a little more.
      const gap = rv.s - this.progress;
      const band = gap > 5 ? 0.9 : gap < -5 ? 1.1 : 1 - gap * 0.01;
      const want = cornerSpeed(r, rv.s + Math.max(0.6, rv.speed * 0.7), top * rv.skill * band);
      rv.speed += Math.max(-4.5 * dt, Math.min(driver.stats.accel * 1.1 * dt, want - rv.speed));
      // Don't drive through the player: queue behind when they're right in front in this lane.
      const p = lineAt(r, rv.s), px = p.x - p.tz * rv.lane, pz = p.z + p.tx * rv.lane;
      const dx = at.x - px, dz = at.z - pz, along = dx * p.tx + dz * p.tz, across = Math.abs(-dx * p.tz + dz * p.tx);
      if (along > 0 && along < 0.4 && across < 0.17) rv.speed = Math.min(rv.speed, Math.max(0, Math.hypot(driver.vx, driver.vz) - 0.1));
      rv.s += rv.speed * dt;
      if (rv.s >= total) { rv.done = this.clock - this.started; }
      this.pose(rv.group, r, rv.s, rv.lane);
    }
  }

  private scoreDrift(dt: number, driver: Driver, speed: number): void {
    const hud = this.hud!, d = this.drift;
    if (driver.slip > 0.3 && speed > 0.8) {
      d.chainTime += dt;
      d.chain += driver.slip * speed * dt * 140;
      d.quiet = 0;
    } else if (d.chain > 0) {
      d.quiet += dt;
      if (d.quiet > 0.9) {
        const mult = 1 + Math.floor(d.chainTime / 1.5);
        d.banked += Math.round(d.chain * mult);
        if (d.chain * mult > 600) this.say(`+${Math.round(d.chain * mult)}`);
        d.chain = 0; d.chainTime = 0;
      }
    }
    hud.combo = 1 + Math.floor(d.chainTime / 1.5);
    hud.score = Math.round(d.banked + d.chain * hud.combo);
  }

  private chase(dt: number, driver: Driver, speed: number): void {
    const police = this.police!, hud = this.hud!, at = driver.position;
    // Leave a trail for the police to follow: they drive where you drove.
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(at.x - last.x, at.z - last.z) > 0.05) this.trail.push({ x: at.x, z: at.z, y: at.y, h: driver.heading });
    const idx = Math.floor(police.along), end = this.trail.length - 1;
    const behind = (end - police.along) * 0.05;
    const top = driver.stats.top * (behind > 4 ? 1.12 : behind > 1.5 ? 0.99 : 0.9) * this.difficulty;
    police.speed += Math.max(-4 * dt, Math.min(2.2 * dt, top - police.speed));
    police.along = Math.min(end, police.along + police.speed * dt / 0.05);
    const p = this.trail[Math.min(end, idx)], q = this.trail[Math.min(end, idx + 1)] ?? p, u = police.along - idx;
    police.group.position.set(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u, p.z + (q.z - p.z) * u);
    police.group.rotation.set(0, Math.atan2(q.x - p.x, q.z - p.z) || p.h, 0);
    const flash = Math.floor(this.clock * 6) % 2 === 0;
    police.lights[0].visible = flash; police.lights[1].visible = !flash;
    const gap = Math.hypot(police.group.position.x - at.x, police.group.position.z - at.z);
    if (gap < 0.5) hud.busted = Math.min(1, hud.busted + dt * (speed < 0.8 ? 0.55 : 0.18));
    else hud.busted = Math.max(0, hud.busted - dt * 0.15);
    if (hud.busted > 0.5 && hud.messageTime <= 0) this.say('Police closing in!');
  }

  private finish(driver: Driver, busted: boolean): void {
    const r = this.race!, hud = this.hud!;
    hud.phase = 'finished';
    driver.frozen = false;
    let share = 0, won = false, medal = '';
    const racers = hud.racers;
    if (r.kind === 'drift') {
      const d = this.drift;
      d.banked += Math.round(d.chain * (1 + Math.floor(d.chainTime / 1.5)));
      hud.score = d.banked;
      share = hud.score >= r.target ? 1 : hud.score >= r.target * 0.7 ? 0.6 : hud.score >= r.target * 0.45 ? 0.3 : 0;
      medal = share === 1 ? 'Gold' : share > 0.5 ? 'Silver' : share > 0 ? 'Bronze' : '';
      won = share === 1;
    } else if (r.kind === 'police') {
      won = !busted; share = won ? 1 : 0;
    } else {
      share = [1, 0.5, 0.25, 0][hud.place - 1] ?? 0;
      won = hud.place === 1;
    }
    const result: RaceResult = { race: r, won, place: hud.place, racers, time: hud.time, score: hud.score, busted, share, reward: Math.round(r.reward * share), medal };
    this.onFinish?.(result);
  }
}
