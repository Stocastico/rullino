// The built playground served from a sub-path, the way GitHub Pages serves a project site
// (https://<user>.github.io/rullino/, or a custom domain with a path): nothing may depend on
// being at the root. Serves dist/ under /sites/rullino/ with a plain static server (anything
// outside answers 404), opens it in headless Chromium and fails on a missing file, a failed request,
// a page error, or if no frame is rendered.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const PREFIX = '/sites/rullino/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const failures = [];
const check = (ok, msg) => ok || failures.push(msg);

if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ does not exist: run pnpm build first');

// Static check: no root-absolute URLs in what the browser loads first.
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
for (const file of walk(dist).filter((f) => /\.(html|css)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:src|href)=["'](\/[^/"'][^"']*)["']|url\(\s*["']?(\/[^/)"'][^)"']*)/g)) failures.push(`${file.slice(dist.length)}: root-absolute URL ${m[1] ?? m[2]}`);
}

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = path.startsWith(PREFIX) ? normalize(path.slice(PREFIX.length) || 'index.html') : undefined;
  const file = rel && !rel.startsWith('..') ? join(dist, rel.endsWith('/') ? `${rel}index.html` : rel) : undefined;
  if (!file || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}${PREFIX}`;

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`));
  page.on('requestfailed', (r) => failures.push(`request failed: ${r.url()}`));
  page.on('response', (r) => r.status() >= 400 && failures.push(`HTTP ${r.status()}: ${r.url()}`));
  await page.goto(url);
  await page.waitForFunction(() => Number(document.getElementById('status')?.dataset.frame ?? 0) > 0, null, { timeout: 60000 });
  const status = await page.textContent('#status');
  check(/WebGPU/.test(status ?? ''), `rendered without WebGPU: ${status}`);
  // The default sample is a photo fetched relative to the page: it must be on screen, not a blank canvas.
  const drawn = await page.evaluate(() => {
    const c = document.getElementById('after');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let distinct = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) distinct.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return distinct.size;
  });
  check(drawn > 50, `the sample photo is not on the canvas (${drawn} distinct colours)`);
  console.log(`smoke-base: ${status} at ${url}`);
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('smoke-base: ok');
