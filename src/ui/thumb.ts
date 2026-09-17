import { GRID, T_COM, T_IND, T_RES, idx } from '../constants';
import { KIND_AVENUE } from '../roads/network';
import type { Scenario } from '../scenarios/defs';
import type { Site } from '../scenarios/build';

const GRASS = '#8cbf68';
const WATER = '#3d86c6';
const ASPHALT = '#4c4d55';
const CASING = '#6b6d78';
const ZONE: Record<number, string> = { [T_RES]: '#62c46a', [T_COM]: '#4f8fe8', [T_IND]: '#e6b93a' };

/** The tiles and streets a level occupies, padded, at the card's aspect ratio. */
function bounds(site: Site, aspect: number): { x: number; z: number; w: number; h: number } {
  let x0 = GRID, x1 = 0, z0 = GRID, z1 = 0;
  const see = (x: number, z: number): void => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  };
  for (let i = 0; i < GRID * GRID; i++) if (site.kind[i]) see(i % GRID, (i / GRID) | 0);
  for (const s of site.net.segs.values()) {
    for (let i = 0; i <= s.n; i++) see(s.pts[i * 2], s.pts[i * 2 + 1]);
  }
  if (x1 < x0) return { x: 0, z: 0, w: GRID, h: GRID / aspect };
  x0 -= 4; x1 += 4; z0 -= 4; z1 += 4;
  let w = x1 - x0, h = z1 - z0;
  // Grow the short side rather than squashing the long one, so nothing is cut off.
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x: (x0 + x1) / 2 - w / 2, z: (z0 + z1) / 2 - h / 2, w, h };
}

/**
 * A small plan view of a level for its card: the river, the districts as coloured tiles, and the
 * streets as they are laid out at the whistle. Drawn from the level's own `build()`, so a card can
 * never show a city the level does not open with.
 */
export function drawThumb(def: Scenario, cssW: number, cssH: number): HTMLCanvasElement {
  const site = def.build();
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(dpr, dpr);

  const b = bounds(site, cssW / cssH);
  const k = cssW / b.w;
  const px = (x: number): number => (x - b.x) * k;
  const pz = (z: number): number => (z - b.z) * k;

  g.fillStyle = GRASS;
  g.fillRect(0, 0, cssW, cssH);

  const x0 = Math.max(0, Math.floor(b.x)), x1 = Math.min(GRID - 1, Math.ceil(b.x + b.w));
  const z0 = Math.max(0, Math.floor(b.z)), z1 = Math.min(GRID - 1, Math.ceil(b.z + b.h));
  // Water is continuous, so its tiles meet; buildings are separate things, so theirs do not.
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, z);
      if (site.terrain.water[i]) {
        g.fillStyle = WATER;
        g.fillRect(px(x), pz(z), k + 0.7, k + 0.7);
      } else if (ZONE[site.kind[i]]) {
        g.fillStyle = ZONE[site.kind[i]];
        g.fillRect(px(x) + 0.35, pz(z) + 0.35, Math.max(1, k - 0.7), Math.max(1, k - 0.7));
      }
    }
  }

  // Streets twice over: a pale casing under the asphalt, the way the road mesh reads from above.
  for (const pass of [0, 1]) {
    g.strokeStyle = pass ? ASPHALT : CASING;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of site.net.segs.values()) {
      const wide = s.kind === KIND_AVENUE || s.fixed;
      g.lineWidth = (wide ? 3.2 : 2.1) * (k / 3.2) + (pass ? 0 : 1.4);
      g.beginPath();
      g.moveTo(px(s.pts[0]), pz(s.pts[1]));
      for (let i = 1; i <= s.n; i++) g.lineTo(px(s.pts[i * 2]), pz(s.pts[i * 2 + 1]));
      g.stroke();
    }
  }

  // Where the outside world arrives, since every level is read from the highway inwards.
  const e = site.terrain.entry;
  g.fillStyle = '#ffd166';
  g.beginPath();
  g.arc(px(e.x), pz(e.z), 3.5, 0, Math.PI * 2);
  g.fill();
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();

/** The same card art every time it is asked for: building a site is not free. */
export function thumbOf(def: Scenario, w: number, h: number): HTMLCanvasElement {
  const key = `${def.id}@${w}x${h}`;
  let art = cache.get(key);
  if (!art) {
    art = drawThumb(def, w, h);
    cache.set(key, art);
  }
  // A canvas does not clone its pixels, so copy them into the one the card will own.
  const c = document.createElement('canvas');
  c.width = art.width;
  c.height = art.height;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  c.getContext('2d')?.drawImage(art, 0, 0);
  return c;
}
