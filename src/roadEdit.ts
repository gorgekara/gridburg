import { N_TILES, ROAD_COST, isService, isZone } from './constants';
import { Network, measurePath, isOneWayKind } from './roads/network';
import type { PlainNet, RSeg } from './roads/network';
import { STRUCTURE_COST, structurePlan, approachProblem } from './roads/structures';
import { rasterize } from './roads/raster';
import type { Game } from './game';

/** What a road edit tool does to the network. */
export type EditOp =
  | { type: 'move'; node: number; x: number; z: number }
  /** Pull a road so its middle passes through (x, z). */
  | { type: 'bend'; seg: number; x: number; z: number }
  | { type: 'cut'; seg: number; s0: number; s1: number }
  | { type: 'kind'; seg: number; s0: number; s1: number; kind: number };

/**
 * An edit worked out on a scratch copy of the network, ready to preview or commit: the roads it
 * made or changed, what it costs, why it cannot be built (if it cannot), and how many buildings it
 * would pave over.
 */
export interface EditPlan { net: Network; ids: number[]; cost: number; problem: string | null; lost: number }

export type EditHost = Pick<Game, 'net' | 'terrain' | 'kind' | 'level' | 'raster' | 'hillMask' | 'canAfford' | 'spend' | 'flush'>;

const segCost = (s: RSeg): number => s.len * ROAD_COST[s.kind] * STRUCTURE_COST[s.structure ?? 0];

/** Why a node cannot be dragged, or null when it can. */
export function moveBlocked(net: Network, id: number): string | null {
  const n = net.nodes.get(id);
  if (!n) return 'Nothing to move here';
  if (n.ring) return 'Roundabout nodes stay on the ring: move the roads that meet it';
  if (n.fixed || n.entry || net.segsAt(id).some((s) => !net.editable(s))) return "The map's own motorway cannot be moved";
  return null;
}

/** Work out an edit on a copy of the network. `plain` lets a drag reuse one snapshot. */
export function planEdit(game: EditHost, op: EditOp, plain: PlainNet = game.net.toPlain()): EditPlan {
  const before = game.net;
  const net = Network.fromPlain(plain);
  let ids: number[] | null = null;
  let cost = 0;
  let problem: string | null = null;
  if (op.type === 'move' || op.type === 'bend') {
    const old = op.type === 'move' ? before.segsAt(op.node) : [before.segs.get(op.seg)].filter((s): s is RSeg => !!s);
    if (op.type === 'move') {
      problem = moveBlocked(before, op.node);
      if (!problem) ids = net.moveNode(op.node, op.x, op.z);
    } else {
      const s = net.segs.get(op.seg);
      if (!s || !net.editable(s)) problem = 'This road cannot be reshaped';
      else {
        const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
        // A quadratic passes through the average of its ends and its control point at its middle.
        ids = net.bendSeg(op.seg, 2 * op.x - (a.x + b.x) / 2, 2 * op.z - (a.z + b.z) / 2);
      }
    }
    if (!problem && !ids) problem = 'That would fold the road onto another one';
    if (ids) {
      const added = ids.map((id) => net.segs.get(id)).filter((s): s is RSeg => !!s);
      cost = Math.max(0, Math.round(added.reduce((t, s) => t + segCost(s), 0) - old.reduce((t, s) => t + segCost(s), 0)));
      problem = problem ?? shapeProblem(game, net, added);
    }
  } else if (op.type === 'cut') {
    const s = before.segs.get(op.seg);
    if (!s || !before.editable(s)) problem = "The map's own motorway cannot be cut";
    else if (!net.cutRange(op.seg, op.s0, op.s1)) problem = s.structure ? 'Bridges and tunnels come out whole: click to remove the span' : 'Drag further along the road to cut it';
    ids = [];
  } else {
    const s = before.segs.get(op.seg);
    ids = s && before.editable(s) ? net.setKindRange(op.seg, op.s0, op.s1, op.kind) : null;
    if (!ids) problem = isOneWayKind(op.kind) ? 'One-way highways replace whole roads: click instead of dragging' : 'This road cannot be changed';
    else if (s) {
      const seg = net.segs.get(ids[0])!;
      cost = Math.max(0, Math.round((ROAD_COST[op.kind] - ROAD_COST[s.kind]) * seg.len * STRUCTURE_COST[seg.structure ?? 0]));
    }
  }
  if (!problem && !game.canAfford(cost)) problem = 'Not enough money';
  return { net, ids: ids ?? [], cost, problem, lost: problem ? 0 : paved(game, net) };
}

/** Put a planned edit into the city as one undoable change. */
export function commitEdit(game: EditHost, plan: EditPlan): boolean {
  if (plan.problem) return false;
  plan.net.version = game.net.version + 1;
  game.net = plan.net;
  game.spend(plan.cost);
  game.flush();
  return true;
}

/** Roads have to stay off hills and out of the river, and spans still have to make sense. */
function shapeProblem(game: EditHost, net: Network, segs: RSeg[]): string | null {
  for (const s of segs) {
    const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
    const path = [{ x: a.x, z: a.z }, { x: s.cx, z: s.cz }, { x: b.x, z: b.z }];
    if (s.structure) {
      const rest = Network.fromPlain(net.toPlain());
      rest.removeSeg(s.id);
      const plan = structurePlan(rest, game.terrain, game.kind, path, s.kind, s.structure);
      if (typeof plan === 'string') return plan;
      continue;
    }
    if (measurePath(path, game.hillMask).wet > 0) return 'Roads cannot climb raised ground: lower it first';
    if (measurePath(path, game.terrain.water).wet > 0) return 'Keep the road out of the river, or draw a bridge';
    const clash = approachProblem(net, path);
    if (clash) return clash;
  }
  return null;
}

/** How many standing buildings the edited network would pave over. */
function paved(game: EditHost, net: Network): number {
  const cover = rasterize(net).cover;
  let n = 0;
  for (let i = 0; i < N_TILES; i++) {
    if (!cover[i] || game.raster.cover[i]) continue;
    if ((isZone(game.kind[i]) && game.level[i] > 0) || isService(game.kind[i])) n++;
  }
  return n;
}
