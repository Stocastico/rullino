// The built playground in a browser WITHOUT WebGPU (Firefox / Safari today): it must say it runs on
// the CPU, render, react to controls, stay responsive while rendering and export. Fails on any page error.
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: fileURLToPath(new URL('..', import.meta.url)), preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls.local[0];
// No `--enable-unsafe-webgpu`: `requestAdapter()` finds nothing.
const browser = await chromium.launch({ args: ['--disable-gpu'] });
const failures = [];
const check = (ok, msg) => ok || failures.push(msg);

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`));
  const frame = () => page.$eval('#status', (s) => Number(s.dataset.frame ?? 0));
  const nextFrame = async (action, timeout = 60000) => {
    const n = await frame();
    await action();
    await page.waitForFunction((n) => Number(document.getElementById('status').dataset.frame ?? 0) > n, n, { timeout });
  };

  await page.goto(`${url}?sample=ramps`);
  await page.waitForFunction(() => Number(document.getElementById('status').dataset.frame ?? 0) > 0, null, { timeout: 60000 });
  const status = () => page.textContent('#status');
  check((await status()).startsWith('On the CPU'), `expected the CPU renderer, status was: ${await status()}`);

  // A slow effect must not freeze the page: a timer keeps ticking while it renders.
  await page.evaluate(() => {
    window.__ticks = 0;
    setInterval(() => window.__ticks++, 20);
  });
  const before = await page.evaluate(() => window.__ticks);
  await nextFrame(() => page.evaluate(() => window.rullino.add('kuwahara')));
  const ticks = (await page.evaluate(() => window.__ticks)) - before;
  check(ticks >= 5, `the page was frozen while the CPU rendered (${ticks} timer ticks)`);

  // The chain changes the picture.
  await nextFrame(() => page.evaluate(() => window.rullino.add('invert')));
  const differs = await page.evaluate(() => {
    const px = (id) => {
      const c = document.getElementById(id);
      return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    };
    const [a, b] = [px('before'), px('after')];
    let n = 0;
    for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i]) > 2 ? 1 : 0;
    return n / a.length;
  });
  check(differs > 0.01, `the chain did not change the picture (${differs})`);

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('#export')]);
  check(download.suggestedFilename().endsWith('.png'), `export file name: ${download.suggestedFilename()}`);
} finally {
  await browser.close();
  await server.close();
}
if (failures.length) {
  console.error(failures.map((f) => `FAIL ${f}`).join('\n'));
  process.exit(1);
}
console.log('smoke-cpu: ok');
