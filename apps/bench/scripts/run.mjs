// `pnpm bench:web`: builds the benchmark page and serves it cross-origin isolated (wasm-vips needs
// it). Open the printed URL in your everyday browser (real GPU), press Run, download the JSON.
//
// `pnpm bench:web --headless [--sizes 640x480] [--runs 2] [--out results.json]` runs it in headless
// Chromium and writes the report; with --strict it fails if a library errored (the CI smoke run:
// SwiftShader timings mean nothing, the point is that every adapter still runs).
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { build, preview } from 'vite';

const root = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: Number(arg('--port', 4180)), strictPort: false } });
const url = server.resolvedUrls.local[0];

if (!args.includes('--headless')) {
  console.log(`\nBenchmark page: ${url}\nOpen it in Chrome or Edge (WebGPU), close other tabs, press Run, then Download JSON. Ctrl+C to stop.\n`);
} else {
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
  let failed = false;
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
    const query = new URLSearchParams({ auto: '1', sizes: arg('--sizes', '640x480'), runs: arg('--runs', '2'), ...(arg('--libs') ? { libs: arg('--libs') } : {}) });
    await page.goto(`${url}?${query}`);
    await page.waitForFunction(() => window.__report, null, { timeout: Number(arg('--timeout', 600)) * 1000 });
    const report = await page.evaluate(() => window.__report);
    console.log(await page.locator('#log').textContent());
    if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(report, null, 2));
    const errors = report.error ? [report.error] : report.rows.filter((r) => r.error).map((r) => `${r.adapter}: ${r.error}`);
    if (errors.length) console.error(`errors:\n${errors.join('\n')}`);
    failed = args.includes('--strict') && errors.length > 0;
  } finally {
    await browser.close();
    await server.close();
  }
  process.exit(failed ? 1 : 0);
}
