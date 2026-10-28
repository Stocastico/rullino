// Release gate, run by .github/workflows/release.yml on a `vX.Y.Z[-pre]` tag (and by hand:
// `node scripts/release-info.mjs v0.1.0-rc.0`). Fails unless the tag is a semver version and all four
// packages carry exactly that version and are publishable; prints `version`, the npm dist-tag
// (`next` for a pre-release, `latest` otherwise) and `prerelease` as GITHUB_OUTPUT-style lines.
import { readFileSync } from 'node:fs';

const PACKAGES = ['core', 'filters', 'presets', 'ml', 'node', 'web', 'konva'];
const SEMVER = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

const tag = process.argv[2] ?? '';
const match = SEMVER.exec(tag);
if (!match) {
  console.error(`release-info: "${tag}" is not a version tag (expected vX.Y.Z or vX.Y.Z-rc.N)`);
  process.exit(1);
}
const version = match[1];

const problems = [];
for (const name of PACKAGES) {
  const pkg = JSON.parse(readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), 'utf8'));
  if (pkg.version !== version) problems.push(`@rullino/${name} is ${pkg.version}, the tag says ${version}`);
  if (pkg.private) problems.push(`@rullino/${name} is still "private": true`);
  if (pkg.publishConfig?.access !== 'public') problems.push(`@rullino/${name} has no publishConfig.access "public"`);
}
if (problems.length) {
  console.error(`release-info: ${problems.join('\n  ')}`);
  process.exit(1);
}

const prerelease = version.includes('-');
console.log(`version=${version}`);
console.log(`tag=${prerelease ? 'next' : 'latest'}`);
console.log(`prerelease=${prerelease}`);
