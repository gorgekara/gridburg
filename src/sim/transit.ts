import { Network } from '../roads/network';
import { laneCentre, sideHalf } from '../roads/lanes';
import type { RSeg } from '../roads/network';
import { GRID, T_BUS, T_STATION, T_AIRPORT, T_SUBWAY, T_TROLLEY, T_TAXI, SERVICES } from '../constants';
export type TransitMode = 'bus' | 'trolley' | 'rail' | 'subway';
export interface TransitLine { a: number; b: number; mode: TransitMode; capacity: number }
const STOP: Record<TransitMode, number> = { bus: T_BUS, trolley: T_TROLLEY, rail: T_STATION, subway: T_SUBWAY };
export interface TransitNetwork { lines: TransitLine[]; airports: number[]; intercity: number[] }

/** How far from a city entrance a station can be and still run a service out of town. */
export const INTERCITY_RANGE = 30;

/**
 * Stops join the previous reachable stop; rail uses automatic elevated connections. A station near a
 * city entrance also runs a service out of town, carrying people who would otherwise drive in and out.
 */
export function transitNetwork(kind: Uint8Array, operational: (i: number) => boolean, routeExists: (a: number, b: number) => boolean, gates: readonly { x: number; z: number }[] = []): TransitNetwork {
  const bus: number[] = [], trolley: number[] = [], rail: number[] = [], subway: number[] = [], airports: number[] = [], lines: TransitLine[] = [];
  for (let i = 0; i < kind.length; i++) {
    if (![T_BUS, T_TROLLEY, T_STATION, T_SUBWAY, T_AIRPORT].includes(kind[i]) || !operational(i)) continue;
    if (kind[i] === T_AIRPORT) airports.push(i);
    else (kind[i] === T_BUS ? bus : kind[i] === T_TROLLEY ? trolley : kind[i] === T_SUBWAY ? subway : rail).push(i);
  }
  const intercity = intercityStations(gates, rail);
  for (const stops of [bus, trolley, rail, subway]) for (let n = 1; n < stops.length; n++) {
    const b = stops[n], mode: TransitMode = kind[b] === T_BUS ? 'bus' : kind[b] === T_TROLLEY ? 'trolley' : kind[b] === T_SUBWAY ? 'subway' : 'rail';
    const candidates = stops.slice(0, n).sort((a, c) => distance(a, b) - distance(c, b));
    const a = candidates.find(a => routeExists(a, b) && routeExists(b, a));
    if (a !== undefined) lines.push({ a, b, mode, capacity: SERVICES[STOP[mode]].capacity! });
  }
  return { lines, airports, intercity };
}
/** Each highway entrance hands its nearest working station a line out of town. */
export function intercityStations(gates: readonly { x: number; z: number }[], stations: readonly number[]): number[] {
  const [fw, fd] = SERVICES[T_STATION].footprint ?? [1, 1];
  const out: number[] = [];
  for (const gate of gates) {
    let best = -1, bestDistance = INTERCITY_RANGE;
    for (const station of stations) {
      const d = Math.hypot(station % GRID + fw / 2 - gate.x, Math.floor(station / GRID) + fd / 2 - gate.z);
      if (d < bestDistance) { bestDistance = d; best = station; }
    }
    if (best >= 0 && !out.includes(best)) out.push(best);
  }
  return out;
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


export interface TrolleyLeg { seg: number; fwd: boolean; p0: number; p1: number }

/** Fixed wired routes share exactly the same directed road legs in simulation and rendering. */
export function trolleyRoute(net: Network, startId: number, startS: number, endId: number, endS: number): TrolleyLeg[] | null {
  const start = net.segs.get(startId), end = net.segs.get(endId);
  const allowed = (s: RSeg): boolean => !s.structure && (s.kind === 0 || s.kind === 1) && !net.nodes.get(s.a)?.ring && !net.nodes.get(s.b)?.ring;
  if (!start || !end || !allowed(start) || !allowed(end)) return null;
  if (startId === endId) {
    if (endS >= startS) return [{ seg: startId, fwd: true, p0: startS, p1: endS }];
    if (!start.oneway) return [{ seg: startId, fwd: false, p0: start.len - startS, p1: start.len - endS }];
  }
  const dist = new Map<number, number>(), prev = new Map<number, { from: number; leg: TrolleyLeg }>(), done = new Set<number>();
  const relax = (node: number, value: number, from: number, leg: TrolleyLeg): void => {
    if (value >= (dist.get(node) ?? Infinity)) return;
    dist.set(node, value); prev.set(node, { from, leg });
  };
  relax(start.b, start.len - startS, -1, { seg: startId, fwd: true, p0: startS, p1: start.len });
  if (!start.oneway) relax(start.a, startS, -1, { seg: startId, fwd: false, p0: start.len - startS, p1: start.len });
  const goal = -2;
  for (;;) {
    let node = -1, best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; node = id; }
    if (node === -1) return null;
    if (node === goal) {
      const legs: TrolleyLeg[] = [];
      while (node !== -1) { const p = prev.get(node)!; legs.unshift(p.leg); node = p.from; }
      return legs.filter(leg => leg.p1 - leg.p0 > 0.001);
    }
    done.add(node);
    if (node === end.a) relax(goal, best + endS, node, { seg: endId, fwd: true, p0: 0, p1: endS });
    if (node === end.b && !end.oneway) relax(goal, best + end.len - endS, node, { seg: endId, fwd: false, p0: 0, p1: end.len - endS });
    for (const s of net.segsAt(node)) {
      if (!allowed(s) || (s.oneway && s.b === node)) continue;
      const fwd = s.a === node;
      relax(fwd ? s.b : s.a, best + s.len, node, { seg: s.id, fwd, p0: 0, p1: s.len });
    }
  }
}

/** Trolleys keep to the kerb lane, wherever lanes have put it, so their poles follow the contact wires. */
export const trolleyLaneOffset = (net: Network, seg: RSeg, fwd: boolean): number => laneCentre(net, seg, fwd, 0);
export function trolleyPath(net: Network, startId: number, startS: number, endId: number, endS: number): { x: number; z: number; poleOffset: number }[] {
  const legs = trolleyRoute(net, startId, startS, endId, endS);
  const out: { x: number; z: number; poleOffset: number }[] = [], pose = { x: 0, z: 0, tx: 0, tz: 0 };
  for (const leg of legs ?? []) {
    const seg = net.segs.get(leg.seg)!, count = Math.max(1, Math.ceil((leg.p1 - leg.p0) / 0.25));
    const lane = trolleyLaneOffset(net, seg, leg.fwd), offset = lane * (leg.fwd ? 1 : -1);
    for (let i = 0; i <= count; i++) {
      const p = leg.p0 + (leg.p1 - leg.p0) * i / count;
      Network.poseAt(seg, leg.fwd ? p : seg.len - p, pose);
      out.push({ x: pose.x - pose.tz * offset, z: pose.z + pose.tx * offset, poleOffset: sideHalf(seg, leg.fwd ? 1 : -1) + 0.39 - lane });
    }
  }
  return out;
}

/** Passengers walk to the nearest available stand, then take a cab directly to their destination.
 * A stand works alone; it is deliberately not a fixed public-transit line. */
export function taxiStopForTrip(stops: readonly number[], origin: number, destination: number, available: (stop: number) => boolean): number {
  if (distance(origin, destination) <= 4) return -1;
  let best = -1, walk = SERVICES[T_TAXI].radius! + 0.001;
  for (const stop of stops) {
    const d = distance(origin, stop);
    if (d < walk && available(stop)) { best = stop; walk = d; }
  }
  return best;
}
