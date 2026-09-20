import { GRID, T_BUS, T_STATION, T_AIRPORT, T_SUBWAY, SERVICES } from '../constants';
export type TransitMode = 'bus' | 'rail' | 'subway';
export interface TransitLine { a: number; b: number; mode: TransitMode; capacity: number }
const STOP: Record<TransitMode, number> = { bus: T_BUS, rail: T_STATION, subway: T_SUBWAY };
export interface TransitNetwork { lines: TransitLine[]; airports: number[]; intercity: number[] }

/** A railway line the player drew: between two stations, or from one station out of town. */
export interface RailLine { a: number; b: number }
/** The far end of a line that leaves the map instead of stopping at a second station. */
export const OUT_OF_TOWN = -1;

/**
 * Buses and metros find their own connections between neighbouring stops. Railways do not: the
 * player draws each line from one station to another, or out of town, and only those run.
 */
export function transitNetwork(kind: Uint8Array, operational: (i: number) => boolean, routeExists: (a: number, b: number) => boolean, railLines: readonly RailLine[] = []): TransitNetwork {
  const bus: number[] = [], subway: number[] = [], airports: number[] = [], intercity: number[] = [], lines: TransitLine[] = [];
  for (let i = 0; i < kind.length; i++) {
    if (![T_BUS, T_SUBWAY, T_AIRPORT].includes(kind[i]) || !operational(i)) continue;
    if (kind[i] === T_AIRPORT) airports.push(i);
    else (kind[i] === T_BUS ? bus : subway).push(i);
  }
  const railCapacity = SERVICES[T_STATION].capacity!;
  for (const line of railLines) {
    if (kind[line.a] !== T_STATION || !operational(line.a)) continue;
    if (line.b === OUT_OF_TOWN) { if (!intercity.includes(line.a)) intercity.push(line.a); continue; }
    if (kind[line.b] !== T_STATION || !operational(line.b)) continue;
    if (!routeExists(line.a, line.b) || !routeExists(line.b, line.a)) continue;
    if (lines.some(l => l.mode === 'rail' && ((l.a === line.a && l.b === line.b) || (l.a === line.b && l.b === line.a)))) continue;
    lines.push({ a: line.a, b: line.b, mode: 'rail', capacity: railCapacity });
  }
  for (const stops of [bus, subway]) for (let n = 1; n < stops.length; n++) {
    const b = stops[n], mode: TransitMode = kind[b] === T_BUS ? 'bus' : kind[b] === T_SUBWAY ? 'subway' : 'rail';
    const candidates = stops.slice(0, n).sort((a, c) => distance(a, b) - distance(c, b));
    const a = candidates.find(a => routeExists(a, b) && routeExists(b, a));
    if (a !== undefined) lines.push({ a, b, mode, capacity: SERVICES[STOP[mode]].capacity! });
  }
  return { lines, airports, intercity };
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
