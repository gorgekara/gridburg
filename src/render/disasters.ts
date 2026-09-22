import * as THREE from 'three';
import { GRID } from '../constants';
import type { DisasterView } from '../sim/disasters';

/** Floodwater over the low ground, and a tornado funnel with a ring of debris. */
export class DisasterLayer {
  readonly group = new THREE.Group();
  private flood: THREE.InstancedMesh;
  private funnel: THREE.Group;
  private debris: THREE.InstancedMesh;
  private view: DisasterView | null = null;
  private floodSignature = '';

  constructor() {
    const plane = new THREE.PlaneGeometry(1.02, 1.02); plane.rotateX(-Math.PI / 2);
    this.flood = new THREE.InstancedMesh(plane, new THREE.MeshStandardMaterial({ color: 0x5f7f86, roughness: 0.2, transparent: true, opacity: 0.8, depthWrite: false }), 6400);
    this.flood.count = 0; this.flood.frustumCulled = false; this.flood.renderOrder = 2;
    this.funnel = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x7c7f84, transparent: true, opacity: 0.72, roughness: 1, side: THREE.DoubleSide, depthWrite: false });
    for (let k = 0; k < 7; k++) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.5 + k * 0.42, 0.28 + k * 0.4, 1.1, 18, 1, true), mat);
      ring.position.y = 0.55 + k * 1.05;
      this.funnel.add(ring);
    }
    const cloud = new THREE.Mesh(new THREE.CylinderGeometry(6, 4, 0.9, 24), new THREE.MeshStandardMaterial({ color: 0x5b5e63, transparent: true, opacity: 0.8, depthWrite: false }));
    cloud.position.y = 7.8;
    this.funnel.add(cloud);
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.08, 0.1), new THREE.MeshStandardMaterial({ color: 0x6b5a48 }), 40);
    this.debris.frustumCulled = false;
    this.funnel.visible = false; this.debris.visible = false;
    this.group.add(this.flood, this.funnel, this.debris);
  }

  set(view: DisasterView | null): void {
    this.view = view;
    const flooded = view?.kind === 'flood' ? view.flooded : [];
    const signature = flooded.join(',');
    if (signature !== this.floodSignature) {
      this.floodSignature = signature;
      const m = new THREE.Matrix4(), half = GRID / 2;
      flooded.forEach((tile, n) => { m.makeTranslation(tile % GRID - half + 0.5, 0, Math.floor(tile / GRID) - half + 0.5); this.flood.setMatrixAt(n, m); });
      this.flood.count = flooded.length;
      this.flood.instanceMatrix.needsUpdate = true;
    }
    this.funnel.visible = this.debris.visible = view?.kind === 'tornado';
  }

  update(time: number): void {
    const v = this.view;
    if (v?.kind === 'flood') {
      // Rise, hold, and drain: the water level follows the flood's age.
      const t = v.age / v.duration, level = t < 0.3 ? t / 0.3 : t > 0.75 ? (1 - t) / 0.25 : 1;
      this.flood.position.y = -0.03 + level * 0.12 + Math.sin(time * 1.3) * 0.004;
      (this.flood.material as THREE.MeshStandardMaterial).opacity = 0.35 + 0.45 * level;
    }
    if (v?.kind === 'tornado') {
      const half = GRID / 2;
      this.funnel.position.set(v.x - half, 0, v.z - half);
      this.funnel.children.forEach((ring, k) => { ring.rotation.y = time * (3 + k * 0.6); ring.position.x = Math.sin(time * 2 + k * 0.7) * 0.12 * k; });
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
      for (let n = 0; n < 40; n++) {
        const a = time * (2.2 + (n % 5) * 0.3) + n * 1.7, r = 0.8 + (n % 7) * 0.35, h = 0.2 + ((n * 37) % 50) / 10;
        p.set(v.x - half + Math.cos(a) * r, h, v.z - half + Math.sin(a) * r);
        q.setFromEuler(new THREE.Euler(a, a * 0.7, 0));
        this.debris.setMatrixAt(n, m.compose(p, q, s));
      }
      this.debris.instanceMatrix.needsUpdate = true;
    }
  }
}
