// The built tools (dist/) served from a sub-path, as GitHub Pages does, opened in headless Chromium.
// Web-ready export: two generated photos (landscape and portrait) through the page's own controls,
// long side 100, PNG; the downloaded zip must hold both, each at the expected size and with no chunk
// but IHDR / IDAT / IEND (no metadata). Fails on a console error, a failed request or a 404.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { launchOptions } from '../../../scripts/browser-launch.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const PREFIX = '/sites/rullino/tools/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const failures = [];
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ does not exist: run pnpm build first');

/** An RGB PNG with a gradient, written by hand (zlib is built into Node). */
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = (x * 255) / w;
      raw[i + 1] = (y * 255) / h;
      raw[i + 2] = 128;
    }
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length);
    b.writeUInt32BE(data.length, 0);
    b.write(type, 4, 'ascii');
    data.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The entries of a store-only zip, through its central directory. */
function unzip(zip) {
  const eocd = zip.length - 22;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const at = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    out.push({ name, data: zip.subarray(at, at + size) });
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return out;
}

function pngInfo(b) {
  const chunks = [];
  for (let p = 8; p < b.length; ) {
    const len = b.readUInt32BE(p);
    chunks.push(b.subarray(p + 4, p + 8).toString('ascii'));
    p += 12 + len;
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), chunks: [...new Set(chunks)] };
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = path.startsWith(PREFIX) ? normalize(path.slice(PREFIX.length) || 'index.html') : undefined;
  const file = rel && !rel.startsWith('..') ? join(dist, rel.endsWith('/') || rel === '.' ? join(rel, 'index.html') : rel) : undefined;
  const resolved = file && existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file;
  if (!resolved || !existsSync(resolved)) return void res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' }).end(readFileSync(resolved));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://localhost:${server.address().port}${PREFIX}`;

const browser = await chromium.launch(launchOptions());
try {
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`));
  page.on('requestfailed', (r) => failures.push(`request failed: ${r.url()}`));
  page.on('response', (r) => r.status() >= 400 && failures.push(`HTTP ${r.status()}: ${r.url()}`));

  // The hub links to the tool.
  await page.goto(base);
  await page.click('a[href="./web-export/"]');
  await page.waitForURL(/web-export/);

  await page.setInputFiles('#files', [
    { name: 'wide.png', mimeType: 'image/png', buffer: png(300, 200) },
    { name: 'tall.png', mimeType: 'image/png', buffer: png(150, 225) },
  ]);
  await page.fill('#long-side', '100');
  await page.selectOption('#format', 'png');
  const code = (await page.textContent('#code')) ?? '';
  if (!code.includes('"longSide":100') || !code.includes('unsharpMask')) failures.push(`the code shown does not follow the settings:\n${code}`);
  await page.click('#export');
  await page.waitForSelector('#status[data-done]', { timeout: 120000 });
  const done = await page.getAttribute('#status', 'data-done');
  if (done !== '2') failures.push(`exported ${done} of 2: ${await page.textContent('#status')}`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  if (download.suggestedFilename() !== 'web-ready.zip') failures.push(`download named ${download.suggestedFilename()}`);
  const zip = readFileSync(await download.path());
  const entries = unzip(zip);
  const want = { 'wide.png': [100, 67], 'tall.png': [67, 100] };
  if (entries.map((e) => e.name).join() !== 'wide.png,tall.png') failures.push(`zip holds ${entries.map((e) => e.name).join(', ')}`);
  for (const e of entries) {
    const info = pngInfo(e.data);
    const [w, h] = want[e.name] ?? [];
    if (Math.abs(info.width - w) > 1 || Math.abs(info.height - h) > 1) failures.push(`${e.name} is ${info.width}×${info.height}, expected about ${w}×${h}`);
    if (info.chunks.some((c) => !['IHDR', 'IDAT', 'IEND'].includes(c))) failures.push(`${e.name} carries ${info.chunks.join(', ')}`);
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`tools smoke failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('tools smoke: ok');
