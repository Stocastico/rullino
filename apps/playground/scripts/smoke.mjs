// End-to-end smoke test of the built playground: serves dist/ with `vite preview`, opens it in
// headless Chromium (WebGPU on SwiftShader without a GPU) and fails on any page error, on
// falling back to the CPU renderer, or if a filter leaves the image unchanged.
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: new URL('..', import.meta.url).pathname, preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const failures = [];

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`));
  await page.goto(url);
  await page.waitForFunction(() => /ms$/.test(document.getElementById('status').textContent), null, { timeout: 20000 });

  const status = await page.textContent('#status');
  if (!status.startsWith('WebGPU')) failures.push(`expected the WebGPU renderer, status was: ${status}`);

  const setSlider = (name, value) =>
    page.$eval(`[name=${name}]`, (el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const settle = () => page.waitForFunction(() => /ms$/.test(document.getElementById('status').textContent) && !document.getElementById('status').textContent.startsWith('Render failed'));
  const differs = () =>
    page.evaluate(() => {
      const px = (id) => {
        const c = document.getElementById(id);
        return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      };
      const [a, b] = [px('before'), px('after')];
      let n = 0;
      for (let i = 0; i < a.length; i++) n += Math.abs(a[i] - b[i]) > 2 ? 1 : 0;
      return n / a.length;
    });

  // Every filter renders without errors.
  const ids = await page.$$eval('#filter option', (o) => o.map((x) => x.value));
  for (const id of ids) {
    await page.selectOption('#filter', id);
    await settle();
  }

  // A visible change actually reaches the canvas.
  await page.selectOption('#filter', 'exposure');
  await setSlider('ev', 0);
  await page.waitForTimeout(300);
  const identity = await differs();
  if (identity > 0.01) failures.push(`exposure 0 EV should match the original, ${(identity * 100).toFixed(1)}% differs`);
  await setSlider('ev', 1.5);
  await page.waitForTimeout(300);
  const changed = await differs();
  if (changed < 0.3) failures.push(`exposure +1.5 EV changed only ${(changed * 100).toFixed(1)}% of channels`);

  for (const s of await page.$$eval('#sample option', (o) => o.map((x) => x.value))) {
    await page.selectOption('#sample', s);
    await settle();
  }
  console.log(`smoke: ${ids.length} filters, status "${await page.textContent('#status')}"`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('smoke: ok');
