import { GRID } from '../constants';
import { Network, KIND_AVENUE } from './network';
import type { Terrain } from '../terrain';
import { rasterize } from './raster';
import { siteOwners } from '../sites';

export function entrySite(x: number, z: number): { x: number; z: number; dx: number; dz: number } {
  const side = [x, GRID - x, z, GRID - z].indexOf(Math.min(x, GRID - x, z, GRID - z));
  const along = (v: number): number => Math.max(4.5, Math.min(GRID - 4.5, Math.floor(v) + 0.5));
  return side === 0 ? { x: 0.5, z: along(z), dx: 1, dz: 0 } : side === 1 ? { x: GRID - 0.5, z: along(z), dx: -1, dz: 0 } : side === 2 ? { x: along(x), z: 0.5, dx: 0, dz: 1 } : { x: along(x), z: GRID - 0.5, dx: 0, dz: -1 };
}

/** Validate on a copy so a rejected entrance never alters the player's roads. */
export function entrancePlan(net: Network, terrain: Terrain, kind: Uint8Array, x: number, z: number): Network | string {
  if (Math.min(x, z, GRID - x, GRID - z) > 5) return 'Choose land within 5 cells of the map edge';
  const e = entrySite(x, z);
  if ([...net.nodes.values()].some(n => n.entry && Math.hypot(n.x - e.x, n.z - e.z) < 10)) return 'Too close to an existing city entrance';
  const copy = Network.fromPlain(net.toPlain());
  copy.insertPath([{ x: e.x, z: e.z }, { x: e.x + e.dx * 7, z: e.z + e.dz * 7 }], KIND_AVENUE);
  const node = copy.nearestNode(e.x, e.z, 0.2);
  if (!node) return 'No room for an entrance';
  node.entry = true; node.fixed = true;
  const before = rasterize(net), after = rasterize(copy), owners = siteOwners(kind);
  for (let i = 0; i < kind.length; i++) if (after.cover[i] && !before.cover[i] && (terrain.water[i] || kind[i] || owners[i] >= 0)) return 'The entrance needs a clear, dry seven-cell approach';
  copy.version++;
  return copy;
}
