/**
 * The player's garage: the cars they own, how each is tuned, what it is painted, and the race
 * winnings to spend on more. It belongs to the player rather than to any one city, so it is kept in
 * the browser's own storage and follows them from city to city.
 */

export type CarModel = 'hatch' | 'coupe' | 'rally' | 'muscle' | 'super';
export type Part = 'engine' | 'turbo' | 'tyres' | 'suspension' | 'brakes';

export interface ModelSpec {
  name: string;
  blurb: string;
  price: number;
  /** Top speed, acceleration, grip, steering and braking, before upgrades. */
  top: number; accel: number; grip: number; steer: number; brake: number;
  /** How far the tyres let go in a slide: lower slides further. */
  slide: number;
  color: number;
}

export const MODELS: Record<CarModel, ModelSpec> = {
  hatch: { name: 'Hatchback', blurb: 'Your first car: light, forgiving and slow', price: 0, top: 2.6, accel: 1.25, grip: 9, steer: 2.3, brake: 4, slide: 1.1, color: 0xd9412f },
  coupe: { name: 'Sports coupé', blurb: 'Low and quick, with a rear spoiler', price: 3200, top: 3.0, accel: 1.55, grip: 9.5, steer: 2.4, brake: 4.4, slide: 1.2, color: 0x2f6fd8 },
  rally: { name: 'Rally car', blurb: 'Built to slide: grips, and drifts on command', price: 5600, top: 3.1, accel: 1.75, grip: 11, steer: 2.65, brake: 4.6, slide: 1.7, color: 0xf2f2ee },
  muscle: { name: 'Muscle car', blurb: 'Brutal off the line, loose in the bends', price: 7400, top: 3.55, accel: 2.0, grip: 8.2, steer: 2.1, brake: 4.2, slide: 0.9, color: 0xf2b31f },
  super: { name: 'Supercar', blurb: 'The fastest thing in town', price: 15000, top: 4.1, accel: 2.35, grip: 11.5, steer: 2.5, brake: 5.2, slide: 1.3, color: 0x1f2226 },
};

export const PARTS: Record<Part, { name: string; effect: string }> = {
  engine: { name: 'Engine', effect: 'Top speed and acceleration' },
  turbo: { name: 'Nitrous', effect: 'A bigger burst on Shift' },
  tyres: { name: 'Tyres', effect: 'Grip in the corners' },
  suspension: { name: 'Suspension', effect: 'Sharper steering, less lean' },
  brakes: { name: 'Brakes', effect: 'Stops shorter' },
};
export const MAX_LEVEL = 3;
export const PAINTS = [0xd9412f, 0x2f6fd8, 0xf2f2ee, 0xf2b31f, 0x1f2226, 0x3fae5f, 0x8a3fd8, 0xff7a1f, 0x7fd0ff, 0xb5b9bd];

export interface OwnedCar { model: CarModel; color: number; parts: Record<Part, number> }
export interface GarageState {
  cash: number;
  cars: OwnedCar[];
  selected: number;
  wins: number;
  /** Best result per race id: the place (1 is first), or for drift races the score. */
  best: Record<string, number>;
}

const KEY = 'gridburg.garage.v1';

export const newCar = (model: CarModel): OwnedCar => ({ model, color: MODELS[model].color, parts: { engine: 0, turbo: 0, tyres: 0, suspension: 0, brakes: 0 } });

export function defaultGarage(): GarageState {
  return { cash: 1000, cars: [newCar('hatch')], selected: 0, wins: 0, best: {} };
}

export function loadGarage(): GarageState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as GarageState | null;
    if (raw && Array.isArray(raw.cars) && raw.cars.length && raw.cars.every(c => c && c.model in MODELS)) {
      const g = { ...defaultGarage(), ...raw };
      g.cars = raw.cars.map(c => ({ ...newCar(c.model), ...c, parts: { ...newCar(c.model).parts, ...c.parts } }));
      g.selected = Math.max(0, Math.min(g.cars.length - 1, g.selected | 0));
      g.cash = Number.isFinite(g.cash) ? Math.max(0, g.cash) : 1000;
      return g;
    }
  } catch { /* storage may be blocked */ }
  return defaultGarage();
}

export function saveGarage(g: GarageState): void {
  try { localStorage.setItem(KEY, JSON.stringify(g)); } catch { /* storage may be blocked */ }
}

/** What the next level of a part costs on a given car: dearer on dearer cars. */
export function partCost(model: CarModel, level: number): number {
  const tier = 1 + MODELS[model].price / 6000;
  return Math.round([450, 1100, 2400][level] * tier / 50) * 50;
}

/** How a car drives, with its upgrades. */
export interface DriveStats { top: number; boost: number; accel: number; grip: number; slide: number; steer: number; brake: number; roll: number }
export function driveStats(car: OwnedCar): DriveStats {
  const m = MODELS[car.model], p = car.parts;
  const top = m.top * (1 + p.engine * 0.07);
  return {
    top,
    boost: top * (1.55 + p.turbo * 0.12),
    accel: m.accel * (1 + p.engine * 0.1 + p.turbo * 0.04),
    grip: m.grip * (1 + p.tyres * 0.1),
    slide: m.slide * (1 + p.tyres * 0.08),
    steer: m.steer * (1 + p.suspension * 0.06),
    brake: m.brake * (1 + p.brakes * 0.15),
    roll: 1 - p.suspension * 0.2,
  };
}

/** Ratings out of ten for the garage's bars. */
export function ratings(car: OwnedCar): { speed: number; acceleration: number; handling: number; braking: number } {
  const s = driveStats(car);
  return {
    speed: Math.min(10, s.top / 5 * 10),
    acceleration: Math.min(10, s.accel / 3 * 10),
    handling: Math.min(10, (s.grip / 14 * 0.6 + s.steer / 3.2 * 0.4) * 10),
    braking: Math.min(10, s.brake / 7 * 10),
  };
}
