import * as THREE from 'three';
import {
  GRID, N_TILES, T_EMPTY, T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET,
  COST_ROAD, COST_AVENUE, COST_ZONE, COST_LIGHT, COST_ROUNDABOUT, BRIDGE_FACTOR, SERVICES, idx, isService,
} from './constants';
import { Network, HALF_WIDTH, KIND_AVENUE, KIND_ROAD, buildPieces, measurePath, sampleCurve } from './roads/network';
import type { Pose } from './roads/network';
import { touchesWater } from './terrain';
import { MeshBuilder } from './render/meshBuilder';
import type { Game } from './game';

export type Tool =
  | 'none'
  | 'road' | 'avenue' | 'upgrade'
  | 'roundabout' | 'light' | 'oneway'
  | 'res' | 'com' | 'ind'
  | 'coal' | 'wind' | 'pump' | 'tower' | 'outlet'
  | 'bulldoze';
/** How the road tools turn clicks into a road, modelled on Cities: Skylines. */
export type RoadMode = 'straight' | 'curve' | 'smooth';

const TOOL_COLOR: Record<Tool, number> = {
  none: 0xffffff,
  road: 0x8fa3b8, avenue: 0xc9d2dc, upgrade: 0xc9d2dc, roundabout: 0xc9d2dc, light: 0xffd23f, oneway: 0xffffff,
  res: 0x62c46a, com: 0x4f8fe8, ind: 0xe6b93a,
  coal: 0x9a9a9a, wind: 0xf2f2ee, pump: 0x4fb3ff, tower: 0x4fb3ff, outlet: 0x9a6b3a,
  bulldoze: 0xe04b3a,
};
const SERVICE_TOOL: Partial<Record<Tool, number>> = { coal: T_COAL, wind: T_WIND, pump: T_PUMP, tower: T_TOWER, outlet: T_OUTLET };
const ZONE_TOOL: Partial<Record<Tool, number>> = { res: T_RES, com: T_COM, ind: T_IND };
const ROUNDABOUT_R = 2.3;
const BAD = 0xe04b3a;
const GUIDE = 0xffffff;

type P = { x: number; z: number };

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();
const pose: Pose = { x: 0, z: 0, tx: 0, tz: 0 };

export class Input {
  tool: Tool = 'road';
  mode: RoadMode = 'straight';
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
  private shape: THREE.Mesh; // road / roundabout preview
  private rect: THREE.InstancedMesh;
  private rectMat: THREE.MeshBasicMaterial;

  // Road placement: points clicked so far for the segment being laid ([start] or [start, bend]).
  private chain: P[] = [];
  /** Direction the road was heading when it reached chain[0]; drives Smooth mode. */
  private tangent: P | null = null;
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
    return this.tool === 'road' || this.tool === 'avenue';
  }

  private isRectTool(): boolean {
    return this.tool in ZONE_TOOL || this.tool === 'bulldoze';
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    const map: Record<string, Tool> = {
      r: 'road', v: 'avenue', u: 'upgrade', o: 'roundabout', t: 'light', y: 'oneway',
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
    const x = this.hit.x + GRID / 2;
    const z = this.hit.z + GRID / 2;
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return null;
    return { x, z };
  }

  private gridSnap(p: P): P {
    return { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 };
  }

  /** Snap a road point to an existing node, then an existing road, then the tile center. */
  private snap(p: P): P {
    const net = this.game.net;
    const n = net.nearestNode(p.x, p.z, 0.9);
    if (n) return { x: n.x, z: n.z };
    const h = net.nearestSeg(p.x, p.z, 0.8);
    if (h) return { x: h.x, z: h.z };
    return this.gridSnap(p);
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
    if (e.button !== 0 || this.tool === 'none') return;
    const p = this.pick(e);
    if (!p) return;
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
    this.downScreen = null;
    this.downWorld = null;
    this.rect.count = 0;
    this.shape.visible = false;
    this.onCost?.(null, 0, 0, true);
  }

  private clearHover(): void {
    this.hover.visible = false;
    this.shape.visible = false;
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

  private roadCost(path: P[]): number {
    const unit = this.tool === 'avenue' ? COST_AVENUE : COST_ROAD;
    const m = measurePath(path, this.game.terrain.water);
    return Math.round((m.len + m.wet * (BRIDGE_FACTOR - 1)) * unit);
  }

  private roadClick(p: P): void {
    const g = this.game;
    if (this.chain.length === 0) {
      const s = this.snap(p);
      this.chain = [s];
      this.tangent = this.mode === 'smooth' ? this.tangentAt(s) : null;
      return;
    }
    const start = this.chain[0];
    if (this.mode === 'curve' && this.chain.length === 1) {
      const c = this.gridSnap(p);
      if (Math.hypot(c.x - start.x, c.z - start.z) < 0.8) return;
      this.chain.push(c);
      return;
    }
    const end = this.snap(p);
    if (Math.hypot(end.x - start.x, end.z - start.z) < 0.8) return;
    const path = this.pendingPath(this.chain, this.tangent, end);
    const cost = this.roadCost(path);
    if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
    const joins = this.onRoad(end);
    const kind = this.tool === 'avenue' ? KIND_AVENUE : KIND_ROAD;
    const added = g.net.insertPath(path, kind);
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
      this.shape.visible = false;
      this.onCost?.(null, 0, 0, true);
    } else {
      this.chain = [end];
      this.tangent = this.mode === 'smooth' ? { x: (end.x - prev.x) / hl, z: (end.z - prev.z) / hl } : null;
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
      const end = this.snap(cursor);
      if (Math.hypot(end.x - start.x, end.z - start.z) >= 0.8) {
        const path = this.pendingPath(chain, tangent, end);
        const cost = this.roadCost(path);
        ok = this.game.canAfford(cost);
        const hw = HALF_WIDTH[this.tool === 'avenue' ? KIND_AVENUE : KIND_ROAD];
        for (const c of buildPieces(path)) {
          const sm = sampleCurve(c);
          const pts = new Float32Array((sm.n + 1) * 2);
          for (let i = 0; i < pts.length; i++) pts[i] = sm.pts[i] - half;
          b.ribbon(pts, sm.n + 1, hw, 0.09, ok ? TOOL_COLOR[this.tool] : BAD);
        }
        if (path.length === 3) {
          // Show the bend handle so the shape of the curve is readable.
          const c = path[1];
          b.ribbon([start.x - half, start.z - half, c.x - half, c.z - half], 2, 0.035, 0.1, GUIDE);
          b.ribbon([c.x - half, c.z - half, end.x - half, end.z - half], 2, 0.035, 0.1, GUIDE);
          b.disc(c.x - half, c.z - half, 0.16, 0.11, GUIDE);
        }
        b.disc(end.x - half, end.z - half, 0.26, 0.11, GUIDE);
        label = `$${cost.toLocaleString()}`;
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
      for (const t of tiles) if (g.kind[t] !== T_EMPTY && g.setKind(t, T_EMPTY, 0)) changed++;
      const sx = this.startTile % GRID, sz = (this.startTile / GRID) | 0;
      const cx = this.curTile % GRID, cz = (this.curTile / GRID) | 0;
      changed += g.net.removeInRect(Math.min(sx, cx), Math.min(sz, cz), Math.max(sx, cx) + 1, Math.max(sz, cz) + 1);
    } else {
      const zk = ZONE_TOOL[this.tool]!;
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
    if (this.tool === 'upgrade') {
      const h = net.nearestSeg(p.x, p.z, 0.9);
      if (!h || h.seg.fixed) return;
      const toAvenue = h.seg.kind === KIND_ROAD;
      const cost = toAvenue ? Math.round((COST_AVENUE - COST_ROAD) * h.seg.len) : 0;
      if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
      h.seg.kind = toAvenue ? KIND_AVENUE : KIND_ROAD;
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
      const h = net.nearestSeg(p.x, p.z, 0.9);
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
      let kind = KIND_ROAD;
      for (const s of net.segs.values()) {
        if (s.kind === KIND_AVENUE && Network.nearestOn(s, c.x, c.z).dist < ROUNDABOUT_R + 0.5) kind = KIND_AVENUE;
      }
      if (!net.addRoundabout(c.x, c.z, ROUNDABOUT_R, kind)) { this.onToast?.('No room for a roundabout here'); return; }
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

  private roundaboutCenter(p: P): P {
    const n = this.game.net.nearestNode(p.x, p.z, 1.6);
    return n && !n.ring ? { x: n.x, z: n.z } : p;
  }

  private serviceProblem(t: number, k: number): string | null {
    const g = this.game;
    const spec = SERVICES[k];
    if (!g.buildable(t)) return 'Cannot build on water or roads';
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
    if (this.tool === 'roundabout') {
      const c = this.roundaboutCenter(p);
      const b = new MeshBuilder();
      const ok = this.game.canAfford(COST_ROUNDABOUT);
      b.ring(c.x - half, c.z - half, ROUNDABOUT_R - 0.45, ROUNDABOUT_R + 0.45, 0.09, ok ? TOOL_COLOR.roundabout : BAD);
      this.shape.geometry.dispose();
      this.shape.geometry = b.build();
      this.shape.visible = true;
      this.hover.visible = false;
      this.onCost?.(`$${COST_ROUNDABOUT}`, e.clientX, e.clientY, ok);
      return;
    }
    let hx = Math.floor(p.x) + 0.5, hz = Math.floor(p.z) + 0.5;
    let size = 1;
    let color = TOOL_COLOR[this.tool];
    let label: string | null = null;
    let ok = true;
    if (this.isRoadTool()) {
      const s = this.snap(p);
      hx = s.x; hz = s.z; size = 0.6;
      label = 'Click to start';
    } else if (this.tool === 'light') {
      const n = this.game.net.nearestNode(p.x, p.z, 1.4);
      if (n && this.game.net.degree(n.id) >= 3 && !n.ring) { hx = n.x; hz = n.z; size = 1.4; label = n.light ? 'Remove signal' : `$${COST_LIGHT}`; }
      else { size = 0.5; color = BAD; }
    } else if (this.tool === 'oneway' || this.tool === 'upgrade') {
      const h = this.game.net.nearestSeg(p.x, p.z, 0.9);
      if (h && !h.seg.fixed) {
        hx = h.x; hz = h.z; size = 0.8;
        if (this.tool === 'upgrade') {
          label = h.seg.kind === KIND_ROAD ? `Upgrade $${Math.round((COST_AVENUE - COST_ROAD) * h.seg.len).toLocaleString()}` : 'Downgrade to road';
        }
      } else { size = 0.5; color = BAD; }
    } else {
      const k = SERVICE_TOOL[this.tool];
      if (k !== undefined) {
        const why = this.serviceProblem(this.tileOf(p), k);
        ok = !why;
        if (why) color = BAD;
        label = why && why !== 'Not enough money' ? why : `$${SERVICES[k].cost.toLocaleString()}`;
      } else if (this.tool !== 'bulldoze' && !this.game.buildable(this.tileOf(p))) {
        color = BAD;
      }
    }
    mat.color.setHex(color);
    this.hover.scale.set(size, 1, size);
    this.hover.position.set(hx - half, 0.095, hz - half);
    this.hover.visible = true;
    this.onCost?.(label, e.clientX, e.clientY, ok);
  }
}
