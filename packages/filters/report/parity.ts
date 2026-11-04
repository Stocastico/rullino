// The parity measurement shared by `pnpm report:parity` (Vitest browser, writes files) and the hardware
// check page (apps/hardware-check, any browser): runs every filter on the GPU of `ctx` and on the CPU
// reference, case by case, and reports how far apart they are. Never fails on numbers.
import { compareImages, decodeSrgb8, defaultParams, maskImage, readImage, runFilter, uploadImage, uploadSrgb8, type Filter, type GpuContext, type Tolerance } from '@rullino/core';
import { filters } from '../src';
import { parityCases, parityImages, parityMask } from '../src/test-utils';

export interface Row {
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

export interface Group {
  readonly id: string;
  readonly cases: number;
  readonly failing: number;
  readonly worstAbs: number;
  readonly needAbs: number;
  readonly worstOutlierFraction: number;
  readonly tolerance: Tolerance;
}

export interface GpuInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean;
}

export interface ParityResult {
  readonly date: string;
  readonly gpu: GpuInfo;
  readonly groups: Group[];
  readonly rows: Row[];
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

type Img = { width: number; height: number; data: Float32Array };

function row(group: string, image: string, name: string, actual: Img, expected: Img, tol: Tolerance): Row {
  const cmp = compareImages(actual as never, expected as never, tol);
  return { group, image, case: name, tolerance: tol, channels: actual.data.length, outliers: cmp.outliers, allowedOutliers: Math.floor((tol.outliers ?? 0) * actual.data.length), pass: cmp.pass, ...measure(actual.data, expected.data, tol) };
}

export interface ParityOptions {
  /** Only these filter ids (and not the 8-bit decode check). */
  readonly only?: readonly string[];
  /** Called before each filter with (index, total, id); a page can await a frame here. */
  readonly onProgress?: (done: number, total: number, id: string) => void | Promise<void>;
}

export async function runParity(ctx: GpuContext, options: ParityOptions = {}): Promise<ParityResult> {
  const rows: Row[] = [];
  const list = (filters as Filter[]).filter((f) => !options.only || options.only.includes(f.id));
  let done = 0;
  for (const f of list) {
    await options.onProgress?.(done++, list.length, f.id);
    const mask = f.kind === 'multipass' && f.usesMask ? parityMask : undefined;
    for (const [img, src] of Object.entries(parityImages))
      for (const [name, params] of parityCases(f.params)) {
        const full = { ...defaultParams(f.params), ...params } as never;
        const out = await readImage(ctx, runFilter(ctx, f, uploadImage(ctx, src), full, mask));
        const expected = mask ? f.cpu(src, full, maskImage(mask, src.width, src.height)) : f.cpu(src, full);
        rows.push(row(f.id, img, name, out, expected, f.tolerance));
      }
  }

  if (!options.only) {
    // The 8-bit sRGB decode the GPU does on upload (hardware sRGB texture format), against decodeSrgb8.
    const w = 64, h = 48;
    const bytes = new Uint8Array(w * h * 4);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 4 === 3 ? (i % 16 === 3 ? 90 : 255) : (i * 37 + (i >> 3) * 11) & 255;
    rows.push(row('8-bit sRGB decode', 'gradient', 'uploadSrgb8', await readImage(ctx, uploadSrgb8(ctx, bytes, w, h)), decodeSrgb8(bytes, w, h), { abs: 1e-4, rel: 2 ** -9 }));
  }

  // Older Safari has no `adapter.info` (it has `requestAdapterInfo()`); report what the browser gives.
  const adapter = (await navigator.gpu.requestAdapter()) as (GPUAdapter & { requestAdapterInfo?: () => Promise<GPUAdapterInfo>; isFallbackAdapter?: boolean }) | null;
  const info: Partial<GPUAdapterInfo> = adapter?.info ?? (await adapter?.requestAdapterInfo?.()) ?? {};
  const gpu: GpuInfo = { vendor: info.vendor ?? '', architecture: info.architecture ?? '', device: info.device ?? '', description: info.description ?? '', isFallbackAdapter: adapter?.isFallbackAdapter ?? info.isFallbackAdapter ?? false };

  const groups = [...new Set(rows.map((r) => r.group))].map((id): Group => {
    const rs = rows.filter((r) => r.group === id);
    return {
      id,
      cases: rs.length,
      failing: rs.filter((r) => !r.pass).length,
      worstAbs: Math.max(...rs.map((r) => r.worstAbs)),
      needAbs: Math.max(...rs.map((r) => r.needAbs)),
      worstOutlierFraction: Math.max(...rs.map((r) => r.outliers / r.channels)),
      tolerance: rs[0]!.tolerance,
    };
  });
  groups.sort((a, b) => b.failing - a.failing || b.worstAbs - a.worstAbs);
  return { date: new Date().toISOString(), gpu, groups, rows };
}

const sig = (v: number) => (v === 0 ? '0' : v >= 1e9 ? '>1e9' : Number.isNaN(v) ? 'NaN' : v.toPrecision(3));

/** The report as Markdown: per filter (affected first) and the failing cases, worst first. */
export function parityMarkdown({ date, gpu, groups, rows }: ParityResult, extra: readonly string[] = []): string {
  const failing = rows.filter((r) => !r.pass).sort((a, b) => b.worstRatio - a.worstRatio);
  return [
    `# Parity report: ${date}`,
    '',
    `GPU: ${JSON.stringify(gpu)}`,
    ...extra,
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
}
