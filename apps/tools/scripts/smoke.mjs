// The built tools (dist/) served from a sub-path, as GitHub Pages does, opened in headless Chromium.
// Web-ready export: two generated photos (landscape and portrait) through the page's own controls,
// long side 100, PNG; the downloaded zip must hold both, each at the expected size and with no chunk
// but IHDR / IDAT / IEND (no metadata). Apply a look to a folder: previews, a bad document, the export
// (Noir must come back grey) and cancel. LUT maker: saturation −1 makes the preview and the .cube grey.
// Compare two renders: identical, one pixel off, two sizes.
// Fails on a console error, a failed request or a 404.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { launchOptions } from '../../../scripts/browser-launch.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const PREFIX = '/sites/rullino/tools/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const failures = [];
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ does not exist: run pnpm build first');

/** An RGB PNG with a gradient, written by hand (zlib is built into Node). */
function png(w, h, poke) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = (x * 255) / w;
      raw[i + 1] = (y * 255) / h;
      raw[i + 2] = 128;
    }
  if (poke) raw[poke.y * (w * 3 + 1) + 1 + poke.x * 3] += poke.by;
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

/** The RGBA8 pixels of an 8-bit RGB / RGBA PNG (every filter type). */
function decodePng(b) {
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  const channels = b[25] === 6 ? 4 : 3;
  const idat = [];
  for (let p = 8; p < b.length; ) {
    const len = b.readUInt32BE(p);
    if (b.subarray(p + 4, p + 8).toString('ascii') === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? row[x - channels] : 0;
      const up = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
      const pred = [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f];
      row[x] = (v + pred) & 255;
    }
    for (let x = 0; x < width; x++) for (let k = 0; k < 4; k++) out[(y * width + x) * 4 + k] = k < channels ? row[x * channels + k] : 255;
    prev.set(row);
  }
  return { width, height, data: out };
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
  if (!/"longSide": ?100/.test(code) || !code.includes('unsharpMask') || !code.includes('"kind": "resize"')) failures.push(`the code shown does not follow the settings:\n${code}`);
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

  // Apply a look to a folder: three photos and a file that is not one, Noir, previews, a bad pasted
  // document, the export (a zip of greys), then a cancel before the first photo.
  await page.goto(base);
  await page.click('a[href="./look-folder/"]');
  await page.waitForURL(/look-folder/);
  const photos = [png(120, 80), png(90, 130), png(64, 64)].map((buffer, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer }));
  await page.setInputFiles('#files', [...photos, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
  const picked = (await page.textContent('#picked')) ?? '';
  if (!picked.startsWith('3 photos (1 other file skipped)')) failures.push(`look folder: picked says "${picked}"`);
  await page.selectOption('#look', 'noir');
  await page.selectOption('#format', 'png');
  await page.waitForFunction(() => document.querySelectorAll('#previews figure').length === 3 && document.querySelector('#previews')?.dataset.ready, null, { timeout: 120000 });
  await page.selectOption('#look', 'paste');
  await page.fill('#document', '{ "version": 2, ');
  if (!/not JSON/.test((await page.textContent('#problem')) ?? '') || !(await page.isDisabled('#export'))) failures.push('look folder: a bad document is not reported, or export stays enabled');
  await page.selectOption('#look', 'noir');
  if (!((await page.textContent('#code')) ?? '').includes('npx rullino render --edit edit.json')) failures.push('look folder: no code shown');
  await page.click('#export');
  await page.waitForSelector('#status[data-done]', { timeout: 120000 });
  if ((await page.getAttribute('#status', 'data-done')) !== '3') failures.push(`look folder: exported ${await page.getAttribute('#status', 'data-done')} of 3: ${await page.textContent('#status')}`);
  const [lookZip] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const looked = unzip(readFileSync(await lookZip.path()));
  if (looked.map((e) => e.name).join() !== 'p0.png,p1.png,p2.png') failures.push(`look folder: zip holds ${looked.map((e) => e.name).join(', ')}`);
  for (const e of looked) {
    const { width, data } = decodePng(e.data);
    let colour = 0;
    for (let i = 0; i < data.length; i += 4) colour = Math.max(colour, Math.abs(data[i] - data[i + 1]), Math.abs(data[i + 1] - data[i + 2]));
    if (colour > 2) failures.push(`look folder: ${e.name} (${width} px wide) is not black and white (channels differ by ${colour})`);
  }
  await page.evaluate(() => {
    document.getElementById('export').click();
    document.getElementById('cancel').click();
  });
  await page.waitForSelector('#status[data-cancelled]', { timeout: 60000 });
  if ((await page.getAttribute('#status', 'data-done')) !== '0') failures.push(`look folder: cancelled at once, but ${await page.getAttribute('#status', 'data-done')} photos were exported`);

  // LUT maker: saturation −1 must make the preview grey and the .cube a table of greys, named and sized as asked.
  await page.goto(base);
  await page.click('a[href="./lut-maker/"]');
  await page.waitForURL(/lut-maker/);
  await page.setInputFiles('#photo', { name: 'colour.png', mimeType: 'image/png', buffer: png(160, 100) });
  const lutFrame = async (action) => {
    const n = Number((await page.getAttribute('#status', 'data-frame')) ?? 0);
    await action();
    await page.waitForFunction((n) => Number(document.getElementById('status').dataset.frame ?? 0) > n, n, { timeout: 120000 });
  };
  await page.waitForFunction(() => Number(document.getElementById('status').dataset.frame ?? 0) > 0, null, { timeout: 120000 });
  const spread = (id) =>
    page.$eval(id, (c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let m = 0;
      for (let i = 0; i < d.length; i += 4) m = Math.max(m, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2]));
      return m;
    });
  await lutFrame(() => page.$eval('#saturation', (el) => { el.value = '-1'; el.dispatchEvent(new Event('input')); }));
  if ((await spread('#before')) < 50) failures.push('LUT maker: the test photo has no colour');
  if ((await spread('#after')) > 3) failures.push(`LUT maker: the preview at saturation −1 is not grey (channels differ by ${await spread('#after')})`);
  if (!((await page.textContent('#code')) ?? '').includes('f.saturation')) failures.push('LUT maker: the code does not show the saturation step');
  await page.fill('#title', 'Grey test');
  await page.selectOption('#size', '17');
  const [cube] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  if (cube.suggestedFilename() !== 'grey-test.cube') failures.push(`LUT maker: file named ${cube.suggestedFilename()}`);
  const text = readFileSync(await cube.path(), 'utf8');
  if (!text.startsWith('TITLE "Grey test"\nLUT_3D_SIZE 17\n')) failures.push(`LUT maker: the file starts with ${JSON.stringify(text.slice(0, 40))}`);
  const rows = text.split('\n').filter((l) => /^[\d.-]+ [\d.-]+ [\d.-]+$/.test(l)).map((l) => l.split(' ').map(Number));
  if (rows.length !== 17 ** 3) failures.push(`LUT maker: ${rows.length} entries, expected ${17 ** 3}`);
  if (rows.some(([r, g, b]) => Math.abs(r - g) > 1e-3 || Math.abs(g - b) > 1e-3)) failures.push('LUT maker: the .cube is not grey at saturation −1');

  // Compare two renders: identical, one pixel off by 10 levels (differs at 2, agrees at 10, red in the
  // map at that pixel), two sizes (said so).
  await page.goto(base);
  await page.click('a[href="./compare/"]');
  await page.waitForURL(/compare/);
  const verdict = async (want) => {
    await page.waitForFunction((w) => document.getElementById('verdict').dataset.verdict === w, want, { timeout: 30000 }).catch(() => {});
    return [await page.getAttribute('#verdict', 'data-verdict'), (await page.textContent('#verdict')) ?? ''];
  };
  await page.setInputFiles('#a', { name: 'a.png', mimeType: 'image/png', buffer: png(50, 30) });
  await page.setInputFiles('#b', { name: 'b.png', mimeType: 'image/png', buffer: png(50, 30) });
  let [v, said] = await verdict('agree');
  if (v !== 'agree' || !said.startsWith('Identical')) failures.push(`compare: identical images gave "${said}"`);
  await page.setInputFiles('#b', { name: 'b.png', mimeType: 'image/png', buffer: png(50, 30, { x: 7, y: 4, by: 10 }) });
  [v, said] = await verdict('differ');
  if (v !== 'differ' || !said.includes('1 pixel ')) failures.push(`compare: one pixel off by 10 gave "${said}"`);
  const red = await page.$eval('#map', (c) => [...c.getContext('2d').getImageData(7, 4, 1, 1).data]);
  const other = await page.$eval('#map', (c) => [...c.getContext('2d').getImageData(8, 4, 1, 1).data]);
  if (!(red[0] > 200 && red[1] < 80) || other[0] > 200) failures.push(`compare: the map is ${red} at the pixel and ${other} next to it`);
  await page.$eval('#levels', (el) => { el.value = '10'; el.dispatchEvent(new Event('input')); });
  [v] = await verdict('agree');
  if (v !== 'agree') failures.push('compare: a tolerance of 10 levels does not accept a difference of 10');
  await page.setInputFiles('#b', { name: 'b.png', mimeType: 'image/png', buffer: png(49, 30) });
  [v, said] = await verdict('error');
  if (v !== 'error' || !said.includes('50×30 and 49×30')) failures.push(`compare: two sizes gave "${said}"`);
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`tools smoke failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('tools smoke: ok');
