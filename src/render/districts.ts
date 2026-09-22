import * as THREE from 'three';
import { GRID, N_TILES } from '../constants';
import { DISTRICT_COLORS, DISTRICT_COUNT } from '../extras';

/** District names floating over the middle of each painted district, shown with the district tools or view. */
export class DistrictLabels {
  readonly group = new THREE.Group();
  private sprites: THREE.Sprite[] = [];
  private signature = '';

  constructor() { this.group.visible = false; }

  setVisible(on: boolean): void { this.group.visible = on; }

  rebuild(district: Uint8Array, names: string[]): void {
    const sums = Array.from({ length: DISTRICT_COUNT }, () => ({ x: 0, z: 0, n: 0 }));
    for (let i = 0; i < N_TILES; i++) if (district[i]) { const s = sums[district[i] - 1]; s.x += i % GRID; s.z += Math.floor(i / GRID); s.n++; }
    const signature = JSON.stringify(sums.map(s => [s.n, Math.round(s.x), Math.round(s.z)])) + names.join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    for (const s of this.sprites) { s.material.map?.dispose(); s.material.dispose(); }
    this.group.clear(); this.sprites = [];
    sums.forEach((s, d) => {
      if (!s.n) return;
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '600 44px system-ui, sans-serif';
      const text = names[d] || `District ${d + 1}`;
      const w = Math.min(500, ctx.measureText(text).width + 48);
      ctx.fillStyle = 'rgba(20,24,28,0.72)';
      ctx.beginPath(); ctx.roundRect((512 - w) / 2, 14, w, 68, 34); ctx.fill();
      ctx.fillStyle = `#${DISTRICT_COLORS[d].toString(16).padStart(6, '0')}`;
      ctx.beginPath(); ctx.arc((512 - w) / 2 + 30, 48, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, 256 + 10, 50);
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      sprite.scale.set(8, 1.5, 1);
      sprite.position.set(s.x / s.n - GRID / 2 + 0.5, 4, s.z / s.n - GRID / 2 + 0.5);
      sprite.renderOrder = 10;
      this.group.add(sprite); this.sprites.push(sprite);
    });
  }
}
