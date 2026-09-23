import * as THREE from 'three';
import type { Builder } from './buildingGeo';

/**
 * The body of a car, built from a side profile rather than stacked boxes: a nose that rounds down to
 * the bumper, a bonnet running up to a raked windscreen, a roof, a sloping rear screen and a boot (or a
 * hatch, or a van's tall box), wheel arches cut out of the sides, and every edge rounded. A glass
 * greenhouse sits on the body, narrower than it, with a painted roof over it and pillars at its
 * corners. Dimensions are in the vehicle's own unscaled units, front towards +z, ground at y = 0.
 */
export interface CarSpec {
  length: number; width: number;
  /** Height of the body's underside, and of its shoulder where the glass starts. */
  sill: number; belt: number;
  /** Height of the nose's top edge, and of the boot at the back. */
  nose: number; deck: number;
  /** The glasshouse: where the windscreen and the rear screen meet the body, how high the roof is, how
   *  far each screen leans back, and how wide it is. */
  cabin: { front: number; back: number; roof: number; rake: number; rearRake: number; width: number };
  /** Wheel radius and where the axles are, as fractions of the length from the middle. */
  wheel: number; axle: number;
  /** A van: the roof runs back to a flat rear, and only the cab has glass. */
  van?: boolean;
}

export interface CarColors { paint: number; glass: number; trim: number; rim: number; lamp: number; tail: number }

const DARK = 0x16191c;

export function carShell(b: Builder, s: CarSpec, c: CarColors): void {
  const L = s.length, W = s.width, half = L / 2, R = s.wheel, pad = 0.012;
  const axles = [-L * s.axle, L * s.axle];
  // ---- the body, with its wheel arches ----
  const body = new THREE.Shape();
  body.moveTo(-half + 0.015, s.sill);
  for (const zw of axles) {
    const r = R + pad, rise = Math.max(-0.99, Math.min(0.99, (s.sill - R) / r)), t = Math.asin(rise);
    body.lineTo(zw - Math.cos(t) * r, s.sill);
    body.absarc(zw, R, r, Math.PI - t, t, true);
  }
  body.lineTo(half - 0.015, s.sill);
  body.quadraticCurveTo(half, s.sill, half, s.sill + 0.02);
  body.lineTo(half, s.nose - 0.012);
  body.quadraticCurveTo(half, s.nose, half - 0.02, s.nose + 0.004);
  const cab = s.cabin;
  if (s.van) {
    // A short bonnet, a steep screen and a tall box behind.
    body.lineTo(cab.front + 0.01, s.belt);
    body.lineTo(cab.front - cab.rake, cab.roof - 0.01);
    body.quadraticCurveTo(cab.front - cab.rake - 0.01, cab.roof, cab.front - cab.rake - 0.03, cab.roof);
    body.lineTo(-half + 0.02, cab.roof);
    body.quadraticCurveTo(-half, cab.roof, -half, cab.roof - 0.02);
  } else {
    // The bonnet rises gently to the screen; the boot falls from the rear screen to the tail.
    body.quadraticCurveTo((half + cab.front) / 2, s.belt + 0.004, cab.front + 0.01, s.belt);
    body.lineTo(cab.back - 0.01, s.belt);
    body.quadraticCurveTo((cab.back - half) / 2, s.deck + 0.006, -half + 0.022, s.deck);
    body.quadraticCurveTo(-half, s.deck - 0.002, -half, s.deck - 0.02);
  }
  body.lineTo(-half, s.sill + 0.02);
  body.quadraticCurveTo(-half, s.sill, -half + 0.015, s.sill);
  b.profile(body, W, 0, c.paint, 0.016, 10);
  // Dark wheel wells behind the arches, so you cannot see through the car.
  for (const zw of axles) b.box(W - 0.05, R + pad + 0.004, 2 * (R + pad) - 0.01, 0, R, zw, DARK);

  // ---- glass, roof and pillars ----
  const top = cab.roof, cw = cab.width;
  if (s.van) {
    // Glass only in the cab: the windscreen and a window each side.
    const screen = new THREE.Shape();
    screen.moveTo(cab.front + 0.004, s.belt + 0.01);
    screen.lineTo(cab.front - cab.rake + 0.006, top - 0.016);
    screen.lineTo(cab.front - cab.rake - 0.004, top - 0.016);
    screen.lineTo(cab.front - 0.006, s.belt + 0.01);
    b.profile(screen, W - 0.04, 0, c.glass, 0.004, 1);
    for (const side of [-1, 1]) {
      const win = new THREE.Shape();
      win.moveTo(cab.front - 0.02, s.belt + 0.012);
      win.lineTo(cab.front - cab.rake - 0.004, top - 0.022);
      win.lineTo(cab.front - cab.rake - 0.1, top - 0.022);
      win.lineTo(cab.front - cab.rake - 0.1, s.belt + 0.012);
      b.profile(win, 0.006, side * (W / 2 - 0.001), c.glass, 0.001, 1);
    }
  } else {
    const glass = new THREE.Shape();
    glass.moveTo(cab.front, s.belt - 0.004);
    glass.lineTo(cab.front - cab.rake, top);
    glass.lineTo(cab.back + cab.rearRake, top);
    glass.lineTo(cab.back, s.belt - 0.004);
    b.profile(glass, cw, 0, c.glass, 0.012, 1);
    // A painted roof over the glass, and pillars at its corners and between the doors.
    const roof = new THREE.Shape(), inset = 0.012;
    roof.moveTo(cab.front - cab.rake - 0.004, top - 0.012);
    roof.lineTo(cab.front - cab.rake + inset * 0.3, top + 0.004);
    roof.lineTo(cab.back + cab.rearRake - inset * 0.3, top + 0.004);
    roof.lineTo(cab.back + cab.rearRake + 0.004, top - 0.012);
    b.profile(roof, cw + 0.006, 0, c.paint, 0.008, 1);
    for (const side of [-1, 1]) {
      const x = side * (cw / 2 + 0.002);
      b.beam(x, s.belt, cab.front - 0.004, x, top - 0.004, cab.front - cab.rake + 0.004, 0.014, c.paint);
      b.beam(x, s.belt, cab.back + 0.004, x, top - 0.004, cab.back + cab.rearRake - 0.004, 0.016, c.paint);
      const mid = (cab.front - cab.rake * 0.5 + cab.back + cab.rearRake * 0.5) / 2;
      b.box(0.012, top - s.belt, 0.018, x, s.belt, mid, c.trim);
    }
  }

  // ---- wheels ----
  for (const x of [-(W / 2 - 0.024), W / 2 - 0.024]) for (const z of axles) b.wheel(R, 0.048, x, R, z, 0x1a1d20, c.rim, 14);

  // ---- lamps, grille, bumpers, plates, mirrors, handles, sills ----
  const lampY = s.nose - 0.028;
  for (const side of [-1, 1]) {
    b.roundBox(0.055, 0.02, 0.014, side * W * 0.32, lampY, half - 0.002, c.lamp, 0.006);
    b.roundBox(0.05, 0.018, 0.012, side * W * 0.33, s.deck - 0.03, -half + 0.001, c.tail, 0.005);
    // Door mirror on a little arm.
    const mz = s.van ? cab.front - 0.03 : cab.front - 0.02;
    b.box(0.022, 0.005, 0.008, side * (W / 2 + 0.006), s.belt + 0.006, mz, c.trim);
    b.roundBox(0.01, 0.02, 0.028, side * (W / 2 + 0.017), s.belt, mz, c.paint, 0.004);
    // Door shut lines and handles, and a dark sill under the doors.
    const doors = s.van ? [cab.front - 0.12] : [cab.front - 0.02, (cab.front + cab.back) / 2 - 0.01, cab.back + 0.03];
    for (const z of doors) b.box(0.002, s.belt - s.sill - 0.02, 0.003, side * (W / 2 + 0.0015), s.sill + 0.012, z, c.trim);
    b.box(0.004, 0.005, 0.02, side * (W / 2 + 0.002), s.belt - 0.022, s.van ? cab.front - 0.07 : (cab.front + cab.back) / 2 + 0.03, 0xc4ccd0);
    b.box(0.006, 0.014, L * 0.5, side * (W / 2 - 0.002), s.sill - 0.006, 0, c.trim);
  }
  b.roundBox(W * 0.42, 0.024, 0.01, 0, s.sill + 0.028, half - 0.001, DARK, 0.005);
  for (let y = s.sill + 0.032; y < s.sill + 0.05; y += 0.007) b.box(W * 0.38, 0.0018, 0.004, 0, y, half + 0.004, 0x6b757b);
  b.roundBox(W - 0.004, 0.022, 0.024, 0, s.sill - 0.006, half - 0.004, c.trim, 0.008);
  b.roundBox(W - 0.004, 0.022, 0.024, 0, s.sill - 0.006, -half + 0.004, c.trim, 0.008);
  b.box(0.062, 0.018, 0.004, 0, s.sill + 0.004, half + 0.009, 0xf2f2ea);
  b.box(0.062, 0.018, 0.004, 0, s.deck - 0.056, -half - 0.001, 0xf2d94a);
  b.pipe(0.0065, 0.028, W * 0.3, s.sill + 0.004, -half - 0.006, 0x8a9296);
}

/** The shapes of the city's cars and of the player's, in the vehicle's own unscaled units. */
export const SEDAN: CarSpec = { length: 0.46, width: 0.25, sill: 0.07, belt: 0.158, nose: 0.14, deck: 0.155, cabin: { front: 0.06, back: -0.13, roof: 0.245, rake: 0.075, rearRake: 0.055, width: 0.215 }, wheel: 0.05, axle: 0.31 };
export const HATCH: CarSpec = { length: 0.42, width: 0.245, sill: 0.07, belt: 0.16, nose: 0.14, deck: 0.18, cabin: { front: 0.07, back: -0.19, roof: 0.25, rake: 0.075, rearRake: 0.02, width: 0.215 }, wheel: 0.05, axle: 0.31 };
export const COUPE: CarSpec = { length: 0.48, width: 0.26, sill: 0.06, belt: 0.14, nose: 0.12, deck: 0.14, cabin: { front: 0.04, back: -0.12, roof: 0.21, rake: 0.085, rearRake: 0.075, width: 0.205 }, wheel: 0.052, axle: 0.31 };
export const WAGON: CarSpec = { length: 0.47, width: 0.255, sill: 0.075, belt: 0.165, nose: 0.145, deck: 0.19, cabin: { front: 0.07, back: -0.21, roof: 0.255, rake: 0.075, rearRake: 0.012, width: 0.22 }, wheel: 0.055, axle: 0.31 };
export const MUSCLE: CarSpec = { length: 0.54, width: 0.27, sill: 0.065, belt: 0.15, nose: 0.14, deck: 0.15, cabin: { front: 0.0, back: -0.15, roof: 0.22, rake: 0.075, rearRake: 0.07, width: 0.22 }, wheel: 0.058, axle: 0.3 };
export const SUPER: CarSpec = { length: 0.52, width: 0.29, sill: 0.05, belt: 0.12, nose: 0.1, deck: 0.13, cabin: { front: 0.06, back: -0.1, roof: 0.185, rake: 0.1, rearRake: 0.08, width: 0.2 }, wheel: 0.055, axle: 0.3 };
export const VAN: CarSpec = { length: 0.54, width: 0.26, sill: 0.075, belt: 0.17, nose: 0.15, deck: 0.33, cabin: { front: 0.17, back: -0.27, roof: 0.33, rake: 0.07, rearRake: 0, width: 0.25 }, wheel: 0.052, axle: 0.32, van: true };
