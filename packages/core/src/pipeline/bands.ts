import type { LinearImage } from '../image';
import { createImage } from '../image';
import { activeSteps, effectiveParams, runStepCpu, type ChainOptions, type Step } from './chain';

// Banded CPU execution: the image is cut into horizontal bands, each is run through (a segment of)
// the chain with a halo of extra rows, and only the rows it owns are kept. With a halo at least as
// large as the reach of the steps, every pixel is computed from the same inputs as in the whole
// image, with the same operations in the same order, so the result is identical bit for bit.
// Design and tests: docs/design/tiled-cpu.md. The executors that put bands on threads are built on
// these functions; here everything runs on the calling thread.

/** The reach of a step in rows, or 'global' when it needs the whole image. */
export type StepReach = number | 'global';

/** A run of steps that can be banded together (`halo` rows), or one step that cannot ('global'). */
export interface Segment {
  readonly steps: readonly Step[];
  readonly halo: StepReach;
}

/** Rows a band owns (`y0` to `y1`, exclusive) and the rows it needs to read (`from` to `to`). */
export interface BandPlan {
  readonly y0: number;
  readonly y1: number;
  readonly from: number;
  readonly to: number;
}

/**
 * How far from a pixel the step reads: 0 for a pointwise filter, the filter's `reach` for a
 * multipass one (from the effective params), 'global' if it declares none or says so. A mask only
 * looks at the pixel's own position, so it adds nothing.
 */
export function stepReach(step: Step, scale = 1): StepReach {
  const { filter } = step;
  if (filter.kind === 'pointwise') return 0;
  const reach = filter.reach;
  if (reach === undefined || reach === 'global') return 'global';
  const rows = reach(effectiveParams(step, scale) as never);
  if (!Number.isInteger(rows) || rows < 0) throw new RangeError(`filter "${filter.id}": reach must be a whole number of rows >= 0, got ${rows}`);
  return rows;
}

/** The enabled steps grouped into segments: neighbouring steps with a reach merge (halo = the sum), every global step stands alone. */
export function planSegments(steps: readonly Step[], scale = 1): Segment[] {
  const out: { steps: Step[]; halo: StepReach }[] = [];
  for (const s of activeSteps(steps)) {
    const r = stepReach(s, scale);
    const last = out.at(-1);
    if (r === 'global') out.push({ steps: [s], halo: 'global' });
    else if (last && last.halo !== 'global') {
      last.steps.push(s);
      last.halo += r;
    } else out.push({ steps: [s], halo: r });
  }
  return out;
}

export interface PlanOptions {
  /** Keep the requested number of bands even when the halo is large against them (tests). */
  readonly force?: boolean;
}

/**
 * Splits `height` rows into up to `count` bands of nearly equal height. Unless `force` is set,
 * a band is at least 4 × halo rows tall, so the halo stays a minor part of the work (a halo as large
 * as the image gives one band). Every band owns at least one row.
 */
export function planBands(height: number, count: number, halo: number, options: PlanOptions = {}): BandPlan[] {
  let n = Math.max(1, Math.min(Math.floor(count) || 1, height));
  if (!options.force && halo > 0) n = Math.max(1, Math.min(n, Math.floor(height / (4 * halo))));
  return Array.from({ length: n }, (_, i) => {
    const y0 = Math.floor((i * height) / n);
    const y1 = Math.floor(((i + 1) * height) / n);
    return { y0, y1, from: Math.max(0, y0 - halo), to: Math.min(height, y1 + halo) };
  });
}

export interface BandOptions extends ChainOptions, PlanOptions {
  /** How many bands to cut the image into (fewer if the halos ask for it). */
  readonly bands: number;
}

const rowsOf = (img: LinearImage, a: number, b: number): LinearImage => createImage(img.width, b - a, img.data.subarray(a * img.width * 4, b * img.width * 4));

/**
 * One band of a segment through its steps: `rows` holds the rows `from` to `to` of the full image;
 * after each step the rows that later steps no longer need are dropped, so the last step produces
 * exactly the rows `y0` to `y1`.
 */
function runBand(steps: readonly Step[], reaches: readonly number[], rows: LinearImage, band: BandPlan, fullHeight: number, options: ChainOptions): LinearImage {
  let img = rows;
  let top = band.from;
  let later = reaches.reduce((a, b) => a + b, 0);
  for (let k = 0; k < steps.length; k++) {
    img = runStepCpu(steps[k]!, img, options, { y0: top, fullHeight });
    later -= reaches[k]!;
    const keepFrom = Math.max(0, band.y0 - later);
    const keepTo = Math.min(fullHeight, band.y1 + later);
    if (keepFrom > top || keepTo < top + img.height) img = rowsOf(img, keepFrom - top, keepTo - top);
    top = keepFrom;
  }
  return img;
}

/**
 * One band of a banded segment, for executors that run bands elsewhere (worker threads): `full`
 * is the whole input of the segment (or a view of it), `steps` the segment's steps (all with a
 * numeric reach), `band` one entry of {@link planBands} for that image's height. Returns exactly the
 * rows `band.y0` to `band.y1`, as {@link runChainBands} computes them.
 */
export function runChainBand(steps: readonly Step[], full: LinearImage, band: BandPlan, options: ChainOptions = {}): LinearImage {
  return runChainBandRows(steps, rowsOf(full, band.from, band.to), band, full.height, options);
}

/**
 * {@link runChainBand} for an executor that holds only the band's input: `rows` are the rows
 * `band.from` to `band.to` of an image `fullHeight` rows tall (a copy sent to a worker, say).
 */
export function runChainBandRows(steps: readonly Step[], rows: LinearImage, band: BandPlan, fullHeight: number, options: ChainOptions = {}): LinearImage {
  const reaches = steps.map((s) => stepReach(s, options.scale));
  if (reaches.some((r) => r === 'global')) throw new RangeError('runChainBand: a global step cannot run on a band');
  if (rows.height !== band.to - band.from) throw new RangeError(`runChainBandRows: ${rows.height} rows given, the band needs ${band.to - band.from}`);
  return runBand(steps, reaches as number[], rows, band, fullHeight, options);
}

/**
 * {@link runChainCpu} through bands, one after the other on this thread: the oracle the tests
 * compare the whole-image result with, and the code worker threads run on their bands. The result
 * is identical to `runChainCpu(steps, src, options)`; the input is not changed.
 */
export function runChainBands(steps: readonly Step[], src: LinearImage, options: BandOptions): LinearImage {
  let img = src;
  for (const seg of planSegments(steps, options.scale)) {
    const plan = seg.halo === 'global' ? [] : planBands(img.height, options.bands, seg.halo, options);
    if (plan.length <= 1) {
      for (const s of seg.steps) img = runStepCpu(s, img, options);
      continue;
    }
    const reaches = seg.steps.map((s) => stepReach(s, options.scale) as number);
    const out = createImage(img.width, img.height);
    for (const band of plan) {
      const result = runBand(seg.steps, reaches, rowsOf(img, band.from, band.to), band, img.height, options);
      out.data.set(result.data, band.y0 * img.width * 4);
    }
    img = out;
  }
  return img === src ? createImage(src.width, src.height, src.data.slice()) : img;
}
