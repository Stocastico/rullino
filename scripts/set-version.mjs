// Sets the lockstep version of the four published packages: `node scripts/set-version.mjs 0.1.0-rc.0`.
// (Their @rullino/* dependencies are `workspace:*`, which `pnpm pack` turns into this exact version.)
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2] ?? '';
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error(`set-version: "${version}" is not a version (expected X.Y.Z or X.Y.Z-rc.N)`);
  process.exit(1);
}
for (const name of ['core', 'filters', 'presets', 'ml']) {
  const file = new URL(`../packages/${name}/package.json`, import.meta.url);
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
console.log(`set-version: ${version}`);
