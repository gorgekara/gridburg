import * as THREE from 'three';
import {
  GRID, N_TILES, T_EMPTY, T_ROAD, T_AVENUE, T_RES, T_COM, T_IND,
  COST_ROAD, COST_AVENUE, COST_ZONE, DIRS8, idx, isRoad,
} from './constants';
import type { Game } from './game';

export type Tool = 'road' | 'avenue' | 'res' | 'com' | 'ind' | 'bulldoze';

const TOOL_COLOR: Record<Tool, number> = {
  road: 0x8fa3b8,
  avenue: 0xc9d2dc,
  res: 0x62c46a,
  com: 0x4f8fe8,
  ind: 0xe6b93a,
  bulldoze: 0xe04b3a,
};

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const zero = new THREE.Vector3();

export class Input {
  tool: Tool = 'road';
  onToolChange: ((t: Tool) => void) | null = null;
  onToast: ((msg: string) => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private hover: THREE.Mesh;
  private preview: THREE.InstancedMesh;
  private previewMat: THREE.MeshBasicMaterial;
  private dragging = false;
  private start = -1;
  private current = -1;
  private previewTiles: number[] = [];
  private canvas: HTMLCanvasElement;
  private camera: THREE.Camera;
  private game: Game;

  constructor(canvas: HTMLCanvasElement, camera: THREE.Camera, game: Game, scene: THREE.Scene) {
    this.canvas = canvas;
    this.camera = camera;
    this.game = game;
    const hg = new THREE.PlaneGeometry(1, 1);
    hg.rotateX(-Math.PI / 2);
    this.hover = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.hover.position.y = 0.09;
    this.hover.visible = false;
    scene.add(this.hover);

    this.previewMat = new THREE.MeshBasicMaterial({ color: TOOL_COLOR.road, transparent: true, opacity: 0.55, depthWrite: false });
    const pg = new THREE.PlaneGeometry(0.96, 0.96);
    pg.rotateX(-Math.PI / 2);
    this.preview = new THREE.InstancedMesh(pg, this.previewMat, N_TILES);
    this.preview.position.y = 0.1;
    this.preview.count = 0;
    this.preview.frustumCulled = false;
    scene.add(this.preview);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', () => { if (!this.dragging) this.hover.visible = false; });
    window.addEventListener('keydown', this.onKey);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.previewMat.color.setHex(TOOL_COLOR[t]);
    (this.hover.material as THREE.MeshBasicMaterial).color.setHex(TOOL_COLOR[t]);
    this.onToolChange?.(t);
  }

  private isRoadTool(): boolean {
    return this.tool === 'road' || this.tool === 'avenue';
  }

  private onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const map: Record<string, Tool> = { '1': 'road', '2': 'avenue', '3': 'res', '4': 'com', '5': 'ind', '6': 'bulldoze' };
    const t = map[e.key];
    if (t) this.setTool(t);
    if (e.key === 'Escape' && this.dragging) this.cancel();
  };

  private tileAt(e: PointerEvent): number {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (!this.raycaster.ray.intersectPlane(this.plane, this.hit)) return -1;
    const x = Math.floor(this.hit.x + GRID / 2);
    const z = Math.floor(this.hit.z + GRID / 2);
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return -1;
    return idx(x, z);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const t = this.tileAt(e);
    if (t < 0) return;
    this.dragging = true;
    this.start = t;
    this.current = t;
    this.updatePreview();
  };

  private onMove = (e: PointerEvent): void => {
    const t = this.tileAt(e);
    if (t >= 0) {
      const half = GRID / 2;
      this.hover.position.set(t % GRID - half + 0.5, 0.09, ((t / GRID) | 0) - half + 0.5);
      this.hover.visible = true;
    } else {
      this.hover.visible = false;
    }
    if (this.dragging && t >= 0 && t !== this.current) {
      this.current = t;
      this.updatePreview();
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.button !== 0 || !this.dragging) return;
    this.commit();
    this.cancel();
  };

  private cancel(): void {
    this.dragging = false;
    this.preview.count = 0;
    this.previewTiles = [];
  }

  /**
   * Tiles covered by the current drag, in order.
   * Roads: if the drag is closer to 45° than to an axis, a diagonal run then a straight run;
   * otherwise an L (horizontal, then vertical). Zones and bulldoze fill a rectangle.
   */
  private computeTiles(): number[] {
    const sx = this.start % GRID;
    const sz = (this.start / GRID) | 0;
    const cx = this.current % GRID;
    const cz = (this.current / GRID) | 0;
    const out: number[] = [];
    if (this.isRoadTool()) {
      const dx = cx - sx;
      const dz = cz - sz;
      const stepX = Math.sign(dx);
      const stepZ = Math.sign(dz);
      const ax = Math.abs(dx);
      const az = Math.abs(dz);
      const angle = Math.atan2(az, ax);
      const diagonal = angle > Math.PI / 8 && angle < (3 * Math.PI) / 8;
      let x = sx;
      let z = sz;
      out.push(idx(x, z));
      if (diagonal) {
        const n = Math.min(ax, az);
        for (let s = 0; s < n; s++) { x += stepX; z += stepZ; out.push(idx(x, z)); }
        while (x !== cx) { x += stepX; out.push(idx(x, z)); }
        while (z !== cz) { z += stepZ; out.push(idx(x, z)); }
      } else {
        while (x !== cx) { x += stepX; out.push(idx(x, z)); }
        while (z !== cz) { z += stepZ; out.push(idx(x, z)); }
      }
    } else {
      const x0 = Math.min(sx, cx);
      const x1 = Math.max(sx, cx);
      const z0 = Math.min(sz, cz);
      const z1 = Math.max(sz, cz);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(idx(x, z));
    }
    return out;
  }

  private updatePreview(): void {
    this.previewTiles = this.computeTiles();
    const half = GRID / 2;
    let n = 0;
    for (const t of this.previewTiles) {
      m4.compose(new THREE.Vector3(t % GRID - half + 0.5, 0, ((t / GRID) | 0) - half + 0.5), q, one);
      this.preview.setMatrixAt(n++, m4);
    }
    m4.compose(zero, q, zero);
    this.preview.count = n;
    this.preview.instanceMatrix.needsUpdate = true;
  }

  private commit(): void {
    const g = this.game;
    const k = g.kind;
    let placed = 0;
    let broke = false;
    const tiles = this.previewTiles;
    if (this.isRoadTool()) {
      const target = this.tool === 'avenue' ? T_AVENUE : T_ROAD;
      const cost = this.tool === 'avenue' ? COST_AVENUE : COST_ROAD;
      let reached = 0;
      for (const t of tiles) {
        if (k[t] !== target) {
          if (!g.canAfford(cost)) { broke = true; break; }
          g.setKind(t, target, cost);
          placed++;
        }
        reached++;
      }
      // Link consecutive diagonal tiles of the stroke.
      for (let j = 1; j < reached; j++) {
        const a = tiles[j - 1];
        const b = tiles[j];
        const dx = (b % GRID) - (a % GRID);
        const dz = ((b / GRID) | 0) - ((a / GRID) | 0);
        if (dx !== 0 && dz !== 0 && isRoad(k[a]) && isRoad(k[b])) {
          for (let d = 1; d < 8; d += 2) {
            if (DIRS8[d][0] === dx && DIRS8[d][1] === dz) { g.addLink(a, d); placed++; break; }
          }
        }
      }
    } else {
      for (const t of tiles) {
        if (this.tool === 'bulldoze') {
          if (k[t] === T_EMPTY) continue;
          g.setKind(t, T_EMPTY, 0);
          placed++;
        } else {
          const zk = this.tool === 'res' ? T_RES : this.tool === 'com' ? T_COM : T_IND;
          if (isRoad(k[t]) || k[t] === zk) continue;
          if (!g.canAfford(COST_ZONE)) { broke = true; break; }
          g.setKind(t, zk, COST_ZONE);
          placed++;
        }
      }
    }
    if (broke) this.onToast?.('Not enough money');
    if (placed > 0) g.flush();
  }
}
