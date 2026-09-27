// Where a ramp leaves or joins a carriageway that was widened for it (an exit or an entrance lane),
// the shape of the lane's mouth: shared by the road renderer (which paves it) and the structures
// renderer (which, up on a deck, carries it on a slab with a parapet round it).
import { Network, HALF_WIDTH, KIND_RAMP, isCarriageway } from './network';
import type { RSeg } from './network';
import { sideHalf } from './lanes';

/** A ramp and a carriageway either side of it: where a ramp leaves or joins one. */
export function rampJoin(net: Network, node: number): boolean {
  const arms = net.segsAt(node);
  return arms.length === 3 && arms.filter(s => s.kind === KIND_RAMP).length === 1 && arms.filter(s => isCarriageway(s.kind)).length === 2;
}

/** The carriageway that runs on from `node` the way the ramp does: the one the ramp shadows. */
export function pairedRoad(net: Network, ramp: RSeg, node: number): RSeg | null {
  const p = { x: 0, z: 0, tx: 0, tz: 0 }, n = net.nodes.get(node)!;
  Network.poseAt(ramp, ramp.a === node ? Math.min(0.3, ramp.len) : Math.max(0, ramp.len - 0.3), p);
  const rx = p.x - n.x, rz = p.z - n.z;
  let best: RSeg | null = null, bd = 0.5;
  for (const o of net.segsAt(node)) {
    if (o.id === ramp.id || !isCarriageway(o.kind)) continue;
    Network.poseAt(o, o.a === node ? Math.min(0.3, o.len) : Math.max(0, o.len - 0.3), p);
    const ox = p.x - n.x, oz = p.z - n.z, dot = (ox * rx + oz * rz) / ((Math.hypot(ox, oz) * Math.hypot(rx, rz)) || 1);
    if (dot > bd) { bd = dot; best = o; }
  }
  return best;
}

/**
 * The mouth: the widened carriageway's outer edge (`outer`, `W` out from the centre line of `road`,
 * the carriageway the ramp shadows) carried straight on from the node until it meets the ramp's outer
 * edge (`inner`), sampled every 0.1 from the node; world coordinates as x, z pairs. `sgn` is the side
 * of `road` the ramp goes off to, seen heading away from the node. Null where the carriageway was not
 * widened for the ramp.
 */
export function rampMouthShape(net: Network, ramp: RSeg, road: RSeg, node: number): { outer: number[]; inner: number[]; W: number; sgn: number } | null {
  const wide = net.segsAt(node).find(o => o.id !== road.id && o.id !== ramp.id && isCarriageway(o.kind));
  if (!wide || !(wide.addR || wide.addL)) return null;
  const W = Math.max(sideHalf(wide, 1), sideHalf(wide, -1));
  if (W <= HALF_WIDTH[road.kind] + 0.05) return null;
  const p = { x: 0, z: 0, tx: 0, tz: 0 }, n = net.nodes.get(node)!;
  const roadFromA = road.a === node, rampFromA = ramp.a === node;
  Network.poseAt(ramp, rampFromA ? Math.min(1, ramp.len) : Math.max(0, ramp.len - 1), p);
  const rx = p.x - n.x, rz = p.z - n.z;
  const outer: number[] = [], inner: number[] = [];
  let sgn = 1;
  for (let d = 0; d <= Math.min(6, road.len - 0.2, ramp.len - 0.2); d += 0.1) {
    Network.poseAt(road, roadFromA ? d : road.len - d, p);
    let tx = roadFromA ? p.tx : -p.tx, tz = roadFromA ? p.tz : -p.tz;
    sgn = (-tz * rx + tx * rz) > 0 ? 1 : -1;
    const ox = p.x - tz * W * sgn, oz = p.z + tx * W * sgn;
    Network.poseAt(ramp, rampFromA ? d : ramp.len - d, p);
    tx = rampFromA ? p.tx : -p.tx; tz = rampFromA ? p.tz : -p.tz;
    // The ramp's outer edge: away from the carriageway (the ramp heads off the way the carriageway
    // does from the node, so that is the same side of both).
    const qx = p.x - tz * HALF_WIDTH[KIND_RAMP] * sgn, qz = p.z + tx * HALF_WIDTH[KIND_RAMP] * sgn;
    outer.push(ox, oz); inner.push(qx, qz);
    if (Network.nearestOn(road, qx, qz).dist >= W) break;
  }
  return outer.length >= 6 ? { outer, inner, W, sgn } : null;
}

/** Whether (x, z) lies inside a mouth's outline (its outer edge out, and back along the ramp's). */
export function inMouth(shape: { outer: number[]; inner: number[] }, x: number, z: number): boolean {
  const poly = [...shape.outer];
  for (let k = shape.inner.length / 2 - 1; k >= 0; k--) poly.push(shape.inner[k * 2], shape.inner[k * 2 + 1]);
  let inside = false;
  for (let i = 0, j = poly.length / 2 - 1; i < poly.length / 2; j = i++) {
    const xi = poly[i * 2], zi = poly[i * 2 + 1], xj = poly[j * 2], zj = poly[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
