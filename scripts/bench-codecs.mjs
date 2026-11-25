// `pnpm bench:codecs [--runs 5] [--size 4000x3000]`: @rullino/codecs against native decoders.
// Bundles packages/codecs with Vite, then times it in plain Node against sharp (libvips: libjpeg-turbo
// with SIMD, libspng, libtiff) and in headless Chromium against the browser's decoder
// (createImageBitmap + a canvas readback, which is what a page that needs the pixels does). The test
// images are made from a sample photo at the given size. Writes packages/codecs/bench/results.txt.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { launchOptions } from './browser-launch.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const runs = Number(arg('runs', '5'));
const [W, H] = arg('size', '4000x3000').split('x').map(Number);
const sharp = createRequire(join(repo, 'packages/codecs/package.json'))('sharp');

const dir = mkdtempSync(join(tmpdir(), 'rullino-codecs-bench-'));
try {
  await build({
    logLevel: 'warn',
    configFile: false,
    build: { emptyOutDir: true, outDir: dir, minify: false, lib: { entry: join(repo, 'packages/codecs/src/index.ts'), formats: ['es'], fileName: () => 'codecs.mjs' } },
  });
  // Test images.
  const photo = await sharp(join(repo, 'apps/playground/public/samples/river.jpg')).resize(W, H, { fit: 'fill' }).toBuffer();
  const files = {
    'jpeg-420-q90.jpg': await sharp(photo).jpeg({ quality: 90, chromaSubsampling: '4:2:0', mozjpeg: false }).toBuffer(),
    'jpeg-progressive.jpg': await sharp(photo).jpeg({ quality: 90, progressive: true }).toBuffer(),
    'png-8.png': await sharp(photo).png({ compressionLevel: 6 }).toBuffer(),
    'png-16.png': await sharp(photo).toColourspace('rgb16').png({ compressionLevel: 6 }).toBuffer(),
    'tiff-16-deflate.tif': await sharp(photo).toColourspace('rgb16').tiff({ compression: 'deflate', predictor: 'horizontal' }).toBuffer(),
  };
  for (const [name, b] of Object.entries(files)) writeFileSync(join(dir, name), b);
  writeFileSync(join(dir, 'rgba.raw'), await sharp(photo).ensureAlpha().raw().toBuffer());

  // Node.
  writeFileSync(
    join(dir, 'node.mjs'),
    `import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as c from './codecs.mjs';
const sharp = createRequire(${JSON.stringify(join(repo, 'packages/codecs/package.json'))})('sharp');
const runs = ${runs}, W = ${W}, H = ${H};
const median = async (f) => { await f(); const t = []; for (let i = 0; i < runs; i++) { const s = performance.now(); await f(); t.push(performance.now() - s); } return t.sort((a, b) => a - b)[runs >> 1]; };
const f = (n) => new Uint8Array(readFileSync(new URL(n, import.meta.url)));
const rows = [];
const row = (what, ours, theirs) => rows.push([what, ours, theirs]);
for (const n of ['jpeg-420-q90.jpg', 'jpeg-progressive.jpg', 'png-8.png', 'png-16.png', 'tiff-16-deflate.tif']) {
  const b = f(n);
  row('decode ' + n, await median(() => c.decode(b)), await median(() => sharp(b).raw({ depth: n.includes('16') ? 'ushort' : 'uchar' }).toBuffer()));
}
const rgba = { width: W, height: H, data: f('rgba.raw') };
row('encode JPEG q90 4:2:0', await median(() => c.encodeJpeg(rgba, { quality: 0.9 })), await median(() => sharp(rgba.data, { raw: { width: W, height: H, channels: 4 } }).jpeg({ quality: 90, mozjpeg: false }).toBuffer()));
row('encode TIFF 8-bit deflate', await median(() => c.encodeTiff({ ...rgba, bitDepth: 8 })), await median(() => sharp(rgba.data, { raw: { width: W, height: H, channels: 4 } }).tiff({ compression: 'deflate', predictor: 'horizontal' }).toBuffer()));
console.log(JSON.stringify(rows));
`,
  );
  const node = spawnSync(process.execPath, ['--max-old-space-size=8192', join(dir, 'node.mjs')], { encoding: 'utf8' });
  if (node.status !== 0) throw new Error(node.stderr);
  const nodeRows = JSON.parse(node.stdout.trim().split('\n').at(-1));

  // Chromium: our decoders against createImageBitmap + getImageData.
  writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="./page.mjs"></script>');
  writeFileSync(
    join(dir, 'page.mjs'),
    `import * as c from './codecs.mjs';
const runs = ${runs};
const median = async (f) => { await f(); const t = []; for (let i = 0; i < runs; i++) { const s = performance.now(); await f(); t.push(performance.now() - s); } return t.sort((a, b) => a - b)[runs >> 1]; };
const native = async (b, type) => { const bmp = await createImageBitmap(new Blob([b], { type })); const cv = new OffscreenCanvas(bmp.width, bmp.height); const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, bmp.width, bmp.height); };
const rows = [];
for (const [n, type] of [['jpeg-420-q90.jpg', 'image/jpeg'], ['jpeg-progressive.jpg', 'image/jpeg'], ['png-8.png', 'image/png']]) {
  const b = new Uint8Array(await (await fetch(n)).arrayBuffer());
  rows.push(['decode ' + n, await median(() => c.decode(b)), await median(() => native(b, type))]);
}
window.result = rows;
`,
  );
  const server = createServer((req, res) => {
    try {
      const body = readFileSync(join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      res.writeHead(200, { 'content-type': req.url.endsWith('.mjs') ? 'text/javascript' : req.url.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  }).listen(0);
  const port = server.address().port;
  const browser = await chromium.launch(launchOptions());
  let browserRows;
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/index.html`);
    await page.waitForFunction(() => window.result, null, { timeout: 600_000 });
    browserRows = await page.evaluate(() => window.result);
  } finally {
    await browser.close();
    server.close();
  }

  const mp = ((W * H) / 1e6).toFixed(1);
  const fmt = (rows, other) =>
    rows.map(([what, ours, theirs]) => `  ${what.padEnd(30)} ${ours.toFixed(0).padStart(6)} ms   ${other} ${theirs.toFixed(0).padStart(6)} ms   ${(ours / theirs).toFixed(1)}×`).join('\n');
  const text = `@rullino/codecs, ${W}×${H} (${mp} MP), median of ${runs} (${new Date().toISOString().slice(0, 10)}, ${process.platform} ${process.arch})

Node ${process.version}: ours vs sharp (native, SIMD)
${fmt(nodeRows, 'sharp')}

Chromium: ours vs createImageBitmap + getImageData
${fmt(browserRows, 'browser')}
`;
  writeFileSync(join(repo, 'packages/codecs/bench/results.txt'), text);
  console.log(text);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
