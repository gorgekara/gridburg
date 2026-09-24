import * as THREE from 'three';
import { GRID } from '../constants';

/** Liveries: the colours of each envelope's gores, round it in turn. */
const LIVERIES = [
  [0xd8453b, 0xf2c94c], [0x2f6fb7, 0xf1f1ec], [0x4f9a55, 0xf2c94c, 0xd8453b], [0x8d4a9e, 0xf08a3c],
  [0xe78fb3, 0xf1f1ec, 0x3fb7b0], [0xf08a3c, 0x2f4f7a], [0xf2c94c, 0x2a9d8f, 0xf1f1ec, 0xd8453b],
];

/** An envelope: a lathe of the classic balloon silhouette, round on top and narrowing to the mouth. */
function envelopeGeometry(colors: number[]): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16; // 0 at the mouth, 1 at the crown
    const y = t * 1.5;
    // Widest a little above the middle, a tight cone below, a round dome above.
    const r = t < 0.62 ? 0.14 + 0.5 * Math.sin((t / 0.62) * Math.PI / 2) ** 1.4 : 0.64 * Math.sqrt(Math.max(0, 1 - ((t - 0.62) / 0.38) ** 2));
    profile.push(new THREE.Vector2(Math.max(0.001, r), y));
  }
  const gores = colors.length * 4;
  const g = new THREE.LatheGeometry(profile, gores).toNonIndexed();
  const pos = g.getAttribute('position'), col: number[] = [], c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    // Colour a whole triangle by the gore its middle falls in.
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
    c.setHex(colors[Math.floor(a / (Math.PI * 2) * gores) % colors.length]);
    for (let v = 0; v < 3; v++) col.push(c.r, c.g, c.b);
  }
  // The lathe's own normals keep the envelope smooth and round.
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

interface Balloon { root: THREE.Group; flame: THREE.Mesh; x: number; z: number; dx: number; dz: number; speed: number; height: number; phase: number; life: number; span: number }

/**
 * Now and then, by day, a hot air balloon drifts across the sky: from one side of the valley to the
 * other on the breeze, rising and sinking a little as the burner fires. Pure scenery.
 */
export class BalloonLayer {
  readonly group = new THREE.Group();
  private flights: Balloon[] = [];
  private wait = 20 + Math.random() * 40;
  private basket = new THREE.BoxGeometry(0.2, 0.16, 0.2);
  private rope = new THREE.CylinderGeometry(0.006, 0.006, 0.32, 4);
  private burner = new THREE.ConeGeometry(0.05, 0.14, 7);
  private wicker = new THREE.MeshStandardMaterial({ color: 0x8a6240, roughness: 0.9 });
  private cord = new THREE.MeshStandardMaterial({ color: 0x3a3a3a });
  private fire = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9 });
  private cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });

  private launch(): void {
    const colors = LIVERIES[Math.floor(Math.random() * LIVERIES.length)];
    const root = new THREE.Group();
    const envelope = new THREE.Mesh(envelopeGeometry(colors), this.cloth);
    envelope.position.y = 0.5; envelope.castShadow = true;
    const basket = new THREE.Mesh(this.basket, this.wicker);
    basket.position.y = 0.02; basket.castShadow = true;
    root.add(envelope, basket);
    for (const [x, z] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) {
      const rope = new THREE.Mesh(this.rope, this.cord);
      rope.position.set(x * 1.2, 0.32, z * 1.2); rope.rotation.set(z * 1.2, 0, -x * 1.2);
      root.add(rope);
    }
    const flame = new THREE.Mesh(this.burner, this.fire);
    flame.position.y = 0.2;
    root.add(flame);
    // Across the valley on the wind, from beyond one edge to beyond the other.
    const span = GRID * 0.75, heading = Math.random() * Math.PI * 2;
    const dx = Math.cos(heading), dz = Math.sin(heading), offset = (Math.random() - 0.5) * GRID * 0.6;
    const scale = 1.3 + Math.random() * 0.6;
    root.scale.setScalar(scale);
    const b: Balloon = {
      root, flame, dx, dz, speed: 0.5 + Math.random() * 0.4, height: 8 + Math.random() * 6, phase: Math.random() * 10,
      x: -dx * span - dz * offset, z: -dz * span + dx * offset, life: 0, span: span * 2,
    };
    this.flights.push(b);
    this.group.add(root);
  }

  /** `night` from 0 by day to 1 at night: balloons only go up in daylight. */
  update(dt: number, night: number): void {
    dt = Math.min(dt, 0.25);
    this.wait -= dt;
    if (this.wait <= 0) {
      if (night < 0.3 && this.flights.length < 2) this.launch();
      this.wait = 70 + Math.random() * 110;
    }
    for (const b of this.flights) {
      b.life += dt;
      b.x += b.dx * b.speed * dt; b.z += b.dz * b.speed * dt;
      const t = b.life * 0.35 + b.phase;
      b.root.position.set(b.x, b.height + Math.sin(t * 0.6) * 0.8, b.z);
      b.root.rotation.set(Math.sin(t) * 0.03, t * 0.08, Math.cos(t * 0.8) * 0.03);
      // The burner fires in bursts.
      const burn = Math.sin(t * 2.3) > 0.4;
      b.flame.visible = burn;
      if (burn) b.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    }
    for (const b of this.flights.filter(f => f.life * f.speed > f.span)) {
      this.group.remove(b.root);
      (b.root.children[0] as THREE.Mesh).geometry.dispose();
    }
    this.flights = this.flights.filter(f => f.life * f.speed <= f.span);
  }
}
