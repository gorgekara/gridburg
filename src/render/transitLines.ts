import * as THREE from 'three';
import { GRID, SERVICES, T_BUS, T_STATION, T_TROLLEY } from '../constants';
import { transitNetwork, trolleyPath } from '../sim/transit';
import type { TransitMode } from '../sim/transit';
import type { Raster } from '../roads/raster';
import { intercityTrack, railPath } from '../roads/rail';
import type { Network } from '../roads/network';
import { transportSignature } from './transport';
import { MeshBuilder } from './meshBuilder';

const LINE_COLORS = [0x2e6fd8, 0xd8452e, 0x2ea86a, 0xe0a52a, 0x8a4fd0, 0x2aa8c4];

interface Run { loop: boolean; px: Float32Array; pz: Float32Array; cum: Float32Array; marker: THREE.Mesh; phase: number; travel: number }

/**
 * The route map for one mode of transport, the way the underground view shows the metro: every
 * automatic connection as a coloured line through the streets, a pin on each stop, and a marker
 * running the route so the service reads as something that moves. Drawn over the city, without
 * depth, because the point is to see the whole network at once while placing the next stop.
 */
export class TransitLineLayer {
  readonly group = new THREE.Group();
  private lines = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92, depthTest: false, depthWrite: false }));
  private markers = new THREE.Group();
  private runs: Run[] = [];
  private mode: TransitMode | null = null;
  private signature = '';
  private inputs = -1;

  constructor() {
    this.lines.renderOrder = 6;
    this.lines.frustumCulled = false;
    this.markers.renderOrder = 7;
    this.group.add(this.lines, this.markers);
    this.group.visible = false;
  }

  /** Bus or rail while that tool is in hand; null puts the map away. */
  setMode(mode: TransitMode | null): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.group.visible = !!mode;
    this.signature = '';
    this.inputs = -1;
  }

  rebuild(kind: Uint8Array, flags: Uint8Array, raster: Raster, net: Network, gates: readonly { x: number; z: number }[] = []): void {
    if (!this.mode) return;
    const inputs = transportSignature(kind, flags, raster, net);
    if (inputs === this.inputs) return;
    this.inputs = inputs;
    const operating = (i: number): boolean => flags[i] === 0 && raster.accSeg[i] >= 0;
    const pathFor = (a: number, b: number): { x: number; z: number }[] => kind[a] === T_TROLLEY ? trolleyPath(net, raster.accSeg[a], raster.accS[a], raster.accSeg[b], raster.accS[b]) : railPath(net, raster, a, b);
    const transit = transitNetwork(kind, operating, (a, b) => pathFor(a, b).length > 1, gates);
    const lines = transit.lines.filter(l => l.mode === this.mode);
    const intercity = this.mode === 'rail' ? transit.intercity : [];
    const signature = `${net.version}:${this.mode}:` + JSON.stringify([lines, intercity]);
    if (signature === this.signature) return;
    this.signature = signature;

    for (const run of this.runs) { run.marker.geometry.dispose(); (run.marker.material as THREE.Material).dispose(); }
    this.markers.clear();
    this.runs = [];
    const half = GRID / 2, b = new MeshBuilder();
    const stopKind = this.mode === 'bus' ? T_BUS : this.mode === 'trolley' ? T_TROLLEY : T_STATION;
    const [fw, fd] = SERVICES[stopKind].footprint ?? [1, 1];
    const centre = (i: number): { x: number; z: number } => ({ x: i % GRID + fw / 2 - half, z: Math.floor(i / GRID) + fd / 2 - half });

    // A line out of town gets the same treatment, ending past the map edge.
    intercity.forEach((station, n) => {
      const track = intercityTrack(net, raster, station, 0.5);
      if (track.length < 2) return;
      const color = LINE_COLORS[(lines.length + n) % LINE_COLORS.length];
      const flat = new Float32Array(track.length * 2);
      for (let i = 0; i < track.length; i++) { flat[i * 2] = track[i].x - half; flat[i * 2 + 1] = track[i].z - half; }
      b.ribbon(flat, track.length, 0.34, 0.6, 0x101820);
      b.ribbon(flat, track.length, 0.24, 0.62, color);
      const c = centre(station);
      b.disc(c.x, c.z, 0.62, 0.63, 0x101820, 16);
      b.disc(c.x, c.z, 0.44, 0.64, color, 16);
      const end = track.at(-1)!;
      b.disc(end.x - half, end.z - half, 0.5, 0.63, color, 12);
    });

    lines.forEach((line, n) => {
      const path = pathFor(line.a, line.b);
      if (line.mode === 'trolley') path.push(...pathFor(line.b, line.a));
      if (path.length < 2) return;
      const color = LINE_COLORS[n % LINE_COLORS.length];
      const flat = new Float32Array(path.length * 2);
      const cum = new Float32Array(path.length);
      for (let i = 0; i < path.length; i++) {
        flat[i * 2] = path[i].x - half;
        flat[i * 2 + 1] = path[i].z - half;
        if (i) cum[i] = cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      }
      b.ribbon(flat, path.length, 0.34, 0.6, 0x101820);
      b.ribbon(flat, path.length, 0.24, 0.62, color);
      for (const stop of [line.a, line.b]) {
        const c = centre(stop);
        b.disc(c.x, c.z, 0.62, 0.63, 0x101820, 16);
        b.disc(c.x, c.z, 0.44, 0.64, color, 16);
      }
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      marker.renderOrder = 8;
      this.markers.add(marker);
      const length = cum.at(-1) ?? 0;
      this.runs.push({ loop: line.mode === 'trolley', px: Float32Array.from(path, p => p.x - half), pz: Float32Array.from(path, p => p.z - half), cum, marker, phase: n * 3.1, travel: Math.max(4, length / 3) });
    });
    this.lines.geometry.dispose();
    this.lines.geometry = b.build();
  }

  /** Runs a marker back and forth along each route, so the map shows service, not just track. */
  update(time: number): void {
    for (const run of this.runs) {
      const length = run.cum.at(-1) ?? 0;
      if (length <= 0) continue;
      const cycle = ((time + run.phase) % (run.travel * 2)) / run.travel;
      const d = (run.loop ? ((time + run.phase) % run.travel) / run.travel : (cycle <= 1 ? cycle : 2 - cycle)) * length;
      let lo = 0, hi = run.cum.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (run.cum[mid] <= d) lo = mid; else hi = mid; }
      const u = (d - run.cum[lo]) / (run.cum[hi] - run.cum[lo] || 1);
      run.marker.position.set(run.px[lo] + (run.px[hi] - run.px[lo]) * u, 0.75, run.pz[lo] + (run.pz[hi] - run.pz[lo]) * u);
    }
  }
}
