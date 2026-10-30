// How far this machine's GPU is from the CPU references, case by case. Not a test: it never fails on
// numbers. The parity tests (`pnpm test:browser`) are calibrated on a software GPU (SwiftShader in CI);
// run `pnpm report:parity` on real hardware to see where it differs and by how much, then decide per
// filter. Writes packages/filters/report/parity-report.json and parity-report.md.
import { compareImages, createGpuContext, decodeSrgb8, defaultParams, maskImage, readImage, runFilter, uploadImage, uploadSrgb8, type Filter, type Tolerance } from '@rullino/core';
import { afterAll, it } from 'vitest';
import { commands } from 'vitest/browser';
import { filters } from '../src';
import { parityCases, parityImages, parityMask } from '../src/test-utils';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

interface Row {
  readonly group: string; // a filter id, or `8-bit sRGB decode`
  readonly image: string;
  readonly case: string;
  readonly tolerance: Tolerance;
  readonly channels: number;
  readonly outliers: number;
  readonly allowedOutliers: number;
  readonly pass: boolean;
  /** Largest |gpu - cpu|. */
  readonly worstAbs: number;
  /** Largest |gpu - cpu| / (abs + rel·|cpu|): above 1 is out of tolerance. 1e9 when the tolerance is 0. */
  readonly worstRatio: number;
  /** The `abs` that would make every channel pass with the same `rel`: tolerance.abs + the worst excess. */
  readonly needAbs: number;
}

/** Worst deviation figures, beyond what `compareImages` reports. */
function measure(actual: Float32Array, expected: Float32Array, tol: Tolerance) {
  let worstAbs = 0, worstRatio = 0, worstExcess = 0;
  for (let i = 0; i < actual.length; i++) {
    const d = Math.abs(actual[i]! - expected[i]!);
    if (Number.isNaN(d)) return { worstAbs: Number.NaN, worstRatio: 1e9, needAbs: Number.NaN };
    const allowed = tol.abs + tol.rel * Math.abs(expected[i]!);
    worstAbs = Math.max(worstAbs, d);
    worstRatio = Math.max(worstRatio, allowed > 0 ? d / allowed : d > 0 ? 1e9 : 0);
    worstExcess = Math.max(worstExcess, d - tol.rel * Math.abs(expected[i]!));
  }
  return { worstAbs, worstRatio: Math.min(worstRatio, 1e9), needAbs: Math.max(tol.abs, worstExcess) };
}

function row(group: string, image: string, name: string, actual: { width: number; height: number; data: Float32Array }, expected: { width: number; height: number; data: Float32Array }, tol: Tolerance): Row {
  const cmp = compareImages(actual as never, expected as never, tol);
  return { group, image, case: name, tolerance: tol, channels: actual.data.length, outliers: cmp.outliers, allowedOutliers: Math.floor((tol.outliers ?? 0) * actual.data.length), pass: cmp.pass, ...measure(actual.data, expected.data, tol) };
}

const sig = (v: number) => (v === 0 ? '0' : v >= 1e9 ? '>1e9' : Number.isNaN(v) ? 'NaN' : v.toPrecision(3));

it('writes the parity report', { timeout: 600_000 }, async () => {
  const rows: Row[] = [];

  for (const f of filters as Filter[]) {
    const mask = f.kind === 'multipass' && f.usesMask ? parityMask : undefined;
    for (const [img, src] of Object.entries(parityImages))
      for (const [name, params] of parityCases(f.params)) {
        const full = { ...defaultParams(f.params), ...params } as never;
        const out = await readImage(ctx, runFilter(ctx, f, uploadImage(ctx, src), full, mask));
        const expected = mask ? f.cpu(src, full, maskImage(mask, src.width, src.height)) : f.cpu(src, full);
        rows.push(row(f.id, img, name, out, expected, f.tolerance));
      }
  }

  // The 8-bit sRGB decode the GPU does on upload (hardware sRGB texture format), against decodeSrgb8.
  const w = 64, h = 48;
  const bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 4 === 3 ? (i % 16 === 3 ? 90 : 255) : (i * 37 + (i >> 3) * 11) & 255;
  rows.push(row('8-bit sRGB decode', 'gradient', 'uploadSrgb8', await readImage(ctx, uploadSrgb8(ctx, bytes, w, h)), decodeSrgb8(bytes, w, h), { abs: 1e-4, rel: 2 ** -9 }));

  const adapter = await navigator.gpu.requestAdapter();
  const { vendor, architecture, device, description, isFallbackAdapter } = adapter!.info;
  const info = { vendor, architecture, device, description, isFallbackAdapter };

  const groups = [...new Set(rows.map((r) => r.group))].map((id) => {
    const rs = rows.filter((r) => r.group === id);
    const failing = rs.filter((r) => !r.pass);
    return {
      id,
      cases: rs.length,
      failing: failing.length,
      worstAbs: Math.max(...rs.map((r) => r.worstAbs)),
      needAbs: Math.max(...rs.map((r) => r.needAbs)),
      worstOutlierFraction: Math.max(...rs.map((r) => r.outliers / r.channels)),
      tolerance: rs[0]!.tolerance,
    };
  });
  groups.sort((a, b) => b.failing - a.failing || b.worstAbs - a.worstAbs);

  const failing = rows.filter((r) => !r.pass).sort((a, b) => b.worstRatio - a.worstRatio);
  const md = [
    `# Parity report: ${new Date().toISOString()}`,
    '',
    `GPU: ${JSON.stringify(info)}`,
    `${rows.length} cases, ${failing.length} outside the published tolerance, ${groups.filter((g) => g.failing > 0).length} of ${groups.length} groups affected.`,
    '',
    '## Per filter (affected first)',
    '',
    '"abs needed" ignores the share of outliers a filter may have; where that share is above 0 read "Worst outlier share" too.',
    '',
    '| Filter | Cases | Failing | Published abs / rel / outliers | Worst abs | abs needed (same rel) | Worst outlier share |',
    '|---|---|---|---|---|---|---|',
    ...groups.map((g) => `| ${g.id} | ${g.cases} | ${g.failing} | ${g.tolerance.abs} / ${g.tolerance.rel} / ${g.tolerance.outliers ?? 0} | ${sig(g.worstAbs)} | ${sig(g.needAbs)} | ${sig(100 * g.worstOutlierFraction)} % |`),
    '',
    '## Failing cases (worst first)',
    '',
    '| Filter | Image | Case | Outliers / allowed / channels | Worst abs | Worst ratio |',
    '|---|---|---|---|---|---|',
    ...failing.map((r) => `| ${r.group} | ${r.image} | ${r.case} | ${r.outliers} / ${r.allowedOutliers} / ${r.channels} | ${sig(r.worstAbs)} | ${sig(r.worstRatio)} |`),
    '',
  ].join('\n');

  await commands.writeFile('packages/filters/report/parity-report.json', `${JSON.stringify({ date: new Date().toISOString(), gpu: info, groups, rows }, null, 1)}\n`);
  await commands.writeFile('packages/filters/report/parity-report.md', md);
});
