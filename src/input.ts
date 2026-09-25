import { PARK_PATH_HALF, PARK_PATH_COST } from './parkPaths';
import { airportPlacementBlocked, airportClearanceTiles } from './airports';
import { T_PATH, T_POND, T_PARK_SHOP, T_TREE, T_FLOWERS, T_BENCH, T_FOUNTAIN, T_PLAZA, T_LAWN, T_TROLLEY, T_TAXI, isDecoration } from './constants';
import { canAddBikeLane, bikeLaneCost } from './roads/network';
import { structurePlan, roadHeight, approachProblem, STRUCTURE_COST } from './roads/structures';
import type { Structure } from './roads/structures';
import { footprint, footprintSize } from './sites';
import { entrancePlan, entrySite } from './roads/entries';
import { T_OFFICE, T_BUS, T_STATION, T_SUBWAY, T_AIRPORT, T_TREATMENT, OFFICE_UNLOCK, ENTRY_UNLOCK, COST_ENTRY, T_FARM, T_LEISURE, LEISURE_UNLOCK } from './constants';
import { gridPoint } from './placement';
import { snapPoint } from './roads/snap';
import type { Snapped, SnapCtx } from './roads/snap';
import { T_CEMETERY, T_CREMATORIUM, T_POST_OFFICE, T_FLOOD_BARRIER, T_LANDMARK, T_PARKING, T_PARKING_M, T_PARKING_L } from './constants';
import { DISTRICT_COLORS, terraformAllowed } from './extras';
import type { TerraformAction } from './extras';

const LAND_TOOLS = ['lower', 'raise', 'flat'] as const;
/** Brush radii in cells for the three sizes of the land brush. */
export const BRUSH_RADIUS = [0.5, 1.6, 2.8];
import * as THREE from 'three';
import {
  T_DOCKS, T_GAS, T_HYDRO, T_NUCLEAR, T_PARK, T_PLAYGROUND, T_SPORTS, T_GARDEN, T_CLINIC, T_HOSPITAL, T_CITY_HOSPITAL, T_POLICE_HQ, T_SCHOOL, T_FIRE, T_POLICE, T_RECYCLING, T_UNIVERSITY, T_SOLAR, GRID, N_TILES, T_EMPTY, T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET,
  ROAD_COST, COST_ZONE, COST_LIGHT, COST_STOP, COST_CALM, COST_ROUNDABOUT, SERVICES, idx, isService,
} from './constants';
import { MILESTONES } from './progression';
import { isMotorway, isOneWayKind, isCarriageway, KIND_MOTORWAY, KIND_RAMP, KIND_HIGHWAY2 } from './roads/network';
import { Network, HALF_WIDTH, KIND_AVENUE, KIND_ROAD, KIND_LANE, KIND_HIGHWAY, ROAD_LABEL, ROUNDABOUT_RADIUS, RING_KIND_LIMIT, RING_SIZES, nextRoadKind, buildPieces, measurePath, sampleCurve } from './roads/network';
import type { RingSize } from './roads/network';
import type { Pose } from './roads/network';
import { touchesWater } from './terrain';
import { MeshBuilder } from './render/meshBuilder';
import { planEdit, commitEdit, moveBlocked } from './roadEdit';
import type { EditOp, EditPlan } from './roadEdit';
import type { PlainNet } from './roads/network';
import type { Game } from './game';

export type Tool =
  | 'none' | 'inspect'
  | 'taxi' | 'bikelane' | 'trolley' | 'parkpath' | 'pond' | 'parkshop' | 'tree' | 'flowers' | 'bench' | 'fountain' | 'plaza' | 'lawn'
  | 'road' | 'avenue' | 'lane' | 'highway' | 'motorway' | 'highway2' | 'ramp' | 'upgrade' | 'edit' | 'cut'
  | 'roundabout' | 'light' | 'oneway' | 'stopsign' | 'calm'
  | 'res' | 'com' | 'ind' | 'office' | 'farm' | 'leisure' | 'entry' | 'bus' | 'station' | 'subway' | 'airport' | 'treatment'
  | 'coal' | 'wind' | 'gas' | 'hydro' | 'nuclear' | 'pump' | 'tower' | 'outlet' | 'docks'
  | 'park' | 'playground' | 'sports' | 'garden' | 'clinic' | 'hospital' | 'cityhospital' | 'school' | 'fire' | 'police' | 'policehq' | 'recycling' | 'university' | 'solar'
  | 'cemetery' | 'crematorium' | 'postoffice' | 'barrier' | 'landmark' | 'parking' | 'parkingm' | 'parkingl'
  | 'district' | 'undistrict' | 'lower' | 'raise' | 'flat'
  | 'bulldoze';
/** How the road tools turn clicks into a road, modelled on Cities: Skylines. */
export type RoadMode = 'straight' | 'curve' | 'smooth';

const TOOL_COLOR: Record<Tool, number> = {
  taxi: 0xe9bb43, bikelane: 0x58b58d, trolley: 0x72b58d, parkpath: 0xd0be98, pond: 0x5199a5, parkshop: 0xd8c49b, tree: 0x4c7b49, flowers: 0xc7667d, bench: 0xa27e53, fountain: 0x73b3be, plaza: 0xb7b3a6, lawn: 0x749858,
  office: 0xb791e0, farm: 0xc9a55a, leisure: 0xe07fb0, entry: 0x76c9ae, bus: 0xeab75c, station: 0x9fbfd5, subway: 0x5b8fd9, airport: 0xd3e8ef, treatment: 0x66caba,
  park: 0x72bb78, playground: 0x8fd08a, sports: 0x5fae67, garden: 0x87c98d, clinic: 0xe8eff4, hospital: 0xf1f4f7, cityhospital: 0xf6f8fa, policehq: 0x4d82c4, school: 0xf2bd63, fire: 0xe97060, police: 0x669fdb, recycling: 0x70bda8, university: 0xbc9be3, solar: 0x628fc1,
  inspect: 0xffd166, none: 0xffffff,
  road: 0x8fa3b8, motorway: 0xdfe6ec, highway2: 0xd3dbe3, ramp: 0xc5ced8, avenue: 0xc9d2dc, lane: 0xa8b4c2, highway: 0xdfe6ec, upgrade: 0xc9d2dc, edit: 0x9fd3ff, cut: 0xe04b3a, roundabout: 0xc9d2dc, light: 0xffd23f, oneway: 0xffffff, stopsign: 0xe0503f, calm: 0x7fc4a8,
  res: 0x62c46a, com: 0x4f8fe8, ind: 0xe6b93a,
  coal: 0x9a9a9a, wind: 0xf2f2ee, gas: 0xc9ccce, hydro: 0x6fa4c6, nuclear: 0xd8d6cf, pump: 0x4fb3ff, tower: 0x4fb3ff, outlet: 0x9a6b3a, docks: 0xb8573f,
  cemetery: 0x8a9a7a, crematorium: 0xa7a39a, postoffice: 0xd9503f, barrier: 0x8fa3b0, landmark: 0xe6c36a, parking: 0x8b9096, parkingm: 0x8b9096, parkingl: 0x8b9096,
  district: 0xffffff, undistrict: 0xe04b3a, lower: 0x4f9fcf, raise: 0x9c9a62, flat: 0x7a9d5c,
  bulldoze: 0xe04b3a,
};
export const SERVICE_TOOL: Partial<Record<Tool, number>> = { taxi: T_TAXI, trolley: T_TROLLEY, parkpath: T_PATH, pond: T_POND, parkshop: T_PARK_SHOP, tree: T_TREE, flowers: T_FLOWERS, bench: T_BENCH, fountain: T_FOUNTAIN, plaza: T_PLAZA, lawn: T_LAWN, bus: T_BUS, station: T_STATION, subway: T_SUBWAY, airport: T_AIRPORT, treatment: T_TREATMENT, park: T_PARK, playground: T_PLAYGROUND, sports: T_SPORTS, garden: T_GARDEN, clinic: T_CLINIC, hospital: T_HOSPITAL, cityhospital: T_CITY_HOSPITAL, school: T_SCHOOL, fire: T_FIRE, police: T_POLICE, policehq: T_POLICE_HQ, recycling: T_RECYCLING, university: T_UNIVERSITY, solar: T_SOLAR, coal: T_COAL, wind: T_WIND, gas: T_GAS, hydro: T_HYDRO, nuclear: T_NUCLEAR, pump: T_PUMP, tower: T_TOWER, outlet: T_OUTLET, docks: T_DOCKS, cemetery: T_CEMETERY, crematorium: T_CREMATORIUM, postoffice: T_POST_OFFICE, barrier: T_FLOOD_BARRIER, landmark: T_LANDMARK, parking: T_PARKING, parkingm: T_PARKING_M, parkingl: T_PARKING_L };
const ZONE_TOOL: Partial<Record<Tool, number>> = { res: T_RES, com: T_COM, ind: T_IND, office: T_OFFICE, farm: T_FARM, leisure: T_LEISURE };

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
  /** True while walking the streets: clicks and shortcut keys belong to the walker then. */
  suspended = false;
  onRotate: ((quarter: number) => void) | null = null;
  onElevation: ((level: number) => void) | null = null;
  /** What the road tool is drawing: -1 a tunnel, 0 the surface, 1 a bridge. */
  elevation = 0;
  /** Quarter turns applied to the next building placed, cleared when the tool changes. */
  placeRotation = 0;
  onModeChange: ((m: RoadMode) => void) | null = null;
  onToast: ((msg: string) => void) | null = null;
  /** Which district the district brush paints (1..8). */
  districtBrush = 1;
  onDistrict: (() => void) | null = null;
  /** Land brush size: 0 small, 1 medium, 2 large. */
  brushSize = 1;
  /** Road points snap to tile centres, as they used to, instead of to guides and angle steps. */
  gridSnapOn = false;
  /** Alt held: road points go exactly where the pointer is, unless they join a road. */
  private free = false;
  /** The last road-point snap, whose guides and label the preview shows. */
  private lastSnap: Snapped | null = null;
  /** Which roundabout the tool draws: matched to the roads, or a size the player picked. */
  ringSize: RingSize = 'auto';
  private painted = new Set<number>();
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

  /** A road edit in progress: what was grabbed, the network as it stood, and the latest plan. */
  private editing: { op: EditOp; plain: PlainNet; screen: { x: number; y: number }; plan: EditPlan | null; grab: P; mid: P; moved?: boolean } | null = null;

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
    this.elevation = 0;
    this.onElevation?.(0);
    this.placeRotation = 0;
    this.onRotate?.(0);
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
    return ['road', 'avenue', 'lane', 'highway', 'motorway', 'highway2', 'ramp', 'parkpath'].includes(this.tool);
  }

  private isRectTool(): boolean {
    return this.tool in ZONE_TOOL || ['plaza', 'lawn', 'bulldoze'].includes(this.tool);
  }

  private isLandTool(): boolean {
    return (LAND_TOOLS as readonly string[]).includes(this.tool);
  }

  private isDistrictTool(): boolean {
    return this.tool === 'district' || this.tool === 'undistrict';
  }

  /** Tools that paint with the round brush: shaping the ground and marking out districts. */
  private isBrushTool(): boolean {
    return this.isLandTool() || this.isDistrictTool();
  }

  /** Tiles under the land brush centred on a tile. */
  private brushTiles(centre: number): number[] {
    const r = BRUSH_RADIUS[this.brushSize], cx = centre % GRID, cz = Math.floor(centre / GRID), out: number[] = [];
    for (let z = Math.ceil(cz - r); z <= Math.floor(cz + r); z++) for (let x = Math.ceil(cx - r); x <= Math.floor(cx + r); x++) {
      if (x < 0 || z < 0 || x >= GRID || z >= GRID || Math.hypot(x - cx, z - cz) > r) continue;
      out.push(z * GRID + x);
    }
    return out;
  }

  /** Shape the ground or mark the district under the brush, once per tile per stroke. */
  private paintBrush(centre: number): void {
    const tiles = this.brushTiles(centre).filter(t => !this.painted.has(t));
    for (const t of tiles) this.painted.add(t);
    if (!tiles.length) return;
    if (this.isDistrictTool()) {
      if (this.game.paintDistrict(tiles, this.tool === 'district' ? this.districtBrush : 0)) this.onDistrict?.();
      return;
    }
    const result = this.game.terraform(tiles, this.tool as TerraformAction);
    if (result.broke) this.onToast?.('Not enough money');
  }

  /** Show the brush footprint under the cursor: in the district's colour, or lit where the ground can be shaped. */
  private previewBrush(centre: number): void {
    const half = GRID / 2;
    let n = 0;
    q.identity();
    const district = this.isDistrictTool();
    const tint = this.tool === 'district' ? DISTRICT_COLORS[this.districtBrush - 1] : 0xffffff;
    for (const t of this.brushTiles(centre)) {
      const ok = district || (terraformAllowed(this.game.baseTerrain, this.game.extras.terraform, t, this.tool as TerraformAction) && !this.game.raster.cover[t] && this.game.owners[t] < 0);
      m4.compose(new THREE.Vector3((t % GRID) - half + 0.5, 0, ((t / GRID) | 0) - half + 0.5), q, one);
      this.rect.setMatrixAt(n, m4);
      this.rect.setColorAt(n, tmpColor.setHex(ok ? tint : 0x555555));
      n++;
    }
    this.rect.count = n;
    this.rect.instanceMatrix.needsUpdate = true;
    if (this.rect.instanceColor) this.rect.instanceColor.needsUpdate = true;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.suspended) return;
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    const map: Record<string, Tool> = {
      i: 'inspect', n: 'edit', z: 'cut', r: 'road', v: 'avenue', l: 'lane', x: 'highway', u: 'upgrade', o: 'roundabout', t: 'light', y: 'oneway', k: 'stopsign', j: 'calm',
      '1': 'res', '2': 'com', '3': 'ind', b: 'bulldoze',
    };
    const key = e.key.toLowerCase();
    const t = map[key];
    if (t) this.setTool(t);
    if (key === 'g' && SERVICE_TOOL[this.tool] !== undefined) this.rotatePlacement();
    else if (key === 'g' && this.isRoadTool() && this.tool !== 'parkpath') {
      this.gridSnapOn = !this.gridSnapOn;
      this.onToast?.(this.gridSnapOn ? 'Grid snap on: road points sit on tile centres' : 'Grid snap off: roads go anywhere, with guides and 15° steps');
    }
    if (this.isRoadTool()) {
      if (e.key === '+' || e.key === '=' || e.key === 'PageUp') this.setElevation(this.elevation + 1);
      if (e.key === '-' || e.key === '_' || e.key === 'PageDown') this.setElevation(this.elevation - 1);
    }
    if (key === 'c') {
      const order: RoadMode[] = ['straight', 'curve', 'smooth'];
      this.setMode(order[(order.indexOf(this.mode) + 1) % order.length]);
    }
    if (e.key === 'Escape') {
      // First Escape drops the road being laid; the next one puts the tool away.
      if (this.chain.length || this.dragging || this.editing) this.cancel();
      else if (this.tool !== 'none') this.setTool('none');
    }
  };

  // ---- picking and snapping --------------------------------------------------------------------
  /** How many world units about 10 pixels cover under the pointer, over the 0.5 guides catch close up. */
  private reach = 1;

  private pick(e: { clientX: number; clientY: number }): P | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX + 10 - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const side = this.raycaster.ray.intersectPlane(this.plane, this.hit) ? this.hit.clone() : null;
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    if (side) this.reach = side.distanceTo(this.hit) / 0.5;
    if (this.roadTarget && ['upgrade', 'oneway', 'bikelane', 'edit', 'cut'].includes(this.tool)) {
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
    return this.tool === 'parkpath' ? { x: Math.max(0.25, Math.min(GRID - 0.25, Math.round(p.x * 4) / 4)), z: Math.max(0.25, Math.min(GRID - 0.25, Math.round(p.z * 4) / 4)) } : gridPoint(p);
  }

  /**
   * Snap a road point: an existing node, then an existing road, then guide lines and 15° steps from
   * `ctx.from` (or tile centres with grid snap on). Alt leaves it where the pointer is.
   */
  private snap(p: P, ctx: SnapCtx = {}): P {
    if (this.tool === 'parkpath') {
      for (const path of this.game.parkPaths) for (const end of [{ x: path.ax, z: path.az }, { x: path.bx, z: path.bz }]) if (Math.hypot(end.x - p.x, end.z - p.z) < 0.3) return end;
      return this.gridSnap(p);
    }
    this.lastSnap = snapPoint(this.game.net, p, { grid: this.gridSnapOn, free: this.free, reach: this.reach, ...ctx });
    return { x: this.lastSnap.x, z: this.lastSnap.z };
  }

  /** Where a curve's bend goes: guides and steps from the start, but never onto a road. */
  private bendPoint(start: P, p: P): P {
    if (this.tool === 'parkpath') return this.gridSnap(p);
    return this.snap(p, { joins: false, from: start });
  }

  private onRoad(p: P): boolean {
    if (this.tool === 'parkpath') return false;
    const net = this.game.net;
    return !!net.nearestNode(p.x, p.z, 0.9) || !!net.nearestSeg(p.x, p.z, 0.8);
  }

  private tileOf(p: P): number {
    return idx(Math.floor(p.x), Math.floor(p.z));
  }

  // ---- pointer handling --------------------------------------------------------------------------
  private onDown = (e: PointerEvent): void => {
    if (this.suspended) return;
    this.free = e.altKey;
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
    } else if (this.isEditTool()) {
      this.beginEdit(p, e);
    } else if (this.isBrushTool()) {
      this.dragging = true;
      this.painted.clear();
      this.curTile = this.tileOf(p);
      this.paintBrush(this.curTile);
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
    if (this.suspended) return;
    if (this.tool === 'none') { this.clearHover(); return; }
    this.free = e.altKey;
    const p = this.pick(e);
    if (!p) { if (!this.dragging && !this.chain.length) this.clearHover(); return; }
    if (this.editing) {
      this.dragEdit(p, e);
    } else if (this.isRoadTool()) {
      // A press-and-drag previews from the press point, so a quick drag still lays a road.
      const pressing = this.downScreen && this.downWorld && !this.chain.length
        && Math.hypot(e.clientX - this.downScreen.x, e.clientY - this.downScreen.y) > 10;
      if (pressing) this.previewRoad([this.snap(this.downWorld!)], null, p, e);
      else if (this.chain.length) this.previewRoad(this.chain, this.tangent, p, e);
      else this.updateHover(p, e);
    } else if (this.dragging && this.isBrushTool()) {
      const t = this.tileOf(p);
      if (t !== this.curTile) { this.curTile = t; this.paintBrush(t); }
      this.previewBrush(t);
    } else if (this.dragging) {
      const t = this.tileOf(p);
      if (t !== this.curTile) { this.curTile = t; this.updateRect(); }
    } else if (this.isBrushTool()) {
      this.previewBrush(this.tileOf(p));
      this.onCost?.(null, e.clientX, e.clientY, true);
    } else {
      this.updateHover(p, e);
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.free = e.altKey;
    if (e.button === 2) {
      // A right click that did not turn into a camera drag cancels the road being laid.
      const d = this.rightDown;
      this.rightDown = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 6) return;
      if (this.chain.length) { this.cancel(); return; }
      // Right-clicking with a building in hand turns it, like Cities: Skylines.
      if (SERVICE_TOOL[this.tool] !== undefined) {
        this.rotatePlacement();
        const p = this.pick(e);
        if (p) this.updateHover(p, e);
      }
      return;
    }
    if (e.button !== 0) return;
    if (this.editing) { this.finishEdit(e); return; }
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
    if (this.isBrushTool()) { this.dragging = false; this.painted.clear(); return; }
    this.commitRect();
    this.dragging = false;
    this.rect.count = 0;
  };

  private cancel(): void {
    this.editing = null;
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
    if (this.tool === 'parkpath') {
      for (const path of this.game.parkPaths) {
        for (const [x, z, cx, cz] of [[path.ax, path.az, path.cx, path.cz], [path.bx, path.bz, path.cx, path.cz]]) {
          const len = Math.hypot(x - cx, z - cz);
          if (len && Math.hypot(p.x - x, p.z - z) < 0.05) return { x: (x - cx) / len, z: (z - cz) / len };
        }
      }
      return null;
    }
    const net = this.game.net;
    const n = net.nearestNode(p.x, p.z, 0.05);
    if (!n || net.degree(n.id) !== 1) return null;
    const s = net.segsAt(n.id)[0];
    const atB = s.b === n.id;
    Network.poseAt(s, atB ? s.len : 0, pose);
    return atB ? { x: pose.tx, z: pose.tz } : { x: -pose.tx, z: -pose.tz };
  }

  /** Where a road would end: straight roads step their heading by 15° from the road they continue. */
  private endPoint(start: P, heading: P | null, cursor: P): P {
    if (this.tool !== 'parkpath') return this.snap(cursor, { from: start, heading: this.mode === 'straight' ? heading : null });
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
    if (this.tool === 'parkpath') return 0;
    if (this.elevation < 0) return 2;
    // Raised by hand, or automatically where the road would otherwise run through the river.
    return this.elevation > 0 || measurePath(path, this.game.terrain.water).wet > 0 ? 1 : 0;
  }

  /**
   * Step the road being drawn up or down: tunnel, surface, bridge. Cities: Skylines raises roads the
   * same way, and it beats keeping a separate tool for every height.
   */
  setElevation(level: number): void {
    const next = Math.max(-1, Math.min(1, level));
    if (next === this.elevation) return;
    this.elevation = next;
    this.onElevation?.(next);
    if (this.chain.length) this.cancel();
  }

  private roadProblem(path: P[]): string | null {
    if (this.tool === 'parkpath') return this.game.parkPathProblem(buildPieces(path));
    if (measurePath(path, this.game.hillMask).wet > 0) return 'Roads cannot climb raised ground: lower it first';
    const structure = this.roadStructure(path);
    if (structure) {
      const plan = structurePlan(this.game.net, this.game.terrain, this.game.kind, path, this.drawKind(), structure);
      return typeof plan === 'string' ? plan : null;
    }
    return approachProblem(this.game.net, path);
  }

  /** The kind of road the tool in hand draws, at whatever height it is set to. */
  private drawKind(): number {
    return this.tool === 'avenue' ? KIND_AVENUE : this.tool === 'lane' ? KIND_LANE : this.tool === 'highway' ? KIND_HIGHWAY : this.tool === 'motorway' ? KIND_MOTORWAY : this.tool === 'highway2' ? KIND_HIGHWAY2 : this.tool === 'ramp' ? KIND_RAMP : KIND_ROAD;
  }

  private roadCost(path: P[]): number {
    if (this.tool === 'parkpath') return Math.ceil(buildPieces(path).reduce((n, p) => n + sampleCurve(p).len, 0) * PARK_PATH_COST);
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
      const c = this.bendPoint(start, p);
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
    if (this.tool === 'parkpath') {
      if (g.addParkPaths(buildPieces(path))) g.flush();
    } else {
      // One-way highways and ramps run the way they were drawn, start to finish.
      const added = g.net.insertPath(path, this.drawKind(), isOneWayKind(this.drawKind()), this.roadStructure(path));
      if (added.length) { g.spend(cost); g.flush(); }
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
      const c = this.bendPoint(start, cursor);
      b.ribbon([start.x - half, start.z - half, c.x - half, c.z - half], 2, 0.05, 0.1, GUIDE);
      b.disc(c.x - half, c.z - half, 0.22, 0.11, GUIDE);
      this.drawGuides(b);
      label = this.lastSnap?.label && this.tool !== 'parkpath' ? `${this.lastSnap.label} · Click to set the bend` : 'Click to set the bend';
    } else {
      const end = this.endPoint(start, this.chain.length ? this.heading : this.tangentAt(start), cursor);
      if (Math.hypot(end.x - start.x, end.z - start.z) >= 0.8) {
        const path = this.pendingPath(chain, tangent, end);
        const cost = this.roadCost(path);
        const problem = this.roadProblem(path);
        ok = !problem && this.game.canAfford(cost);
        const hw = this.tool === 'parkpath' ? PARK_PATH_HALF : HALF_WIDTH[this.drawKind()];
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
        const snapLabel = this.tool !== 'parkpath' ? this.lastSnap?.label : null;
        if (this.tool !== 'parkpath') this.drawGuides(b);
        label = problem ?? `${snapLabel ? `${snapLabel} · ` : ''}$${cost.toLocaleString()} · ${this.tool === 'parkpath' ? "Park path" : this.roadStructure(path) === 1 ? "Bridge" : this.roadStructure(path) === 2 ? "Tunnel" : "Road"}`;
      }
    }
    b.disc(start.x - half, start.z - half, 0.26, 0.11, GUIDE);
    this.shape.geometry.dispose();
    this.shape.geometry = b.build();
    this.shape.visible = true;
    this.hover.visible = false;
    this.onCost?.(label, e.clientX, e.clientY, ok);
  }

  /** Dashed lines along whichever guides the last snap caught on. */
  private drawGuides(b: MeshBuilder): void {
    const half = GRID / 2;
    for (const g of this.lastSnap?.guides ?? []) {
      const len = Math.hypot(g.bx - g.ax, g.bz - g.az);
      if (len < 0.1) continue;
      const ux = (g.bx - g.ax) / len, uz = (g.bz - g.az) / len;
      for (let d = 0; d < len; d += 0.5) {
        const e = Math.min(len, d + 0.28);
        b.ribbon([g.ax + ux * d - half, g.az + uz * d - half, g.ax + ux * e - half, g.az + uz * e - half], 2, 0.03, 0.105, GUIDE);
      }
    }
  }

  // ---- editing roads: drag nodes, bend, cut and re-kind stretches -----------------------------------
  /** Edit, Cut, and Upgrade (which still upgrades a whole road on a plain click). */
  private isEditTool(): boolean {
    return this.tool === 'edit' || this.tool === 'cut' || this.tool === 'upgrade';
  }

  /** Grab whatever is under the pointer for the edit tool in hand. */
  private beginEdit(p: P, e: PointerEvent): void {
    const net = this.game.net;
    const screen = { x: e.clientX, y: e.clientY };
    let op: EditOp | null = null;
    let mid: P = { x: p.x, z: p.z };
    if (this.tool === 'edit') {
      const node = net.nearestNode(p.x, p.z, 0.9);
      if (node && net.degree(node.id)) {
        const why = moveBlocked(net, node.id);
        if (why) { this.onToast?.(why); return; }
        op = { type: 'move', node: node.id, x: node.x, z: node.z };
      } else {
        const h = this.roadHit(p, 0.9);
        if (!h) return;
        if (!net.editable(h.seg)) { this.onToast?.(h.seg.fixed ? "The map's own motorway cannot be reshaped" : 'Roundabouts keep their shape'); return; }
        op = { type: 'bend', seg: h.seg.id, x: h.x, z: h.z };
        // The road's middle moves with the pointer from wherever it was grabbed, so it never jumps.
        const a = net.nodes.get(h.seg.a)!, b = net.nodes.get(h.seg.b)!;
        mid = { x: (a.x + b.x) / 4 + h.seg.cx / 2, z: (a.z + b.z) / 4 + h.seg.cz / 2 };
      }
    } else {
      const h = this.roadHit(p, 0.9);
      if (!h) return;
      // Upgrade still widens a roundabout's ring on a click; only the stretch drag needs an ordinary road.
      if (this.tool === 'upgrade' ? h.seg.fixed : !net.editable(h.seg)) { this.onToast?.(h.seg.fixed ? "The map's own motorway cannot be changed" : 'Roundabouts are removed with the bulldozer'); return; }
      op = this.tool === 'cut'
        ? { type: 'cut', seg: h.seg.id, s0: h.s, s1: h.s }
        : { type: 'kind', seg: h.seg.id, s0: h.s, s1: h.s, kind: nextRoadKind(h.seg.kind) };
    }
    this.editing = { op, plain: net.toPlain(), screen, plan: null, grab: { x: p.x, z: p.z }, mid };
  }

  /** Whether the pointer has moved far enough since the press to count as a drag. */
  private editDragged(ed: NonNullable<Input['editing']>, e: { clientX: number; clientY: number }): boolean {
    // Once it has moved it stays a drag, even brought back to where it started.
    if (!ed.moved && Math.hypot(e.clientX - ed.screen.x, e.clientY - ed.screen.y) > 6) ed.moved = true;
    return !!ed.moved;
  }

  private dragEdit(p: P, e: PointerEvent): void {
    const ed = this.editing!;
    const net = this.game.net;
    const op = ed.op;
    if (!this.editDragged(ed, e)) return;
    if (op.type === 'move') {
      const own = new Set(net.segsAt(op.node).map(s => s.id));
      const t = this.snap(p, { excludeNodes: new Set([op.node]), excludeSegs: own });
      op.x = t.x; op.z = t.z;
    } else if (op.type === 'bend') {
      this.lastSnap = null;
      op.x = ed.mid.x + p.x - ed.grab.x; op.z = ed.mid.z + p.z - ed.grab.z;
    } else {
      const seg = net.segs.get(op.seg);
      if (!seg) return;
      op.s1 = Network.nearestOn(seg, p.x, p.z).s;
    }
    ed.plan = planEdit(this.game, op, ed.plain);
    this.previewEdit(ed.plan, e);
  }

  private finishEdit(e: PointerEvent): void {
    const ed = this.editing!;
    this.editing = null;
    const p = this.pick(e);
    if (!this.editDragged(ed, e)) {
      // A click: Upgrade widens the whole road as before, Cut removes the whole road.
      if (ed.op.type === 'kind' && p) this.click(p);
      else if (ed.op.type === 'cut') {
        const seg = this.game.net.segs.get(ed.op.seg);
        if (seg) this.applyEdit(planEdit(this.game, { ...ed.op, s0: 0, s1: seg.len }, ed.plain));
      }
    } else if (ed.plan) this.applyEdit(ed.plan);
    this.shape.visible = false;
    this.onCost?.(null, 0, 0, true);
    if (p) this.updateHover(p, e);
  }

  private applyEdit(plan: EditPlan): void {
    if (plan.problem) { this.onToast?.(plan.problem); return; }
    commitEdit(this.game, plan);
  }

  /** Draw the edited roads over the old ones, and the removed stretch of a cut in red. */
  private previewEdit(plan: EditPlan, e: { clientX: number; clientY: number }): void {
    const half = GRID / 2;
    const b = new MeshBuilder();
    const ok = !plan.problem;
    const op = this.editing!.op;
    const ribbon = (seg: import('./roads/network').RSeg, from: number, to: number, color: number): void => {
      const pts: number[] = [];
      for (let d = from; ; d = Math.min(to, d + 0.25)) {
        Network.poseAt(seg, d, pose);
        pts.push(pose.x - half, pose.z - half);
        if (d >= to) break;
      }
      if (pts.length >= 4) b.ribbon(pts, pts.length / 2, HALF_WIDTH[seg.kind], 0.1, color);
    };
    if (op.type === 'cut') {
      const seg = this.game.net.segs.get(op.seg);
      if (seg) ribbon(seg, Math.min(op.s0, op.s1), Math.max(op.s0, op.s1), ok ? BAD : 0x777777);
    } else {
      for (const id of plan.ids) {
        const seg = plan.net.segs.get(id);
        if (seg) ribbon(seg, 0, seg.len, ok ? TOOL_COLOR[this.tool] : BAD);
      }
      if (op.type === 'move' || op.type === 'bend') b.disc(op.x - half, op.z - half, 0.26, 0.12, GUIDE);
      this.drawGuides(b);
    }
    this.shape.geometry.dispose();
    this.shape.geometry = b.build();
    this.shape.visible = true;
    this.hover.visible = false;
    const snapLabel = op.type === 'move' ? this.lastSnap?.label : null;
    const parts = [snapLabel, op.type === 'cut' ? 'Cut' : `$${plan.cost.toLocaleString()}`, plan.lost ? `−${plan.lost} building${plan.lost > 1 ? 's' : ''}` : null];
    this.onCost?.(plan.problem ?? parts.filter(Boolean).join(' · '), e.clientX, e.clientY, ok);
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
    } else if (['parkpath', 'plaza', 'lawn'].includes(this.tool)) {
      const k = SERVICE_TOOL[this.tool]!;
      for (const t of tiles) {
        if (g.kind[t] === k) continue;
        const problem = this.serviceProblem(t, k);
        if (problem === 'Not enough money') { broke = true; break; }
        if (problem) continue;
        if (g.setKind(t, k, SERVICES[k].cost)) changed++;
      }
    } else {
      const zk = ZONE_TOOL[this.tool]!;
      if (zk === T_OFFICE && g.stats.cityLevel < OFFICE_UNLOCK) { this.onToast?.('Offices unlock at Thriving town (900 residents)'); return; }
      if (zk === T_LEISURE && g.stats.cityLevel < LEISURE_UNLOCK) { this.onToast?.('Leisure & tourism unlocks at Small town (400 residents)'); return; }
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
      if (!canAddBikeLane(h.seg, net)) h.seg.bike = false;
      net.version++;
      g.spend(cost);
      g.flush();
    } else if (this.tool === 'light') {
      const n = net.nearestNode(p.x, p.z, 1.4);
      if (!n || net.degree(n.id) < 3) { this.onToast?.('Traffic lights go on junctions of three or more roads'); return; }
      if (n.ring) { this.onToast?.('Roundabouts do not need lights'); return; }
      if (!n.light && !g.canAfford(COST_LIGHT)) { this.onToast?.('Not enough money'); return; }
      n.light = !n.light;
      if (n.light) n.stop = false;
      net.version++;
      g.spend(n.light ? COST_LIGHT : 0);
      g.flush();
    } else if (this.tool === 'stopsign') {
      const n = net.nearestNode(p.x, p.z, 1.4);
      if (!n || net.degree(n.id) < 3) { this.onToast?.('Stop signs go on junctions of three or more roads'); return; }
      if (n.ring) { this.onToast?.('Roundabouts already give way'); return; }
      if (!n.stop && !g.canAfford(COST_STOP)) { this.onToast?.('Not enough money'); return; }
      n.stop = !n.stop;
      if (n.stop) n.light = false; // a junction is controlled one way or the other
      net.version++;
      g.spend(n.stop ? COST_STOP : 0);
      g.flush();
    } else if (this.tool === 'bikelane') {
      const h = this.roadHit(p, 0.9);
      if (!h || (!h.seg.bike && !canAddBikeLane(h.seg, net))) { this.onToast?.('Bike lanes need a surface street or avenue away from roundabouts'); return; }
      const cost = h.seg.bike ? 0 : bikeLaneCost(h.seg);
      if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
      h.seg.bike = !h.seg.bike;
      net.version++;
      g.spend(cost); g.flush();
    } else if (this.tool === 'calm') {
      const h = this.roadHit(p, 0.9);
      if (!h || h.seg.fixed) { this.onToast?.('Pick a street to calm'); return; }
      if (isMotorway(h.seg.kind)) { this.onToast?.('Expressways and ramps cannot be calmed'); return; }
      const cost = h.seg.calm ? 0 : Math.round(COST_CALM * h.seg.len);
      if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
      h.seg.calm = !h.seg.calm;
      net.version++;
      g.spend(cost);
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
      const c = this.roundaboutCenter(p), cost = this.roundaboutCost();
      if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
      const kind = this.roundaboutKind(c);
      if (!net.addRoundabout(c.x, c.z, this.roundaboutRadius(c), kind)) { this.onToast?.('No room for a roundabout here'); return; }
      g.spend(cost);
      g.flush();
    } else {
      const k = SERVICE_TOOL[this.tool];
      if (k === undefined) return;
      const t = this.tileOf(p);
      const why = this.serviceProblem(t, k);
      if (why) { this.onToast?.(why); return; }
      g.setKind(t, k, SERVICES[k].cost, k === T_PATH ? 0 : this.placeRotation);
      g.flush();
    }
  }

  /** Turn the building waiting to be placed a quarter turn clockwise. */
  rotatePlacement(): void {
    this.placeRotation = (this.placeRotation + 1) & 3;
    this.onRotate?.(this.placeRotation);
  }

  private ring(): typeof RING_SIZES[number] { return RING_SIZES.find(s => s.id === this.ringSize) ?? RING_SIZES[0]; }

  private roundaboutCost(): number { return Math.round(COST_ROUNDABOUT * this.ring().cost); }

  /** The ring's carriageway: the size the player picked, or else the widest road that meets it. */
  private roundaboutKind(c: P): number {
    const picked = this.ring().kind;
    if (picked !== null) return picked;
    let kind = KIND_LANE;
    for (const s of this.game.net.segs.values()) {
      if (s.structure || Network.nearestOn(s, c.x, c.z).dist > ROUNDABOUT_RADIUS[s.kind] + 0.8) continue;
      if (ROUNDABOUT_RADIUS[s.kind] > ROUNDABOUT_RADIUS[kind]) kind = s.kind;
    }
    // An expressway arriving at a roundabout slows to avenue size: a six-lane circle would be enormous.
    return kind === KIND_HIGHWAY || isCarriageway(kind) ? RING_KIND_LIMIT : kind === KIND_RAMP ? KIND_ROAD : kind;
  }

  private roundaboutRadius(c: P): number {
    return this.ring().radius ?? ROUNDABOUT_RADIUS[this.roundaboutKind(c)];
  }

  private roundaboutCenter(p: P): P {
    const n = this.game.net.nearestNode(p.x, p.z, 1.6);
    return n && !n.ring ? { x: n.x, z: n.z } : gridPoint(p);
  }

  private serviceProblem(t: number, k: number): string | null {
    const g = this.game;
    const spec = SERVICES[k];
    if (g.stats.cityLevel < (spec.unlock ?? 0)) return `Unlocks at ${MILESTONES[spec.unlock!].name} (${MILESTONES[spec.unlock!].population} residents)`;
    const cells = footprint(t, k, this.placeRotation);
    if (cells.some(i => g.airportClearance[i])) return 'Keep the airport runway and flight path clear';
    if (k === T_AIRPORT && airportPlacementBlocked(t, this.placeRotation, g.kind, g.level, g.rot)) return 'Clear buildings beside the runway and along both flight paths first';
    if (!cells.length || cells.some(i => !g.buildable(i, spec.needsWater))) return 'Cannot build on water or roads';
    if (spec.footprint && cells.some(i => g.kind[i] !== T_EMPTY)) return 'Clear the whole building footprint first';
    if (isService(g.kind[t]) && !(spec.decoration && isDecoration(g.kind[t]))) return 'There is already a service building here';
    if (spec.decoration && g.kind[t] && !isDecoration(g.kind[t])) return 'Clear this tile before decorating it';
    if (!spec.decoration && g.raster.accSeg[t] < 0) return 'Too far from a road';
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
      const cost = this.roundaboutCost(), ok = this.game.canAfford(cost);
      const r = this.roundaboutRadius(c);
      b.ring(c.x - half, c.z - half, r - 0.45, r + 0.45, 0.09, ok ? TOOL_COLOR.roundabout : BAD);
      this.shape.geometry.dispose();
      this.shape.geometry = b.build();
      this.shape.visible = true;
      this.hover.visible = false;
      this.onCost?.(`$${cost}`, e.clientX, e.clientY, ok);
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
      label = this.tool !== 'parkpath' && this.lastSnap?.label ? `${this.lastSnap.label} · Click to start` : 'Click to start';
    } else if (this.tool === 'light' || this.tool === 'stopsign') {
      const n = this.game.net.nearestNode(p.x, p.z, 1.4);
      const sign = this.tool === 'stopsign';
      if (n && this.game.net.degree(n.id) >= 3 && !n.ring) {
        hx = n.x; hz = n.z; size = 1.4;
        label = sign ? (n.stop ? 'Remove stop signs' : `$${COST_STOP}`) : n.light ? 'Remove signal' : `$${COST_LIGHT}`;
      } else { size = 0.5; color = BAD; }
    } else if (this.tool === 'edit') {
      const net = this.game.net;
      const n = net.nearestNode(p.x, p.z, 0.9);
      const h = n && net.degree(n.id) ? null : this.roadHit(p, 0.9);
      if (n && net.degree(n.id)) {
        hx = n.x; hz = n.z; size = 0.9;
        label = moveBlocked(net, n.id) ?? 'Drag to move this point';
        if (moveBlocked(net, n.id)) { color = BAD; ok = false; }
      } else if (h) {
        hx = h.x; hz = h.z; size = 0.7;
        label = net.editable(h.seg) ? 'Drag to bend this road' : 'This road keeps its shape';
        if (!net.editable(h.seg)) { color = BAD; ok = false; }
      } else { size = 0.5; label = 'Grab a point or a road'; }
    } else if (['oneway', 'upgrade', 'calm', 'bikelane', 'cut'].includes(this.tool)) {
      const h = this.roadHit(p, 0.9);
      if (h && !h.seg.fixed) {
        hx = h.x; hz = h.z; size = 0.8;
        if (this.tool === 'cut') {
          label = this.game.net.editable(h.seg) ? (h.seg.structure ? 'Click to remove the span' : 'Click to remove · drag to cut a stretch') : 'Roundabouts are removed with the bulldozer';
        } else if (this.tool === 'bikelane') {
          ok = !!h.seg.bike || (canAddBikeLane(h.seg, this.game.net) && this.game.canAfford(bikeLaneCost(h.seg)));
          label = h.seg.bike ? 'Remove bike lanes' : !canAddBikeLane(h.seg, this.game.net) ? 'Needs a surface street or avenue' : `$${bikeLaneCost(h.seg).toLocaleString()} · Bike lanes`;
          if (!ok) color = BAD;
        } else if (this.tool === 'calm') {
          label = isMotorway(h.seg.kind) ? 'Expressways and ramps cannot be calmed'
            : h.seg.calm ? 'Remove calming' : `$${Math.round(COST_CALM * h.seg.len).toLocaleString()}`;
        } else if (this.tool === 'upgrade') {
          const next = nextRoadKind(h.seg.kind);
          const change = Math.round((ROAD_COST[next] - ROAD_COST[h.seg.kind]) * h.seg.len * STRUCTURE_COST[h.seg.structure ?? 0]);
          label = `${ROAD_LABEL[next]}${change > 0 ? ` $${change.toLocaleString()}` : ''}${isOneWayKind(next) || h.seg.structure ? '' : ' · drag for a stretch'}`;
        }
      } else { size = 0.5; color = BAD; }
    } else {
      const k = SERVICE_TOOL[this.tool];
      if (k !== undefined) {
        const spec = SERVICES[k];
        const tile = this.tileOf(p);
        if (!spec.decoration) { hx = this.game.raster.lotX[tile]; hz = this.game.raster.lotZ[tile]; }
        if (spec.footprint) {
          [size, depth] = footprintSize(k, this.placeRotation);
          hx = tile % GRID + size / 2; hz = Math.floor(tile / GRID) + depth / 2;
        }
        if (spec.radius) {
          this.serviceRadius.scale.set(spec.radius, 1, spec.radius);
          this.serviceRadius.position.set(hx - half, 0.1, hz - half);
          this.serviceRadius.visible = true;
        }
        if (k === T_AIRPORT) {
          const b = new MeshBuilder();
          for (const tile of airportClearanceTiles(this.tileOf(p), this.placeRotation)) {
            const x = tile % GRID - half, z = Math.floor(tile / GRID) - half;
            b.ribbon([x + 0.5, z, x + 0.5, z + 1], 2, 0.48, 0.08, 0xd9aa53);
          }
          this.shape.geometry.dispose(); this.shape.geometry = b.build(); this.shape.visible = true;
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
