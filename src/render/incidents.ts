import * as THREE from 'three';
import { GRID, tileHash, isZone } from '../constants';
import { buildingHeight, VARIANTS } from './buildingGeo';
import type { IncidentView } from '../sim/incidents';
import type { Raster } from '../roads/raster';

export class IncidentLayer {
  readonly group = new THREE.Group();
  private flames: { mesh: THREE.Mesh; phase: number }[] = [];
  private shared = {
    flame: new THREE.ConeGeometry(0.17, 0.6, 7), smoke: new THREE.SphereGeometry(0.22, 7, 5),
    warning: new THREE.OctahedronGeometry(0.14),
  };
  private fire = new THREE.MeshBasicMaterial({ color: 0xff962e });
  private core = new THREE.MeshBasicMaterial({ color: 0xffdf61 });
  private smoke = new THREE.MeshBasicMaterial({ color: 0x55545a, transparent: true, opacity: 0.62 });
  private crash = new THREE.MeshBasicMaterial({ color: 0xf3c645 });
  private crime = new THREE.MeshBasicMaterial({ color: 0xca77df });
  private heist = new THREE.MeshBasicMaterial({ color: 0x4fc3f7 });
  rebuild(view: IncidentView, kind: Uint8Array, level: Uint8Array, raster: Raster): void {
    this.group.clear(); this.flames = [];
    for (const { tile } of view.fires) {
      if (!isZone(kind[tile]) || !level[tile]) continue;
      const height = buildingHeight(kind[tile], Math.max(1, level[tile]), Math.floor(tileHash(tile) * VARIANTS) % VARIANTS);
      for (let i = 0; i < 5; i++) {
        const mesh = new THREE.Mesh(i < 3 ? this.shared.flame : this.shared.smoke, i < 2 ? this.fire : i === 2 ? this.core : this.smoke);
        mesh.position.set(raster.lotX[tile] - GRID / 2 + (i % 3 - 1) * 0.14, height + (i < 3 ? 0.18 : 0.55 + (i - 3) * 0.25), raster.lotZ[tile] - GRID / 2);
        this.group.add(mesh); this.flames.push({ mesh, phase: tile + i });
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
    for (const f of this.flames) { f.mesh.scale.y = 0.8 + Math.sin(time * 8 + f.phase) * 0.25; f.mesh.rotation.y = time + f.phase; }
  }
}
