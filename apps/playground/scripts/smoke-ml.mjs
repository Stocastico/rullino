// End-to-end check of the ML tools with the real models: serves dist/, answers the model requests
// from .cache/models (scripts/fetch-models.mjs; no network).
//  1. Object tool (SlimSAM): clicks a tiger cub; a masked exposure step brightens the cub, not the hay.
//  2. Remove object (MI-GAN): selects the cub with the Object tool and fills it; the cub's pixels
//     change a lot, the hay far away does not.
// Slow on SwiftShader (the app picks WASM there): about a minute of inference in all.
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

  // 2. Remove object, on a fresh page.
  const removal = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  removal.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  await removal.route('https://huggingface.co/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    route.fulfill({ status: 200, body: readFileSync(new URL(name, models)), headers: { 'content-type': 'application/octet-stream' } });
  });
  await removal.goto(`${url}?sample=tiger-cubs`);
  await removal.waitForFunction(() => Number(document.getElementById('status').dataset.frame ?? 0) > 0, null, { timeout: 60000 });
  await removal.selectOption('#chain select[data-action=add]', 'patch');
  await removal.click('#chain [data-action=tool-object]');
  const box2 = await removal.locator('#after').boundingBox();
  await removal.mouse.click(box2.x + box2.width * 0.78, box2.y + box2.height * 0.62);
  await removal.waitForFunction(() => /Object selected|failed/.test(document.getElementById('announce').textContent), null, { timeout: 300000 });
  check(/Object selected/.test(await removal.textContent('#announce')), `object selection (removal): ${await removal.textContent('#announce')}`);
  await removal.click('#chain [data-action=fill]');
  await removal.waitForFunction(() => /Area filled|failed/.test(document.getElementById('announce').textContent), null, { timeout: 300000 });
  const filled = await removal.textContent('#announce');
  check(/Area filled/.test(filled), `fill: ${filled}`);
  // Frames are not proof that the latest state is shown: wait for the cub's pixels to change.
  const measure = () =>
    removal.evaluate(() => {
      const px = (id, u, v) => {
        const c = document.getElementById(id);
        const d = c.getContext('2d').getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const diff = (u, v) => px('after', u, v).reduce((s, x, i) => s + Math.abs(x - px('before', u, v)[i]), 0);
      return { cub: diff(0.78, 0.62), hay: diff(0.97, 0.95) };
    });
  let change = await measure();
  for (let i = 0; i < 40 && change.cub <= 40; i++) {
    await removal.waitForTimeout(500);
    change = await measure();
  }
  check(change.cub > 40, `the cub should be gone: ${JSON.stringify(change)}`);
  check(change.hay < 10, `the hay should be unchanged: ${JSON.stringify(change)}`);
  console.log(`smoke-ml: ${filled}; pixel change ${JSON.stringify(change)}`);
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('smoke-ml: ok');
