import { roadHeight } from './structures';
import { GRID, N_TILES } from '../constants';
import { ROAD_FRONTAGE, Network } from './network';
import type { RSeg } from './network';
import { buildingRotation, lotScale } from '../placement';
import { laneTapers, edgeAt, roadHalf } from './lanes';

/** tan 10°: a road within this of an axis lays its lots out on the grid, as roads always did. */
const NEAR_AXIS = Math.tan((10 * Math.PI) / 180);

/** How far from the edge of a road a tile can be and still use it: three rows deep, like CS zoning. */
export const ACCESS_DEPTH = 2.7;

export interface Raster {
  /** 1 where a road surface covers the tile, so nothing can be built there. */
  cover: Uint8Array;
  /** Nearest segment id for tiles close enough to a road to use it, else -1. */
  accSeg: Int32Array;
  /** Arc length along that segment of the nearest point. */
  accS: Float32Array;
  /** World position of that nearest point, for orienting buildings. */
  accX: Float32Array;
  accZ: Float32Array;
  /** Visual lot centers close to narrow curbs; logical zoning cells remain stable. */
  lotX: Float32Array;
  lotZ: Float32Array;
  /** Which way the building on each lot faces: squared to the grid beside straight roads, turned to angled ones. */
  face: Float32Array;
  /**
   * Which row back from its road a tile's zone cell is in (0 at the kerb, up to 2), or −1 for a tile
   * with no cell. A cell is a road-aligned square the tile's building stands in at full size.
   */
  cell: Int8Array;
  /** 1 on a tile some other tile's cell stands partly over: its own old lot there would overlap that building. */
  under: Uint8Array;
}

/**
 * What else rasterizing takes into account. `blocked` marks tiles no zone cell may touch (services,
 * water, shore, hills): cells avoid them. `cells: false` skips laying cells, for callers that only
 * need to know which tiles the roads cover.
 */
export interface RasterOptions { blocked?: Uint8Array; cells?: boolean }

/** How many rows of zone cells a road carries on each side. */
export const CELL_ROWS = 3;
const KERB_GAP = 0.09;

/** How much a tile's building shrinks: not at all in a road-aligned cell, enough to fit its tile otherwise. */
export const lotScaleAt = (r: Raster, i: number): number => r.cell[i] >= 0 ? 1 : lotScale(r.face[i]);

/** Project the road network onto the tile grid: which tiles are paved and which can reach a road. */
export function rasterize(net: Network, opts: RasterOptions = {}): Raster {
  const cover = new Uint8Array(N_TILES);
  const accSeg = new Int32Array(N_TILES).fill(-1);
  const accS = new Float32Array(N_TILES);
  const accX = new Float32Array(N_TILES);
  const accZ = new Float32Array(N_TILES);
  const roadWidth = new Float32Array(N_TILES);
  // Direction of the road at each tile's access point, to tell grid frontage from angled.
  const accTx = new Float32Array(N_TILES), accTz = new Float32Array(N_TILES);
  const best = new Float32Array(N_TILES).fill(1e9);

  const tapers = laneTapers(net);
  for (const seg of net.segs.values()) {
    // A road with lanes added on one side is wider there: search out to the wider side.
    const widest = roadHalf(seg);
    // An expressway is a barrier, not an address: it paves its tiles but gives nothing frontage.
    const frontage = ROAD_FRONTAGE[seg.kind] !== false;
    const reach = widest + (frontage ? ACCESS_DEPTH : 0);
    for (let i = 0; i < seg.n; i++) {
      const x0 = seg.pts[i * 2], z0 = seg.pts[i * 2 + 1];
      const x1 = seg.pts[i * 2 + 2], z1 = seg.pts[i * 2 + 3];
      const dx = x1 - x0, dz = z1 - z0;
      const l2 = dx * dx + dz * dz || 1;
      const tx0 = Math.max(0, Math.floor(Math.min(x0, x1) - reach));
      const tx1 = Math.min(GRID - 1, Math.floor(Math.max(x0, x1) + reach));
      const tz0 = Math.max(0, Math.floor(Math.min(z0, z1) - reach));
      const tz1 = Math.min(GRID - 1, Math.floor(Math.max(z0, z1) + reach));
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const px = tx + 0.5, pz = tz + 0.5;
          let u = ((px - x0) * dx + (pz - z0) * dz) / l2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = x0 + dx * u, qz = z0 + dz * u;
          const d = Math.hypot(px - qx, pz - qz);
          const t = tz * GRID + tx;
          const distance = seg.cum[i] + (seg.cum[i + 1] - seg.cum[i]) * u;
          // The edge on the tile's own side of the road, following any taper.
          const side = (px - qx) * -dz + (pz - qz) * dx > 0 ? 1 : -1;
          const hw = edgeAt(seg, side, distance, tapers);
          if (seg.structure === 2 && Math.abs(roadHeight(seg, distance)) > 0.8) continue;
          if (d < hw + 0.42) cover[t] = 1;
          if (seg.structure || !frontage) continue;
          if (d < hw + ACCESS_DEPTH && d < best[t]) {
            best[t] = d;
            accSeg[t] = seg.id;
            accS[t] = seg.cum[i] + (seg.cum[i + 1] - seg.cum[i]) * u;
            accX[t] = qx;
            accZ[t] = qz;
            roadWidth[t] = hw;
            const l = Math.sqrt(l2);
            accTx[t] = dx / l; accTz[t] = dz / l;
          }
        }
      }
    }
  }
  // Nothing can be built on a roundabout's island.
  for (const rb of net.roundabouts()) {
    for (let tz = Math.max(0, Math.floor(rb.z - rb.r)); tz <= Math.min(GRID - 1, Math.floor(rb.z + rb.r)); tz++) {
      for (let tx = Math.max(0, Math.floor(rb.x - rb.r)); tx <= Math.min(GRID - 1, Math.floor(rb.x + rb.r)); tx++) {
        if (Math.hypot(tx + 0.5 - rb.x, tz + 0.5 - rb.z) < rb.r) cover[tz * GRID + tx] = 1;
      }
    }
  }
  const lotX = new Float32Array(N_TILES), lotZ = new Float32Array(N_TILES);
  const onGrid = (i: number): boolean => Math.min(Math.abs(accTx[i]), Math.abs(accTz[i])) <= Math.max(Math.abs(accTx[i]), Math.abs(accTz[i])) * NEAR_AXIS;
  for (let i = 0; i < N_TILES; i++) {
    const x = i % GRID + 0.5, z = Math.floor(i / GRID) + 0.5;
    lotX[i] = x; lotZ[i] = z;
    if (cover[i] || accSeg[i] < 0) continue;
    const dx = accX[i] - x, dz = accZ[i] - z;
    // Beside a road squared to the grid, only lots straight across from it move, so a row keeps its
    // spacing and the corner past a dead end stays put. Beside an angled road every lot moves up
    // along the road's normal. Lots that would then crowd a neighbour are put back below; a building
    // turned to an angled road shrinks to fit its cell, so that axis-aligned test still keeps them apart.
    if (onGrid(i) && Math.abs(dx) > 0.001 && Math.abs(dz) > 0.001) continue;
    const distance = Math.hypot(dx, dz);
    const front = roadWidth[i] + 0.09 + 0.5;
    if (distance < front) continue;
    const offset = Math.min(0.75, Math.max(0, distance - front - Math.floor(distance - front + 0.00001)));
    lotX[i] += dx / distance * offset;
    lotZ[i] += dz / distance * offset;
  }
  // Revert conflicting shifts at junctions, propagating only when a lot moves back.
  // Straight rows retain their shared offset; each lot can be reset at most once.
  const pending = Array.from({ length: N_TILES }, (_, i) => i);
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const i = pending[cursor];
    if (cover[i] || accSeg[i] < 0) continue;
    const x = i % GRID, z = Math.floor(i / GRID);
    for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
      if ((!ox && !oz) || x + ox < 0 || x + ox >= GRID || z + oz < 0 || z + oz >= GRID) continue;
      const j = (z + oz) * GRID + x + ox;
      if (cover[j] || accSeg[j] < 0) continue;
      if (Math.abs(lotX[i] - lotX[j]) >= 0.999 || Math.abs(lotZ[i] - lotZ[j]) >= 0.999) continue;
      for (const t of [i, j]) {
        const tx = t % GRID + 0.5, tz = Math.floor(t / GRID) + 0.5;
        if (lotX[t] === tx && lotZ[t] === tz) continue;
        lotX[t] = tx; lotZ[t] = tz;
        pending.push(t);
      }
    }
  }
  const face = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    if (accSeg[i] < 0) continue;
    const dx = accX[i] - lotX[i], dz = accZ[i] - lotZ[i];
    face[i] = onGrid(i) ? Math.round(Math.atan2(dx, dz) / (Math.PI / 2)) * (Math.PI / 2) : buildingRotation(dx, dz);
  }
  const under = new Uint8Array(N_TILES);
  const cell = opts.cells === false ? new Int8Array(N_TILES).fill(-1) : layCells(net, tapers, cover, accSeg, accS, accX, accZ, lotX, lotZ, face, under, opts.blocked);
  return { cover, accSeg, accS, accX, accZ, lotX, lotZ, face, cell, under };
}

/**
 * Zone cells along the roads, Cities: Skylines-style: on each side of every road with frontage,
 * rows of unit squares parallel to its kerb, as many as fit without touching a road or each other,
 * each matched to one tile. Row 0 is laid everywhere first, so the row at the kerb wins wherever
 * cells compete (at junctions, on the inside of curves). Beside a road squared to the grid the cells
 * land on the tile centres, so grid streets lay out as they always have. A matched tile's lot, facing
 * and road access become its cell's.
 */
function layCells(net: Network, tapers: ReturnType<typeof laneTapers>, cover: Uint8Array, accSeg: Int32Array, accS: Float32Array, accX: Float32Array, accZ: Float32Array, lotX: Float32Array, lotZ: Float32Array, face: Float32Array, under: Uint8Array, blocked?: Uint8Array): Int8Array {
  const cell = new Int8Array(N_TILES).fill(-1);
  const segs = [...net.segs.values()].filter(s => ROAD_FRONTAGE[s.kind] !== false && !s.structure);
  const all = [...net.segs.values()];
  const rings = net.roundabouts();
  const kept: { x: number; z: number; ax: number; az: number }[] = [];
  const buckets = new Map<number, number[]>();
  const bucketOf = (x: number, z: number): number => Math.floor(x) * 97 + Math.floor(z);
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  // Roads by the tiles their surface can reach, so a point is only tested against roads near it.
  const near: RSeg[][] = Array.from({ length: N_TILES }, () => []);
  for (const o of all) {
    // Far enough that a cell centre well clear of every road in its tile's list really is clear.
    const reach = roadHalf(o) + 0.85;
    for (let tz = Math.max(0, Math.floor(o.minZ - reach)); tz <= Math.min(GRID - 1, Math.floor(o.maxZ + reach)); tz++)
      for (let tx = Math.max(0, Math.floor(o.minX - reach)); tx <= Math.min(GRID - 1, Math.floor(o.maxX + reach)); tx++) near[tz * GRID + tx].push(o);
  }
  // A point of a cell may not lie on any road's surface or a roundabout island.
  // How far a point is from the nearest road surface or roundabout island (negative: on it).
  const clearance = (x: number, z: number): number => {
    if (x < 0 || z < 0 || x >= GRID || z >= GRID) return -1;
    let gap = Infinity;
    for (const o of near[Math.floor(z) * GRID + Math.floor(x)]) {
      const hit = Network.nearestOn(o, x, z);
      if (o.structure === 2 && Math.abs(roadHeight(o, hit.s)) > 0.8) continue;
      gap = Math.min(gap, hit.dist - roadHalf(o) - 0.05);
    }
    for (const rb of rings) gap = Math.min(gap, Math.hypot(x - rb.x, z - rb.z) - rb.r);
    return gap;
  };
  const onRoad = (x: number, z: number): boolean => clearance(x, z) < 0;
  // Two unit squares, given their centres and along-road directions, overlap by more than a hair.
  const overlaps = (x: number, z: number, ax: number, az: number): boolean => {
    // Turned squares can overlap with centres up to √2 apart, which may be two buckets away.
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (const k of buckets.get(bucketOf(x + dx, z + dz)) ?? []) {
        const o = kept[k];
        if (Math.hypot(o.x - x, o.z - z) >= 1.42) continue;
        const axes = [[ax, az], [-az, ax], [o.ax, o.az], [-o.az, o.ax]];
        const ox = o.x - x, oz = o.z - z;
        const apart = axes.some(([ux, uz]) => {
          const extent = (vx: number, vz: number): number => 0.5 * (Math.abs(vx * ux + vz * uz) + Math.abs(-vz * ux + vx * uz));
          return Math.abs(ox * ux + oz * uz) >= extent(ax, az) + extent(o.ax, o.az) - 0.02;
        });
        if (!apart) return true;
      }
    }
    return false;
  };
  for (let row = 0; row < CELL_ROWS; row++) {
    for (const seg of segs) {
      const a = net.nodes.get(seg.a)!, b = net.nodes.get(seg.b)!;
      const cx = b.x - a.x, cz = b.z - a.z, chord = Math.hypot(cx, cz) || 1;
      // Squared to the grid: phase the cells so their centres fall on tile centres along the road.
      const alongX = Math.abs(cz) <= Math.abs(cx) * NEAR_AXIS, alongZ = Math.abs(cx) <= Math.abs(cz) * NEAR_AXIS;
      const onGridRoad = (alongX || alongZ) && seg.len < chord * 1.02;
      let s0 = 0.5;
      if (onGridRoad) {
        const start = alongX ? a.x : a.z, sign = Math.sign(alongX ? cx : cz) || 1;
        s0 = ((((0.5 - start) * sign) % 1) + 1) % 1;
      }
      for (const side of [1, -1]) {
        for (let s = s0; s <= seg.len + 1e-6; s += 1) {
          Network.poseAt(seg, s, pose);
          const ox = -pose.tz * side, oz = pose.tx * side; // outwards, away from the road
          const off = edgeAt(seg, side, s, tapers) + KERB_GAP + 0.5 + row;
          const x = pose.x + ox * off, z = pose.z + oz * off;
          const ax = pose.tx, az = pose.tz;
          // A centre well clear of every road leaves no corner on one either.
          const gap = clearance(x, z);
          let clear = gap >= 0;
          for (const [u, v] of [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]]) {
            if (!clear || gap > 0.72) break;
            if (onRoad(x + ax * u + ox * v, z + az * u + oz * v)) clear = false;
          }
          if (!clear) continue;
          // The tiles the square stands over: none may be blocked (a service, water, shore, a hill).
          const feet: number[] = [];
          for (const [u, v] of FOOT_SAMPLES) {
            const px = x + ax * u + ox * v, pz = z + az * u + oz * v;
            const t = Math.floor(pz) * GRID + Math.floor(px);
            if (blocked?.[t]) { clear = false; break; }
            feet.push(t);
          }
          if (!clear || overlaps(x, z, ax, az)) continue;
          // The tile it stands on, or failing that the nearest free one next to it.
          const fx = Math.floor(x), fz = Math.floor(z);
          // On a turned lattice two cells can share a tile and another tile stays free, so a cell
          // may take a free tile a little way off; the simulation's fields are smooth at that scale.
          let tile = -1, best = 1.1;
          for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
            const tx = fx + dx, tz = fz + dz;
            if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) continue;
            const t = tz * GRID + tx;
            if (cover[t] || cell[t] >= 0 || blocked?.[t]) continue;
            const d = dx === 0 && dz === 0 ? -1 : Math.hypot(tx + 0.5 - x, tz + 0.5 - z);
            if (d < best) { best = d; tile = t; }
          }
          if (tile < 0) continue;
          cell[tile] = row;
          lotX[tile] = x; lotZ[tile] = z;
          const yaw = Math.atan2(-ox, -oz);
          face[tile] = onGridRoad ? Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2) : yaw;
          accSeg[tile] = seg.id; accS[tile] = s; accX[tile] = pose.x; accZ[tile] = pose.z;
          for (const t of feet) if (t !== tile) under[t] = 1;
          const k = kept.push({ x, z, ax, az }) - 1;
          const key = bucketOf(x, z);
          const list = buckets.get(key);
          if (list) list.push(k); else buckets.set(key, [k]);
        }
      }
    }
  }
  return cell;
}

/**
 * Whether a point is inside a tile's lot, `half` out from its centre in the lot's own turned frame
 * (scaled with the lot, so a shrunk lot on an angled road is judged by its real size).
 */
export function inLot(r: Raster, i: number, px: number, pz: number, half: number): boolean {
  const dx = px - r.lotX[i], dz = pz - r.lotZ[i], c = Math.cos(r.face[i]), s = Math.sin(r.face[i]);
  const h = half * lotScaleAt(r, i);
  return Math.abs(dx * c - dz * s) < h && Math.abs(dx * s + dz * c) < h;
}

/** Points of a unit cell, in its own frame (along, out), that tell which tiles it stands over. */
const FOOT_SAMPLES = [[0, 0], [0.47, 0.47], [0.47, -0.47], [-0.47, 0.47], [-0.47, -0.47], [0.47, 0], [-0.47, 0], [0, 0.47], [0, -0.47]];

/** Brush radii for painting zone cells, for the three brush sizes. */
export const ZONE_BRUSH = [0.7, 1.6, 2.8];

/**
 * The tiles whose zone cells lie within `radius` of (x, z): what a zone brush there paints. Tiles
 * without a cell are included too where `also` accepts them, judged by their lot.
 */
export function zoneCellsUnder(r: Raster, x: number, z: number, radius: number, also?: (i: number) => boolean): number[] {
  const out: number[] = [];
  const x0 = Math.max(0, Math.floor(x - radius - 1)), x1 = Math.min(GRID - 1, Math.floor(x + radius + 1));
  const z0 = Math.max(0, Math.floor(z - radius - 1)), z1 = Math.min(GRID - 1, Math.floor(z + radius + 1));
  for (let tz = z0; tz <= z1; tz++) for (let tx = x0; tx <= x1; tx++) {
    const i = tz * GRID + tx;
    if ((r.cell[i] >= 0 || also?.(i)) && Math.hypot(r.lotX[i] - x, r.lotZ[i] - z) < radius) out.push(i);
  }
  return out;
}
