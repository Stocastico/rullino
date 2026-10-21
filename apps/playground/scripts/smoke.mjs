// End-to-end smoke test of the built playground: serves dist/ with `vite preview`, opens it in
// headless Chromium (WebGPU on SwiftShader without a GPU) and fails on any page error, on
// falling back to the CPU renderer, or if the chain does not change the pixels as expected.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ root: new URL('..', import.meta.url).pathname, preview: { port: 0, strictPort: false } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
const failures = [];
const check = (ok, msg) => ok || failures.push(msg);

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && failures.push(`console error: ${m.text()}`));

  const frame = () => page.$eval('#status', (s) => Number(s.dataset.frame ?? 0));
  /** Runs an action and waits until at least one new frame has finished after it. */
  const after = async (action) => {
    const n = await frame();
    await action();
    await page.waitForFunction((n) => Number(document.getElementById('status').dataset.frame ?? 0) > n, n, { timeout: 20000 });
    // Changes made during that frame collapse into one more; let it finish too.
    await page.waitForTimeout(50);
    const m = await frame();
    await page.waitForFunction((m) => Number(document.getElementById('status').dataset.frame ?? 0) >= m, m);
  };
  const status = () => page.textContent('#status');
  const slider = (name, value) =>
    page.$eval(`#chain [name=${name}]`, (el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
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

  await page.goto(url);
  await page.waitForFunction(() => Number(document.getElementById('status').dataset.frame ?? 0) > 0, null, { timeout: 30000 });
  check((await status()).startsWith('WebGPU'), `expected the WebGPU renderer, status was: ${await status()}`);

  // Initial chain is a single exposure step at 0 EV: identity.
  const identity = await differs();
  check(identity < 0.01, `exposure 0 EV should match the original, ${(identity * 100).toFixed(1)}% differs`);
  await after(() => slider('ev', 1.5));
  const changed = await differs();
  check(changed > 0.3, `exposure +1.5 EV changed only ${(changed * 100).toFixed(1)}% of channels`);

  // A linear-gradient mask (top to bottom by default) restricts the step to the bottom of the image.
  const rowDiff = () =>
    page.evaluate(() => {
      const px = (id) => { const c = document.getElementById(id); return [c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height]; };
      const [[a, w, h], [b]] = [px('before'), px('after')];
      const row = (y) => { let n = 0; for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) n += Math.abs(a[(y * w + x) * 4 + c] - b[(y * w + x) * 4 + c]); return n / (w * 3); };
      return [row(2), row(h - 3)];
    });
  await after(() => page.selectOption('#chain select[data-action=mask-kind]', 'linear'));
  const [top, bottom] = await rowDiff();
  check(top < 1 && bottom > 10, `linear mask: top row differs by ${top.toFixed(1)}, bottom by ${bottom.toFixed(1)}`);
  await after(() => page.$eval('#chain input[data-action=mask-invert]', (t) => { t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }));
  const [itop, ibottom] = await rowDiff();
  check(itop > 10 && ibottom < 1, `inverted mask: top row differs by ${itop.toFixed(1)}, bottom by ${ibottom.toFixed(1)}`);
  // Dragging the gradient's handles on the image reverses it: 'from' to the bottom, 'to' to the top.
  await after(() => page.$eval('#chain input[data-action=mask-invert]', (t) => { t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); }));
  const drag = async (handle, fy) => {
    const box = await page.locator(`#overlay [data-handle=${handle}]`).boundingBox();
    const stage = await page.locator('#after').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, stage.y + stage.height * fy, { steps: 4 });
    await page.mouse.up();
  };
  await after(() => drag('from', 0.97));
  await after(() => drag('to', 0.03));
  const [dtop, dbottom] = await rowDiff();
  check(dtop > 10 && dbottom < 1, `dragged mask: top row differs by ${dtop.toFixed(1)}, bottom by ${dbottom.toFixed(1)}`);
  await after(() => page.selectOption('#chain select[data-action=mask-kind]', 'none'));
  check((await page.$$('#overlay [data-handle]')).length === 0, 'mask handles should disappear with the mask');

  // Brush: an empty mask changes nothing; a stroke across the middle changes only that band.
  await after(() => page.selectOption('#chain select[data-action=mask-kind]', 'brush'));
  check((await differs()) < 0.01, 'an empty brush mask should leave the image unchanged');
  const midRows = () =>
    page.evaluate(() => {
      const px = (id) => { const c = document.getElementById(id); return [c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height]; };
      const [[a, w, h], [b]] = [px('before'), px('after')];
      const row = (y) => { let n = 0; for (let x = Math.floor(w * 0.6); x < Math.floor(w * 0.9); x++) for (let c = 0; c < 3; c++) n += Math.abs(a[(y * w + x) * 4 + c] - b[(y * w + x) * 4 + c]); return n / (Math.floor(w * 0.3) * 3); };
      return [row(Math.floor(h / 2)), row(2)];
    });
  await after(async () => {
    const box = await page.locator('#after').boundingBox();
    await page.mouse.move(box.x + box.width * 0.05, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
  });
  const [mid, edge] = await midRows();
  check(mid > 10 && edge < 1, `brush stroke: middle row differs by ${mid.toFixed(1)}, top row by ${edge.toFixed(1)}`);
  await after(() => page.click('#chain button[data-action=mask-clear]'));
  check((await differs()) < 0.01, 'clearing the brush mask should restore the image');

  // Magic wand on the colour chart: a click inside one patch selects that patch only;
  // refining the edges keeps it; Alt+click on the same patch removes it again.
  await after(() => page.selectOption('#sample', 'chart'));
  await page.click('#chain button[data-action=tool-wand]');
  const clickAt = async (fx, fy, alt = false) => {
    const box = await page.locator('#after').boundingBox();
    // mouse.click has no modifiers option: hold the key explicitly.
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    if (alt) await page.keyboard.up('Alt');
  };
  await after(() => clickAt(0.09, 0.12));
  const patch = await differs();
  check(patch > 0.01 && patch < 0.1, `wand on one chart patch changed ${(patch * 100).toFixed(1)}% of the image`);
  await after(() => clickAt(0.09, 0.12, true));
  check((await differs()) < 0.01, 'Alt+click with the wand should remove the selection');
  // Refining a selection that already follows the patch edges keeps it about the same
  // (the guided filter leaves a faint halo in the flat gap around it).
  await after(() => clickAt(0.09, 0.12));
  await after(() => page.click('#chain button[data-action=mask-refine]'));
  const refined = await differs();
  check(Math.abs(refined - patch) < 0.03, `refining a patch-aligned selection changed it from ${(patch * 100).toFixed(1)}% to ${(refined * 100).toFixed(1)}%`);
  await after(() => page.click('#chain button[data-action=mask-clear]'));
  await page.click('#chain button[data-action=tool-paint]');
  await after(() => page.selectOption('#sample', 'ramps'));
  await after(() => page.selectOption('#chain select[data-action=mask-kind]', 'none'));

  // Disabling the step brings the original back.
  await after(() => page.$eval('#chain input[data-action=toggle]', (t) => { t.checked = false; t.dispatchEvent(new Event('change')); }));
  check((await differs()) < 0.01, 'disabled step should leave the image unchanged');

  // Dragging a slider renders the reduced preview, releasing renders full resolution.
  await after(() => page.$eval('#chain input[data-action=toggle]', (t) => { t.checked = true; t.dispatchEvent(new Event('change')); }));
  await after(async () => {
    await page.$eval('#chain [name=ev]', (el) => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await slider('ev', -1);
  });
  check((await status()).includes('preview'), `expected a preview frame while dragging, status: ${await status()}`);
  await after(() => page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup'))));
  check(!(await status()).includes('preview'), `expected a full frame after release, status: ${await status()}`);

  // A .cube file loaded into a LUT step changes the image (an inverting LUT).
  const afterPixels = () => page.$eval('#after', (c) => Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data));
  await after(() => page.selectOption('#chain select[data-action=add]', 'applyLut'));
  const beforeLut = await afterPixels();
  const cube = ['LUT_3D_SIZE 2', ...[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${1 - r} ${1 - g} ${1 - b}`)))].join('\n');
  await after(() => page.setInputFiles('#chain input[type=file][name=look]', { name: 'invert.cube', mimeType: 'text/plain', buffer: Buffer.from(cube) }));
  const afterLut = await afterPixels();
  const lutChanged = afterLut.filter((v, i) => i % 4 !== 3 && Math.abs(v - beforeLut[i]) > 2).length / (afterLut.length * 0.75);
  check(lutChanged > 0.5, `an inverting .cube changed only ${(lutChanged * 100).toFixed(1)}% of channels`);
  check(/invert · 2³/.test(await page.textContent('#chain .lut-info')), 'LUT step should show the loaded file');

  // Adding a look appends its steps (LUT, vignette, grain for Noir) and turns the image black and white.
  const stepsBefore = await page.$$eval('#chain li[data-step]', (l) => l.length);
  await after(() => page.selectOption('#chain select[data-action=add-look]', 'noir'));
  check((await page.$$eval('#chain li[data-step]', (l) => l.length)) === stepsBefore + 3, 'the Noir look should add 3 steps');
  const colourful = await page.$eval('#after', (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) n += Math.max(Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2])) > 3 ? 1 : 0;
    return n / (d.length / 4);
  });
  check(colourful < 0.01, `after the Noir look ${(colourful * 100).toFixed(1)}% of pixels still have colour`);
  // Back to the chain without the look's steps, so the checks below see a known chain.
  for (let i = 0; i < 3; i++) await after(() => page.click('#chain li[data-step]:last-of-type button[data-action=remove]'));

  // Export happens at full resolution, not at the 2048 px display size.
  await after(() =>
    page.evaluate(async () => {
      const c = new OffscreenCanvas(2600, 1300);
      const g = c.getContext('2d');
      g.fillStyle = '#c84'; g.fillRect(0, 0, 2600, 1300);
      g.fillStyle = '#48c'; g.fillRect(400, 300, 1200, 600);
      const file = new File([await c.convertToBlob()], 'big.png', { type: 'image/png' });
      const input = document.getElementById('file');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change'));
    }),
  );
  const exported = async (format) => {
    await page.selectOption('#export-format', format);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('#export')]);
    return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
  };
  {
    const { name, bytes } = await exported('png16');
    check(name === 'big-rullino.png', `export file name: ${name}`);
    check(bytes.readUInt32BE(16) === 2600 && bytes.readUInt32BE(20) === 1300, `export size ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}, expected 2600x1300`);
    check(bytes[24] === 16, `expected a 16-bit PNG, bit depth ${bytes[24]}`);
  }
  {
    const { name, bytes } = await exported('jpeg');
    check(name === 'big-rullino.jpg' && bytes[0] === 0xff && bytes[1] === 0xd8, `expected a JPEG download, got ${name}`);
  }
  await after(() => page.selectOption('#sample', 'ramps'));

  // Every filter in one chain renders without errors.
  const ids = await page.$$eval('#chain select[data-action=add] option', (o) => o.map((x) => x.value).filter(Boolean));
  for (const id of ids) await after(() => page.selectOption('#chain select[data-action=add]', id));
  // Transparency at full strength (its default) would hide everything after it; the checks below
  // need to see a drawn image.
  await after(() => page.click('#chain button[data-action=select][aria-label="Edit Transparency"]'));
  await after(() => slider('amount', 0));
  check((await status()).includes(`${ids.length + 2} steps`), `expected ${ids.length + 2} steps, status: ${await status()}`);

  for (const s of await page.$$eval('#sample option', (o) => o.map((x) => x.value))) {
    await after(() => page.selectOption('#sample', s));
  }

  // Loading an image while a frame is in flight must still end with the new image fully drawn.
  await page.selectOption('#sample', 'ramps');
  await page.waitForTimeout(500);
  await page.selectOption('#sample', 'chart');
  await page.selectOption('#chain select[data-action=add]', 'canny');
  // Initial exposure + the LUT step + every filter + the canny just added.
  const expected = new RegExp(`Colour chart .* ${ids.length + 3} steps`);
  await page.waitForFunction((re) => new RegExp(re).test(document.getElementById('status').textContent), expected.source, { timeout: 20000 }).catch(() => {});
  check(expected.test(await status()), `renderer stuck after racing a load with a render, status: ${await status()}`);
  const opaque = await page.evaluate(() => {
    const c = document.getElementById('after');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) n += d[i] > 0 ? 1 : 0;
    return n / (d.length / 4);
  });
  check(opaque > 0.9, `after canvas is ${(100 - opaque * 100).toFixed(0)}% transparent after the race`);
  // Two loads back to back: the last one must win, with matching canvas sizes.
  await page.selectOption('#sample', 'alpha');
  await page.selectOption('#sample', 'ramps');
  await page.waitForFunction(() => /Ramps & hues/.test(document.getElementById('status').textContent), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const sizes = await page.evaluate(() => ['before', 'after'].map((id) => { const c = document.getElementById(id); return `${c.width}x${c.height}`; }));
  check(/Ramps & hues/.test(await status()), `last load should win, status: ${await status()}`);
  check(sizes.every((s) => s === '768x384'), `canvas sizes after back-to-back loads: ${sizes.join(', ')}`);

  console.log(`smoke: ${ids.length} filters chained, status "${await status()}"`);
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('smoke: ok');
