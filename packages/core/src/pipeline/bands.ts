import type { LinearImage } from '../image';
import { createImage } from '../image';
import type { RowRegion } from '../mask';
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
  /**
   * Only when planned with `twoPhase`: the two-phase step that comes next. The bands of this segment
   * end by computing its statistic on the rows they own (see {@link twoPhaseStat}), the statistics
   * are added ({@link sumStats}), and the next segment starts with that step, given the sum.
   */
  readonly statFor?: Step;
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

const twoPhaseOf = (step: Step) => (step.filter.kind === 'multipass' ? step.filter.twoPhase : undefined);

/**
 * The reach a step has once its statistic is known: 0 for the second phase of a two-phase filter
 * (it reads only the pixel), {@link stepReach} for the others.
 */
export function bandReach(step: Step, scale = 1): StepReach {
  return twoPhaseOf(step) ? 0 : stepReach(step, scale);
}

export interface SegmentOptions {
  /**
   * Plan the two-phase steps in two phases: the segment before one ends with its statistic and the
   * step starts the next segment (its reach is 0), instead of standing alone as a global step. An
   * executor that does not know about them leaves this off and still gets a correct plan.
   */
  readonly twoPhase?: boolean;
}

/** The enabled steps grouped into segments: neighbouring steps with a reach merge (halo = the sum), every global step stands alone. */
export function planSegments(steps: readonly Step[], scale = 1, options: SegmentOptions = {}): Segment[] {
  const out: { steps: Step[]; halo: StepReach; statFor?: Step }[] = [];
  for (const s of activeSteps(steps)) {
    const r = options.twoPhase ? bandReach(s, scale) : stepReach(s, scale);
    const last = out.at(-1);
    if (options.twoPhase && twoPhaseOf(s)) {
      // The statistic is made at the end of the segment before: an empty one if there is none to extend.
      if (last && last.halo !== 'global') last.statFor = s;
      else out.push({ steps: [], halo: 0, statFor: s });
      out.push({ steps: [s], halo: 0 });
    } else if (r === 'global') out.push({ steps: [s], halo: 'global' });
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
function runBand(steps: readonly Step[], reaches: readonly number[], rows: LinearImage, band: BandPlan, fullHeight: number, options: ChainOptions, stat?: Float64Array): LinearImage {
  let img = rows;
  let top = band.from;
  let later = reaches.reduce((a, b) => a + b, 0);
  for (let k = 0; k < steps.length; k++) {
    img = runStepCpu(steps[k]!, img, options, { y0: top, fullHeight }, k === 0 ? stat : undefined);
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
 * `stat` is the statistic of the whole image for the first step, which must then be a two-phase
 * step (see {@link planSegments}); its second phase runs on the band.
 */
export function runChainBandRows(steps: readonly Step[], rows: LinearImage, band: BandPlan, fullHeight: number, options: ChainOptions = {}, extra: { readonly stat?: Float64Array } = {}): LinearImage {
  const reaches = steps.map((s) => (extra.stat ? bandReach(s, options.scale) : stepReach(s, options.scale)));
  if (reaches.some((r) => r === 'global')) throw new RangeError('runChainBand: a global step cannot run on a band');
  if (rows.height !== band.to - band.from) throw new RangeError(`runChainBandRows: ${rows.height} rows given, the band needs ${band.to - band.from}`);
  return runBand(steps, reaches as number[], rows, band, fullHeight, options, extra.stat);
}

/**
 * The statistic of `step` (a two-phase step) over the rows `rows`, which sit at `region` in the
 * full image: what a band computes on the rows it owns once its segment is done.
 */
export function twoPhaseStat(step: Step, rows: LinearImage, region: RowRegion, options: ChainOptions = {}): Float64Array {
  const phase = twoPhaseOf(step);
  if (!phase) throw new Error(`filter "${step.filter.id}" is not a two-phase filter`);
  return phase.stat(rows, effectiveParams(step, options.scale) as never, region);
}

/** Adds statistics element by element: the statistic of the whole image from those of its bands (counts, so exact in any order). */
export function sumStats(parts: readonly Float64Array[]): Float64Array {
  const out = new Float64Array(parts[0]!.length);
  for (const part of parts) {
    if (part.length !== out.length) throw new RangeError(`sumStats: statistics of ${part.length} and ${out.length} values`);
    for (let i = 0; i < out.length; i++) out[i]! += part[i]!;
  }
  return out;
}

/**
 * {@link runChainCpu} through bands, one after the other on this thread: the oracle the tests
 * compare the whole-image result with, and the code worker threads run on their bands. The result
 * is identical to `runChainCpu(steps, src, options)`; the input is not changed. Two-phase steps
 * (equalize, clahe, otsu) are banded too: the statistic comes from the rows each band owns.
 */
export function runChainBands(steps: readonly Step[], src: LinearImage, options: BandOptions): LinearImage {
  let img = src;
  let stat: Float64Array | undefined; // the statistic for the first step of the next segment
  for (const seg of planSegments(steps, options.scale, { twoPhase: true })) {
    const plan = seg.halo === 'global' ? [] : planBands(img.height, options.bands, seg.halo, options);
    const first = stat;
    stat = undefined;
    if (plan.length <= 1) {
      seg.steps.forEach((s, k) => (img = runStepCpu(s, img, options, undefined, k === 0 ? first : undefined)));
      if (seg.statFor) stat = twoPhaseStat(seg.statFor, img, { y0: 0, fullHeight: img.height }, options);
      continue;
    }
    const reaches = seg.steps.map((s) => bandReach(s, options.scale) as number);
    const out = createImage(img.width, img.height);
    const parts: Float64Array[] = [];
    for (const band of plan) {
      const result = runBand(seg.steps, reaches, rowsOf(img, band.from, band.to), band, img.height, options, first);
      out.data.set(result.data, band.y0 * img.width * 4);
      if (seg.statFor) parts.push(twoPhaseStat(seg.statFor, result, { y0: band.y0, fullHeight: img.height }, options));
    }
    if (seg.statFor) stat = sumStats(parts);
    img = out;
  }
  return img === src ? createImage(src.width, src.height, src.data.slice()) : img;
}
