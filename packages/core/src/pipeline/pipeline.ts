import type { PointwiseFilter } from '../filter';
import type { GpuContext } from '../gpu/context';
import { runMultipass } from '../gpu/multipass';
import { objectKey } from '../gpu/readback';
import { activeSteps, effectiveParams, type ChainOptions, type Step } from './chain';
import { runFused } from './fuse';

export interface PipelineOptions {
  /** Fuse consecutive pointwise steps into one pass (default true). Off is useful for debugging. */
  readonly fuse?: boolean;
}

interface Stage {
  readonly steps: readonly Step[];
  readonly params: readonly Record<string, unknown>[];
  /** Identifies this stage's result: everything upstream plus this stage's filters and params. */
  readonly key: string;
}

interface CachedStage {
  readonly key: string;
  readonly output: GPUTexture;
}

/**
 * Runs a filter chain on the GPU, caching each stage's output so that a change only recomputes
 * from the first affected stage onwards. Consecutive pointwise steps form a single stage (one pass);
 * each multipass filter is a stage of its own. Shaders depend only on the filters, so moving a
 * slider never recompiles.
 */
export class Pipeline {
  /** Cumulative GPU passes dispatched and shaders compiled; useful in tests and for profiling. */
  readonly stats = { passes: 0, compiles: 0 };
  readonly #ctx: GpuContext;
  readonly #fuse: boolean;
  #source: GPUTexture | undefined;
  #scale = 1;
  #sourceVersion = 0;
  #cache: CachedStage[] = [];

  constructor(ctx: GpuContext, options: PipelineOptions = {}) {
    this.#ctx = ctx;
    this.#fuse = options.fuse ?? true;
  }

  /**
   * Sets the input working texture. Not owned: the caller keeps it alive and destroys it.
   * `scale` is its resolution relative to the full image (see {@link ChainOptions}).
   */
  setSource(texture: GPUTexture, options: ChainOptions = {}): void {
    this.#source = texture;
    this.#scale = options.scale ?? 1;
    this.#sourceVersion++;
    this.#evict(0);
  }

  /**
   * Returns the chain's output. The texture belongs to the pipeline (or is the source itself for
   * an empty chain): do not destroy it; it stays valid until the next run, setSource or destroy.
   */
  run(steps: readonly Step[]): GPUTexture {
    const source = this.#source;
    if (!source) throw new Error('Pipeline.run() before setSource()');
    const stages = this.#plan(steps);

    let first = 0;
    while (first < stages.length && this.#cache[first]?.key === stages[first]!.key) first++;
    this.#evict(first);

    let input = first === 0 ? source : this.#cache[first - 1]!.output;
    for (let i = first; i < stages.length; i++) {
      const stage = stages[i]!;
      const head = stage.steps[0]!.filter;
      let output: GPUTexture;
      if (head.kind === 'multipass') {
        const r = runMultipass(this.#ctx, head, input, stage.params[0]!);
        this.stats.passes += r.passes;
        this.stats.compiles += r.compiled;
        output = r.output;
      } else {
        const r = runFused(this.#ctx, stage.steps.map((s) => s.filter as PointwiseFilter<any>), stage.params, input);
        this.stats.passes++;
        if (r.compiled) this.stats.compiles++;
        output = r.output;
      }
      this.#cache.push({ key: stage.key, output });
      input = output;
    }
    return input;
  }

  destroy(): void {
    this.#evict(0);
    this.#source = undefined;
  }

  #plan(steps: readonly Step[]): Stage[] {
    const groups: Step[][] = [];
    for (const s of activeSteps(steps)) {
      const last = groups.at(-1);
      if (this.#fuse && last && last.at(-1)!.filter.kind === 'pointwise' && s.filter.kind === 'pointwise') last.push(s);
      else groups.push([s]);
    }
    let key = `src${this.#sourceVersion}`;
    return groups.map((g) => {
      const params = g.map((s) => effectiveParams(s, this.#scale));
      key = `${key}|${g.map((s, i) => `${s.filter.id}#${objectKey(s.filter)}${JSON.stringify(params[i])}`).join('+')}`;
      return { steps: g, params, key };
    });
  }

  #evict(from: number): void {
    for (const c of this.#cache.splice(from)) c.output.destroy();
  }
}
