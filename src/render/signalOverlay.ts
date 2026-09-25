import * as THREE from 'three';
import { GRID } from '../constants';
import { Network } from '../roads/network';
import type { Pose } from '../roads/network';
import { approachLanes, laneCentre, roadHalf } from '../roads/lanes';
import { movements } from '../roads/signals';
import type { SignalPlan } from '../roads/signals';
import { MeshBuilder } from './meshBuilder';

const GREEN = 0x3ddc84, YIELD = 0xffc53d, RED = 0x8a2b2b;
const pose: Pose = { x: 0, z: 0, tx: 0, tz: 0 };

/**
 * The signal editor's view of a junction: every movement drawn as a curved arrow from the stop line
 * of the lane it uses, through the junction and into the lane it ends in, coloured by what the
 * selected phase shows it — green, amber for giving way, dim red for stop. The sampled paths are kept
 * so a click can find the arrow under it.
 */
export class SignalOverlay {
  readonly mesh: THREE.Mesh;
  private paths: { key: string; pts: { x: number; z: number }[] }[] = [];

  constructor() {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  show(net: Network, node: number, plan: SignalPlan, phase: number): void {
    const half = GRID / 2, b = new MeshBuilder();
    const n = net.nodes.get(node);
    this.paths = [];
    if (!n) { this.hide(); return; }
    const moves = plan.phases[phase]?.moves ?? {};
    const setback = Math.max(0.85, Math.max(...net.segsAt(node).map(roadHalf)) + 0.45);
    for (const m of movements(net, node)) {
      const inSeg = net.segs.get(m.inSeg)!, outSeg = net.segs.get(m.outSeg)!;
      const a = approachLanes(net, node, inSeg, m.inFwd);
      const exit = a.exits.findIndex(e => e.seg === m.outSeg && e.fwd === m.outFwd);
      // Draw it from the first lane that makes this turn, into the lane it lands in.
      const lane = Math.max(0, a.serve.findIndex(list => list.includes(exit)));
      const outLane = a.targets(lane, exit)[0] ?? 0;
      const at = (s: typeof inSeg, fwd: boolean, d: number, off: number, leaving: boolean): { x: number; z: number; tx: number; tz: number } => {
        const dist = Math.min(s.len * 0.45, d);
        Network.poseAt(s, leaving ? (fwd ? dist : s.len - dist) : (fwd ? s.len - dist : dist), pose);
        const tx = fwd ? pose.tx : -pose.tx, tz = fwd ? pose.tz : -pose.tz;
        return { x: pose.x - tz * off, z: pose.z + tx * off, tx, tz };
      };
      const start = at(inSeg, m.inFwd, setback, laneCentre(net, inSeg, m.inFwd, lane), false);
      const end = at(outSeg, m.outFwd, setback, laneCentre(net, outSeg, m.outFwd, outLane), true);
      // Bend about where the two lanes would meet, or through the junction when they do not.
      const cross = start.tx * end.tz - start.tz * end.tx, gx = end.x - start.x, gz = end.z - start.z;
      const s0 = Math.abs(cross) > 0.2 ? (gx * end.tz - gz * end.tx) / cross : -1;
      const ctrl = s0 > 0.05 ? { x: start.x + start.tx * s0, z: start.z + start.tz * s0 } : { x: n.x, z: n.z };
      const pts: { x: number; z: number }[] = [];
      for (let k = 0; k <= 14; k++) {
        const t = k / 14, u = 1 - t;
        pts.push({ x: u * u * start.x + 2 * u * t * ctrl.x + t * t * end.x, z: u * u * start.z + 2 * u * t * ctrl.z + t * t * end.z });
      }
      this.paths.push({ key: m.key, pts });
      const state = moves[m.key];
      const color = state === 1 ? GREEN : state === 2 ? YIELD : RED;
      const flat: number[] = [];
      for (const p of pts) flat.push(p.x - half, p.z - half);
      b.ribbon(flat, pts.length, state ? 0.05 : 0.03, 0.2, color);
      const last = pts[pts.length - 1], prev = pts[pts.length - 3];
      const dl = Math.hypot(last.x - prev.x, last.z - prev.z) || 1;
      b.arrow(last.x - half, last.z - half, (last.x - prev.x) / dl, (last.z - prev.z) / dl, state ? 0.16 : 0.11, 0.201, color);
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = b.build();
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
    this.paths = [];
  }

  /** The movement whose arrow passes nearest (x, z), in map coordinates, if any is close enough. */
  pick(x: number, z: number): string | null {
    let best: string | null = null, bd = 0.35;
    // Movements from one lane share their first stretch and movements into one lane their last, so
    // only the middle of each arrow, where they are apart, counts.
    for (const p of this.paths) for (const q of p.pts.slice(3, 12)) {
      const d = Math.hypot(q.x - x, q.z - z);
      if (d < bd) { bd = d; best = p.key; }
    }
    return best;
  }
}
