// End-to-end check of the Object mask tool with the real SlimSAM model: serves dist/, answers the
// model requests from .cache/models (scripts/fetch-models.mjs; no network), clicks a tiger cub and
// checks that a masked exposure step brightens the cub and not the hay. Slow on SwiftShader (the
// app picks WASM there): ~30 s of inference.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';

const models = new URL('../../../.cache/models/', import.meta.url);
const server = await preview({ root: new URL('..', import.meta.url).pathname, preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const failures = [];
const check = (ok, msg) => ok || failures.push(msg);

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  await page.route('https://huggingface.co/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    route.fulfill({ status: 200, body: readFileSync(new URL(name, models)), headers: { 'content-type': 'application/octet-stream' } });
  });
  const frame = () => page.$eval('#status', (s) => Number(s.dataset.frame ?? 0));
  await page.goto(`${url}?sample=tiger-cubs`);
  await page.waitForFunction(() => Number(document.getElementById('status').dataset.frame ?? 0) > 0, null, { timeout: 60000 });

  // Exposure +1.5 EV, restricted by a brush mask.
  await page.$eval('#chain [name=ev]', (el) => {
    el.value = '1.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.selectOption('#chain select[data-action=mask-kind]', 'brush');
  await page.click('#chain [data-action=tool-object]');
  const box = await page.locator('#after').boundingBox();
  const n = await frame();
  // The right cub's body (uv 0.78, 0.62).
  await page.mouse.click(box.x + box.width * 0.78, box.y + box.height * 0.62);
  await page.waitForFunction(() => /Object selected|failed/.test(document.getElementById('announce').textContent), null, { timeout: 300000 });
  const said = await page.textContent('#announce');
  check(/Object selected/.test(said), `object selection: ${said}`);
  await page.waitForFunction((n) => Number(document.getElementById('status').dataset.frame ?? 0) > n, n, { timeout: 60000 });
  await page.waitForTimeout(500);

  // Brightness change (after vs before) on the cub and in the hay at the bottom-right corner.
  const gain = await page.evaluate(() => {
    const px = (id, u, v) => {
      const c = document.getElementById(id);
      const d = c.getContext('2d').getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data;
      return d[0] + d[1] + d[2];
    };
    return { cub: px('after', 0.78, 0.62) - px('before', 0.78, 0.62), hay: px('after', 0.97, 0.95) - px('before', 0.97, 0.95) };
  });
  check(gain.cub > 60, `the cub should be brighter: ${JSON.stringify(gain)}`);
  check(Math.abs(gain.hay) < 10, `the hay should be unchanged: ${JSON.stringify(gain)}`);
  console.log(`smoke-ml: ${said}; brightness change ${JSON.stringify(gain)}`);
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('smoke-ml: ok');
