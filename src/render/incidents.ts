import * as THREE from 'three';
import { GRID, tileHash, isZone, mulberry32 } from '../constants';
import { buildingHeight, VARIANTS } from './buildingGeo';
import type { IncidentView } from '../sim/incidents';
import type { Raster } from '../roads/raster';

/** A flame tongue: a teardrop turned on a lathe, round at the foot and licking up to a point. */
function flameGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 12; k++) {
    const t = k / 12;
    pts.push(new THREE.Vector2(Math.max(0.001, Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.02)) ** 0.7 * (1 - t) ** 0.9 * 0.16), t * 0.6));
  }
  return new THREE.LatheGeometry(pts, 9);
}

interface Flame { mesh: THREE.Mesh; phase: number; x: number; z: number; base: number; size: number }
interface Puff { mesh: THREE.Mesh; phase: number; x: number; z: number; base: number; drift: number }

export class IncidentLayer {
  readonly group = new THREE.Group();
  private flames: Flame[] = [];
  private puffs: Puff[] = [];
  private embers: Flame[] = [];
  private glows: { mesh: THREE.Mesh; phase: number }[] = [];
  private shared = {
    flame: flameGeometry(), smoke: new THREE.IcosahedronGeometry(0.2, 1),
    ember: new THREE.OctahedronGeometry(0.018), glow: new THREE.SphereGeometry(0.42, 12, 8),
    warning: new THREE.OctahedronGeometry(0.14),
  };
  private outer = new THREE.MeshBasicMaterial({ color: 0xe8531c, transparent: true, opacity: 0.82, depthWrite: false });
  private fire = new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.9, depthWrite: false });
  private core = new THREE.MeshBasicMaterial({ color: 0xffe27a });
  private ember = new THREE.MeshBasicMaterial({ color: 0xffc04a });
  private glow = new THREE.MeshBasicMaterial({ color: 0xff7a26, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  private smoke = new THREE.MeshBasicMaterial({ color: 0x55545a, transparent: true, opacity: 0.62 });
  private crash = new THREE.MeshBasicMaterial({ color: 0xf3c645 });
  private crime = new THREE.MeshBasicMaterial({ color: 0xca77df });
  private heist = new THREE.MeshBasicMaterial({ color: 0x4fc3f7 });
  rebuild(view: IncidentView, kind: Uint8Array, level: Uint8Array, raster: Raster): void {
    for (const p of this.puffs) (p.mesh.material as THREE.Material).dispose();
    this.group.clear(); this.flames = []; this.puffs = []; this.embers = []; this.glows = [];
    for (const { tile } of view.fires) {
      if (!isZone(kind[tile]) || !level[tile]) continue;
      const height = buildingHeight(kind[tile], Math.max(1, level[tile]), Math.floor(tileHash(tile) * VARIANTS) % VARIANTS);
      const cx = raster.lotX[tile] - GRID / 2, cz = raster.lotZ[tile] - GRID / 2;
      const rnd = mulberry32(tile * 7919 + 13);
      // A ring of tongues over the roof, taller in the middle, with a hot core licking up inside them.
      const tongues = 9;
      for (let i = 0; i < tongues; i++) {
        const a = (i / tongues) * Math.PI * 2 + rnd() * 0.5, r = i === 0 ? 0 : 0.1 + rnd() * 0.2;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, size = (i === 0 ? 1.35 : 0.7 + rnd() * 0.5) * (1 - r * 0.8);
        for (const layer of [0, 1, 2]) {
          if (layer === 2 && r > 0.2) continue;
          const mesh = new THREE.Mesh(this.shared.flame, layer === 0 ? this.outer : layer === 1 ? this.fire : this.core);
          const s = size * [1, 0.72, 0.42][layer];
          mesh.renderOrder = 3 + layer;
          this.group.add(mesh);
          this.flames.push({ mesh, phase: rnd() * 20, x, z, base: height - 0.02, size: s });
        }
      }
      for (let i = 0; i < 10; i++) {
        const mesh = new THREE.Mesh(this.shared.ember, this.ember);
        this.group.add(mesh);
        this.embers.push({ mesh, phase: rnd(), x: cx + (rnd() - 0.5) * 0.4, z: cz + (rnd() - 0.5) * 0.4, base: height + 0.1, size: 0.6 + rnd() * 0.8 });
      }
      const glow = new THREE.Mesh(this.shared.glow, this.glow);
      glow.position.set(cx, height + 0.2, cz); glow.scale.set(1, 0.7, 1);
      this.group.add(glow); this.glows.push({ mesh: glow, phase: tile });
      // A column of smoke that keeps rising, swelling and thinning out as it drifts downwind.
      for (let i = 0; i < 8; i++) {
        const mesh = new THREE.Mesh(this.shared.smoke, this.smoke.clone());
        mesh.rotation.set(rnd() * 3, rnd() * 3, 0);
        this.group.add(mesh);
        this.puffs.push({ mesh, phase: i / 8, x: cx + (rnd() - 0.5) * 0.15, z: cz + (rnd() - 0.5) * 0.15, base: height + 0.35, drift: 0.6 + rnd() * 0.5 });
      }
    }
    for (const { tile } of view.heists) {
      const mesh = new THREE.Mesh(this.shared.warning, this.heist);
      mesh.position.set(raster.lotX[tile] - GRID / 2, buildingHeight(kind[tile], Math.max(1, level[tile]), Math.floor(tileHash(tile) * VARIANTS) % VARIANTS) + 0.5, raster.lotZ[tile] - GRID / 2);
      this.group.add(mesh);
    }
    for (const crash of view.crashes) {
      const mesh = new THREE.Mesh(this.shared.warning, this.crash);
      mesh.position.set(crash.x - GRID / 2, Math.max(0, crash.y ?? 0) + 0.5, crash.z - GRID / 2); this.group.add(mesh);
      const smoke = new THREE.Mesh(this.shared.smoke, this.smoke); smoke.position.copy(mesh.position); smoke.scale.setScalar(0.6); this.group.add(smoke);
    }
    for (const tile of view.crime) {
      if (!isZone(kind[tile]) || !level[tile]) continue;
      const mesh = new THREE.Mesh(this.shared.warning, this.crime);
      mesh.position.set(raster.lotX[tile] - GRID / 2, buildingHeight(kind[tile], Math.max(1, level[tile]), Math.floor(tileHash(tile) * VARIANTS) % VARIANTS) + 0.22, raster.lotZ[tile] - GRID / 2); this.group.add(mesh);
    }
  }
  update(time: number): void {
    for (const f of this.flames) {
      // Each tongue flickers on its own: stretching, swelling, leaning and turning.
      const t = time * 9 + f.phase, flick = Math.sin(t) * 0.5 + Math.sin(t * 2.3 + 1.7) * 0.3 + Math.sin(t * 5.1) * 0.2;
      const h = f.size * (1 + flick * 0.28), w = f.size * (1 - flick * 0.12);
      f.mesh.scale.set(w, h, w);
      f.mesh.position.set(f.x + Math.sin(t * 0.7) * 0.02, f.base, f.z + Math.cos(t * 0.6) * 0.02);
      f.mesh.rotation.set(Math.sin(t * 0.9) * 0.12 + 0.08, t * 0.3, Math.cos(t * 1.1) * 0.12);
    }
    for (const e of this.embers) {
      const k = (time * 0.55 * e.size + e.phase) % 1;
      e.mesh.position.set(e.x + Math.sin(k * 9 + e.phase * 20) * 0.08 + k * 0.25, e.base + k * 1.1, e.z + Math.cos(k * 7 + e.phase * 11) * 0.08);
      e.mesh.scale.setScalar((1 - k) * e.size);
    }
    for (const g of this.glows) g.mesh.scale.setScalar(1 + Math.sin(time * 11 + g.phase) * 0.08 + Math.sin(time * 4.3) * 0.05);
    for (const p of this.puffs) {
      const k = (time * 0.12 * p.drift + p.phase) % 1;
      p.mesh.position.set(p.x + k * k * 1.2, p.base + k * 2.4, p.z + k * k * 0.5);
      p.mesh.scale.setScalar(0.5 + k * 2.2);
      p.mesh.rotation.y = time * 0.2 + p.phase * 6;
      const m = p.mesh.material as THREE.MeshBasicMaterial;
      // Dark and dense over the flames, fading to a pale haze as it rises.
      m.opacity = Math.min(1, k * 8) * (1 - k) * 0.7;
      m.color.setRGB(0.22 + k * 0.4, 0.21 + k * 0.4, 0.22 + k * 0.42);
    }
  }
}
