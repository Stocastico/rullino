// GPU timings for every registered filter and a typical chain. Not a test: run with `pnpm bench`.
// Absolute numbers on SwiftShader (CI, cloud sessions) are not GPU numbers; compare runs, not machines.
import { createGpuContext, createImage, defaultParams, Pipeline, readSrgb8, releaseTexture, runFilter, uploadImage, type Step } from '@rullino/core';
import { filters } from '../src';
import { afterAll, it } from 'vitest';
import { commands } from 'vitest/browser';

const W = 1024;
const H = 768;
const RUNS = 5;

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

const data = new Float32Array(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - W / 2, y - H / 2) * 0.08) * (x / W);
    data.set([v * v, v, v * 0.8, 1], (y * W + x) * 4);
  }
const source = uploadImage(ctx, createImage(W, H, data));

async function time(run: () => GPUTexture | void): Promise<number> {
  const t0 = performance.now();
  const out = run();
  await ctx.device.queue.onSubmittedWorkDone();
  const dt = performance.now() - t0;
  // Released, not destroyed: that is what the Pipeline does, so pooled reuse is measured too.
  if (out && out !== source) releaseTexture(ctx, out);
  return dt;
}

async function measure(run: () => GPUTexture | void): Promise<{ first: number; median: number }> {
  const first = await time(run); // includes shader compilation
  const ts: number[] = [];
  for (let i = 0; i < RUNS; i++) ts.push(await time(run));
  ts.sort((a, b) => a - b);
  return { first, median: ts[Math.floor(RUNS / 2)]! };
}

const rows: string[] = [];
// Browser console output is not forwarded to the terminal, so results go to a file.
afterAll(() => commands.writeFile('packages/filters/bench/results.txt', `${W}x${H}, median of ${RUNS} (first run incl. compile)\n${rows.join('\n')}\n`));
const row = (name: string, r: { first: number; median: number }) =>
  rows.push(`${name.padEnd(28)} ${r.median.toFixed(1).padStart(8)} ms   (first ${r.first.toFixed(0)} ms)`);

it('filters at defaults', async () => {
  for (const f of filters) row(f.id, await measure(() => runFilter(ctx, f, source, defaultParams(f.params))));
});

it('readback', async () => {
  row('readSrgb8 (readback)', await measure(() => void readSrgb8(ctx, source)));
});

it('typical chain (Pipeline, uncached)', async () => {
  const byId = new Map(filters.map((f) => [f.id, f]));
  const steps: Step[] = ['exposure', 'contrast', 'vibrance', 'whiteBalance', 'unsharpMask', 'gamma'].map((id) => ({ filter: byId.get(id)! }));
  const p = new Pipeline(ctx);
  // setSource bumps the source version, so every run recomputes the whole chain. The output
  // belongs to the pipeline, hence the void.
  row('chain: 4 pointwise + USM + 1', await measure(() => void (p.setSource(source), p.run(steps))));
  p.destroy();
});
