// The built page (dist/) served from a sub-path, opened in headless Chromium: it must describe the
// device, run the parity check on two filters (?only=) with ?auto=1 and report none outside the
// published tolerance (CI's software GPU is what the tolerances are calibrated on), and the speed
// check must produce its lines. Fails on a console error, a failed request or a 404.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { launchOptions } from '../../../scripts/browser-launch.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const PREFIX = '/sites/rullino/check/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const failures = [];
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ does not exist: run pnpm build first');

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = path.startsWith(PREFIX) ? normalize(path.slice(PREFIX.length) || 'index.html') : undefined;
  const file = rel && !rel.startsWith('..') ? join(dist, rel.endsWith('/') ? `${rel}index.html` : rel) : undefined;
  if (!file || !existsSync(file) || statSync(file).isDirectory()) return void res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://localhost:${server.address().port}${PREFIX}?auto=1&only=exposure,gaussianBlur`;

const browser = await chromium.launch(launchOptions());
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`));
  page.on('requestfailed', (r) => failures.push(`request failed: ${r.url()}`));
  page.on('response', (r) => r.status() >= 400 && failures.push(`HTTP ${r.status()}: ${r.url()}`));
  await page.goto(url);
  await page.waitForSelector('#status[data-done]', { timeout: 120000 });
  const env = await page.textContent('#env');
  if (!/WebGPU: available/.test(env ?? '')) failures.push(`no WebGPU in the page: ${env}`);
  const done = await page.getAttribute('#status', 'data-done');
  if (done !== 'parity') failures.push(`the parity check ended with "${done}": ${await page.textContent('#status')}`);
  const verdict = (await page.textContent('#parity')) ?? '';
  if (!/ 0 outside the published tolerance/.test(verdict)) failures.push(`parity verdict: ${verdict.slice(0, 200)}`);
  if (Number(/(\d+) cases/.exec(verdict)?.[1] ?? 0) < 10) failures.push(`the parity check ran too few cases: ${verdict.slice(0, 120)}`);
  await page.click('#run-speed');
  await page.waitForSelector('#speed[data-done]', { timeout: 300000 });
  const speed = (await page.textContent('#speed')) ?? '';
  if (!/GPU 12 MP[^\n]*first \d+ ms/.test(speed) || !/CPU 12 MP[^\n]*first \d+ ms/.test(speed)) failures.push(`speed lines missing:\n${speed}`);
  const report = await page.evaluate(async () => (document.getElementById('copy').click(), 'clicked'));
  if (report !== 'clicked') failures.push('copy button missing');
} finally {
  await browser.close();
  server.close();
}
if (failures.length) {
  console.error(`hardware-check smoke failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('hardware-check smoke: ok');
