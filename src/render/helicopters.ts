import * as THREE from 'three';
import { GRID } from '../constants';
import { Builder } from './buildingGeo';
import type { IncidentView } from '../sim/incidents';

interface Chopper {
  body: THREE.Mesh;
  rotor: THREE.Mesh;
  tail: THREE.Mesh;
  /** Where it is circling, and how wide and fast that circle is. */
  x: number; z: number; radius: number; speed: number; phase: number; height: number;
}

/**
 * Helicopters over the city: the police and the traffic watch. They loiter in slow circles, and when
 * something is happening — a fire, a robbery, a pile-up — the nearest one drifts over to look at it.
 * Pure scenery: they never land and nothing on the ground depends on them.
 */
export class HelicopterLayer {
  readonly group = new THREE.Group();
  private fleet: Chopper[] = [];

  constructor() {
    const livery = [0x2f4f7a, 0x6b6f76, 0x2c6b52];
    for (let n = 0; n < 3; n++) {
      const b = new Builder(n + 41);
      b.box(0.34, 0.26, 0.9, 0, 0, 0, livery[n]);
      b.box(0.3, 0.14, 0.3, 0, 0.06, 0.36, 0x9fd2e6); // cockpit glass
      b.box(0.1, 0.1, 0.75, 0, 0.1, -0.78, livery[n]); // tail boom
      b.box(0.06, 0.34, 0.08, 0, 0.22, -1.08, livery[n]); // fin
      b.box(0.04, 0.07, 0.04, 0, 0.16, 0, 0x3a4149); // rotor mast
      for (const x of [-0.16, 0.16]) {
        b.box(0.05, 0.05, 0.62, x, -0.2, 0.02, 0x3a4149); // skids
        b.box(0.04, 0.16, 0.04, x, -0.12, 0.2, 0x3a4149);
      }
      const body = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
      body.castShadow = true;

      const blades = new Builder(n + 51);
      blades.box(1.9, 0.02, 0.09, 0, 0, 0, 0x22262b);
      blades.box(0.09, 0.02, 1.9, 0, 0, 0, 0x22262b);
      const rotor = new THREE.Mesh(blades.build(), new THREE.MeshStandardMaterial({ vertexColors: true }));
      rotor.position.y = 0.22;

      const tailBlades = new Builder(n + 61);
      tailBlades.box(0.02, 0.5, 0.06, 0, 0, 0, 0x22262b);
      const tail = new THREE.Mesh(tailBlades.build(), new THREE.MeshStandardMaterial({ vertexColors: true }));
      tail.position.set(0.06, 0.22, -1.08);

      body.add(rotor, tail);
      // Small against the city: a helicopter is about the size of a bus, not of a house.
      body.scale.setScalar(0.45);
      this.group.add(body);
      this.fleet.push({
        body, rotor, tail,
        x: (n - 1) * 12, z: (n % 2 ? 1 : -1) * 10, radius: 6 + n * 2.5, speed: 0.14 + n * 0.03,
        phase: n * 2.1, height: 6.5 + n * 1.5,
      });
    }
  }

  /** Send each helicopter to the nearest thing worth watching, or leave it over its own patch. */
  watch(view: IncidentView): void {
    const scenes: { x: number; z: number }[] = [
      ...view.fires.map(f => ({ x: f.tile % GRID + 0.5, z: Math.floor(f.tile / GRID) + 0.5 })),
      ...view.heists.map(h => ({ x: h.tile % GRID + 0.5, z: Math.floor(h.tile / GRID) + 0.5 })),
      ...view.crashes.map(c => ({ x: c.x, z: c.z })),
    ];
    this.fleet.forEach((chopper, n) => {
      const scene = scenes[n % Math.max(1, scenes.length)];
      if (!scenes.length || !scene) return;
      chopper.x = scene.x - GRID / 2;
      chopper.z = scene.z - GRID / 2;
    });
  }

  update(time: number): void {
    for (const c of this.fleet) {
      const a = time * c.speed + c.phase;
      const x = c.x + Math.cos(a) * c.radius, z = c.z + Math.sin(a) * c.radius;
      c.body.position.set(x, c.height + Math.sin(time * 0.4 + c.phase) * 0.4, z);
      // Nose along the circle, and lean into the turn like a helicopter under way.
      c.body.rotation.set(0, Math.atan2(-Math.sin(a), Math.cos(a)) - Math.PI / 2, 0);
      c.body.rotateZ(0.12);
      c.rotor.rotation.y = time * 26;
      c.tail.rotation.x = time * 30;
    }
  }
}
