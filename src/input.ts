import { structurePlan, roadHeight, BRIDGE_RISE, STRUCTURE_COST } from './roads/structures';
import type { Structure } from './roads/structures';
import { footprint } from './sites';
import { entrancePlan, entrySite } from './roads/entries';
import { T_OFFICE, T_BUS, T_STATION, T_SUBWAY, T_AIRPORT, T_TREATMENT, OFFICE_UNLOCK, ENTRY_UNLOCK, COST_ENTRY } from './constants';
import { gridPoint, roadPoint } from './placement';
import * as THREE from 'three';
import {
  T_PARK, T_PLAYGROUND, T_SPORTS, T_GARDEN, T_CLINIC, T_SCHOOL, T_FIRE, T_POLICE, T_RECYCLING, T_UNIVERSITY, T_SOLAR, GRID, N_TILES, T_EMPTY, T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET,
  ROAD_COST, COST_ZONE, COST_LIGHT, COST_ROUNDABOUT, SERVICES, idx, isService,
} from './constants';
import { MILESTONES } from './progression';
import { Network, HALF_WIDTH, KIND_AVENUE, KIND_ROAD, KIND_LANE, KIND_HIGHWAY, ROAD_LABEL, nextRoadKind, buildPieces, measurePath, sampleCurve } from './roads/network';
import type { Pose } from './roads/network';
import { touchesWater } from './terrain';
import { MeshBuilder } from './render/meshBuilder';
import type { Game } from './game';

export type Tool =
  | 'none' | 'inspect'
  | 'road' | 'avenue' | 'lane' | 'highway' | 'upgrade' | 'bridge' | 'tunnel'
  | 'roundabout' | 'light' | 'oneway'
  | 'res' | 'com' | 'ind' | 'office' | 'entry' | 'bus' | 'station' | 'subway' | 'airport' | 'treatment'
  | 'coal' | 'wind' | 'pump' | 'tower' | 'outlet'
  | 'park' | 'playground' | 'sports' | 'garden' | 'clinic' | 'school' | 'fire' | 'police' | 'recycling' | 'university' | 'solar'
  | 'bulldoze';
/** How the road tools turn clicks into a road, modelled on Cities: Skylines. */
export type RoadMode = 'straight' | 'curve' | 'smooth';

const TOOL_COLOR: Record<Tool, number> = {
  bridge: 0x9cd9c1, tunnel: 0x86d9e7,
  office: 0xb791e0, entry: 0x76c9ae, bus: 0xeab75c, station: 0x9fbfd5, subway: 0x5b8fd9, airport: 0xd3e8ef, treatment: 0x66caba,
  park: 0x72bb78, playground: 0x8fd08a, sports: 0x5fae67, garden: 0x87c98d, clinic: 0xe8eff4, school: 0xf2bd63, fire: 0xe97060, police: 0x669fdb, recycling: 0x70bda8, university: 0xbc9be3, solar: 0x628fc1,
  inspect: 0xffd166, none: 0xffffff,
  road: 0x8fa3b8, avenue: 0xc9d2dc, lane: 0xa8b4c2, highway: 0xdfe6ec, upgrade: 0xc9d2dc, roundabout: 0xc9d2dc, light: 0xffd23f, oneway: 0xffffff,
  res: 0x62c46a, com: 0x4f8fe8, ind: 0xe6b93a,
  coal: 0x9a9a9a, wind: 0xf2f2ee, pump: 0x4fb3ff, tower: 0x4fb3ff, outlet: 0x9a6b3a,
  bulldoze: 0xe04b3a,
};
export const SERVICE_TOOL: Partial<Record<Tool, number>> = { bus: T_BUS, station: T_STATION, subway: T_SUBWAY, airport: T_AIRPORT, treatment: T_TREATMENT, park: T_PARK, playground: T_PLAYGROUND, sports: T_SPORTS, garden: T_GARDEN, clinic: T_CLINIC, school: T_SCHOOL, fire: T_FIRE, police: T_POLICE, recycling: T_RECYCLING, university: T_UNIVERSITY, solar: T_SOLAR, coal: T_COAL, wind: T_WIND, pump: T_PUMP, tower: T_TOWER, outlet: T_OUTLET };
const ZONE_TOOL: Partial<Record<Tool, number>> = { res: T_RES, com: T_COM, ind: T_IND, office: T_OFFICE };
const ROUNDABOUT_R = 2.3, ROUNDABOUT_R_AVENUE = 3.4;
const BAD = 0xe04b3a;
const GUIDE = 0xffffff;

type P = { x: number; z: number; y?: number };

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();
const pose: Pose = { x: 0, z: 0, tx: 0, tz: 0 };

export class Input {
  roadTarget: THREE.Object3D | null = null;
  inspectionTarget: THREE.Object3D | null = null;
  tool: Tool = 'road';
  mode: RoadMode = 'straight';
  onInspect: ((tile: number) => void) | null = null;
  onToolChange: ((t: Tool) => void) | null = null;
  onModeChange: ((m: RoadMode) => void) | null = null;
  onToast: ((msg: string) => void) | null = null;
  /** Live label next to the cursor; null hides it. */
  onCost: ((text: string | null, x: number, y: number, ok: boolean) => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private hover: THREE.Mesh;
  private serviceRadius: THREE.Mesh;
  private shape: THREE.Mesh; // road / roundabout preview
  private rect: THREE.InstancedMesh;
  private rectMat: THREE.MeshBasicMaterial;

  // Road placement: points clicked so far for the segment being laid ([start] or [start, bend]).
  private chain: P[] = [];
  /** Direction the road was heading when it reached chain[0]; drives Smooth mode. */
  private tangent: P | null = null;
  /** Direction of the road being extended; straight roads lock onto it when the cursor is close. */
  private heading: P | null = null;
  private downScreen: { x: number; y: number } | null = null;
  private downWorld: P | null = null;
  private rightDown: { x: number; y: number } | null = null;

  // Rectangle tools.
  private dragging = false;
  private startTile = -1;
  private curTile = -1;

  private flipped = new Set<number>();
  private canvas: HTMLCanvasElement;
  private camera: THREE.Camera;
  private game: Game;

  constructor(canvas: HTMLCanvasElement, camera: THREE.Camera, game: Game, scene: THREE.Scene) {
    this.canvas = canvas;
    this.camera = camera;
    this.game = game;

    const hg = new THREE.PlaneGeometry(1, 1);
    hg.rotateX(-Math.PI / 2);
    this.hover = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
    this.hover.visible = false;
    this.hover.renderOrder = 3;
    scene.add(this.hover);
    const ring = new THREE.RingGeometry(0.985, 1, 96);
    ring.rotateX(-Math.PI / 2);
    this.serviceRadius = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x8fd19e, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    this.serviceRadius.visible = false;
    this.serviceRadius.renderOrder = 3;
    scene.add(this.serviceRadius);

    this.shape = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.shape.frustumCulled = false;
    this.shape.renderOrder = 3;
    scene.add(this.shape);

    this.rectMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
    const pg = new THREE.PlaneGeometry(0.96, 0.96);
    pg.rotateX(-Math.PI / 2);
    this.rect = new THREE.InstancedMesh(pg, this.rectMat, N_TILES);
    this.rect.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_TILES * 3), 3);
    this.rect.position.y = 0.1;
    this.rect.count = 0;
    this.rect.frustumCulled = false;
    this.rect.renderOrder = 3;
    scene.add(this.rect);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', () => { if (!this.dragging && !this.chain.length) this.clearHover(); });
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setTool(t: Tool): void {
    this.cancel();
    this.tool = t;
    this.rectMat.color.setHex(TOOL_COLOR[t]);
    this.onToolChange?.(t);
  }

  setMode(m: RoadMode): void {
    this.cancel();
    this.mode = m;
    this.onModeChange?.(m);
  }

  private isRoadTool(): boolean {
    return ['road', 'avenue', 'lane', 'highway', 'bridge', 'tunnel'].includes(this.tool);
  }

  private isRectTool(): boolean {
    return this.tool in ZONE_TOOL || this.tool === 'bulldoze';
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    const map: Record<string, Tool> = {
      i: 'inspect', r: 'road', v: 'avenue', l: 'lane', x: 'highway', u: 'upgrade', o: 'roundabout', t: 'light', y: 'oneway',
      '1': 'res', '2': 'com', '3': 'ind', b: 'bulldoze',
    };
    const key = e.key.toLowerCase();
    const t = map[key];
    if (t) this.setTool(t);
    if (key === 'c') {
      const order: RoadMode[] = ['straight', 'curve', 'smooth'];
      this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
    }
    if (e.key === 'Escape') {
      // First Escape drops the road being laid; the next one puts the tool away.
      if (this.chain.length || this.dragging) this.cancel();
      else if (this.tool !== 'none') this.setTool('none');
    }
  };

  // ---- picking and snapping --------------------------------------------------------------------
  private pick(e: { clientX: number; clientY: number }): P | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    if (this.roadTarget && ['upgrade', 'oneway'].includes(this.tool)) {
      const hits = this.raycaster.intersectObject(this.roadTarget);
      if (hits.length) return { x: hits[0].point.x + GRID / 2, z: hits[0].point.z + GRID / 2, y: hits[0].point.y };
    }
    const x = this.hit.x + GRID / 2;
    const z = this.hit.z + GRID / 2;
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return null;
    return { x, z };
  }

  private roadHit(p: P, reach = 1.1) {
    if (p.y === undefined) return this.game.net.nearestSeg(p.x, p.z, reach);
    const hits = [...this.game.net.segs.values()].map(seg => ({ seg, ...Network.nearestOn(seg, p.x, p.z) }))
      .filter(h => h.dist < reach && Math.abs(roadHeight(h.seg, h.s) - p.y!) < 0.3);
    return hits.sort((a, b) => a.dist - b.dist)[0] ?? null;
  }

  private gridSnap(p: P): P {
    return gridPoint(p);
  }

  /** Snap a road point to an existing node, then an existing road, then the grid intersection. */
  private snap(p: P): P {
    const hit = this.game.net.nearestSeg(p.x, p.z, 0.8);
    if (hit?.seg.structure && hit.s > 0.9 && hit.seg.len - hit.s > 0.9) return gridPoint(p);
    return roadPoint(this.game.net, p);
  }

  private onRoad(p: P): boolean {
    const net = this.game.net;
    return !!net.nearestNode(p.x, p.z, 0.9) || !!net.nearestSeg(p.x, p.z, 0.8);
  }

  private tileOf(p: P): number {
    return idx(Math.floor(p.x), Math.floor(p.z));
  }

  // ---- pointer handling --------------------------------------------------------------------------
  private onDown = (e: PointerEvent): void => {
    if (e.button === 2) { this.rightDown = { x: e.clientX, y: e.clientY }; return; }
    if (e.button !== 0) return;
    const p = this.pick(e);
    if (!p) return;
    if (this.tool === 'inspect' || this.tool === 'none') {
      const hits = this.inspectionTarget ? this.raycaster.intersectObject(this.inspectionTarget, true) : [];
      const building = hits.find(hit => hit.instanceId !== undefined && hit.object.userData.tileIds?.[hit.instanceId] !== undefined);
      this.onInspect?.(building ? building.object.userData.tileIds[building.instanceId!] : this.tileOf(p));
      return;
    }
    if (this.isRoadTool()) {
      this.downScreen = { x: e.clientX, y: e.clientY };
      this.downWorld = p;
    } else if (this.isRectTool()) {
      this.dragging = true;
      this.startTile = this.tileOf(p);
      this.curTile = this.startTile;
      this.updateRect();
    } else {
      this.click(p);
    }
  };

  private onMove = (e: PointerEvent): void => {
    if (this.tool === 'none') { this.clearHover(); return; }
    const p = this.pick(e);
    if (!p) { if (!this.dragging && !this.chain.length) this.clearHover(); return; }
    if (this.isRoadTool()) {
      // A press-and-drag previews from the press point, so a quick drag still lays a road.
      const pressing = this.downScreen && this.downWorld && !this.chain.length
        && Math.hypot(e.clientX - this.downScreen.x, e.clientY - this.downScreen.y) > 10;
      if (pressing) this.previewRoad([this.snap(this.downWorld!)], null, p, e);
      else if (this.chain.length) this.previewRoad(this.chain, this.tangent, p, e);
      else this.updateHover(p, e);
    } else if (this.dragging) {
      const t = this.tileOf(p);
      if (t !== this.curTile) { this.curTile = t; this.updateRect(); }
    } else {
      this.updateHover(p, e);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.button === 2) {
      // A right click that did not turn into a camera drag cancels the road being laid.
      const d = this.rightDown;
      this.rightDown = null;
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6 && this.chain.length) this.cancel();
      return;
    }
    if (e.button !== 0) return;
    if (this.isRoadTool() && this.downScreen && this.downWorld) {
      const moved = Math.hypot(e.clientX - this.downScreen.x, e.clientY - this.downScreen.y);
      const up = this.pick(e) ?? this.downWorld;
      const down = this.downWorld;
      this.downScreen = null;
      this.downWorld = null;
      if (moved > 10 && this.chain.length === 0) {
        // Drag = two clicks: press point, then release point.
        this.roadClick(down);
        this.roadClick(up);
      } else {
        this.roadClick(up);
      }
      if (this.chain.length) this.previewRoad(this.chain, this.tangent, up, e);
      return;
    }
    if (!this.dragging) return;
    this.commitRect();
    this.dragging = false;
    this.rect.count = 0;
  };

  private cancel(): void {
    this.dragging = false;
    this.chain = [];
    this.tangent = null;
    this.heading = null;
    this.downScreen = null;
    this.downWorld = null;
    this.rect.count = 0;
    this.shape.visible = false;
    this.serviceRadius.visible = false;
    this.hover.visible = false;
    this.onCost?.(null, 0, 0, true);
  }

  private clearHover(): void {
    this.hover.visible = false;
    this.shape.visible = false;
    this.serviceRadius.visible = false;
    this.hover.visible = false;
    this.onCost?.(null, 0, 0, true);
  }

  // ---- roads ---------------------------------------------------------------------------------------
  /** Heading of an existing dead-end road at this point, so Smooth mode can continue it. */
  private tangentAt(p: P): P | null {
    const net = this.game.net;
    const n = net.nearestNode(p.x, p.z, 0.05);
    if (!n || net.degree(n.id) !== 1) return null;
    const s = net.segsAt(n.id)[0];
    const atB = s.b === n.id;
    Network.poseAt(s, atB ? s.len : 0, pose);
    return atB ? { x: pose.tx, z: pose.tz } : { x: -pose.tx, z: -pose.tz };
  }

  /** Where a straight road would end: continues the existing road's heading when the cursor is within ~30° of it. */
  private endPoint(start: P, heading: P | null, cursor: P): P {
    const end = this.snap(cursor);
    if (this.mode !== 'straight' || !heading || this.onRoad(end)) return end;
    const dx = cursor.x - start.x, dz = cursor.z - start.z, len = Math.hypot(dx, dz);
    let along = dx * heading.x + dz * heading.z;
    if (len < 0.5 || along < len * 0.87) return end;
    // Axis and 45° headings land back on grid intersections.
    const step = Math.abs(Math.abs(heading.x) - Math.abs(heading.z)) < 0.02 ? Math.SQRT2 : Math.abs(heading.x) < 0.02 || Math.abs(heading.z) < 0.02 ? 1 : 0;
    if (step) along = Math.max(step, Math.round(along / step) * step);
    const p = { x: start.x + heading.x * along, z: start.z + heading.z * along };
    if (p.x < 1 || p.z < 1 || p.x > GRID - 1 || p.z > GRID - 1) return end;
    return this.onRoad(p) ? this.snap(p) : p;
  }

  /** Bend point that leaves `a` along `t` and arrives at `b` as a roughly circular arc. */
  private smoothControl(a: P, t: P, b: P): P {
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const dot = dx * t.x + dz * t.z;
    let s = dot > 0.1 * len ? (len * len) / (2 * dot) : len * 0.6;
    s = Math.max(len * 0.25, Math.min(len * 1.2, s));
    return { x: a.x + t.x * s, z: a.z + t.z * s };
  }

  /** Guide points for the segment that would be built if the user clicked at `end`. */
  private pendingPath(chain: P[], tangent: P | null, end: P): P[] {
    const start = chain[0];
    if (this.mode === 'curve' && chain.length > 1) return [start, chain[1], end];
    if (this.mode === 'smooth' && tangent) {
      const dx = end.x - start.x, dz = end.z - start.z;
      const l = Math.hypot(dx, dz) || 1;
      // Nearly straight ahead: skip the bend so it stays a clean line.
      if ((dx * tangent.x + dz * tangent.z) / l > 0.995) return [start, end];
      return [start, this.smoothControl(start, tangent, end), end];
    }
    return [start, end];
  }

  private roadStructure(path: P[]): Structure {
    if (this.tool === 'tunnel') return 2;
    return this.tool === 'bridge' || measurePath(path, this.game.terrain.water).wet > 0 ? 1 : 0;
  }

  private roadProblem(path: P[]): string | null {
    const structure = this.roadStructure(path);
    if (structure) {
      const plan = structurePlan(this.game.net, this.game.terrain, this.game.kind, path, this.drawKind(), structure);
      return typeof plan === 'string' ? plan : null;
    }
    for (const c of buildPieces(path)) {
      const sm = sampleCurve(c);
      for (const seg of this.game.net.segs.values()) {
        if (!seg.structure) continue;
        for (let i = 0; i <= sm.n; i++) {
          const hit = Network.nearestOn(seg, sm.pts[i * 2], sm.pts[i * 2 + 1]);
          if (hit.s < 0.9 || seg.len - hit.s < 0.9) {
            if (hit.dist < HALF_WIDTH[seg.kind] + 0.5 && sm.cum[i] > 1.5 && sm.len - sm.cum[i] > 1.5) return 'End the road at the bridge or tunnel entrance to connect it';
            continue;
          }
          if (hit.dist < HALF_WIDTH[seg.kind] + 0.5 && Math.abs(roadHeight(seg, hit.s)) < 1.1 * (BRIDGE_RISE / 2.4)) return 'Keep surface roads clear of the approach ramps';
        }
      }
    }
    return null;
  }

  /** The kind of road the tool in hand draws; bridges and tunnels carry streets. */
  private drawKind(): number {
    return this.tool === 'avenue' ? KIND_AVENUE : this.tool === 'lane' ? KIND_LANE : this.tool === 'highway' ? KIND_HIGHWAY : KIND_ROAD;
  }

  private roadCost(path: P[]): number {
    const unit = ROAD_COST[this.drawKind()];
    const m = measurePath(path, this.game.terrain.water);
    return Math.round(m.len * unit * STRUCTURE_COST[this.roadStructure(path)]);
  }

  private roadClick(p: P): void {
    const g = this.game;
    if (this.chain.length === 0) {
      const s = this.snap(p);
      this.chain = [s];
      this.heading = this.tangentAt(s);
      this.tangent = this.mode === 'smooth' ? this.heading : null;
      return;
    }
    const start = this.chain[0];
    if (this.mode === 'curve' && this.chain.length === 1) {
      const c = this.gridSnap(p);
      if (Math.hypot(c.x - start.x, c.z - start.z) < 0.8) return;
      this.chain.push(c);
      return;
    }
    const end = this.endPoint(start, this.heading, p);
    if (Math.hypot(end.x - start.x, end.z - start.z) < 0.8) return;
    const path = this.pendingPath(this.chain, this.tangent, end);
    const cost = this.roadCost(path);
    const problem = this.roadProblem(path);
    if (problem) { this.onToast?.(problem); return; }
    if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
    const joins = this.onRoad(end);
    const added = g.net.insertPath(path, this.drawKind(), false, this.roadStructure(path));
    if (added.length) {
      g.spend(cost);
      g.flush();
    }
    // Keep laying from where this piece ended, unless it joined an existing road.
    const prev = path[path.length - 2];
    const hl = Math.hypot(end.x - prev.x, end.z - prev.z) || 1;
    if (joins) {
      this.chain = [];
      this.tangent = null;
      this.heading = null;
      this.shape.visible = false;
    this.serviceRadius.visible = false;
      this.hover.visible = false;
    this.onCost?.(null, 0, 0, true);
    } else {
      this.chain = [end];
      this.heading = { x: (end.x - prev.x) / hl, z: (end.z - prev.z) / hl };
      this.tangent = this.mode === 'smooth' ? this.heading : null;
    }
  }

  private previewRoad(chain: P[], tangent: P | null, cursor: P, e: { clientX: number; clientY: number }): void {
    const half = GRID / 2;
    const b = new MeshBuilder();
    const start = chain[0];
    const choosingBend = this.mode === 'curve' && chain.length === 1 && !(this.downScreen && !this.chain.length);
    let label: string | null = null;
    let ok = true;

    if (choosingBend) {
      // Second click of a curve: show the tangent line out of the start point.
      const c = this.gridSnap(cursor);
      b.ribbon([start.x - half, start.z - half, c.x - half, c.z - half], 2, 0.05, 0.1, GUIDE);
      b.disc(c.x - half, c.z - half, 0.22, 0.11, GUIDE);
      label = 'Click to set the bend';
    } else {
      const end = this.endPoint(start, this.chain.length ? this.heading : this.tangentAt(start), cursor);
      if (Math.hypot(end.x - start.x, end.z - start.z) >= 0.8) {
        const path = this.pendingPath(chain, tangent, end);
        const cost = this.roadCost(path);
        const problem = this.roadProblem(path);
        ok = !problem && this.game.canAfford(cost);
        const hw = HALF_WIDTH[this.drawKind()];
        for (const c of buildPieces(path)) {
          const sm = sampleCurve(c);
          const pts = new Float32Array((sm.n + 1) * 2);
          for (let i = 0; i < pts.length; i++) pts[i] = sm.pts[i] - half;
          const structure = this.roadStructure(path);
          if (structure === 1) b.heightAt = (x, z) => {
            const hit = Network.nearestOn({ ...sm } as Parameters<typeof Network.nearestOn>[0], x + half, z + half);
            return roadHeight({ structure, len: sm.len }, hit.s);
          };
          b.ribbon(pts, sm.n + 1, hw, 0.09, ok ? TOOL_COLOR[this.tool] : BAD);
          b.heightAt = null;
        }
        if (path.length === 3) {
          // Show the bend handle so the shape of the curve is readable.
          const c = path[1];
          b.ribbon([start.x - half, start.z - half, c.x - half, c.z - half], 2, 0.035, 0.1, GUIDE);
          b.ribbon([c.x - half, c.z - half, end.x - half, end.z - half], 2, 0.035, 0.1, GUIDE);
          b.disc(c.x - half, c.z - half, 0.16, 0.11, GUIDE);
        }
        b.disc(end.x - half, end.z - half, 0.26, 0.11, GUIDE);
        label = problem ?? `$${cost.toLocaleString()} · ${this.roadStructure(path) === 1 ? "Bridge" : this.roadStructure(path) === 2 ? "Tunnel" : "Road"}`;
      }
    }
    b.disc(start.x - half, start.z - half, 0.26, 0.11, GUIDE);
    this.shape.geometry.dispose();
    this.shape.geometry = b.build();
    this.shape.visible = true;
    this.hover.visible = false;
    this.onCost?.(label, e.clientX, e.clientY, ok);
  }

  // ---- rectangles: zones and bulldoze --------------------------------------------------------------
  private rectTiles(): number[] {
    const sx = this.startTile % GRID, sz = (this.startTile / GRID) | 0;
    const cx = this.curTile % GRID, cz = (this.curTile / GRID) | 0;
    const out: number[] = [];
    for (let z = Math.min(sz, cz); z <= Math.max(sz, cz); z++) {
      for (let x = Math.min(sx, cx); x <= Math.max(sx, cx); x++) out.push(idx(x, z));
    }
    return out;
  }

  private updateRect(): void {
    const half = GRID / 2;
    let n = 0;
    q.identity();
    const zoning = this.tool !== 'bulldoze';
    for (const t of this.rectTiles()) {
      if (zoning && !this.game.buildable(t)) continue;
      m4.compose(new THREE.Vector3((t % GRID) - half + 0.5, 0, ((t / GRID) | 0) - half + 0.5), q, one);
      this.rect.setMatrixAt(n, m4);
      // Tiles too far from any road are shown gray: they can be zoned but nothing will grow there yet.
      const reachable = !zoning || this.game.raster.accSeg[t] >= 0;
      this.rect.setColorAt(n, tmpColor.setHex(reachable ? 0xffffff : 0x555555));
      n++;
    }
    this.rect.count = n;
    this.rect.instanceMatrix.needsUpdate = true;
    if (this.rect.instanceColor) this.rect.instanceColor.needsUpdate = true;
  }

  private commitRect(): void {
    const g = this.game;
    const tiles = this.rectTiles();
    let changed = 0;
    let broke = false;
    if (this.tool === 'bulldoze') {
      for (const t of tiles) if ((g.kind[t] !== T_EMPTY || g.owners[t] >= 0) && g.setKind(t, T_EMPTY, 0)) changed++;
      const sx = this.startTile % GRID, sz = (this.startTile / GRID) | 0;
      const cx = this.curTile % GRID, cz = (this.curTile / GRID) | 0;
      changed += g.net.removeInRect(Math.min(sx, cx), Math.min(sz, cz), Math.max(sx, cx) + 1, Math.max(sz, cz) + 1);
    } else {
      const zk = ZONE_TOOL[this.tool]!;
      if (zk === T_OFFICE && g.stats.cityLevel < OFFICE_UNLOCK) { this.onToast?.('Offices unlock at Thriving town (900 residents)'); return; }
      for (const t of tiles) {
        if (!g.buildable(t) || g.kind[t] === zk || isService(g.kind[t])) continue;
        if (!g.canAfford(COST_ZONE)) { broke = true; break; }
        g.setKind(t, zk, COST_ZONE);
        changed++;
      }
    }
    if (broke) this.onToast?.('Not enough money');
    if (changed > 0) { g.spend(0); g.flush(); }
  }

  // ---- single-click tools ------------------------------------------------------------------------------
  private click(p: P): void {
    const g = this.game;
    const net = g.net;
    if (this.tool === 'entry') {
      if (g.stats.cityLevel < ENTRY_UNLOCK) { this.onToast?.('City entrances unlock at Small town'); return; }
      if (!g.canAfford(COST_ENTRY)) { this.onToast?.('Not enough money'); return; }
      const plan = entrancePlan(net, g.terrain, g.kind, p.x, p.z);
      if (typeof plan === 'string') { this.onToast?.(plan); return; }
      plan.version = net.version + 1; g.net = plan; g.spend(COST_ENTRY); g.flush();
      this.onToast?.('New city entrance opened. Connect its avenue to your neighborhoods.');
    } else if (this.tool === 'upgrade') {
      const h = this.roadHit(p, 0.9);
      if (!h || h.seg.fixed) return;
      const next = nextRoadKind(h.seg.kind);
      const cost = Math.max(0, Math.round((ROAD_COST[next] - ROAD_COST[h.seg.kind]) * h.seg.len * STRUCTURE_COST[h.seg.structure ?? 0]));
      if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
      h.seg.kind = next;
      net.version++;
      g.spend(cost);
      g.flush();
    } else if (this.tool === 'light') {
      const n = net.nearestNode(p.x, p.z, 1.4);
      if (!n || net.degree(n.id) < 3) { this.onToast?.('Traffic lights go on junctions of three or more roads'); return; }
      if (n.ring) { this.onToast?.('Roundabouts do not need lights'); return; }
      if (!n.light && !g.canAfford(COST_LIGHT)) { this.onToast?.('Not enough money'); return; }
      n.light = !n.light;
      net.version++;
      g.spend(n.light ? COST_LIGHT : 0);
      g.flush();
    } else if (this.tool === 'oneway') {
      const h = this.roadHit(p, 0.9);
      if (!h || h.seg.fixed) return;
      const s = h.seg;
      if (net.nodes.get(s.a)!.ring && net.nodes.get(s.b)!.ring) { this.onToast?.('Roundabout direction is fixed'); return; }
      if (!s.oneway) { s.oneway = true; this.flipped.delete(s.id); }
      else if (!this.flipped.has(s.id)) { net.reverseSeg(s.id); this.flipped.add(s.id); }
      else { s.oneway = false; this.flipped.delete(s.id); }
      net.version++;
      g.spend(0);
      g.flush();
    } else if (this.tool === 'roundabout') {
      const c = this.roundaboutCenter(p);
      if (!g.canAfford(COST_ROUNDABOUT)) { this.onToast?.('Not enough money'); return; }
      const r = this.roundaboutRadius(c), kind = r === ROUNDABOUT_R_AVENUE ? KIND_AVENUE : KIND_ROAD;
      if (!net.addRoundabout(c.x, c.z, r, kind)) { this.onToast?.('No room for a roundabout here'); return; }
      g.spend(COST_ROUNDABOUT);
      g.flush();
    } else {
      const k = SERVICE_TOOL[this.tool];
      if (k === undefined) return;
      const t = this.tileOf(p);
      const why = this.serviceProblem(t, k);
      if (why) { this.onToast?.(why); return; }
      g.setKind(t, k, SERVICES[k].cost);
      g.flush();
    }
  }

  /** Avenue rings need a wider island to fit the four-lane corridor. */
  private roundaboutRadius(c: P): number {
    const avenue = [...this.game.net.segs.values()].some(s => s.kind === KIND_AVENUE && Network.nearestOn(s, c.x, c.z).dist < ROUNDABOUT_R + 0.5);
    return avenue ? ROUNDABOUT_R_AVENUE : ROUNDABOUT_R;
  }

  private roundaboutCenter(p: P): P {
    const n = this.game.net.nearestNode(p.x, p.z, 1.6);
    return n && !n.ring ? { x: n.x, z: n.z } : gridPoint(p);
  }

  private serviceProblem(t: number, k: number): string | null {
    const g = this.game;
    const spec = SERVICES[k];
    if (g.stats.cityLevel < (spec.unlock ?? 0)) return `Unlocks at ${MILESTONES[spec.unlock!].name} (${MILESTONES[spec.unlock!].population} residents)`;
    const cells = footprint(t, k);
    if (!cells.length || cells.some(i => !g.buildable(i, spec.needsWater))) return 'Cannot build on water or roads';
    if (spec.footprint && cells.some(i => g.kind[i] !== T_EMPTY)) return 'Clear the whole building footprint first';
    if (isService(g.kind[t])) return 'There is already a service building here';
    if (g.raster.accSeg[t] < 0) return 'Too far from a road';
    if (spec.needsWater && !touchesWater(g.terrain, t % GRID, (t / GRID) | 0)) return `${spec.name} must sit on the river bank`;
    if (!g.canAfford(spec.cost)) return 'Not enough money';
    return null;
  }

  private updateHover(p: P, e: PointerEvent): void {
    const half = GRID / 2;
    const mat = this.hover.material as THREE.MeshBasicMaterial;
    this.shape.visible = false;
    this.serviceRadius.visible = false;
    if (this.tool === 'roundabout') {
      const c = this.roundaboutCenter(p);
      const b = new MeshBuilder();
      const ok = this.game.canAfford(COST_ROUNDABOUT);
      const r = this.roundaboutRadius(c);
      b.ring(c.x - half, c.z - half, r - 0.45, r + 0.45, 0.09, ok ? TOOL_COLOR.roundabout : BAD);
      this.shape.geometry.dispose();
      this.shape.geometry = b.build();
      this.shape.visible = true;
      this.hover.visible = false;
      this.onCost?.(`$${COST_ROUNDABOUT}`, e.clientX, e.clientY, ok);
      return;
    }
    let hx = Math.floor(p.x) + 0.5, hz = Math.floor(p.z) + 0.5;
    let size = 1, depth = 1;
    let color = TOOL_COLOR[this.tool];
    let label: string | null = null;
    let ok = true;
    if (this.tool === 'entry') {
      const site = entrySite(p.x, p.z); hx = site.x; hz = site.z; size = 1.5;
      ok = this.game.stats.cityLevel >= ENTRY_UNLOCK && this.game.canAfford(COST_ENTRY) && Math.min(p.x, p.z, GRID - p.x, GRID - p.z) <= 5;
      label = ok ? `Open entrance $${COST_ENTRY}` : 'Small town required · choose the map edge';
      if (!ok) color = BAD;
    } else if (this.tool === 'inspect') {
      label = 'Click to inspect this tile';
    } else if (this.isRoadTool()) {
      const s = this.snap(p);
      hx = s.x; hz = s.z; size = 0.6;
      label = 'Click to start';
    } else if (this.tool === 'light') {
      const n = this.game.net.nearestNode(p.x, p.z, 1.4);
      if (n && this.game.net.degree(n.id) >= 3 && !n.ring) { hx = n.x; hz = n.z; size = 1.4; label = n.light ? 'Remove signal' : `$${COST_LIGHT}`; }
      else { size = 0.5; color = BAD; }
    } else if (['oneway', 'upgrade'].includes(this.tool)) {
      const h = this.roadHit(p, 0.9);
      if (h && !h.seg.fixed) {
        hx = h.x; hz = h.z; size = 0.8;
        if (this.tool === 'upgrade') {
          const next = nextRoadKind(h.seg.kind);
          const change = Math.round((ROAD_COST[next] - ROAD_COST[h.seg.kind]) * h.seg.len * STRUCTURE_COST[h.seg.structure ?? 0]);
          label = `${ROAD_LABEL[next]}${change > 0 ? ` $${change.toLocaleString()}` : ''}`;
        }
      } else { size = 0.5; color = BAD; }
    } else {
      const k = SERVICE_TOOL[this.tool];
      if (k !== undefined) {
        const spec = SERVICES[k];
        const tile = this.tileOf(p);
        hx = this.game.raster.lotX[tile]; hz = this.game.raster.lotZ[tile];
        if (spec.footprint) {
          [size, depth] = spec.footprint;
          hx = tile % GRID + size / 2; hz = Math.floor(tile / GRID) + depth / 2;
        }
        if (spec.radius) {
          this.serviceRadius.scale.set(spec.radius, 1, spec.radius);
          this.serviceRadius.position.set(hx - half, 0.1, hz - half);
          this.serviceRadius.visible = true;
        }
        const why = this.serviceProblem(this.tileOf(p), k);
        ok = !why;
        if (why) color = BAD;
        label = why && why !== 'Not enough money' ? why : `$${SERVICES[k].cost.toLocaleString()}`;
      } else if (this.tool !== 'bulldoze' && !this.game.buildable(this.tileOf(p))) {
        color = BAD;
      }
    }
    mat.color.setHex(color);
    this.hover.scale.set(size, 1, depth === 1 ? size : depth);
    this.hover.position.set(hx - half, (p.y ?? 0) + 0.095, hz - half);
    this.hover.visible = true;
    this.onCost?.(label, e.clientX, e.clientY, ok);
  }
}
