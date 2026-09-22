import { parkPathTiles, parkPathTouchesLot, quantizeParkPath, PARK_PATH_COST } from './parkPaths';
import type { ParkPath } from './parkPaths';
import { sampleCurve } from './roads/network';
import { decorationPlacementAllowed } from './parks';
import { isDecoration, T_PATH, T_LAWN, T_PLAZA, SERVICES } from './constants';
import { airportClearanceMask, airportPlacementBlocked } from './airports';
import { T_AIRPORT } from './constants';
import type { IncidentSnapshot, IncidentView } from './sim/incidents';
import { footprint, siteOwners } from './sites';
import { defaultFunding } from './management';
import { noPolicies } from './policies';
import type { PolicyId } from './policies';
import type { FundingKey } from './management';
import { levelForPopulation } from './progression';
import { RES_POP, T_RES, GRID, MAX_CARS, N_TILES, START_MONEY, isService, isZone } from './constants';
import { Network, KIND_MOTORWAY, KIND_RAMP, KIND_ROAD } from './roads/network';
import { ensureApproaches } from './roads/entries';
import { rasterize } from './roads/raster';
import type { Raster } from './roads/raster';
import { generateTerrain } from './terrain';
import type { Terrain } from './terrain';
import { emptyStats } from './sim/messages';
import type { EditPayload, MainToWorker, Stats, WorkerToMain, TileReport } from './sim/messages';

import type { SaveData } from './save';
import { cloneExtras, defaultExtras, shapeTerrain, terraformAllowed, hillLevel, DUG, FILLED, HILL_BASE, COST_DIG, COST_FILL, COST_RAISE, COST_LOWER } from './extras';
import type { TerraformAction } from './extras';
import type { CityExtras, Taxes } from './extras';
import type { CityMaps } from './sim/messages';
import type { DisasterKind, DisasterView } from './sim/disasters';

/** One step of undo: the city as it was before an edit, and what that edit cost. */
interface UndoStep { before: SaveData; spent: number }
const UNDO_LIMIT = 30;

const CHEAT_FLOOR = 1_000_000;

/** Main-thread mirror of the city plus the bridge to the simulation worker. */
export class Game {
  incidents: IncidentView = { fires: [], heists: [], crashes: [], crime: [], patrol: [] };
  incidentSave?: IncidentSnapshot;
  seed = 1;
  terrain: Terrain = generateTerrain(1);
  /** The river valley before the player dug or filled anything. */
  baseTerrain: Terrain = this.terrain;
  extras: CityExtras = defaultExtras();
  maps: CityMaps | null = null;
  disaster: DisasterView | null = null;
  /** Scales how often disasters strike; scenarios set it. */
  disasterRate = 1;
  private undoStack: UndoStep[] = [];
  private committed: SaveData | null = null;
  onUndo: (() => void) | null = null;
  onTerraform: (() => void) | null = null;
  net = new Network();
  parkPaths: ParkPath[] = [];
  parkPathMask: Uint8Array = new Uint8Array(N_TILES);
  private parkPathLotMask: Uint8Array = new Uint8Array(N_TILES);
  raster: Raster = rasterize(this.net);
  kind = new Uint8Array(N_TILES);
  /** Quarter turns for placed buildings: which way each one faces. */
  rot = new Uint8Array(N_TILES);
  airportClearance: Uint8Array = new Uint8Array(N_TILES);
  owners: Int32Array = new Int32Array(N_TILES).fill(-1);
  level = new Uint8Array(N_TILES);
  neglect = new Uint8Array(N_TILES);
  flags: Uint8Array = new Uint8Array(N_TILES);
  pollution: Uint8Array = new Uint8Array(N_TILES);
  riverPollution: Uint8Array = new Uint8Array(0);
  stats: Stats = emptyStats(START_MONEY);
  tax = 10;
  speed = 1;
  carHeights: Float32Array = new Float32Array(MAX_CARS);
  prevCarHeights: Float32Array = new Float32Array(MAX_CARS);
  carPitch: Float32Array = new Float32Array(MAX_CARS);
  simTime = 0;
  cityTime = 0;
  /** Segment ids in the order last sent to the worker; congestion frames are indexed the same way. */
  segOrder: number[] = [];
  segCong: Uint8Array = new Uint8Array(0);
  carIdsPrev: Uint32Array = new Uint32Array(MAX_CARS);
  carIdsNext: Uint32Array = new Uint32Array(MAX_CARS);
  carsPrev: Float32Array = new Float32Array(MAX_CARS * 4);
  carsNext: Float32Array = new Float32Array(MAX_CARS * 4);
  prevTime = 0;
  nextTime = 0;

  onInspection: ((report: TileReport | null) => void) | null = null;
  onNotice: ((message: string) => void) | null = null;
  onState: (() => void) | null = null;
  onEdit: (() => void) | null = null;
  onTerrain: (() => void) | null = null;
  onFrame: (() => void) | null = null;

  private worker: Worker;
  private pendingSpent = 0;
  private dirty = false;
  private serial = 0;
  private rasterVersion = -1;

  constructor() {
    this.worker = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const m = ev.data;
      if (m.type === 'state') {
        this.incidents = m.incidents; this.incidentSave = m.incidentSave;
        this.level.set(m.level);
        this.neglect.set(m.neglect);
        this.flags = m.flags;
        this.pollution = m.pollution;
        this.riverPollution = m.riverPollution;
        if (m.maps) this.maps = m.maps;
        this.disaster = m.disaster ?? null;
        this.stats = m.stats;
        this.cityTime = Math.max(this.cityTime, m.stats.tick);
        this.onState?.();
      } else if (m.type === 'inspection') {
        this.onInspection?.(m.report);
      } else if (m.type === 'notice') {
        this.onNotice?.(m.message);
      } else {
        this.carIdsPrev = this.carIdsNext; this.carIdsNext = m.carIds;
        this.carsPrev = this.carsNext;
        this.carsNext = m.cars;
        this.prevTime = this.nextTime;
        this.nextTime = performance.now();
        this.prevCarHeights = this.carHeights; this.carHeights = m.carHeights; this.carPitch = m.carPitch;
        this.simTime = m.simTime;
        this.cityTime = m.cityTime;
        if (m.serial === this.serial) this.segCong = m.segCong;
        this.onFrame?.();
      }
    };
  }

  private send(m: MainToWorker): void {
    this.worker.postMessage(m);
  }

  /** Cheat: building is free and the treasury is topped up to CHEAT_FLOOR on every edit. */
  infiniteMoney = false;

  setInfiniteMoney(on: boolean): void {
    this.infiniteMoney = on;
    if (on) { this.dirty = true; this.flush(); }
  }

  canAfford(cost: number): boolean {
    if (this.infiniteMoney) return true;
    return this.stats.money - this.pendingSpent >= cost;
  }

  spend(cost: number): void {
    this.pendingSpent += cost;
    this.dirty = true;
  }

  /** Can something be placed on this tile at all? */
  /**
   * Dry, unpaved, unclaimed ground. The shore strip counts as wet: it is drawn under the water even
   * though the tile mask calls it land, so nothing may stand there. Waterside works are the exception —
   * a pump or an outlet belongs on the bank.
   */
  buildable(i: number, bank = false): boolean {
    if (this.parkPathLotMask[i] || hillLevel(this.extras.terraform[i]) > 0) return false;
    if (this.airportClearance[i] || this.terrain.water[i] || this.raster.cover[i] || this.owners[i] >= 0) return false;
    return bank || !this.terrain.shore[i];
  }

  parkPathProblem(paths: ParkPath[]): string | null {
    paths = paths.map(quantizeParkPath);
    if (!paths.length || this.parkPaths.length + paths.length > 2000) return 'Park path limit reached';
    for (const path of paths) {
      if (Object.values(path).some(v => !Number.isFinite(v) || v < 0.1 || v > GRID - 0.1)) return 'Keep the path inside the map';
      const cells = parkPathTiles(path);
      if (!cells.length || sampleCurve(path).len < 0.2) return 'Choose a longer path';
      const nearby = new Set<number>();
      for (const i of cells) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x = i % GRID + dx, z = Math.floor(i / GRID) + dz;
        if (x >= 0 && z >= 0 && x < GRID && z < GRID) nearby.add(z * GRID + x);
      }
      for (const i of nearby) if ((isZone(this.kind[i]) || (isService(this.kind[i]) && !isDecoration(this.kind[i]) && !SERVICES[this.kind[i]].footprint)) && parkPathTouchesLot(path, this.raster.lotX[i], this.raster.lotZ[i])) return 'Keep paths clear of building fronts';
      for (const i of cells) {
        if (this.kind[i] !== 0 && this.kind[i] !== T_PATH && this.kind[i] !== T_LAWN && this.kind[i] !== T_PLAZA) return 'Clear buildings and decorations from the path';
        if (this.terrain.water[i] || this.terrain.shore[i] || this.raster.cover[i] || this.airportClearance[i] || this.owners[i] >= 0) return 'Keep paths on clear, dry ground beside roads';
      }
    }
    return null;
  }

  addParkPaths(paths: ParkPath[]): boolean {
    paths = paths.map(quantizeParkPath);
    if (this.parkPathProblem(paths)) return false;
    const fresh = paths.filter(p => !this.parkPaths.some(q => Object.keys(p).every(k => p[k as keyof ParkPath] === q[k as keyof ParkPath])));
    if (!fresh.length) return false;
    const cost = Math.ceil(fresh.reduce((n, p) => n + sampleCurve(p).len, 0) * PARK_PATH_COST);
    if (!this.canAfford(cost)) return false;
    for (const path of fresh) {
      this.parkPaths.push({ ...path });
      for (const i of parkPathTiles(path)) { this.kind[i] = T_PATH; this.level[i] = 1; this.rot[i] = 0; }
    }
    this.syncParkPaths(); this.spend(cost); return true;
  }

  /** Removing a touched tile removes that drawn segment; shared intersections remain. */
  private syncParkPaths(): void {
    const old = this.parkPathMask;
    this.parkPaths = this.parkPaths.filter(p => {
      const cells = parkPathTiles(p);
      return cells.length && cells.every(i => this.kind[i] === T_PATH && !this.raster.cover[i]);
    });
    this.parkPathMask = new Uint8Array(N_TILES);
    this.parkPathLotMask = new Uint8Array(N_TILES);
    for (const path of this.parkPaths) {
      const nearby = new Set<number>();
      for (const i of parkPathTiles(path)) {
        this.parkPathMask[i] = 1;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          const x = i % GRID + dx, z = Math.floor(i / GRID) + dz;
          if (x >= 0 && z >= 0 && x < GRID && z < GRID) nearby.add(z * GRID + x);
        }
      }
      for (const i of nearby) if (parkPathTouchesLot(path, this.raster.lotX[i], this.raster.lotZ[i])) this.parkPathLotMask[i] = 1;
    }
    for (let i = 0; i < N_TILES; i++) if (old[i] && !this.parkPathMask[i] && this.kind[i] === T_PATH) { this.kind[i] = 0; this.level[i] = 0; }
  }

  /** Change a tile's kind, optionally facing a given quarter turn. Returns false if unchanged. */
  setKind(i: number, k: number, cost: number, rot = 0): boolean {
    if (!Number.isInteger(i) || i < 0 || i >= N_TILES) return false;
    if (k && !isDecoration(k) && this.parkPathLotMask[i]) return false;
    if (isDecoration(k) && !decorationPlacementAllowed(i, { kind: this.kind, water: this.terrain.water, shore: this.terrain.shore, cover: this.raster.cover, owners: this.owners, airportClearance: this.airportClearance })) return false;
    if (this.owners[i] >= 0) {
      if (k) return false;
      i = this.owners[i];
    }
    if (k && !footprint(i, k, rot).length) return false;
    if (k === T_PATH) rot = 0;
    if (k && footprint(i, k, rot).some(t => this.airportClearance[t])) return false;
    if (k === T_AIRPORT && airportPlacementBlocked(i, rot, this.kind, this.level, this.rot)) return false;
    if (this.kind[i] === k && this.rot[i] === rot) return false;
    this.kind[i] = k;
    this.rot[i] = k ? rot & 3 : 0;
    this.owners = siteOwners(this.kind, this.rot);
    this.airportClearance = airportClearanceMask(this.kind, this.rot);
    this.level[i] = isService(k) ? 1 : 0;
    this.pendingSpent += cost;
    this.dirty = true;
    return true;
  }

  private payload(): EditPayload {
    if (this.rasterVersion !== this.net.version) {
      this.raster = rasterize(this.net);
      this.rasterVersion = this.net.version;
      // Roads pave over whatever was on the tile.
      for (let i = 0; i < N_TILES; i++) {
        if ((isZone(this.kind[i]) || isService(this.kind[i])) && footprint(i, this.kind[i], this.rot[i]).some(t => this.raster.cover[t])) {
          this.kind[i] = 0;
          this.level[i] = 0;
          this.rot[i] = 0;
        }
      }
    }
    this.owners = siteOwners(this.kind, this.rot);
    this.airportClearance = airportClearanceMask(this.kind, this.rot);
    this.syncParkPaths();
    const net = this.net.toPlain();
    this.segOrder = net.segs.map((s) => s[0]);
    this.serial++;
    this.segCong = new Uint8Array(this.segOrder.length);
    return {
      kind: this.kind.slice(), rot: this.rot.slice(), net, serial: this.serial,
      cover: this.raster.cover.slice(), accSeg: this.raster.accSeg.slice(), accS: this.raster.accS.slice(),
      district: this.extras.district.slice(), terraform: this.extras.terraform.slice(),
    };
  }

  /** Push accumulated edits to the worker. */
  flush(): void {
    if (!this.dirty && this.rasterVersion === this.net.version) return;
    // A negative spend tops the worker's treasury back up.
    if (this.infiniteMoney) this.pendingSpent = Math.min(0, this.stats.money - CHEAT_FLOOR);
    // Remember the city as it stood before this edit, so it can be taken back.
    if (this.committed) {
      this.undoStack.push({ before: this.committed, spent: this.pendingSpent });
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    }
    this.send({ type: 'edit', spent: this.pendingSpent, ...this.payload() });
    this.stats.money -= this.pendingSpent;
    this.pendingSpent = 0;
    this.dirty = false;
    this.committed = this.snapshotCopy();
    this.onEdit?.();
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }

  /** Take back the last edit: the map returns to how it was and its cost is refunded. */
  undo(): boolean {
    this.flush();
    const step = this.undoStack.pop();
    if (!step) return false;
    const now = this.snapshot();
    const restored: SaveData = {
      ...step.before, money: now.money + Math.max(0, step.spent), tick: now.tick, cityLevel: now.cityLevel,
      incidents: now.incidents, debt: now.debt, funding: now.funding, policies: now.policies,
      extras: { ...cloneExtras(step.before.extras ?? this.extras), taxes: [...this.extras.taxes] as Taxes, districtPolicies: [...this.extras.districtPolicies], districtNames: [...this.extras.districtNames], scenario: this.extras.scenario, disasters: this.extras.disasters },
    };
    const stack = this.undoStack;
    this.load(restored, true);
    this.undoStack = stack;
    this.onUndo?.();
    return true;
  }

  private snapshotCopy(): SaveData {
    const s = this.snapshot();
    return { ...s, kind: s.kind.slice(), level: s.level.slice(), rot: s.rot?.slice(), neglect: s.neglect?.slice() };
  }

  load(d: SaveData, keepHistory = false): void {
    if (!keepHistory) this.undoStack = [];
    this.extras = d.extras ? cloneExtras(d.extras) : defaultExtras(d.tax);
    this.incidentSave = d.incidents;
    this.incidents = { fires: d.incidents?.fires ?? [], heists: [], crashes: [], crime: [], patrol: [] };
    this.seed = d.seed;
    this.baseTerrain = generateTerrain(d.seed);
    this.terrain = shapeTerrain(this.baseTerrain, this.extras.terraform);
    this.maps = null; this.disaster = null;
    this.net = Network.fromPlain(d.net);
    ensureApproaches(this.net); // older cities and shared links stop at the map edge
    this.rasterVersion = -1;
    this.parkPaths = (d.parkPaths ?? []).map(p => ({ ...p }));
    this.parkPathMask = new Uint8Array(N_TILES);
    for (const path of this.parkPaths) for (const i of parkPathTiles(path)) this.parkPathMask[i] = 1;
    this.kind.set(d.kind);
    this.rot.set(d.rot ?? new Uint8Array(N_TILES));
    this.level.set(d.level);
    this.neglect.set(d.neglect ?? new Uint8Array(N_TILES));
    this.flags = new Uint8Array(N_TILES);
    this.pollution = new Uint8Array(N_TILES);
    this.riverPollution = new Uint8Array(this.terrain.river.length);
    this.tax = d.tax;
    const money = this.infiniteMoney ? Math.max(d.money, CHEAT_FLOOR) : d.money;
    this.stats = emptyStats(money);
    this.stats.tick = d.tick;
    this.cityTime = d.tick;
    this.stats.funding = { ...defaultFunding(), ...d.funding };
    this.stats.policies = { ...noPolicies(), ...d.policies };
    this.stats.debt = d.debt ?? 0;
    this.stats.cityLevel = d.cityLevel ?? levelForPopulation(d.kind.reduce((n, k, i) => n + (k === T_RES ? RES_POP[d.level[i]] : 0), 0));
    this.pendingSpent = 0;
    this.dirty = false;
    this.carIdsPrev = new Uint32Array(MAX_CARS); this.carIdsNext = new Uint32Array(MAX_CARS);
    this.prevCarHeights.fill(0); this.carHeights.fill(0); this.carPitch.fill(0);
    this.carsPrev = new Float32Array(MAX_CARS * 4);
    this.carsNext = new Float32Array(MAX_CARS * 4);
    const payload = this.payload();
    this.send({ type: 'load', extras: cloneExtras(this.extras), disasterRate: this.disasterRate, incidents: d.incidents, policies: this.stats.policies, funding: this.stats.funding, debt: this.stats.debt, neglect: this.neglect.slice(), cityLevel: this.stats.cityLevel, seed: d.seed, level: this.level.slice(), money, tick: d.tick, tax: d.tax, ...payload });
    this.committed = this.snapshotCopy();
    this.onTerrain?.();
    this.onEdit?.();
  }

  snapshot(): SaveData {
    return {
      extras: cloneExtras(this.extras), parkPaths: this.parkPaths.map(p => ({ ...p })), incidents: this.incidentSave, seed: this.seed, kind: this.kind, level: this.level, rot: this.rot, net: this.net.toPlain(),
      funding: this.stats.funding, policies: this.stats.policies, debt: this.stats.debt, neglect: this.neglect, cityLevel: this.stats.cityLevel, money: this.stats.money, tick: this.stats.tick, tax: this.tax,
    };
  }

  setStreetView(active: boolean): void {
    this.send({ type: 'streetView', active });
  }

  setSpeed(v: number): void {
    this.speed = v;
    this.send({ type: 'speed', value: v });
  }

  setTax(v: number): void {
    this.tax = v;
    this.extras.taxes = [v, v, v, v];
    this.send({ type: 'tax', value: v });
  }

  /** Separate rates for homes, shops, industry and offices. */
  setTaxes(taxes: Taxes): void {
    this.extras.taxes = taxes.map(t => Math.max(0, Math.min(30, Math.round(t)))) as Taxes;
    this.tax = this.extras.taxes[0];
    this.send({ type: 'taxes', taxes: [...this.extras.taxes] as Taxes });
  }

  /** Paint tiles into a district (0 clears them). Free, like zoning a colour on a map. */
  paintDistrict(tiles: number[], district: number): number {
    let changed = 0;
    for (const t of tiles) if (t >= 0 && t < N_TILES && this.extras.district[t] !== district) { this.extras.district[t] = district; changed++; }
    if (changed) { this.dirty = true; this.flush(); }
    return changed;
  }

  setDistrictPolicy(district: number, mask: number): void {
    this.extras.districtPolicies[district - 1] = mask;
    this.send({ type: 'districtPolicy', district, mask });
  }

  renameDistrict(district: number, name: string): void {
    this.extras.districtNames[district - 1] = name.slice(0, 32) || `District ${district}`;
  }

  /**
   * Dig tiles out to water, fill them in to land, or pile earth up and take it down again. Returns
   * how many changed; stops when money runs out. Nothing under a road or a building can be shaped.
   */
  terraform(tiles: number[], action: TerraformAction): { changed: number; broke: boolean } {
    let changed = 0, broke = false;
    for (const t of tiles) {
      if (!terraformAllowed(this.baseTerrain, this.extras.terraform, t, action)) continue;
      if (this.raster.cover[t] || this.owners[t] >= 0 || (this.kind[t] && action !== 'fill')) continue;
      const cost = action === 'dig' ? COST_DIG : action === 'fill' ? COST_FILL : action === 'raise' ? COST_RAISE : COST_LOWER;
      if (!this.canAfford(cost)) { broke = true; break; }
      const v = this.extras.terraform[t];
      if (action === 'raise') this.extras.terraform[t] = HILL_BASE + hillLevel(v) + 1;
      else if (action === 'lower') this.extras.terraform[t] = hillLevel(v) > 1 ? v - 1 : 0;
      else {
        // Filling a dug pond, or digging out old fill, just puts the ground back as it was.
        const undoes = (action === 'fill' && v === DUG) || (action === 'dig' && v === FILLED);
        this.extras.terraform[t] = undoes ? 0 : action === 'dig' ? DUG : FILLED;
      }
      this.pendingSpent += cost;
      changed++;
    }
    if (changed) {
      this.terrain = shapeTerrain(this.baseTerrain, this.extras.terraform);
      this.dirty = true;
      this.flush();
      this.onTerraform?.();
    }
    return { changed, broke };
  }

  /** 1 where earth has been piled up: nothing can be zoned, built or driven there. */
  get hillMask(): Uint8Array {
    const out = new Uint8Array(N_TILES);
    for (let i = 0; i < N_TILES; i++) if (hillLevel(this.extras.terraform[i])) out[i] = 1;
    return out;
  }

  setDisasters(on: boolean, trigger?: DisasterKind): void {
    this.extras.disasters = on;
    this.send({ type: 'disasters', on, rate: this.disasterRate, trigger });
  }

  setFunding(key: FundingKey, value: number): void {
    this.flush();
    this.send({ type: 'funding', key, value });
  }

  setPolicy(id: PolicyId, on: boolean): void {
    this.flush();
    this.stats.policies = { ...this.stats.policies, [id]: on };
    this.send({ type: 'policy', id, on });
  }

  loan(action: 'take' | 'repay'): void {
    this.flush();
    this.send({ type: 'loan', action });
  }

  inspect(tile: number): void {
    this.flush();
    this.send({ type: 'inspect', tile });
  }

  warm(ticks: number): void {
    this.send({ type: 'warm', ticks });
  }
}

/**
 * A fresh map: a seeded river, and a motorway running right across it just inside the roomier edge,
 * one carriageway each way, with a diamond interchange at the city's front door and a second one
 * further along. Traffic from outside arrives on both carriageways from either end of the map.
 */
export function newCity(seed: number): SaveData {
  const terrain = generateTerrain(seed);
  const net = new Network();
  const e = terrain.entry;
  // `along` runs the length of the highway, `in` measures inwards from the map edge it hugs.
  const pos = (along: number, inward: number): { x: number; z: number } => e.dx
    ? { x: e.x + e.dx * inward, z: along }
    : { x: along, z: e.z + e.dz * inward };
  const front = e.dx ? e.z : e.x;
  const carriageway = (from: number, to: number, inward: number): void => {
    const ids = net.insertPath([pos(from, inward), pos(to, inward)], KIND_MOTORWAY, true);
    for (const id of ids) net.segs.get(id)!.fixed = true;
    // Only the carriageway ends are entrances; nothing else this close to the edge is.
    for (const id of [ids[0], ids[ids.length - 1]]) for (const n of [net.segs.get(id)!.a, net.segs.get(id)!.b]) {
      const node = net.nodes.get(n)!;
      if (node.x < 1 || node.z < 1 || node.x > GRID - 1 || node.z > GRID - 1) node.entry = true;
    }
  };
  // Drive on the right: the inner carriageway runs the way that puts the city on its right-hand
  // side, so every slip road leaves from and joins the outer lane.
  const alongX = e.dx === 0, ax = alongX ? 1 : 0, az = alongX ? 0 : 1;
  const rightIsCity = (-az * e.dx + ax * e.dz) > 0;
  if (rightIsCity) { carriageway(0.5, GRID - 0.5, INNER); carriageway(GRID - 0.5, 0.5, OUTER); }
  else { carriageway(GRID - 0.5, 0.5, INNER); carriageway(0.5, GRID - 0.5, OUTER); }
  const d = rightIsCity ? 1 : -1; // which way the inner carriageway runs along the map
  interchange(net, pos, front, d);
  const second = front + 28 < GRID - 12 ? front + 28 : front - 28;
  if (second > 12) interchange(net, pos, second, d);
  for (const n of net.nodes.values()) n.fixed = true;
  ensureApproaches(net);
  return {
    seed, kind: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES), net: net.toPlain(),
    money: START_MONEY, tick: 0, tax: 10, extras: defaultExtras(10),
  };
}

/** Where the two carriageways run, measured in from the map edge. */
export const OUTER = 4.5;
export const INNER = 6.5;
/** How far in from the edge an interchange's street node sits; the city grows from there. */
export const DOOR = 9.5;

/**
 * A diamond interchange, the way real ones are laid out: a street crosses both carriageways on one
 * overpass, and four slip roads leave and join the carriageways at grade, meeting the street at the
 * foot of the bridge on either side. Each slip road peels away along the carriageway before turning.
 */
function interchange(net: Network, pos: (along: number, inward: number) => { x: number; z: number }, along: number, d: number): void {
  const inside = pos(along, DOOR), outside = pos(along, 0.5);
  const fix = (ids: number[]): void => { for (const id of ids) net.segs.get(id)!.fixed = true; };
  fix(net.insertPath([outside, inside], KIND_ROAD, false, 1));
  // Slip roads leave each carriageway before the bridge and rejoin after it, in its direction of travel.
  fix(net.insertPath([pos(along - 11 * d, INNER), pos(along - 4 * d, INNER + 0.3), inside], KIND_RAMP, true));
  fix(net.insertPath([inside, pos(along + 4 * d, INNER + 0.3), pos(along + 11 * d, INNER)], KIND_RAMP, true));
  fix(net.insertPath([pos(along + 11 * d, OUTER), pos(along + 4 * d, OUTER - 0.3), outside], KIND_RAMP, true));
  fix(net.insertPath([outside, pos(along - 4 * d, OUTER - 0.3), pos(along - 11 * d, OUTER)], KIND_RAMP, true));
}

export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xfffffff) + 1) >>> 0;
}
