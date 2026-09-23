import type { VisualDetail } from './detail';
import { VEHICLE_SCALE } from '../sim/trafficSpace';
import * as THREE from 'three';
import { MAX_CARS } from '../constants';
import { Builder } from './buildingGeo';
import { carShell, busShell, truckShell, SEDAN, COUPE, VAN, BUS_LAMP_Y, TRUCK_LAMP_Y } from './carShell';
import type { CarSpec } from './carShell';

/** Vehicle types match the worker frame: 1 car, 2 van, 3 truck, 4 bus, 5 patrol, 6 engine, 7 racer, 8 trolleybus, 9 taxi, 10 garbage truck. */
export function vehicleGeometry(type: number, detail: VisualDetail = 1): THREE.BufferGeometry {
  const emergency = type === 5 || type === 6;
  const b = new Builder(type);
  const model = type === 5 || type === 7 || type === 9 ? 1 : type === 6 || type === 10 ? 3 : type === 8 ? 4 : type;
  const length = model >= 3 ? 0.78 : model === 2 ? 0.54 : 0.46;
  // Cars and vans are painted white and tinted per vehicle, so the palette lives in CarLayer.
  const body = [0, 0xffffff, 0xffffff, 0x508e9d, 0xeebc55, 0xe6ecec, 0xd44434, 0x2a2f36, 0x38b49b, 0xf7c62f, 0x3f8a4a][type];
  // Cars and vans are shaped from a side profile: rounded, raked and arched rather than boxed.
  if (detail > 0 && (model === 1 || model === 2)) {
    const spec = shellSpec(type)!;
    carShell(b, spec, { paint: body, glass: 0x243a4b, trim: 0x2a2f36, rim: type === 7 ? 0x2a2f36 : 0xc4ccd0, lamp: 0xfff1c8, tail: 0xc8282a });
    const roof = spec.cabin.roof, mid = (spec.cabin.front - spec.cabin.rake + spec.cabin.back + spec.cabin.rearRake) / 2;
    if (type === 9) {
      // A taxi: the roof sign and a chequered band along the doors.
      b.roundBox(0.1, 0.035, 0.05, 0, roof + 0.004, mid, 0xffe7a0, 0.01);
      for (const side of [-1, 1]) for (let z = -0.14; z <= 0.14; z += 0.035) b.box(0.004, 0.016, 0.017, side * (spec.width / 2 + 0.002), spec.sill + 0.045, z, (Math.round(z * 57) & 1) ? 0x252b30 : 0xf7c62f);
    }
    if (type === 5) {
      // A patrol car: a light bar and a blue band along the sides.
      b.roundBox(0.16, 0.022, 0.045, 0, roof + 0.004, mid, 0x263947, 0.008);
      b.roundBox(0.07, 0.024, 0.04, -0.045, roof + 0.012, mid, 0x428dff, 0.008);
      b.roundBox(0.07, 0.024, 0.04, 0.045, roof + 0.012, mid, 0xff5343, 0.008);
      for (const side of [-1, 1]) b.box(0.004, 0.024, spec.length * 0.8, side * (spec.width / 2 + 0.002), spec.sill + 0.03, 0, 0x315b89);
    }
    if (type === 7) {
      // A racer: a stripe over the top and a wing on the back.
      for (const x of [-0.022, 0.022]) b.box(0.016, 0.003, spec.length * 0.9, x, spec.belt - 0.004, 0, 0xe06a2e);
      b.roundBox(spec.width - 0.02, 0.008, 0.04, 0, spec.deck + 0.04, -spec.length / 2 + 0.025, 0x1f2226, 0.004);
      for (const x of [-0.08, 0.08]) b.box(0.008, 0.04, 0.012, x, spec.deck, -spec.length / 2 + 0.025, 0x1f2226);
    }
    if (type === 2 && detail === 2) {
      // Roof bars on a van.
      for (const x of [-0.09, 0.09]) b.box(0.01, 0.01, spec.length * 0.6, x, spec.cabin.roof + 0.004, -0.05, 0x3a4046);
    }
    // Tyres on the asphalt, which stands a little proud of the ground the cars are placed on.
    const geometry = b.build(); geometry.translate(0, 0.066, 0); geometry.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE); return geometry;
  }
  // Buses and lorries are shaped too: a rounded, raked front, windows, arches and all.
  if (detail > 0 && (model === 3 || model === 4)) {
    if (model === 4) {
      busShell(b, length, 0.25, 0.43, { paint: body, glass: 0x243a4b, trim: 0x2a2f36, stripe: type === 8 ? 0x1f6f60 : 0xc8541f });
      if (type === 8) {
        // Twin roof collectors distinguish electric trolleybuses from diesel buses.
        b.roundBox(0.2, 0.02, 0.4, 0, 0.43, -0.05, 0xe4eee4, 0.008);
        for (const x of [-0.055, 0.055]) {
          // The shoes meet the wires at the same height as ever, allowing for the lift onto the asphalt.
          b.cyl(0.012, 0.68, x, 0.45, -0.12, 0x424a4b, 6);
          b.box(0.025, 0.025, 0.14, x, 1.19 - 0.066, -0.12, 0x272f30);
        }
      }
    } else {
      const cabColor = type === 6 ? 0xd44434 : type === 10 ? 0xf2f2ee : body;
      truckShell(b, length, 0.25, { paint: cabColor, glass: 0x243a4b, trim: 0x2a2f36 });
      const z0 = length / 2 - 0.255, z1 = -length / 2 + 0.01, bodyLen = z0 - z1, mid = (z0 + z1) / 2;
      const load = type === 6 ? 0xcc4434 : type === 10 ? 0x3f8a4a : 0xe1e0d7;
      b.roundBox(0.27, 0.27, bodyLen, 0, 0.11, mid, load, 0.025);
      if (type === 3) {
        // A box van body: ribs down the sides and doors at the back.
        for (let z = z1 + 0.05; z < z0 - 0.02; z += 0.07) for (const side of [-1, 1]) b.box(0.006, 0.25, 0.012, side * 0.136, 0.12, z, 0xc2c6c4);
        b.box(0.002, 0.24, 0.004, 0, 0.12, z1 - 0.002, 0x8a9296);
        for (const x of [-0.06, 0.06]) b.box(0.01, 0.2, 0.006, x, 0.14, z1 - 0.004, 0x6b757b);
      } else if (type === 6) {
        // A fire engine: lockers down the sides, a ladder on top, a light bar on the cab.
        for (const side of [-1, 1]) for (let z = z1 + 0.06; z < z0 - 0.04; z += 0.1) {
          b.box(0.004, 0.13, 0.085, side * 0.137, 0.14, z, 0xd8dcdc);
          b.box(0.005, 0.006, 0.03, side * 0.138, 0.2, z, 0x6b757b);
        }
        for (const x of [-0.085, 0.085]) b.box(0.02, 0.02, bodyLen + 0.08, x, 0.39, mid + 0.02, 0xd5dddd);
        for (let z = z1 + 0.02; z < z0 + 0.05; z += 0.06) b.box(0.17, 0.014, 0.014, 0, 0.392, z, 0xd5dddd);
        b.roundBox(0.19, 0.02, 0.045, 0, 0.39, length / 2 - 0.12, 0x263947, 0.008);
        b.roundBox(0.08, 0.026, 0.04, -0.05, 0.4, length / 2 - 0.12, 0x428dff, 0.008);
        b.roundBox(0.08, 0.026, 0.04, 0.05, 0.4, length / 2 - 0.12, 0xff5343, 0.008);
      } else if (type === 10) {
        // A bin lorry: a stripe, and the loading hopper at the back.
        for (const side of [-1, 1]) b.box(0.004, 0.03, bodyLen - 0.02, side * 0.137, 0.22, mid, 0xf2f2ee);
        b.roundBox(0.25, 0.2, 0.08, 0, 0.1, z1 - 0.03, 0x2f6f3f, 0.02);
        b.box(0.2, 0.05, 0.004, 0, 0.14, z1 - 0.072, 0x1f2226);
        b.box(0.03, 0.03, 0.01, 0.09, 0.26, z1 - 0.07, 0xf2a21f);
      }
      for (const side of [-1, 1]) b.roundBox(0.035, 0.03, 0.01, side * 0.1, 0.12, z1 - 0.004, 0xc8282a, 0.004);
    }
    const geometry = b.build(); geometry.translate(0, 0.066, 0); geometry.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE); return geometry;
  }
  // Lorries and buses keep their boxy shape, but with rounded edges and corners.
  const slab = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, r: number): void => {
    if (detail > 0) b.roundBox(w, h, d, x, y, z, color, r); else b.box(w, h, d, x, y, z, color);
  };
  slab(0.25, 0.11, length, 0, 0.1, 0, body, 0.02);
  if (model === 1) {
    b.box(0.22, 0.1, 0.25, 0, 0.21, -0.01, body);
    b.box(0.19, 0.075, 0.015, 0, 0.23, 0.12, 0x283d50);
    b.box(0.19, 0.06, 0.015, 0, 0.23, -0.14, 0x283d50);
  } else if (model === 3) {
    slab(0.25, 0.18, 0.22, 0, 0.2, 0.25, body, 0.035);
    slab(0.27, 0.26, 0.48, 0, 0.16, -0.12, type === 6 ? 0xcc4434 : type === 10 ? 0x3f8a4a : 0xe1e0d7, 0.02);
    for (let z = -0.3; z < 0.1; z += 0.08) b.box(0.275, 0.23, 0.012, 0, 0.18, z, 0xb7c1bf);
    b.box(0.22, 0.08, 0.012, 0, 0.28, 0.365, 0x294354);
  } else {
    slab(0.24, model === 4 ? 0.24 : 0.19, length - 0.04, 0, 0.18, 0, body, 0.04);
    b.box(0.21, 0.1, 0.015, 0, 0.26, length / 2 - 0.013, 0x294354);
    if (model === 4) {
      for (let z = -0.27; z < 0.32; z += 0.12) b.box(0.25, 0.1, 0.085, 0, 0.27, z, 0x294354);
      b.box(0.18, 0.035, 0.2, 0, 0.42, -0.08, 0xe9e6db);
      b.box(0.18, 0.03, 0.016, 0, 0.38, length / 2 - 0.01, 0x263b38);
    } else {
      b.box(0.248, 0.09, 0.12, 0, 0.26, 0.13, 0x294354);
      b.box(0.015, 0.15, 0.014, 0, 0.2, -length / 2, 0x929d9e);
    }
  }
  if (detail > 0) {
    // Surface details replace solid-looking cabins without adding hidden box faces.
    for (const side of [-1, 1]) {
      const turn = side * Math.PI / 2;
      if (model === 1) {
        for (const z of [-0.073, 0.055]) b.pane(0.103, 0.068, side * 0.111, 0.231, z, turn, 0x283d50);
        b.pane(0.009, 0.088, side * 0.126, 0.117, 0.005, turn, 0x68747c);
        for (const z of [-0.07, 0.055]) b.pane(0.027, 0.008, side * 0.127, 0.19, z, turn, 0xb5c1c5);
      } else if (model === 3) {
        b.pane(0.14, 0.09, side * 0.126, 0.273, 0.25, turn, 0x294354);
        b.pane(0.035, 0.008, side * 0.127, 0.238, 0.22, turn, 0xb5c1c5);
      }
    }
    b.pane(0.09, 0.025, 0, 0.145, length / 2 + 0.015, 0, 0x34414a);
    b.pane(0.09, 0.004, 0, 0.155, length / 2 + 0.016, 0, 0x9da9ac);
    b.pane(0.062, 0.021, 0, 0.12, -length / 2 - 0.015, Math.PI, 0xd6d4c4);
  }
  if (detail === 2) {
    b.pane(0.21, 0.016, 0, 0.102, -length / 2 - 0.017, Math.PI, 0xa9b3b5);
    for (const side of [-1, 1]) {
      const turn = side * Math.PI / 2;
      b.pane(length * 0.58, 0.008, side * 0.127, 0.115, 0, turn, 0x8c989d);
      if (model === 1) {
        b.pane(0.009, 0.065, side * 0.112, 0.234, -0.01, turn, 0xa0adb0);
        b.pane(0.004, 0.04, side * 0.04, 0.23, 0.129, 0, 0x89959a);
      } else if (model === 3) {
        for (const z of [-0.28, -0.15, -0.02]) b.pane(0.021, 0.026, side * 0.141, 0.22, z, turn, 0x5e7077);
      }
    }
  }
  for (const x of [-0.13, 0.13]) for (const z of [-length * 0.31, length * 0.31]) {
    if (detail > 0) {
      // Round wheels with rims and hub caps, under dark wheel arches.
      b.wheel(0.052, 0.05, x, 0.105, z, 0x1f2327, model >= 3 ? 0x9aa3a8 : 0xc4ccd0);
      b.box(0.012, 0.03, 0.13, x * 1.02, 0.13, z, 0x1b1f23);
    } else {
      b.box(0.05, 0.1, 0.1, x, 0.055, z, 0x252b30);
      b.box(0.055, 0.04, 0.045, x, 0.085, z, 0x859299);
    }
  }
  if (detail > 0) {
    // Number plates, a grille, bumpers, door mirrors, door handles, an exhaust and an aerial.
    b.pane(0.07, 0.022, 0, 0.115, length / 2 + 0.019, 0, 0xf2f2ea);
    b.pane(0.05, 0.006, 0, 0.118, length / 2 + 0.02, 0, 0x2a2f36);
    b.pane(0.07, 0.022, 0, 0.16, -length / 2 - 0.018, Math.PI, 0xf2d94a);
    b.pane(0.05, 0.006, 0, 0.163, -length / 2 - 0.019, Math.PI, 0x2a2f36);
    for (let y = 0.165; y < 0.19; y += 0.008) b.pane(0.1, 0.003, 0, y, length / 2 + 0.0165, 0, 0x7c878c);
    b.box(0.24, 0.022, 0.02, 0, 0.09, -length / 2 - 0.004, 0x2c3237);
    b.box(0.24, 0.022, 0.02, 0, 0.09, length / 2 + 0.004, 0x2c3237);
    const mirrorZ = model === 1 ? 0.105 : model === 3 ? 0.33 : length / 2 - 0.07, mirrorY = model === 1 ? 0.2 : model === 3 ? 0.3 : 0.26;
    for (const side of [-1, 1]) {
      b.box(0.03, 0.006, 0.01, side * 0.138, mirrorY + 0.01, mirrorZ, 0x2a2f36);
      b.box(0.012, 0.024, 0.03, side * 0.155, mirrorY, mirrorZ, 0x3a4046);
      if (model <= 2) for (const z of model === 1 ? [0.03, -0.09] : [0.08]) b.box(0.004, 0.006, 0.022, side * 0.127, 0.19, z, 0x9aa3a8);
    }
    b.pipe(0.006, 0.04, 0.07, 0.085, -length / 2 - 0.01, 0x6b7378);
    if (model === 1) b.box(0.003, 0.09, 0.003, 0.08, 0.31, -0.1, 0x2a2f36);
  }
  for (const x of [-0.085, 0.085]) {
    b.box(0.05, 0.035, 0.016, x, 0.14, length / 2 + 0.005, 0xffedb0);
    b.box(0.045, 0.035, 0.016, x, 0.14, -length / 2 - 0.005, 0xbd3934);
    b.box(0.035, 0.025, 0.03, x * 1.7, 0.25, length * 0.22, 0x687b86);
  }
  b.box(0.23, 0.025, 0.018, 0, 0.105, length / 2 + 0.009, 0xa9b3b5);
  if (type === 9) {
    b.box(0.12, 0.045, 0.065, 0, 0.315, 0, 0xffe7a0);
    for (const side of [-1, 1]) for (let z = -0.13; z <= 0.13; z += 0.05)
      b.box(0.006, 0.027, 0.026, side * 0.127, 0.16, z, 0x252b30);
  }
  if (type === 7) {
    // A racer: low, striped, with a spoiler across the back.
    b.box(0.26, 0.03, 0.1, 0, 0.2, -length / 2 + 0.03, 0xd9d4c8);
    for (const x of [-0.11, 0.11]) b.box(0.02, 0.06, 0.05, x, 0.16, -length / 2 + 0.05, 0x3c434b);
    b.box(0.05, 0.02, length * 0.8, 0, 0.215, 0, 0xe06a2e);
    b.box(0.26, 0.05, 0.03, 0, 0.09, length / 2 - 0.02, 0xe06a2e);
  }
  if (type === 8) {
    // Twin roof collectors distinguish electric trolleybuses from diesel buses.
    b.box(0.23, 0.025, 0.48, 0, 0.33, 0, 0xe4eee4);
    for (const x of [-0.055, 0.055]) {
      b.cyl(0.012, 0.85, x, 0.35, -0.12, 0x424a4b, 6);
      b.box(0.025, 0.025, 0.14, x, 1.19, -0.12, 0x272f30);
    }
  }
  if (emergency) {
    const y = type === 6 ? 0.43 : 0.32;
    b.box(0.19, 0.025, 0.045, 0, y, 0.08, 0x263947);
    b.box(0.08, 0.035, 0.05, -0.05, y + 0.025, 0.08, 0x428dff);
    b.box(0.08, 0.035, 0.05, 0.05, y + 0.025, 0.08, 0xff5343);
    if (type === 6) {
      for (const x of [-0.085, 0.085]) b.box(0.025, 0.025, 0.4, x, 0.45, -0.12, 0xd5dddd);
      for (let z = -0.3; z < 0.1; z += 0.07) b.box(0.17, 0.025, 0.018, 0, 0.45, z, 0xd5dddd);
    } else b.box(0.255, 0.06, 0.2, 0, 0.14, 0, 0x315b89);
  }
  const geometry = b.build(); geometry.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE); return geometry;
}
/** The profile a car or van is built from, if it is one. */
export function shellSpec(type: number): CarSpec | null {
  if (type === 2) return VAN;
  if (type === 7) return COUPE;
  if (type === 1 || type === 5 || type === 9) return SEDAN;
  return null;
}

/** Head and tail lamps, drawn additively after dark. The lamps light up; the road stays dark. */
function lightGeometry(type: number): THREE.BufferGeometry {
  const model = type === 5 || type === 9 ? 1 : type === 6 || type === 10 ? 3 : type === 8 ? 4 : type;
  const length = model >= 3 ? 0.78 : model === 2 ? 0.54 : 0.46;
  const pos: number[] = [], col: number[] = [];
  const lamp = (x: number, y: number, z: number, w: number, h: number, c: number[]): void => {
    const g = new THREE.BoxGeometry(w, h, 0.03).toNonIndexed(), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z); col.push(...c); }
    g.dispose();
  };
  const warm = [1, 0.93, 0.72], red = [1, 0.12, 0.08];
  const spec = shellSpec(type);
  if (spec) {
    // Over the shaped car's own lamps.
    for (const side of [-1, 1]) {
      lamp(side * spec.width * 0.32, spec.nose - 0.018 + 0.066, spec.length / 2 + 0.006, 0.058, 0.024, warm);
      lamp(side * spec.width * 0.33, spec.deck - 0.021 + 0.066, -spec.length / 2 - 0.004, 0.052, 0.022, red);
    }
  } else if (model === 3 || model === 4) {
    // Over the shaped lorry's and bus's own lamps.
    const y = (model === 4 ? BUS_LAMP_Y : TRUCK_LAMP_Y) + 0.066;
    for (const side of [-1, 1]) {
      lamp(side * 0.25 * 0.33, y, length / 2 + 0.006, 0.05, 0.022, warm);
      lamp(side * 0.1, 0.135 + 0.066, -length / 2 - 0.006, 0.038, 0.032, red);
    }
  } else {
    const front = length / 2;
    for (const x of [-0.085, 0.085]) {
      lamp(x, 0.158, front + 0.012, 0.055, 0.04, warm);
      lamp(x, 0.158, -front - 0.012, 0.05, 0.04, red);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  return g;
}

// Weighted like a real car park: mostly white, black, silver and grey, with a few bright ones.
const CAR_COLORS = [0xf1f1ec, 0xf1f1ec, 0x26292d, 0x26292d, 0xb4b9bd, 0xb4b9bd, 0x6b7076, 0xa8312b, 0x2e5c9a, 0x1f3350, 0x355d45, 0xd9a93a, 0xcdbb97, 0xd66f2c, 0x6fa6c8, 0x6a2230];
const VAN_COLORS = [0xf1f1ec, 0xf1f1ec, 0xf1f1ec, 0xb4b9bd, 0x6b7076, 0x2e4f7c, 0xb13a2f, 0x3f6b4a, 0xe0b43c, 0x26292d];
export const vehicleColor = (type: number, id: number): number => {
  const palette = type === 1 ? CAR_COLORS : VAN_COLORS;
  const h = Math.imul(id ^ (id >>> 15), 0x2c1b3c6d) >>> 0;
  return palette[(h ^ (h >>> 12)) % palette.length];
};

const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
const pitchQ = new THREE.Quaternion(), pitchAxis = new THREE.Vector3(1, 0, 0);
const one = new THREE.Vector3(1, 1, 1), axis = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
export class CarLayer {
  readonly mesh = new THREE.Group();
  private detail: VisualDetail = 1;
  private vehicles: THREE.InstancedMesh[] = [];
  private lights: THREE.InstancedMesh[] = [];
  private lightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  constructor() {
    for (let type = 1; type <= 10; type++) {
      const mesh = new THREE.InstancedMesh(vehicleGeometry(type), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), MAX_CARS);
      if (type === 1 || type === 2) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3).fill(1), 3);
      mesh.castShadow = true; mesh.count = 0; mesh.frustumCulled = false;
      this.vehicles.push(mesh); this.mesh.add(mesh);
      const lights = new THREE.InstancedMesh(lightGeometry(type), this.lightMaterial, MAX_CARS);
      lights.count = 0; lights.frustumCulled = false; lights.renderOrder = 2; lights.visible = false;
      this.lights.push(lights); this.mesh.add(lights);
    }
  }
  setDetail(detail: VisualDetail): void {
    if (this.detail === detail) return;
    this.detail = detail;
    this.vehicles.forEach((mesh, index) => {
      const previous = mesh.geometry;
      mesh.geometry = vehicleGeometry(index + 1, detail);
      mesh.boundingSphere = null;
      previous.dispose();
    });
  }
  /** 0 by day, 1 at night: fades the head and tail lamps. */
  setNight(night: number): void {
    const on = night > 0.05;
    this.lightMaterial.opacity = Math.min(1, night * 1.3);
    for (const m of this.lights) m.visible = on;
  }
  update(prev: Float32Array, next: Float32Array, alpha: number, prevIds?: Uint32Array, nextIds?: Uint32Array, heights?: Float32Array, prevHeights?: Float32Array, pitch?: Float32Array): void {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < MAX_CARS; i++) {
      const o = i * 4, type = Math.round(next[o + 3]);
      if (type < 1 || type > 10) continue;
      let y = heights?.[i] ?? 0;
      let x = next[o], z = next[o + 1], a = next[o + 2];
      if ((!prevIds || !nextIds || prevIds[i] === nextIds[i]) && prev[o + 3] === type && Math.abs(prev[o] - x) + Math.abs(prev[o + 1] - z) < 1.5) {
        y = (prevHeights?.[i] ?? y) + (y - (prevHeights?.[i] ?? y)) * alpha;
        x = prev[o] + (x - prev[o]) * alpha; z = prev[o + 1] + (z - prev[o + 1]) * alpha;
        const da = Math.atan2(Math.sin(a - prev[o + 2]), Math.cos(a - prev[o + 2]));
        a = prev[o + 2] + da * alpha;
      }
      if (y < -0.22) continue; // vehicles disappear beneath the tunnel portal
      pos.set(x, y, z); q.setFromAxisAngle(axis, a); q.multiply(pitchQ.setFromAxisAngle(pitchAxis, pitch?.[i] ?? 0)); matrix.compose(pos, q, one);
      const slot = counts[type - 1]++, mesh = this.vehicles[type - 1];
      mesh.setMatrixAt(slot, matrix);
      if (type <= 2) mesh.setColorAt(slot, color.setHex(vehicleColor(type, nextIds?.[i] ?? i)));
      if (y > -0.05) this.lights[type - 1].setMatrixAt(slot, matrix);
      else this.lights[type - 1].setMatrixAt(slot, matrix.makeScale(0, 0, 0));
    }
    this.vehicles.forEach((mesh, i) => {
      mesh.count = counts[i]; mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.lights[i].count = counts[i]; this.lights[i].instanceMatrix.needsUpdate = true;
    });
  }
}
