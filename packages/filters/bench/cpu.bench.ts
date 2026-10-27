// CPU timings: every registered filter's reference at 1024x768 and the three PLAN §6b chains at
// 12 MP, with their fast paths where they have one. Not a test: run with `pnpm bench:cpu`.
import { writeFileSync } from 'node:fs';
import { createImage, defaultParams, lutFromFunction, runChainCpu, type LinearImage, type Step } from '@rullino/core';
import { filters } from '../src';
import { afterAll, it } from 'vitest';

const rows: string[] = [];
afterAll(() => writeFileSync(new URL('./cpu-results.txt', import.meta.url), `${rows.join('\n')}\n`));
const ms = (t: number) => `${t.toFixed(0).padStart(8)} ms`;
/** Reference time, and the fast path's when the filter (or a filter of the chain) has one. */
const row = (name: string, ref: number, fast?: number) => rows.push(`${name.padEnd(34)} ${ms(ref)}${fast === undefined ? '' : `   fast ${ms(fast)}`}`);

function image(w: number, h: number): LinearImage {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - w / 2, y - h / 2) * 0.08) * (x / w);
      data.set([v * v, v, v * 0.8, 1], (y * w + x) * 4);
    }
  return createImage(w, h, data);
}

function time(run: () => unknown): number {
  const t0 = performance.now();
  run();
  return performance.now() - t0;
}

const byId = new Map(filters.map((f) => [f.id, f]));
const step = (id: string, params: Record<string, unknown> = {}): Step => ({ filter: byId.get(id)!, params });

/** The chains PLAN §6b measured (26 Oct: 10.0 s, 8.0 s, 14.3 s at 12 MP). */
export const planChains: Record<string, Step[]> = {
  'exposure + curves + LUT': [
    step('exposure', { ev: 0.3 }),
    step('curves', { rgb: [[0, 0], [0.3, 0.25], [0.7, 0.8], [1, 1]] }),
    step('applyLut', { look: lutFromFunction(33, (r, g, b) => [Math.sqrt(r), g * g, (r + b) / 2]) }),
  ],
  'blur + unsharp': [step('gaussianBlur', { sigma: 3 }), step('unsharpMask', { amount: 0.8 })],
  'levels + vignette + grain': [step('levels', { inBlack: 0.05 }), step('vignette'), step('grain')],
};

it('chains at 12 MP', () => {
  const src = image(4000, 3000);
  for (const [name, steps] of Object.entries(planChains))
    row(`chain: ${name}`, time(() => runChainCpu(steps, src)), time(() => runChainCpu(steps, src, { fast: true })));
});

it('filters at 1024x768', () => {
  const src = image(1024, 768);
  const hole = { kind: 'radial', center: [0.5, 0.5], radius: [0.15, 0.1], feather: 0.3 } as const;
  for (const f of filters) {
    const mask = f.kind === 'multipass' && f.usesMask ? hole : undefined;
    const steps: Step[] = [{ filter: f, params: defaultParams(f.params), ...(mask && { mask }) }];
    row(f.id, time(() => runChainCpu(steps, src)), f.fast && time(() => runChainCpu(steps, src, { fast: true })));
  }
});
