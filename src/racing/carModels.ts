import type * as THREE from 'three';
import { Builder } from '../render/buildingGeo';
import { VEHICLE_SCALE } from '../sim/trafficSpace';
import type { CarModel } from './garage';

interface Shape {
  length: number; width: number;
  /** Height of the body's underside and of its top. */
  sill: number; beltline: number;
  cabin: { length: number; width: number; height: number; z: number };
  wheel: number;
  spoiler?: boolean; scoop?: boolean; stripes?: number; roofLights?: boolean; splitter?: boolean; hatchback?: boolean;
}

const SHAPES: Record<CarModel, Shape> = {
  hatch: { length: 0.46, width: 0.25, sill: 0.07, beltline: 0.16, cabin: { length: 0.28, width: 0.225, height: 0.085, z: -0.03 }, wheel: 0.05, hatchback: true },
  coupe: { length: 0.5, width: 0.26, sill: 0.06, beltline: 0.135, cabin: { length: 0.22, width: 0.215, height: 0.072, z: -0.035 }, wheel: 0.052, spoiler: true, splitter: true },
  rally: { length: 0.47, width: 0.26, sill: 0.075, beltline: 0.16, cabin: { length: 0.27, width: 0.225, height: 0.085, z: -0.02 }, wheel: 0.055, stripes: 0x2f6fd8, roofLights: true, spoiler: true },
  muscle: { length: 0.55, width: 0.27, sill: 0.065, beltline: 0.15, cabin: { length: 0.21, width: 0.225, height: 0.07, z: -0.06 }, wheel: 0.058, scoop: true, stripes: 0x1f2226 },
  super: { length: 0.53, width: 0.29, sill: 0.05, beltline: 0.12, cabin: { length: 0.2, width: 0.225, height: 0.064, z: -0.02 }, wheel: 0.055, spoiler: true, splitter: true, stripes: 0xd9412f },
};

const GLASS = 0x22384a, TRIM = 0x23282d, CHROME = 0xc4ccd0;

/** A player's car, painted: a body, a glasshouse, round wheels, lamps, plates and the model's own touches. */
export function playerCarGeometry(model: CarModel, paint: number): THREE.BufferGeometry {
  const s = SHAPES[model], b = new Builder(7, 2);
  const L = s.length, W = s.width, half = L / 2;
  const bodyH = s.beltline - s.sill;
  b.box(W, bodyH, L, 0, s.sill, 0, paint);
  // Bonnet and boot slope down a little at the ends.
  b.box(W - 0.02, 0.012, L * 0.26, 0, s.beltline, half - L * 0.13, paint);
  const c = s.cabin, cy = s.beltline;
  b.box(c.width, c.height, c.length, 0, cy, c.z, paint);
  // Glass all round the cabin, and pillars.
  b.pane(c.width - 0.03, c.height - 0.022, 0, cy + 0.008, c.z + c.length / 2 + 0.001, 0, GLASS);
  b.pane(c.width - 0.03, c.height - 0.026, 0, cy + 0.01, c.z - c.length / 2 - 0.001, Math.PI, GLASS);
  for (const side of [-1, 1]) {
    const turn = side * Math.PI / 2;
    b.pane(c.length * 0.42, c.height - 0.03, side * (c.width / 2 + 0.001), cy + 0.012, c.z + c.length * 0.22, turn, GLASS);
    b.pane(c.length * 0.36, c.height - 0.03, side * (c.width / 2 + 0.001), cy + 0.012, c.z - c.length * 0.25, turn, GLASS);
    // A shut line for the door and a handle.
    b.pane(0.003, bodyH - 0.02, side * (W / 2 + 0.001), s.sill + 0.01, c.z + c.length * 0.45, turn, TRIM);
    b.box(0.004, 0.006, 0.022, side * (W / 2 + 0.002), s.beltline - 0.025, c.z, CHROME);
    // Side skirts.
    b.box(0.012, 0.018, L * 0.55, side * (W / 2 - 0.004), s.sill - 0.012, 0, TRIM);
    // Mirrors.
    b.box(0.03, 0.006, 0.01, side * (c.width / 2 + 0.012), cy + 0.012, c.z + c.length / 2 - 0.02, TRIM);
    b.box(0.012, 0.022, 0.028, side * (c.width / 2 + 0.027), cy + 0.004, c.z + c.length / 2 - 0.02, paint);
  }
  // Wheels under their arches.
  for (const x of [-(W / 2 - 0.02), W / 2 - 0.02]) for (const z of [-L * 0.31, L * 0.31]) {
    b.wheel(s.wheel, 0.05, x, s.wheel, z, 0x1a1d20, model === 'super' ? 0x2a2f36 : model === 'muscle' ? 0xe0e4e6 : CHROME, 14);
    b.box(0.014, 0.026, s.wheel * 2.5, x * 1.05, s.wheel + 0.02, z, TRIM);
  }
  // Lamps, grille, bumpers and plates.
  for (const x of [-W * 0.34, W * 0.34]) {
    b.box(0.05, 0.022, 0.012, x, s.beltline - 0.035, half + 0.004, 0xfff1c8);
    b.box(0.05, 0.02, 0.012, x, s.beltline - 0.035, -half - 0.004, 0xc8282a);
  }
  b.box(W * 0.4, 0.028, 0.008, 0, s.sill + 0.02, half + 0.002, TRIM);
  for (let y = s.sill + 0.024; y < s.sill + 0.045; y += 0.008) b.pane(W * 0.38, 0.002, 0, y, half + 0.0065, 0, 0x6b757b);
  b.box(W + 0.004, 0.02, 0.018, 0, s.sill - 0.004, half + 0.006, TRIM);
  b.box(W + 0.004, 0.02, 0.018, 0, s.sill - 0.004, -half - 0.006, TRIM);
  b.pane(0.06, 0.018, 0, s.sill + 0.004, half + 0.016, 0, 0xf2f2ea);
  b.pane(0.06, 0.018, 0, s.sill + 0.03, -half - 0.011, Math.PI, 0xf2d94a);
  b.pipe(0.007, 0.03, W * 0.3, s.sill + 0.002, -half - 0.01, 0x8a9296);
  if (model === 'muscle' || model === 'super') b.pipe(0.007, 0.03, -W * 0.3, s.sill + 0.002, -half - 0.01, 0x8a9296);
  // The model's own touches.
  if (s.stripes !== undefined) for (const x of [-0.025, 0.025]) {
    b.box(0.018, 0.0015, L * 0.26, x, s.beltline + 0.012, half - L * 0.13, s.stripes);
    b.box(0.018, 0.0015, c.length, x, cy + c.height, c.z, s.stripes);
    b.box(0.018, 0.0015, L * 0.2, x, s.beltline, -half + L * 0.1, s.stripes);
  }
  if (s.spoiler) {
    b.box(W - 0.02, 0.008, 0.035, 0, s.beltline + 0.045, -half + 0.02, model === 'rally' ? paint : TRIM);
    for (const x of [-W * 0.35, W * 0.35]) b.box(0.008, 0.045, 0.012, x, s.beltline, -half + 0.02, TRIM);
  }
  if (s.scoop) b.box(0.07, 0.02, 0.08, 0, s.beltline + 0.012, half - L * 0.2, TRIM);
  if (s.splitter) b.box(W + 0.01, 0.006, 0.03, 0, s.sill - 0.012, half + 0.008, TRIM);
  if (s.roofLights) for (const x of [-0.06, -0.02, 0.02, 0.06]) b.box(0.03, 0.022, 0.012, x, cy + c.height + 0.004, c.z + c.length / 2 - 0.01, 0xfff1c8);
  if (s.hatchback) b.box(c.width, 0.012, 0.03, 0, cy + c.height - 0.012, c.z - c.length / 2 - 0.01, paint);
  b.box(0.003, 0.08, 0.003, W * 0.3, cy + c.height, c.z - c.length * 0.3, TRIM);
  const g = b.build();
  g.scale(VEHICLE_SCALE, VEHICLE_SCALE, VEHICLE_SCALE);
  // Tyres sit on the asphalt, which stands a little proud of the ground.
  g.translate(0, 0.045, 0);
  return g;
}
