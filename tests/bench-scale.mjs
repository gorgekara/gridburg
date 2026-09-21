import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
}});
const { Builder } = await import('../src/render/buildingGeo.ts');
const { parkGeometry } = await import('../src/render/parkGeo.ts');
const { T_BENCH } = await import('../src/constants.ts');
const builder = new Builder(1);
parkGeometry(builder, T_BENCH, 0);
const geometry = builder.build();
const positions = geometry.attributes.position;
let top = 0, left = Infinity, right = -Infinity, front = -Infinity, back = Infinity;
for (let i = 0; i < positions.count; i++) {
  const y = positions.getY(i);
  top = Math.max(top, y);
  if (y <= 0.02) continue; // Exclude the one-tile grass base.
  left = Math.min(left, positions.getX(i)); right = Math.max(right, positions.getX(i));
  back = Math.min(back, positions.getZ(i)); front = Math.max(front, positions.getZ(i));
}
assert.ok(top > 0.07 && top < 0.1, 'bench back is below pedestrian eye height (0.13)');
assert.ok(right - left > 0.14 && right - left < 0.17, 'bench seats two people at street scale');
assert.ok(front - back < 0.065, 'seat depth matches the compact human-scale bench');
geometry.dispose();
console.log('Bench decoration: human-scale height, length and seat depth passed.');
