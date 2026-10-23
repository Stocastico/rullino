// Fails when a package or the playground grows past size-budget.json (gzip -9 bytes). Run after
// `pnpm build`. Prints every measurement so a PR shows by how much a limit is used.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const repo = new URL('..', import.meta.url).pathname;
const budget = JSON.parse(readFileSync(join(repo, 'size-budget.json'), 'utf8'));

const walk = (dir) => readdirSync(dir).sort().flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const gz = (files) => gzipSync(Buffer.concat(files.map((f) => readFileSync(f))), { level: 9 }).length;

const measured = {};
for (const name of Object.keys(budget).filter((k) => k.startsWith('packages/'))) {
  const dist = join(repo, name, 'dist');
  if (!existsSync(dist)) throw new Error(`${dist} does not exist: run pnpm build first`);
  measured[name] = gz(walk(dist).filter((f) => f.endsWith('.js')));
}
const assets = join(repo, 'apps/playground/dist/assets');
if (!existsSync(assets)) throw new Error(`${assets} does not exist: run pnpm build first`);
const asset = (re) => {
  const hits = readdirSync(assets).filter((f) => re.test(f));
  if (hits.length !== 1) throw new Error(`expected one asset matching ${re}, got ${hits.join(', ') || 'none'}`);
  return join(assets, hits[0]);
};
measured['playground/main-chunk'] = gz([asset(/^index-.*\.js$/)]);
measured['playground/ort-chunk'] = gz([asset(/^ort\..*\.js$/)]);

let failed = false;
for (const [name, limit] of Object.entries(budget)) {
  if (name.startsWith('_')) continue;
  const size = measured[name];
  const over = size > limit;
  failed ||= over;
  console.log(`${over ? 'OVER ' : 'ok   '} ${name.padEnd(24)} ${String(size).padStart(7)} / ${limit} B (${((size / limit) * 100).toFixed(0)}%)`);
}
if (failed) {
  console.error('size budget exceeded');
  process.exit(1);
}
