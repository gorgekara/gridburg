import * as THREE from 'three';
import { GRID, N_TILES, T_FARM, T_IND, idx, inBounds, isZone, tileHash } from '../constants';
import type { Network } from '../roads/network';
import type { Raster } from '../roads/raster';
import type { Terrain } from '../terrain';
import { siteOwners } from '../sites';
import { Kit, stream, pick } from './streetDetail';
import { isGardenTile } from './verges';

/**
 * The places a city grows that nobody zoned. They go on the leftover garden ground in town and cost
 * nothing:
 * - a civic plaza where the land is dear and the towers stand close, with a fountain or a statue,
 *   trees in grilles, benches and lamps
 * - a clock tower in the best-placed spot of each district (or of the whole city), whose hands keep
 *   the city's time
 * - a promenade along the water wherever the town comes down to it: paving, a railing, benches and
 *   lamps where there were reeds
 */
export interface LandmarkPlan {
  plazas: number[];
  towers: number[];
  promenade: number[];
}

export interface LandmarkInput {
  kind: Uint8Array;
  level: Uint8Array;
  raster: Raster;
  terrain: Terrain;
  terraform: Uint8Array;
  rot?: Uint8Array;
  /** Wealth band per tile (see `character.ts`), or null before the first maps. */
  wealth: Uint8Array | null;
  /** Land value per tile, or null before the first maps. */
  land: Uint8Array | null;
  district: Uint8Array;
}

/** How many built zone lots, of at least `minLevel`, stand within `r` cells of a tile. */
function builtNear(kind: Uint8Array, level: Uint8Array, i: number, r: number, minLevel = 1): number {
  const x = i % GRID, z = Math.floor(i / GRID);
  let n = 0;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (!inBounds(x + dx, z + dz)) continue;
    const t = idx(x + dx, z + dz);
    if (isZone(kind[t]) && level[t] >= minLevel) n++;
  }
  return n;
}

/** Shore tiles that the town comes down to: beside a built lot or a road. */
export function isPromenadeTile(i: number, kind: Uint8Array, level: Uint8Array, raster: Raster, terrain: Terrain): boolean {
  if (!terrain.shore[i] || terrain.water[i] || kind[i] || raster.cover[i]) return false;
  const x = i % GRID, z = Math.floor(i / GRID);
  let wet = false, town = false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dz) || !inBounds(x + dx, z + dz)) continue;
    const t = idx(x + dx, z + dz);
    if (terrain.water[t] && (!dx || !dz)) wet = true;
    if (raster.cover[t] || (isZone(kind[t]) && level[t] > 0)) town = true;
  }
  return wet && town;
}

/**
 * How much town stands round a tile, for where a clock tower belongs: the homes, shops and offices
 * within 3 cells, the mid-rise counting most. A town clock stands in the old heart of a place among
 * buildings it rises over, not at the foot of the glass towers.
 */
const TOWN_WEIGHT = [0, 1, 2, 1];
function townNear(kind: Uint8Array, level: Uint8Array, i: number): number {
  const x = i % GRID, z = Math.floor(i / GRID);
  let n = 0;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    if (!inBounds(x + dx, z + dz)) continue;
    const t = idx(x + dx, z + dz);
    if (isZone(kind[t]) && kind[t] !== T_FARM && kind[t] !== T_IND) n += TOWN_WEIGHT[level[t]] ?? 0;
  }
  return n;
}

export const TOWER_SPACING = 6;
const TOWER_MIN_LOTS = 20;

/** `prev` keeps a clock tower where it stands while its spot is still garden ground in its district. */
export function planLandmarks(input: LandmarkInput, prev?: LandmarkPlan): LandmarkPlan {
  const { kind, level, raster, terrain, terraform, rot, wealth, land, district } = input;
  const owners = siteOwners(kind, rot);
  const gardens: number[] = [];
  for (let i = 0; i < N_TILES; i++) if (isGardenTile(i, kind, level, raster, terrain, terraform, owners)) gardens.push(i);

  // One clock tower per district with enough of a town in it; with no districts at all, one for the city.
  const lots = new Map<number, number>();
  let anyDistrict = false;
  for (let i = 0; i < N_TILES; i++) {
    if (!isZone(kind[i]) || !level[i]) continue;
    const d = district[i];
    if (d) anyDistrict = true;
    lots.set(d, (lots.get(d) ?? 0) + 1);
  }
  const groups = anyDistrict ? [...lots.keys()].filter(d => d > 0) : [0];
  const score = (i: number): number => townNear(kind, level, i) * (land ? 1 + land[i] / 64 : 1);
  const towers: number[] = [];
  // Until the city's land values are known there is no telling where its heart is.
  if (!land) groups.length = 0;
  for (const g of groups) {
    if ((anyDistrict ? lots.get(g) ?? 0 : [...lots.values()].reduce((a, b) => a + b, 0)) < TOWER_MIN_LOTS) continue;
    const open = (t: number): boolean => gardens.includes(t) && (!anyDistrict || district[t] === g) && !towers.some(o => Math.hypot(o % GRID - t % GRID, Math.floor(o / GRID) - Math.floor(t / GRID)) < TOWER_SPACING);
    let best = -1, bestScore = 0;
    for (const t of gardens) {
      if (!open(t)) continue;
      const s = score(t);
      if (s > bestScore) { bestScore = s; best = t; }
    }
    // A tower stays where it stands unless somewhere else has clearly become the heart of the place.
    const kept = prev?.towers.find(t => open(t) && score(t) >= bestScore * 0.7);
    if (kept !== undefined) towers.push(kept);
    else if (best >= 0) towers.push(best);
  }

  const plazas = gardens.filter(t => !towers.includes(t) && (wealth ? wealth[t] >= 2 : false) && builtNear(kind, level, t, 3, 3) >= 5);
  const promenade: number[] = [];
  for (let i = 0; i < N_TILES; i++) if (isPromenadeTile(i, kind, level, raster, terrain)) promenade.push(i);
  return { plazas, towers, promenade };
}

const HALF = GRID / 2;
const STONE = 0xc2bcae, PAVING = 0xd0cabd, DARK_STONE = 0x9e988a, COPPER = 0x5f9e88, IRON = 0x2a2c30, WATER = 0x5fa8d8;
const TOWER_TOP = 1.7, DIAL = 0.085, DIAL_Y = TOWER_TOP + 0.12;

export class LandmarkLayer {
  readonly group = new THREE.Group();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  private glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private signature = '';
  /** The tiles the landmarks stand on: the gardens and the street detail leave them alone. */
  taken = new Set<number>();
  plan: LandmarkPlan = { plazas: [], towers: [], promenade: [] };
  private hands: THREE.InstancedMesh;
  private dials: { x: number; y: number; z: number; yaw: number }[] = [];

  constructor() {
    const hand = new THREE.BoxGeometry(1, 1, 1);
    hand.translate(0, 0.5, 0);
    this.hands = new THREE.InstancedMesh(hand, new THREE.MeshBasicMaterial({ color: 0x1f2226 }), 256);
    this.hands.count = 0;
    this.hands.frustumCulled = false;
    this.group.add(this.hands);
  }

  setNight(night: number): void { this.glowMaterial.color.setScalar(0.55 + 0.45 * night); }

  rebuild(input: LandmarkInput, net: Network, relief: (x: number, z: number) => number): void {
    const plan = planLandmarks(input, this.plan);
    const signature = `${net.version}|${plan.plazas.join(',')}|${plan.towers.join(',')}|${plan.promenade.join(',')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.plan = plan;
    this.taken = new Set([...plan.plazas, ...plan.towers]);
    for (const m of [...this.group.children]) if (m !== this.hands) { (m as THREE.Mesh).geometry.dispose(); this.group.remove(m); }
    const kit = new Kit(), glow = new Kit();
    for (const t of plan.plazas) plaza(kit, glow, t, net);
    this.dials = [];
    for (const t of plan.towers) tower(kit, glow, t, relief, this.dials);
    for (const t of plan.promenade) promenade(kit, glow, t, input.terrain, relief);
    const g = kit.build(), l = glow.build();
    if (g) { const m = new THREE.Mesh(g, this.material); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; this.group.add(m); }
    if (l) { const m = new THREE.Mesh(l, this.glowMaterial); m.matrixAutoUpdate = false; this.group.add(m); }
    this.hands.count = Math.min(256, this.dials.length * 2);
  }

  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  /** Turn the clock hands to the city's hour. */
  update(hour: number): void {
    const n = Math.min(this.dials.length, 128);
    if (!n) return;
    const hourAngle = -((hour % 12) / 12) * Math.PI * 2, minuteAngle = -(hour % 1) * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const d = this.dials[k];
      for (const [slot, angle, len, width] of [[0, hourAngle, DIAL * 0.55, 0.012], [1, minuteAngle, DIAL * 0.85, 0.008]] as const) {
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw);
        this.q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
        this.q.multiply(this.q2);
        this.p.set(d.x + Math.sin(d.yaw) * (0.004 + slot * 0.002), d.y, d.z + Math.cos(d.yaw) * (0.004 + slot * 0.002));
        this.m4.compose(this.p, this.q, this.s.set(width, len, 0.004));
        this.hands.setMatrixAt(k * 2 + slot, this.m4);
      }
    }
    this.hands.instanceMatrix.needsUpdate = true;
  }
}

/** A civic plaza: stone paving with a border, a fountain or a statue, trees in grilles, benches, lamps. */
function plaza(kit: Kit, glow: Kit, i: number, net: Network): void {
  const x = i % GRID + 0.5, z = Math.floor(i / GRID) + 0.5, rnd = stream(i * 7717 + 3);
  const free = (px: number, pz: number): boolean => !net.onRoad(px, pz, -1, 0.12);
  kit.jitter = 0;
  kit.at(x - HALF, 0, z - HALF, 0);
  kit.quad(0, 0.005, 0, 0.94, 0.94, DARK_STONE);
  kit.quad(0, 0.0055, 0, 0.86, 0.86, PAVING);
  for (let k = -3; k <= 3; k++) { kit.quad(k * 0.12, 0.006, 0, 0.004, 0.86, 0xbcb5a6); kit.quad(0, 0.006, k * 0.12, 0.86, 0.004, 0xbcb5a6); }
  if (tileHash(i * 13 + 1) < 0.55) {
    // A fountain: a basin, a column, a bowl, and water falling.
    kit.prism(0, 0, 0, 0.2, 0.035, STONE, 20);
    kit.disc(0, 0.03, 0, 0.18, WATER, 20);
    kit.prism(0, 0.03, 0, 0.025, 0.09, STONE, 8);
    kit.prism(0, 0.12, 0, 0.07, 0.014, STONE, 14);
    kit.disc(0, 0.134, 0, 0.06, WATER, 14);
    kit.prism(0, 0.134, 0, 0.008, 0.07, 0xd0ecf8, 6, 0.002);
    kit.prism(0, 0.13, 0, 0.05, 0.05, 0xd0ecf8, 10, 0);
  } else {
    // A statue on a tall plinth: a figure in bronze, one arm out.
    const bronze = 0x5f7a66;
    kit.box(0, 0.005, 0, 0.12, 0.02, 0.12, DARK_STONE);
    kit.box(0, 0.025, 0, 0.08, 0.12, 0.08, STONE);
    kit.box(0, 0.145, 0, 0.1, 0.01, 0.1, DARK_STONE);
    kit.box(-0.012, 0.155, 0, 0.016, 0.07, 0.02, bronze); kit.box(0.012, 0.155, 0, 0.016, 0.07, 0.02, bronze);
    kit.box(0, 0.225, 0, 0.05, 0.07, 0.03, bronze);
    kit.beam(0.03, 0.28, 0, 0.07, 0.3, 0.02, 0.014, bronze);
    kit.box(0, 0.295, 0, 0.026, 0.03, 0.026, bronze);
  }
  for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    if (!free(x + ox, z + oz)) continue;
    kit.at(x + ox - HALF, 0, z + oz - HALF, 0);
    kit.jitter = 0;
    kit.disc(0, 0.0065, 0, 0.04, IRON, 10);
    kit.prism(0, 0, 0, 0.008, 0.18, 0x5a4330, 6, 0.006);
    kit.jitter = (rnd() - 0.5) * 0.15;
    const leaf = pick(rnd, [0x4f7f3d, 0x5a8a45, 0x6a9a4a]);
    kit.lump(0, 0.15, 0, 0.07, leaf, 0.85, rnd);
    kit.lump(0.035, 0.2, -0.01, 0.05, leaf, 0.85, rnd);
    kit.jitter = 0;
  }
  for (const [ox, oz, yaw] of [[0, -0.33, 0], [0, 0.33, Math.PI], [-0.33, 0, Math.PI / 2], [0.33, 0, -Math.PI / 2]] as [number, number, number][]) {
    if (!free(x + ox, z + oz)) continue;
    kit.at(x + ox - HALF, 0.005, z + oz - HALF, yaw);
    kit.box(0, 0.028, 0, 0.12, 0.008, 0.03, 0x8a6240);
    kit.box(0, 0.036, -0.016, 0.12, 0.03, 0.006, 0x8a6240);
    for (const o of [-0.05, 0.05]) kit.box(o, 0, 0, 0.006, 0.03, 0.03, IRON);
  }
  for (const [ox, oz] of [[-0.42, 0], [0.42, 0]]) {
    if (!free(x + ox, z + oz)) continue;
    kit.at(x + ox - HALF, 0, z + oz - HALF, 0);
    kit.prism(0, 0, 0, 0.006, 0.24, IRON, 6);
    glow.at(x + ox - HALF, 0, z + oz - HALF, 0);
    glow.prism(0, 0.24, 0, 0.02, 0.026, 0xffe7a0, 6, 0.012);
    kit.prism(0, 0.266, 0, 0.014, 0.008, IRON, 6, 0);
  }
}

/** A clock tower: a stone shaft, a clock on every side, an open belfry, a copper spire. */
function tower(kit: Kit, glow: Kit, i: number, relief: (x: number, z: number) => number, dials: { x: number; y: number; z: number; yaw: number }[]): void {
  const x = i % GRID + 0.5 - HALF, z = Math.floor(i / GRID) + 0.5 - HALF, y = relief(x, z);
  kit.jitter = 0;
  kit.at(x, y, z, 0);
  kit.quad(0, 0.005, 0, 0.7, 0.7, PAVING);
  kit.box(0, 0, 0, 0.36, 0.06, 0.36, DARK_STONE);
  kit.box(0, 0.06, 0, 0.26, TOWER_TOP - 0.06, 0.26, STONE);
  // Pilasters up the corners and a band at each storey.
  for (const [cx, cz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) kit.box(cx, 0.06, cz, 0.035, TOWER_TOP - 0.06, 0.035, DARK_STONE);
  for (let s = 0.35; s < TOWER_TOP; s += 0.3) kit.box(0, s, 0, 0.28, 0.014, 0.28, DARK_STONE);
  // A door, and slit windows up the shaft.
  kit.box(0, 0.06, 0.131, 0.07, 0.12, 0.004, 0x3a2a1f);
  for (let s = 0.45; s < TOWER_TOP - 0.1; s += 0.3) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) kit.box(Math.sin(yaw) * 0.131, s, Math.cos(yaw) * 0.131, 0.025, 0.08, 0.004, 0x2a2f36, yaw);
  // The clock stage: a wider block with a lit dial on each face.
  kit.box(0, TOWER_TOP, 0, 0.3, 0.24, 0.3, STONE);
  kit.box(0, TOWER_TOP + 0.24, 0, 0.32, 0.02, 0.32, DARK_STONE);
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    kit.box(nx * 0.151, DIAL_Y - DIAL - 0.012, nz * 0.151, DIAL * 2 + 0.024, DIAL * 2 + 0.024, 0.004, 0x2a2c30, yaw);
    glow.at(x, y, z, 0);
    glow.box(nx * 0.154, DIAL_Y - DIAL, nz * 0.154, DIAL * 2, DIAL * 2, 0.003, 0xf4ecd0, yaw);
    // The hour marks.
    for (let h = 0; h < 12; h++) {
      const a = h / 12 * Math.PI * 2, r = DIAL * 0.85;
      const u = Math.sin(a) * r, v = Math.cos(a) * r;
      kit.box(nx * 0.157 + Math.cos(yaw) * u, DIAL_Y + v - 0.006, nz * 0.157 - Math.sin(yaw) * u, 0.008, 0.012, 0.002, 0x2a2c30, yaw);
    }
    dials.push({ x: x + nx * 0.158, y: y + DIAL_Y, z: z + nz * 0.158, yaw });
  }
  // The belfry: four posts round a bell, then the spire.
  const b0 = TOWER_TOP + 0.26;
  for (const [cx, cz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) kit.box(cx, b0, cz, 0.04, 0.16, 0.04, STONE);
  kit.prism(0, b0 + 0.04, 0, 0.05, 0.08, 0xb08a3a, 10, 0.03);
  kit.box(0, b0 + 0.16, 0, 0.3, 0.025, 0.3, DARK_STONE);
  kit.prism(0, b0 + 0.185, 0, 0.19, 0.4, COPPER, 4, 0);
  kit.prism(0, b0 + 0.58, 0, 0.004, 0.08, 0xc9a24a, 4);
}

/** A promenade along the water's edge of a shore tile: paving, a railing, and now and then a bench and a lamp. */
function promenade(kit: Kit, glow: Kit, i: number, terrain: Terrain, relief: (x: number, z: number) => number): void {
  const tx = i % GRID, tz = Math.floor(i / GRID);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!inBounds(tx + dx, tz + dz) || !terrain.water[idx(tx + dx, tz + dz)]) continue;
    // The edge of the tile towards the water, in scene coordinates, and the way along it.
    const ex = tx + 0.5 + dx * 0.5 - HALF, ez = tz + 0.5 + dz * 0.5 - HALF, yaw = Math.atan2(dx, dz);
    const y = relief(ex - dx * 0.2, ez - dz * 0.2);
    kit.jitter = 0;
    kit.at(ex - dx * 0.14, y, ez - dz * 0.14, yaw);
    kit.quad(0, 0.006, 0, 1.0, 0.26, PAVING);
    kit.quad(0, 0.0065, 0.12, 1.0, 0.02, DARK_STONE);
    // The railing, on posts along the edge.
    for (let u = -0.48; u <= 0.48 + 1e-6; u += 0.12) kit.box(u, 0.006, 0.12, 0.008, 0.07, 0.008, IRON);
    kit.beam(-0.5, 0.076, 0.12, 0.5, 0.076, 0.12, 0.006, IRON);
    kit.beam(-0.5, 0.045, 0.12, 0.5, 0.045, 0.12, 0.003, IRON);
    const h = tileHash(i * 17 + dx * 3 + dz * 5 + 11);
    if (h < 0.6) {
      // A bench looking out over the water.
      kit.box(0.1, 0.034, -0.02, 0.12, 0.008, 0.03, 0x8a6240);
      kit.box(0.1, 0.042, -0.036, 0.12, 0.03, 0.006, 0x8a6240);
      for (const o of [0.05, 0.15]) kit.box(o, 0.006, -0.02, 0.006, 0.03, 0.03, IRON);
    }
    if (h > 0.4) {
      kit.prism(-0.3, 0.006, 0.02, 0.006, 0.24, IRON, 6);
      glow.at(ex - dx * 0.14, y, ez - dz * 0.14, yaw);
      glow.prism(-0.3, 0.246, 0.02, 0.02, 0.026, 0xffe7a0, 6, 0.012);
    }
  }
}
