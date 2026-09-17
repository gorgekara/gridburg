import * as THREE from 'three';
import {
  GRID, N_TILES, T_EMPTY, T_RES, T_COM, T_IND, T_COAL, T_WIND, T_PUMP, T_TOWER, T_OUTLET,
  COST_ROAD, COST_AVENUE, COST_ZONE, COST_LIGHT, COST_ROUNDABOUT, BRIDGE_FACTOR, SERVICES, idx, isService,
} from './constants';
import { Network, HALF_WIDTH, KIND_AVENUE, KIND_ROAD, buildPieces, measurePath, sampleCurve } from './roads/network';
import { touchesWater } from './terrain';
import { MeshBuilder } from './render/meshBuilder';
import type { Game } from './game';

export type Tool =
  | 'road' | 'avenue' | 'roundabout' | 'light' | 'oneway'
  | 'res' | 'com' | 'ind'
  | 'coal' | 'wind' | 'pump' | 'tower' | 'outlet'
  | 'bulldoze';
export type RoadMode = 'straight' | 'curve';

const TOOL_COLOR: Record<Tool, number> = {
  road: 0x8fa3b8, avenue: 0xc9d2dc, roundabout: 0xc9d2dc, light: 0xffd23f, oneway: 0xffffff,
  res: 0x62c46a, com: 0x4f8fe8, ind: 0xe6b93a,
  coal: 0x9a9a9a, wind: 0xf2f2ee, pump: 0x4fb3ff, tower: 0x4fb3ff, outlet: 0x9a6b3a,
  bulldoze: 0xe04b3a,
};
const SERVICE_TOOL: Partial<Record<Tool, number>> = { coal: T_COAL, wind: T_WIND, pump: T_PUMP, tower: T_TOWER, outlet: T_OUTLET };
const ZONE_TOOL: Partial<Record<Tool, number>> = { res: T_RES, com: T_COM, ind: T_IND };
const ROUNDABOUT_R = 2.3;
const BAD = 0xe04b3a;

type P = { x: number; z: number };

/** Ramer–Douglas–Peucker simplification of a freehand stroke. */
function simplify(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = 0, wi = -1;
    const ax = pts[a].x, az = pts[a].z, dx = pts[b].x - ax, dz = pts[b].z - az;
    const l = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - ax) * dz - (pts[i].z - az) * dx) / l;
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tol && wi > 0) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const tmpColor = new THREE.Color();

export class Input {
  tool: Tool = 'road';
  mode: RoadMode = 'straight';
  onToolChange: ((t: Tool) => void) | null = null;
  onModeChange: ((m: RoadMode) => void) | null = null;
  onToast: ((msg: string) => void) | null = null;
  /** Live cost label next to the cursor; null hides it. */
  onCost: ((text: string | null, x: number, y: number, ok: boolean) => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private hover: THREE.Mesh;
  private shape: THREE.Mesh; // road / roundabout preview
  private rect: THREE.InstancedMesh;
  private rectMat: THREE.MeshBasicMaterial;
  private dragging = false;
  private startP: P = { x: 0, z: 0 };
  private raw: P[] = [];
  private path: P[] = [];
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
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
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
    canvas.addEventListener('pointerleave', () => { if (!this.dragging) this.clearHover(); });
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
      r: 'road', v: 'avenue', o: 'roundabout', t: 'light', y: 'oneway',
      '1': 'res', '2': 'com', '3': 'ind', b: 'bulldoze',
    };
    const t = map[e.key.toLowerCase()];
    if (t) this.setTool(t);
    if (e.key.toLowerCase() === 'c') this.setMode(this.mode === 'straight' ? 'curve' : 'straight');
    if (e.key === 'Escape') this.cancel();
  };

  // ---- picking and snapping --------------------------------------------------------------------
  private pick(e: PointerEvent): P | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return null;
    const x = this.hit.x + GRID / 2;
    const z = this.hit.z + GRID / 2;
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return null;
    return { x, z };
  }

  /** Snap a road point to an existing node, then an existing road, then (optionally) the tile center. */
  private snap(p: P, grid: boolean): P {
    const net = this.game.net;
    const n = net.nearestNode(p.x, p.z, 0.9);
    if (n) return { x: n.x, z: n.z };
    const h = net.nearestSeg(p.x, p.z, 0.8);
    if (h) return { x: h.x, z: h.z };
    if (grid) return { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 };
    return p;
  }

  private tileOf(p: P): number {
    return idx(Math.floor(p.x), Math.floor(p.z));
  }

  // ---- pointer handling --------------------------------------------------------------------------
  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const p = this.pick(e);
    if (!p) return;
    if (this.isRoadTool()) {
      this.dragging = true;
      this.startP = this.snap(p, true);
      this.raw = [p];
      this.path = [this.startP];
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
    const p = this.pick(e);
    if (!p) { if (!this.dragging) this.clearHover(); return; }
    if (this.dragging && this.isRoadTool()) {
      const last = this.raw[this.raw.length - 1];
      if (Math.hypot(p.x - last.x, p.z - last.z) > 0.7) this.raw.push(p);
      this.path = this.roadPath(p);
      this.previewRoad(e);
    } else if (this.dragging) {
      const t = this.tileOf(p);
      if (t !== this.curTile) { this.curTile = t; this.updateRect(); }
    } else {
      this.updateHover(p, e);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.dragging) return;
    if (this.isRoadTool()) this.commitRoad();
    else this.commitRect();
    this.cancel();
  };

  private cancel(): void {
    this.dragging = false;
    this.rect.count = 0;
    this.shape.visible = false;
    this.raw = [];
    this.path = [];
    this.onCost?.(null, 0, 0, true);
  }

  private clearHover(): void {
    this.hover.visible = false;
    this.shape.visible = false;
    this.onCost?.(null, 0, 0, true);
  }

  // ---- roads ---------------------------------------------------------------------------------------
  private roadPath(current: P): P[] {
    if (this.mode === 'straight') return [this.startP, this.snap(current, true)];
    const end = this.snap(current, false);
    const pts = [this.startP, ...this.raw.slice(1, -1), end];
    return simplify(pts, 0.55);
  }

  private roadCost(path: P[]): number {
    const unit = this.tool === 'avenue' ? COST_AVENUE : COST_ROAD;
    const m = measurePath(path, this.game.terrain.water);
    return Math.round((m.len + m.wet * (BRIDGE_FACTOR - 1)) * unit);
  }

  private pathLength(path: P[]): number {
    let l = 0;
    for (let i = 1; i < path.length; i++) l += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    return l;
  }

  private previewRoad(e: PointerEvent): void {
    if (this.pathLength(this.path) < 0.6) { this.shape.visible = false; this.onCost?.(null, 0, 0, true); return; }
    const cost = this.roadCost(this.path);
    const ok = this.game.canAfford(cost);
    const b = new MeshBuilder();
    const half = GRID / 2;
    const hw = HALF_WIDTH[this.tool === 'avenue' ? KIND_AVENUE : KIND_ROAD];
    for (const c of buildPieces(this.path)) {
      const sm = sampleCurve(c);
      const pts = new Float32Array((sm.n + 1) * 2);
      for (let i = 0; i < pts.length; i++) pts[i] = sm.pts[i] - half;
      b.ribbon(pts, sm.n + 1, hw, 0.09, ok ? TOOL_COLOR[this.tool] : BAD);
    }
    this.shape.geometry.dispose();
    this.shape.geometry = b.build();
    this.shape.visible = true;
    this.onCost?.(`$${cost.toLocaleString()}`, e.clientX, e.clientY, ok);
  }

  private commitRoad(): void {
    const g = this.game;
    const kind = this.tool === 'avenue' ? KIND_AVENUE : KIND_ROAD;
    if (this.pathLength(this.path) < 0.6) {
      // A click rather than a drag: convert the road under the cursor to this type.
      const hit = g.net.nearestSeg(this.startP.x, this.startP.z, 0.9);
      if (!hit || hit.seg.fixed || hit.seg.kind === kind) return;
      const delta = (kind === KIND_AVENUE ? COST_AVENUE - COST_ROAD : 0) * hit.seg.len;
      const cost = Math.round(delta);
      if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
      hit.seg.kind = kind;
      g.net.version++;
      g.spend(cost);
      g.flush();
      return;
    }
    const cost = this.roadCost(this.path);
    if (!g.canAfford(cost)) { this.onToast?.('Not enough money'); return; }
    const added = g.net.insertPath(this.path, kind);
    if (!added.length) return;
    g.spend(cost);
    g.flush();
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
    if (this.tool === 'light') {
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
      const s = this.snap(p, true);
      hx = s.x; hz = s.z; size = 0.6;
    } else if (this.tool === 'light') {
      const n = this.game.net.nearestNode(p.x, p.z, 1.4);
      if (n && this.game.net.degree(n.id) >= 3 && !n.ring) { hx = n.x; hz = n.z; size = 1.4; label = n.light ? 'Remove light' : `$${COST_LIGHT}`; }
      else { size = 0.5; color = BAD; }
    } else if (this.tool === 'oneway') {
      const h = this.game.net.nearestSeg(p.x, p.z, 0.9);
      if (h && !h.seg.fixed) { hx = h.x; hz = h.z; size = 0.8; } else { size = 0.5; color = BAD; }
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
