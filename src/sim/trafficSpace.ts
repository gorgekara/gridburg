export const VEHICLE_SCALE = 0.68;
export interface VehiclePose { y?: number; x: number; z: number; angle: number; type: number }
export const vehicleLength = (type: number): number => (type === 3 || type === 4 || type === 6 || type === 8 || type === 10 ? 0.82 : type === 2 ? 0.58 : type === 7 ? 0.48 : 0.5) * VEHICLE_SCALE;

/** Separating-axis test for oriented vehicle bodies, with a small safety margin. */
export function vehiclesOverlap(a: VehiclePose, b: VehiclePose, margin = 0.025): boolean {
  if (Math.abs((a.y ?? 0) - (b.y ?? 0)) > 0.6) return false;
  const axes = [[Math.cos(a.angle), -Math.sin(a.angle)], [Math.sin(a.angle), Math.cos(a.angle)], [Math.cos(b.angle), -Math.sin(b.angle)], [Math.sin(b.angle), Math.cos(b.angle)]];
  const dx = a.x - b.x, dz = a.z - b.z;
  const radius = (p: VehiclePose, x: number, z: number): number =>
    Math.abs(x * Math.cos(p.angle) - z * Math.sin(p.angle)) * (0.33 * VEHICLE_SCALE / 2 + margin) + Math.abs(x * Math.sin(p.angle) + z * Math.cos(p.angle)) * (vehicleLength(p.type) / 2 + margin);
  return axes.every(([x, z]) => Math.abs(dx * x + dz * z) < radius(a, x, z) + radius(b, x, z));
}

/** Spatial reservations shared by spawning, normal movement and junction transitions. */
export class TrafficSpace {
  readonly poses = new Map<number, VehiclePose>();
  private buckets = new Map<string, Set<number>>();
  private key(p: VehiclePose): string { return `${Math.floor(p.x)},${Math.floor(p.z)}`; }
  set(id: number, p: VehiclePose): void {
    this.remove(id); this.poses.set(id, p);
    const key = this.key(p); if (!this.buckets.has(key)) this.buckets.set(key, new Set());
    this.buckets.get(key)!.add(id);
  }
  remove(id: number): void {
    const p = this.poses.get(id); if (!p) return;
    const key = this.key(p), bucket = this.buckets.get(key)!;
    bucket.delete(id); if (!bucket.size) this.buckets.delete(key); this.poses.delete(id);
  }
  clear(): void { this.poses.clear(); this.buckets.clear(); }
  free(p: VehiclePose, ignore = -1): boolean {
    for (let z = Math.floor(p.z) - 1; z <= Math.floor(p.z) + 1; z++) for (let x = Math.floor(p.x) - 1; x <= Math.floor(p.x) + 1; x++) {
      for (const id of this.buckets.get(`${x},${z}`) ?? []) if (id !== ignore && vehiclesOverlap(p, this.poses.get(id)!)) return false;
    }
    return true;
  }
  canMove(id: number, next: VehiclePose): boolean {
    const old = this.poses.get(id); if (!old) return this.free(next, id);
    const angle = Math.atan2(Math.sin(next.angle - old.angle), Math.cos(next.angle - old.angle));
    const steps = Math.max(1, Math.ceil(Math.hypot(next.x - old.x, next.z - old.z) / 0.035), Math.ceil(Math.abs(angle) / 0.1));
    for (let n = 1; n <= steps; n++) {
      const t = n / steps;
      if (!this.free({ ...next, y: (old.y ?? 0) + ((next.y ?? 0) - (old.y ?? 0)) * t, x: old.x + (next.x - old.x) * t, z: old.z + (next.z - old.z) * t, angle: old.angle + angle * t }, id)) return false;
    }
    return true;
  }
}
