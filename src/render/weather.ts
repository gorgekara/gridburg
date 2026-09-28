import { tileHash } from '../constants';
import { currentDayLength } from './daylight';

/**
 * The weather, read off the city clock. Each city day is clear, overcast, rainy or foggy, by a hash of
 * the day's number, so a day always has the same weather on any machine and a replay looks the same.
 * The day's weather comes in over the hours either side of midnight rather than snapping. Rain falls in
 * showers with dry spells between, fog is thickest at dawn and burns off by noon, and the streets stay
 * wet for a few hours after the rain stops.
 */
export type WeatherKind = 'clear' | 'overcast' | 'rain' | 'fog';

export interface Weather {
  kind: WeatherKind;
  /** 0 to 1: how much of the sky is cloud. */
  cloud: number;
  /** 0 to 1: how hard it is raining now. */
  rain: number;
  /** 0 to 1: how thick the fog is. */
  fog: number;
  /** 0 to 1: how wet the streets are. */
  wet: number;
  /** Where the wind blows towards (radians, 0 = +z) and how hard (0 to 1). */
  windAngle: number;
  wind: number;
}

export const CLEAR: Weather = { kind: 'clear', cloud: 0.1, rain: 0, fog: 0, wet: 0, windAngle: 0.6, wind: 0.3 };

export function kindOfDay(day: number): WeatherKind {
  const h = tileHash(day * 7919 + 13);
  return h < 0.5 ? 'clear' : h < 0.72 ? 'overcast' : h < 0.9 ? 'rain' : 'fog';
}

const CLOUD: Record<WeatherKind, number> = { clear: 0.1, overcast: 0.85, rain: 0.95, fog: 0.6 };
const RAIN: Record<WeatherKind, number> = { clear: 0, overcast: 0, rain: 1, fog: 0 };
const FOG: Record<WeatherKind, number> = { clear: 0, overcast: 0.1, rain: 0.25, fog: 1 };

/** How strongly a day's fog shows at an hour: thick at dawn, burnt off by the afternoon. */
function dawn(hour: number): number {
  if (hour < 3) return 0.7;
  if (hour < 5) return 0.7 + (hour - 3) * 0.15;
  if (hour < 9) return 1;
  if (hour < 13) return 1 - (hour - 9) * 0.175;
  if (hour < 19) return 0.3;
  return 0.3 + (hour - 19) * 0.08;
}

/** The absolute hour on the city clock (hours since the first midnight). */
function hoursAt(seconds: number, dayLength: number): number {
  return 9 + seconds * 24 / dayLength;
}

/** The day's own settings, blended across midnight. */
function blend(abs: number): { cloud: number; rain: number; fog: number; kind: WeatherKind } {
  const day = Math.floor(abs / 24), hour = abs - day * 24;
  let a = day, b = day, t = 0;
  if (hour > 22) { b = day + 1; t = (hour - 22) / 4; }
  else if (hour < 2) { a = day - 1; t = (hour + 2) / 4; }
  const ka = kindOfDay(a), kb = kindOfDay(b), s = t * t * (3 - 2 * t);
  const mix = (m: Record<WeatherKind, number>): number => m[ka] + (m[kb] - m[ka]) * s;
  return { cloud: mix(CLOUD), rain: mix(RAIN), fog: mix(FOG), kind: s < 0.5 ? ka : kb };
}

/** How hard it rains at an absolute hour: showers on a rainy day. */
function rainAt(abs: number): number {
  const base = blend(abs).rain;
  if (!base) return 0;
  const day = Math.floor(abs / 24);
  const shower = Math.sin(abs * 0.9 + day * 2.3) * 0.7 + Math.sin(abs * 0.37 + day) * 0.35 + 0.35;
  return Math.max(0, Math.min(1, shower)) * base;
}

export function weatherAt(seconds: number, dayLength = currentDayLength()): Weather {
  const abs = hoursAt(seconds, dayLength), day = Math.floor(abs / 24), hour = abs - day * 24;
  const b = blend(abs);
  const rain = rainAt(abs);
  // Wet: the rain of the last three hours, fading the longer ago it fell.
  let wet = 0;
  for (let k = 0; k <= 12; k++) wet = Math.max(wet, rainAt(abs - k * 0.25) * (1 - k / 13));
  // A fog day's fog, and on any day a little morning mist round dawn.
  const mist = Math.max(0, 1 - Math.abs(hour - 6) / 3.5) * 0.12;
  const fog = Math.min(1, b.fog * dawn(hour) + mist);
  const windAngle = abs * 0.07 + Math.sin(abs * 0.05) * 0.8;
  const wind = Math.min(1, 0.25 + b.cloud * 0.35 + rain * 0.4);
  return { kind: b.kind, cloud: b.cloud, rain, fog, wet: Math.min(1, wet * 1.2), windAngle, wind };
}
