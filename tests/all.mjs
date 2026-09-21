import { spawnSync } from 'node:child_process';
for (const suite of ['park-paths', 'bench-scale', 'taxi', 'street-pace', 'run', 'streets-render', 'bike-lanes', 'airports', 'parks', 'trolley', 'placement-integration']) {
  const result = spawnSync(process.execPath, [new URL(`./${suite}.mjs`, import.meta.url).pathname], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
