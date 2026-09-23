import type * as THREE from 'three';
import { Builder } from '../render/buildingGeo';
import { carShell, HATCH, COUPE, WAGON, MUSCLE, SUPER } from '../render/carShell';
import type { CarSpec } from '../render/carShell';
import { VEHICLE_SCALE } from '../sim/trafficSpace';
import type { CarModel } from './garage';

const SPECS: Record<CarModel, CarSpec> = { hatch: HATCH, coupe: COUPE, rally: WAGON, muscle: MUSCLE, super: SUPER };
const TRIM = 0x23282d;

/** A player's car, painted: a shaped body and glasshouse, round wheels, lamps, and the model's own touches. */
export function playerCarGeometry(model: CarModel, paint: number): THREE.BufferGeometry {
  const s = SPECS[model], b = new Builder(7, 2);
  const L = s.length, W = s.width, half = L / 2, cab = s.cabin;
  carShell(b, s, {
    paint, glass: 0x1f3445, trim: TRIM, lamp: 0xfff1c8, tail: 0xc8282a,
    rim: model === 'super' ? 0x2a2f36 : model === 'muscle' ? 0xe0e4e6 : 0xc4ccd0,
  });
  const stripe = model === 'rally' ? 0x2f6fd8 : model === 'muscle' ? 0x1f2226 : model === 'super' ? 0xd9412f : null;
  if (stripe !== null) for (const x of [-0.022, 0.022]) {
    b.box(0.016, 0.003, half - cab.front - 0.02, x, s.belt + 0.002, (half + cab.front) / 2, stripe);
    b.box(0.016, 0.003, cab.front - cab.rake - cab.back - cab.rearRake, x, cab.roof + 0.005, (cab.front - cab.rake + cab.back + cab.rearRake) / 2, stripe);
  }
  if (model === 'coupe' || model === 'super' || model === 'rally') {
    // A rear wing on two struts.
    b.roundBox(W - 0.02, 0.008, 0.04, 0, s.deck + 0.04, -half + 0.024, model === 'rally' ? paint : TRIM, 0.004);
    for (const x of [-W * 0.33, W * 0.33]) b.box(0.008, 0.042, 0.012, x, s.deck, -half + 0.024, TRIM);
  }
  if (model === 'muscle') b.roundBox(0.07, 0.022, 0.09, 0, s.belt - 0.006, half - L * 0.2, TRIM, 0.008);
  if (model === 'super' || model === 'coupe') b.roundBox(W + 0.008, 0.006, 0.03, 0, s.sill - 0.014, half - 0.002, TRIM, 0.003);
  if (model === 'rally') for (const x of [-0.06, -0.02, 0.02, 0.06]) b.roundBox(0.03, 0.022, 0.012, x, cab.roof + 0.006, cab.front - cab.rake - 0.004, 0xfff1c8, 0.004);
  b.box(0.003, 0.08, 0.003, W * 0.3, cab.roof, cab.back + cab.rearRake + 0.02, TRIM);
  const g = b.build();
  g.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  // Tyres sit on the asphalt, which stands a little proud of the ground.
  g.translate(0, 0.045, 0);
  return g;
}
