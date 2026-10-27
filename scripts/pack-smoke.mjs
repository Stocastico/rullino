// Installs the packages the way a user would and runs them: builds, `pnpm pack`s each package, installs
// the tarballs into a throwaway project outside the repo, then
//   1. checks what the tarballs contain (dist only, exports pointing at dist, no workspace: ranges),
//   2. imports them under plain Node ESM and runs the CPU path,
//   3. bundles them with Vite and runs a GPU filter in headless Chromium, compared with the CPU one.
// Slow (a minute or two), so it has its own command: `pnpm test:pack`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const repo = new URL('..', import.meta.url).pathname;
const PACKAGES = ['core', 'filters', 'presets', 'ml'];
const version = JSON.parse(readFileSync(join(repo, 'packages/core/package.json'), 'utf8')).version;
const failures = [];
const check = (ok, msg) => ok || failures.push(msg);
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const work = mkdtempSync(join(tmpdir(), 'rullino-pack-'));
const tarballs = join(work, 'tarballs');
const project = join(work, 'project');
mkdirSync(tarballs);
mkdirSync(project);

try {
  run('pnpm', ['-r', '--filter', './packages/*', 'build'], repo);

  // 1. The tarballs.
  for (const name of PACKAGES) run('pnpm', ['pack', '--pack-destination', tarballs], join(repo, 'packages', name));
  const files = readdirSync(tarballs);
  check(files.length === PACKAGES.length, `expected ${PACKAGES.length} tarballs, got ${files.join(', ')}`);
  for (const name of PACKAGES) {
    const tgz = join(tarballs, files.find((f) => f === `rullino-${name}-${version}.tgz`) ?? `missing-${name}`);
    const listing = run('tar', ['-tzf', tgz], work).split('\n').filter(Boolean);
    const stray = listing.filter((f) => !/^package\/(dist\/|package\.json$|README\.md$|LICENSE$)/.test(f) && !(name === 'core' && f === 'package/edit.schema.json'));
    check(stray.length === 0, `${name}: unexpected files in the tarball: ${stray.slice(0, 5).join(', ')}`);
    check(listing.some((f) => f === 'package/dist/index.js') && listing.some((f) => f === 'package/dist/index.d.ts'), `${name}: dist/index.js / index.d.ts missing`);
    check(listing.includes('package/LICENSE'), `${name}: LICENSE missing from the tarball`);
    check(!listing.some((f) => /\.test\.|test-utils/.test(f)), `${name}: test files in the tarball`);
    // What the release workflow runs on each tarball (with "./": without it npm reads "dir/x.tgz" as a GitHub repo).
    try {
      run('npm', ['publish', '--dry-run', `./${basename(tgz)}`, '--access', 'public', '--tag', 'next'], tarballs);
    } catch (e) {
      failures.push(`${name}: npm publish --dry-run of the tarball failed: ${e.message}`);
    }
    const pkg = JSON.parse(run('tar', ['-xzOf', tgz, 'package/package.json'], work));
    check(JSON.stringify(pkg.exports).includes('./dist/index.js') && !JSON.stringify(pkg.exports).includes('/src/'), `${name}: exports do not point at dist: ${JSON.stringify(pkg.exports)}`);
    const ranges = JSON.stringify({ ...pkg.dependencies, ...pkg.peerDependencies });
    check(!ranges.includes('workspace:'), `${name}: workspace: range left in the tarball: ${ranges}`);
  }

  // 2. Install and run under Node.
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({ name: 'pack-smoke', private: true, type: 'module', dependencies: Object.fromEntries(PACKAGES.map((n) => [`@rullino/${n}`, `file:../tarballs/rullino-${n}-${version}.tgz`])) }),
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], project);

  writeFileSync(
    join(project, 'check-node.mjs'),
    `import * as core from '@rullino/core';
import * as internal from '@rullino/core/internal';
import { filters, exposure } from '@rullino/filters';
import * as presets from '@rullino/presets';
import * as ml from '@rullino/ml';
import * as mlInternal from '@rullino/ml/internal';
const out = {};
out.core = typeof core.defineFilter === 'function' && !('passShader' in core) && typeof internal.passShader === 'function';
out.ml = typeof ml.createMiganInpainter === 'function' && !('samInput' in ml) && typeof mlInternal.samInput === 'function';
out.presets = typeof presets.lookSteps === 'function';
out.filters = filters.length > 40;
// CPU path: +1 EV doubles linear light; a chain on a 2 x 1 image.
const img = core.createImage(2, 1, Float32Array.from([0.1, 0.2, 0.3, 1, 0.4, 0.2, 0.1, 0.5]));
const res = core.runChainCpu([{ filter: exposure, params: { ev: 1 } }], img);
out.cpu = Math.abs(res.data[0] - 0.2) < 1e-6 && Math.abs(res.data[4] - 0.8) < 1e-6 && res.data[7] === 0.5;
// The README examples of filters, presets and autoAdjust, on the packed packages.
const blurred = core.runChainCpu([{ filter: filters.find((f) => f.id === 'gaussianBlur'), params: { sigma: 3 } }, { filter: filters.find((f) => f.id === 'vignette') }], core.createImage(64, 64));
out.readmeFilters = blurred.width === 64 && Object.keys(filters.find((f) => f.id === 'gaussianBlur').params).join() === 'sigma';
const looked = core.runChainCpu(presets.lookSteps(presets.looks[0], { intensity: 0.8 }), core.createImage(16, 16));
out.readmePresets = looked.width === 16 && presets.looks.length >= 10;
const { autoAdjust } = await import('@rullino/filters');
out.readmeAuto = typeof autoAdjust(core.createImage(32, 32)) === 'object';
// The JSON Schema of edit documents ships with core, and accepts what serializeChain writes.
const schema = (await import('@rullino/core/edit.schema.json', { with: { type: 'json' } })).default;
out.editSchema = schema.properties.version.const === core.CHAIN_VERSION;
// The root README quick start: the edit as JSON, replayed on the CPU.
const edit = JSON.stringify(core.serializeChain([{ filter: exposure, params: { ev: 0.3 } }, { filter: filters.find((f) => f.id === 'contrast'), params: { amount: 0.15 } }], { output: { format: 'png', longSide: 2048 } }));
const replayed = await core.applyEdit(img, JSON.parse(edit), { filters });
const manual = core.runChainCpu(core.parseChain(JSON.parse(edit), { filters }).steps, img);
out.readmeJson = edit.startsWith('{"version":2,"steps":[{"filter":"exposure","params":{"ev":0.3}},') && replayed.data.every((v, i) => v === manual.data[i]);
console.log(JSON.stringify(out));
`,
  );
  const node = JSON.parse(run('node', ['check-node.mjs'], project));
  for (const [key, ok] of Object.entries(node)) check(ok, `node check failed: ${key}`);

  // 3. Bundle with Vite and run a GPU filter in Chromium.
  writeFileSync(join(project, 'index.html'), '<!doctype html><html><body><script type="module" src="./main.js"></script></body></html>');
  writeFileSync(
    join(project, 'main.js'),
    `import { createGpuContext, createImage, fromFloat16Array, importImage, Pipeline, readImage, readSrgb8, runFilter, toFloat16Array, uploadImage } from '@rullino/core';
import { filters } from '@rullino/filters';
const ctx = await createGpuContext();
const w = 17, h = 9; // odd sizes: workgroup bounds, row padding
const data = new Float32Array(w * h * 4);
for (let i = 0; i < w * h; i++) data.set([(i % 7) / 7, (i % 5) / 5, (i % 3) / 3, 1], i * 4);
const src = createImage(w, h, fromFloat16Array(toFloat16Array(data)));
const result = {};
// An image param (the depth map of the lens blur) goes through the packed packages too.
const depth = createImage(4, 3);
for (let i = 0; i < 12; i++) depth.data.set([i / 11, i / 11, i / 11, 1], i * 4);
for (const [id, params] of [['exposure', { ev: 0.7 }], ['gaussianBlur', { sigma: 2 }], ['lensBlur', { depth, focus: 1, range: 0, radius: 5 }]]) {
  const f = filters.find((x) => x.id === id);
  const gpu = await readImage(ctx, runFilter(ctx, f, uploadImage(ctx, src), params));
  const cpu = f.cpu(src, params);
  let worst = 0;
  for (let i = 0; i < cpu.data.length; i++) worst = Math.max(worst, Math.abs(gpu.data[i] - cpu.data[i]));
  result[id] = worst;
}
// The core README quick start: a Pipeline over an imported image, read back as sRGB.
const exposure = filters.find((x) => x.id === 'exposure');
const flat = new ImageData(4, 4);
for (let i = 0; i < 16; i++) flat.data.set([100, 150, 200, 255], i * 4);
const pipeline = new Pipeline(ctx);
pipeline.setSource(importImage(ctx, await createImageBitmap(flat, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })));
const rgba = await readSrgb8(ctx, pipeline.run([{ filter: exposure, params: { ev: 0 } }]));
result.quickstartPixel = Math.max(Math.abs(rgba[0] - 100), Math.abs(rgba[1] - 150), Math.abs(rgba[2] - 200), Math.abs(rgba[3] - 255)); // an ev 0 chain returns the image (8-bit rounding)
window.__result = result;
`,
  );
  await build({ root: project, logLevel: 'error', build: { outDir: 'out', target: 'esnext' } });
  const server = await preview({ root: project, build: { outDir: 'out' }, preview: { port: 0 } });
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { failures.push(`page error: ${e.message}`); console.error('page error:', e.message); });
    page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => window.__result, null, { timeout: 60000 });
    const result = await page.evaluate(() => window.__result);
    for (const [id, worst] of Object.entries(result)) check(id === 'quickstartPixel' ? worst <= 1 : worst < 5e-3, `${id}: GPU and CPU differ by ${worst} through the packed packages`);
    console.log(`pack-smoke: GPU vs CPU max difference ${JSON.stringify(result)}`);
  } finally {
    await browser.close();
    await server.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('pack-smoke: ok');
