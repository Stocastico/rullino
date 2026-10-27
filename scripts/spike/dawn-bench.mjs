// Spike #72 (not merged): the three PLAN chains at 12 MP on Dawn in Node (software Vulkan on CI) vs the CPU reference.
import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);
Object.defineProperty(globalThis.navigator, 'gpu', { value: create([]), configurable: true });

const { createGpuContext, createImage, uploadImage, readImage, Pipeline, runChainCpu, lutFromFunction } = await import('@rullino/core');
const { filters } = await import('@rullino/filters');
const byId = (id) => filters.find((f) => f.id === id);

const [W, H] = [4000, 3000];
const data = new Float32Array(W * H * 4);
for (let i = 0; i < W * H; i++) data.set([(i % 997) / 997, ((i * 7) % 499) / 499, ((i * 13) % 251) / 251, 1], i * 4);
const img = createImage(W, H, data);
const lut = lutFromFunction(33, (r, g, b) => [Math.sqrt(r), g * g, (r + b) / 2]);

const chains = {
  'exposure + curves + LUT': [
    { filter: byId('exposure'), params: { ev: 0.3 } },
    { filter: byId('curves'), params: { rgb: [[0, 0], [0.3, 0.25], [0.7, 0.8], [1, 1]] } },
    { filter: byId('applyLut'), params: { look: lut } },
  ],
  'blur + unsharp': [
    { filter: byId('gaussianBlur'), params: { sigma: 3 } },
    { filter: byId('unsharpMask'), params: { amount: 0.8 } },
  ],
  'levels + vignette + grain': [
    { filter: byId('levels') , params: { inBlack: 0.05 } },
    { filter: byId('vignette') },
    { filter: byId('grain') },
  ],
};

const ctx = await createGpuContext();
const t0 = performance.now();
const tex = uploadImage(ctx, img);
await ctx.device.queue.onSubmittedWorkDone();
console.log(`upload 12 MP: ${(performance.now() - t0).toFixed(0)} ms`);
const ms = (t) => `${(performance.now() - t).toFixed(0)} ms`;

for (const [name, steps] of Object.entries(chains)) {
  const p = new Pipeline(ctx);
  p.setSource(tex);
  let t = performance.now();
  let out = p.run(steps);
  await ctx.device.queue.onSubmittedWorkDone();
  const first = ms(t); // includes shader compilation
  p.setSource(uploadImage(ctx, img)); // new source: no cached stages
  t = performance.now();
  out = p.run(steps);
  await ctx.device.queue.onSubmittedWorkDone();
  const warm = ms(t);
  t = performance.now();
  await readImage(ctx, out);
  const read = ms(t);
  let cpu = 'skipped';
  if (process.argv.includes('--cpu')) {
    t = performance.now();
    runChainCpu(steps, img);
    cpu = ms(t);
  }
  console.log(`${name}: gpu first ${first}, warm ${warm}, readback ${read}, cpu ${cpu}`);
}
ctx.device.destroy();
