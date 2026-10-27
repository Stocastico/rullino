// Spike #72 (not merged): every filter at its defaults on Dawn in Node vs the CPU reference, published packages.
import { create, globals } from 'webgpu';
Object.assign(globalThis, globals);
Object.defineProperty(globalThis.navigator, 'gpu', { value: create([]), configurable: true });

const core = await import('@rullino/core');
const { filters } = await import('@rullino/filters');
const { createGpuContext, createImage, compareImages, fromFloat16Array, toFloat16Array, uploadImage, readImage, runFilter, runChainCpu, Pipeline, defaultParams } = core;

const errors = [];
const ctx = await createGpuContext({ onError: (e) => errors.push(e.message ?? String(e)) });
console.log('limits', ctx.limits.maxTextureDimension2D, ctx.limits.maxBufferSize);

// Same noise image as the browser parity test (float16-quantised).
function testImage(w, h) {
  const data = new Float32Array(w * h * 4);
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < data.length; i += 4) {
    const a = i % 52 === 0 ? 0 : 0.2 + 0.8 * rand();
    data.set([rand() * a, rand() * a, rand() * 1.5 * a, a], i);
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}
const src = testImage(67, 45);

// Every registered filter at its defaults (mask-aware ones skipped: they need a mask).
let pass = 0;
const fails = [];
for (const f of filters) {
  if (f.kind === 'multipass' && f.usesMask) continue;
  const params = defaultParams(f.params);
  const gpu = await readImage(ctx, runFilter(ctx, f, uploadImage(ctx, src), params));
  const res = compareImages(gpu, f.cpu(src, params), f.tolerance);
  if (res.pass) pass++;
  else fails.push(`${f.id}: ${res.outliers} outliers, worst ${JSON.stringify(res.worst)}`);
}
console.log(`defaults parity: ${pass} pass, ${fails.length} fail`);
for (const l of fails) console.log('  FAIL', l);

// A fused chain through the Pipeline (pointwise fusion + a multipass stage).
const byId = (id) => filters.find((f) => f.id === id);
const steps = [
  { filter: byId('exposure'), params: { ev: 0.5 } },
  { filter: byId('contrast'), params: { amount: 0.2 } },
  { filter: byId('gaussianBlur'), params: { sigma: 2 } },
  { filter: byId('vignette') },
];
const pipeline = new Pipeline(ctx);
pipeline.setSource(uploadImage(ctx, src));
const chainGpu = await readImage(ctx, pipeline.run(steps));
const chainCpu = runChainCpu(steps, src);
let worst = 0;
for (let i = 0; i < chainCpu.data.length; i++) worst = Math.max(worst, Math.abs(chainGpu.data[i] - chainCpu.data[i]));
console.log('chain max |gpu - cpu|', worst);

await ctx.device.queue.onSubmittedWorkDone();
console.log('gpu errors', errors.length, errors.slice(0, 3));
ctx.device.destroy();
if (fails.length || errors.length) process.exit(1);
