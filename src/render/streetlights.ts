import { roadHeight } from '../roads/structures';
import * as THREE from 'three';
import { HALF_WIDTH } from '../roads/network';
import type { Network } from '../roads/network';

/** Instanced lamps and soft pools avoid hundreds of real-time point lights. */
export class StreetlightLayer {
  readonly group = new THREE.Group();
  private poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 1.25, 5), new THREE.MeshStandardMaterial({ color: 0x5d6469 }), 3000);
  private bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.06, 0.16), new THREE.MeshBasicMaterial({ color: 0xffdb91 }), 3000);
  private glowMaterial: THREE.MeshBasicMaterial;
  private pools: THREE.InstancedMesh;
  private builtNet: Network | null = null;
  private builtVersion = -1;
  constructor() {
    const size = 64, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      data[i] = 255; data[i + 1] = 204; data[i + 2] = 115; data[i + 3] = Math.round(Math.max(0, 1 - radius) ** 2 * 100);
    }
    const texture = new THREE.DataTexture(data, size, size); texture.needsUpdate = true;
    this.glowMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const plane = new THREE.PlaneGeometry(2.7, 2.7); plane.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(plane, this.glowMaterial, 3000);
    for (const m of [this.poles, this.bulbs, this.pools]) { m.count = 0; m.frustumCulled = false; this.group.add(m); }
  }
  rebuild(net: Network): void {
    if (net === this.builtNet && net.version === this.builtVersion) return;
    this.builtNet = net; this.builtVersion = net.version;
    const obj = new THREE.Object3D(); let count = 0;
    for (const seg of net.segs.values()) {
      if (seg.structure === 2) continue;
      let next = 2.5;
      for (let i = 1; i <= seg.n && count < 3000; i++) {
        if (seg.cum[i] < next || seg.cum[i] > seg.cum[seg.n] - 1.5) continue;
        next = seg.cum[i] + 5;
        const dx = seg.pts[i * 2] - seg.pts[(i - 1) * 2], dz = seg.pts[i * 2 + 1] - seg.pts[(i - 1) * 2 + 1], len = Math.hypot(dx, dz) || 1;
        const offset = HALF_WIDTH[seg.kind] + 0.035;
        obj.position.set(seg.pts[i * 2] - 40 - dz / len * offset, roadHeight(seg, seg.cum[i]) + 0.65, seg.pts[i * 2 + 1] - 40 + dx / len * offset);
        obj.updateMatrix(); this.poles.setMatrixAt(count, obj.matrix);
        obj.position.y = roadHeight(seg, seg.cum[i]) + 1.3; obj.updateMatrix(); this.bulbs.setMatrixAt(count, obj.matrix);
        obj.position.y = roadHeight(seg, seg.cum[i]) + 0.061; obj.updateMatrix(); this.pools.setMatrixAt(count++, obj.matrix);
      }
    }
    for (const m of [this.poles, this.bulbs, this.pools]) { m.count = count; m.instanceMatrix.needsUpdate = true; }
  }
  update(night: number): void { this.bulbs.visible = night > 0.05; this.pools.visible = night > 0.05; this.glowMaterial.opacity = night; }
}
