import { HALF_WIDTH, KIND_HIGHWAY, Network } from '../roads/network';
import type { Pose, RSeg } from '../roads/network';

/** Distance from each junction to its zebra crossing, indexed by segment and endpoint. */
export function crossingApproaches(net: Network): Map<number, [number, number]> {
  const result = new Map<number, [number, number]>();
  const p: Pose = { x: 0, z: 0, tx: 0, tz: 0 };
  const direction = (seg: RSeg, node: number): [number, number] => {
    Network.poseAt(seg, seg.a === node ? 0 : seg.len, p);
    const sign = seg.a === node ? 1 : -1;
    return [p.tx * sign, p.tz * sign];
  };
  for (const node of net.nodes.values()) {
    const arms = net.segsAt(node.id);
    if (node.ring || node.entry || arms.length < 3 || arms.some(s => s.structure || s.kind === KIND_HIGHWAY)) continue;
    for (const seg of arms) {
      const [tx, tz] = direction(seg, node.id), hw = HALF_WIDTH[seg.kind];
      let reach = Math.max(...arms.map(s => HALF_WIDTH[s.kind])) + 0.24;
      let safe = true;
      for (const other of arms) {
        if (other === seg) continue;
        const [ox, oz] = direction(other, node.id);
        const dot = tx * ox + tz * oz, cross = Math.abs(tx * oz - tz * ox);
        if (dot < -0.98) continue; // opposing approach does not widen this side of the junction
        if (cross < 0.18) { safe = false; break; } // near-parallel merging arms have no clear crossing
        reach = Math.max(reach, (HALF_WIDTH[other.kind] + hw * Math.abs(dot)) / cross + 0.24);
      }
      // Leave a central gap even when crossings occur at both ends of a short block.
      if (!safe || reach + 0.22 > seg.len * 0.45) continue;
      const ends = result.get(seg.id) ?? [0, 0];
      ends[seg.a === node.id ? 0 : 1] = reach;
      result.set(seg.id, ends);
    }
  }
  return result;
}
