import { GRID } from '../constants';
import { Network, KIND_HIGHWAY, KIND_RAMP } from './network';
import type { Terrain } from '../terrain';
import { rasterize } from './raster';
import { siteOwners } from '../sites';

/** How far past the map edge the highway runs, so arriving traffic is already rolling when it appears. */
export const APPROACH = 16;

export function entrySite(x: number, z: number): { x: number; z: number; dx: number; dz: number } {
  const side = [x, GRID - x, z, GRID - z].indexOf(Math.min(x, GRID - x, z, GRID - z));
  const along = (v: number): number => Math.max(4.5, Math.min(GRID - 4.5, Math.floor(v) + 0.5));
  return side === 0 ? { x: 0.5, z: along(z), dx: 1, dz: 0 } : side === 1 ? { x: GRID - 0.5, z: along(z), dx: -1, dz: 0 } : side === 2 ? { x: along(x), z: 0.5, dx: 0, dz: 1 } : { x: along(x), z: GRID - 0.5, dx: 0, dz: -1 };
}

const offMap = (x: number, z: number): boolean => x < 0 || z < 0 || x > GRID || z > GRID;

/** The point on the map edge an entrance passes through, wherever its highway node sits. */
export const entryGate = (node: { x: number; z: number }): { x: number; z: number; dx: number; dz: number } => entrySite(node.x, node.z);

/**
 * Carry every entrance out past the map edge. Traffic from outside the city is created and retired at the
 * far end of that stretch, so cars roll in from off the map instead of appearing on the doorstep, and the
 * queue to leave forms out there rather than across the entrance itself.
 */
export function ensureApproaches(net: Network): void {
  for (const node of [...net.nodes.values()]) {
    if (!node.entry || offMap(node.x, node.z)) continue;
    const e = entrySite(node.x, node.z);
    const outer = net.addNode(node.x - e.dx * APPROACH, node.z - e.dz * APPROACH);
    outer.entry = true;
    outer.fixed = true;
    node.entry = false;
    node.fixed = true;
    // The approach carries on whatever reaches the edge: a two-way expressway, or one carriageway
    // of a motorway running the way its traffic does.
    // The road that reaches the edge, not a slip road that happens to end at the same node.
    const arms = net.segsAt(node.id), seg = arms.find(s => s.kind !== KIND_RAMP) ?? arms[0];
    const kind = seg?.kind ?? KIND_HIGHWAY, oneway = !!seg?.oneway;
    const arriving = !!seg && seg.b === node.id;
    if (oneway && arriving) net.addSeg(node.id, outer.id, (outer.x + node.x) / 2, (outer.z + node.z) / 2, kind, true, true);
    else net.addSeg(outer.id, node.id, (outer.x + node.x) / 2, (outer.z + node.z) / 2, kind, oneway, true);
  }
}

/** Validate on a copy so a rejected entrance never alters the player's roads. */
export function entrancePlan(net: Network, terrain: Terrain, kind: Uint8Array, x: number, z: number): Network | string {
  if (Math.min(x, z, GRID - x, GRID - z) > 5) return 'Choose land within 5 cells of the map edge';
  const e = entrySite(x, z);
  const gates = [...net.nodes.values()].filter(n => n.entry).map(entryGate);
  if (gates.some(g => Math.hypot(g.x - e.x, g.z - e.z) < 10)) return 'Too close to an existing city entrance';
  const copy = Network.fromPlain(net.toPlain());
  copy.insertPath([{ x: e.x, z: e.z }, { x: e.x + e.dx * 7, z: e.z + e.dz * 7 }], KIND_HIGHWAY);
  const node = copy.nearestNode(e.x, e.z, 0.2);
  if (!node) return 'No room for an entrance';
  node.entry = true; node.fixed = true;
  ensureApproaches(copy);
  const before = rasterize(net), after = rasterize(copy), owners = siteOwners(kind);
  for (let i = 0; i < kind.length; i++) if (after.cover[i] && !before.cover[i] && (terrain.water[i] || kind[i] || owners[i] >= 0)) return 'The entrance needs a clear, dry seven-cell approach';
  copy.version++;
  return copy;
}
