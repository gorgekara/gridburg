import { GRID, T_BUS, T_STATION, T_AIRPORT, T_SUBWAY, SERVICES } from '../constants';
export type TransitMode = 'bus' | 'rail' | 'subway';
export interface TransitLine { a: number; b: number; mode: TransitMode; capacity: number }
const STOP: Record<TransitMode, number> = { bus: T_BUS, rail: T_STATION, subway: T_SUBWAY };
export interface TransitNetwork { lines: TransitLine[]; airports: number[] }

/** Stops join the previous reachable stop; rail uses automatic elevated connections. */
export function transitNetwork(kind: Uint8Array, operational: (i: number) => boolean, routeExists: (a: number, b: number) => boolean): TransitNetwork {
  const bus: number[] = [], rail: number[] = [], subway: number[] = [], airports: number[] = [], lines: TransitLine[] = [];
  for (let i = 0; i < kind.length; i++) {
    if (![T_BUS, T_STATION, T_SUBWAY, T_AIRPORT].includes(kind[i]) || !operational(i)) continue;
    if (kind[i] === T_AIRPORT) airports.push(i);
    else (kind[i] === T_BUS ? bus : kind[i] === T_SUBWAY ? subway : rail).push(i);
  }
  for (const stops of [bus, rail, subway]) for (let n = 1; n < stops.length; n++) {
    const b = stops[n], mode: TransitMode = kind[b] === T_BUS ? 'bus' : kind[b] === T_SUBWAY ? 'subway' : 'rail';
    const candidates = stops.slice(0, n).sort((a, c) => distance(a, b) - distance(c, b));
    const a = candidates.find(a => routeExists(a, b) && routeExists(b, a));
    if (a !== undefined) lines.push({ a, b, mode, capacity: SERVICES[STOP[mode]].capacity! });
  }
  return { lines, airports };
}
export const distance = (a: number, b: number): number => Math.hypot(a % GRID - b % GRID, Math.floor(a / GRID) - Math.floor(b / GRID));

/** Find a direct line whose two catchments cover opposite ends of the trip. */
export function transitLineForTrip(net: TransitNetwork, origin: number, destination: number): number {
  let best = -1, bestWalk = Infinity;
  net.lines.forEach((line, i) => {
    const radius = SERVICES[STOP[line.mode]].radius!;
    for (const [a, b] of [[line.a, line.b], [line.b, line.a]]) {
      const from = distance(origin, a), to = distance(destination, b);
      if (from <= radius && to <= radius && from + to < bestWalk && distance(origin, destination) > 4) { best = i; bestWalk = from + to; }
    }
  });
  return best;
}
