import { createImage, type LinearImage, type Lut, type Step } from '@rullino/core';
import { planBands, planSegments, runStepCpu, sumStats, twoPhaseStat, type BandPlan } from '@rullino/core/internal';
import type { BandJob, BandReply, PoolOptions } from './protocol';

// CPU rendering on a pool of band workers (docs/design/tiled-cpu.md), driven from the render worker:
// the image is cut into horizontal bands, each band worker runs the whole segment of the chain on
// its band plus a halo of extra rows and returns only the rows it owns. Everything that cannot be
// banded (a step that needs the whole image, small images) runs on the calling thread, exactly as
// without threads. Bands travel by copy by default (structured clone: no cross-origin isolation
// needed). A shared-memory variant was built and measured (docs/design/tiled-cpu.md, phase 3): once the copies reuse their buffers it is no faster, and it needs COOP/COEP.

/**
 * The number of threads an option stands for. By default 4 on a machine with at least 4 cores and
 * 1 below (measured: 12 MP chains scale to 3.9× at 4 workers and 6.5× at 8 on 24 cores; a phone often
 * reports 8 cores of which 4 are slow, hence the cap of 4 instead of 'auto'), 'auto' = the cores, at most 8.
 */
export function resolveThreads(option: number | 'auto' | undefined, cores = (globalThis.navigator?.hardwareConcurrency ?? 1)): number {
  if (option === undefined) return cores >= 4 ? 4 : 1;
  if (option === 'auto') return Math.max(1, Math.min(8, cores));
  if (!Number.isInteger(option) || option < 1) throw new RangeError(`threads must be a whole number >= 1 or 'auto', got ${String(option)}`);
  return Math.min(option, 64);
}

/** What a render did: the bands it ran and where its time went (diagnostics). */
export interface ThreadedResult {
  readonly image: LinearImage;
  readonly bands: number;
  /** Milliseconds spent in segments cut into bands (copies and waiting for the workers included) and in segments run on the calling thread. */
  readonly bandedMs: number;
  readonly inlineMs: number;
}

export interface ThreadedExecutor {
  /**
   * Runs `steps` (parsed from `edit`) on `image` like `runChainCpu(steps, image, { scale, fast: true })`
   * does, bands on workers where the chain allows. Renders are queued, one at a time.
   */
  run(edit: unknown, luts: Readonly<Record<string, Lut>>, steps: readonly Step[], image: LinearImage, scale: number): Promise<ThreadedResult>;
  /** Stops the workers; a render in progress fails. */
  destroy(): void;
}

const MP = 1_000_000;

export function createThreadedExecutor(threads: number, pool: PoolOptions = {}): ThreadedExecutor {
  const createAtPixels = pool.createAtPixels ?? 2 * MP;
  const useAtPixels = pool.useAtPixels ?? 0.5 * MP;
  const workerUrl = pool.workerUrl ?? 'band-worker.js';
  let workers: Worker[] | undefined;
  let starting: Promise<Worker[]> | undefined;
  let destroyed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let renders = 0;

  const stop = () => {
    const w = workers ?? [];
    workers = undefined;
    starting = undefined;
    for (const worker of w) worker.terminate();
  };

  /** Resolves with a new worker once it says it is ready, or rejects with what it died of. */
  const spawn = () =>
    new Promise<Worker>((resolve, reject) => {
      let worker: Worker;
      const fail = (message: string) => reject(new Error(`could not start the band workers (${message}); @rullino/web loads ${String(workerUrl)}`));
      try {
        // The literal form, inside `new Worker(...)`: bundlers only recognise a worker entry by it.
        worker = pool.workerUrl === undefined ? new Worker(new URL('./band-worker.ts', import.meta.url), { type: 'module' }) : new Worker(pool.workerUrl, { type: 'module' });
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      worker.onerror = (event) => fail(event.message || 'the worker failed to load');
      worker.onmessage = ({ data }: MessageEvent<BandReply>) => {
        worker.onerror = null;
        worker.onmessage = null;
        if (data.type === 'ready') resolve(worker);
        else fail(data.type === 'error' ? data.message : 'unexpected reply');
      };
    });

  const start = async (): Promise<Worker[]> => {
    if (workers) return workers;
    starting ??= Promise.all(Array.from({ length: threads }, spawn)).then(
      (w) => {
        if (destroyed) {
          for (const worker of w) worker.terminate();
          throw new Error('the renderer was destroyed');
        }
        workers = w;
        return w;
      },
      (e: Error) => {
        starting = undefined;
        throw e;
      },
    );
    return starting;
  };

  // Buffers for the copied bands, kept for the next band, segment and render: copying every band into a new
  // buffer and getting a new one back was ~400 MB of garbage per segment at 12 MP, and the garbage collector
  // then ran in the middle of the next step. A buffer travels to a worker, is written over there and comes back.
  const free: ArrayBuffer[] = [];
  const acquire = (bytes: number) => {
    let best = -1;
    for (let i = 0; i < free.length; i++) if (free[i]!.byteLength >= bytes && (best < 0 || free[i]!.byteLength < free[best]!.byteLength)) best = i;
    return best >= 0 ? free.splice(best, 1)[0]! : new ArrayBuffer(bytes);
  };
  const release = (buffer: ArrayBuffer) => {
    free.push(buffer);
    while (free.length > threads * 2 + 2) free.shift();
  };

  /** One band on one worker; rejects if the worker reports an error or dies. */
  const call = (worker: Worker, job: BandJob, transfer: Transferable[]) =>
    new Promise<{ buffer?: ArrayBuffer; length?: number; stat?: Float64Array }>((resolve, reject) => {
      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
      };
      worker.onmessage = ({ data }: MessageEvent<BandReply>) => {
        cleanup();
        if (data.type === 'done') resolve(data);
        else reject(new Error(data.type === 'error' ? data.message : 'unexpected reply from a band worker'));
      };
      worker.onerror = (event) => {
        cleanup();
        reject(new Error(destroyed ? 'the renderer was destroyed' : `a band worker failed: ${event.message}`));
      };
      worker.postMessage(job, transfer);
    });

  const execute = async (edit: unknown, luts: Readonly<Record<string, Lut>>, steps: readonly Step[], image: LinearImage, scale: number) => {
    if (destroyed) throw new Error('the renderer was destroyed');
    let current = image;
    let enabled = 0; // steps handled so far, counted among the enabled ones
    let bandJobs = 0;
    let bandedMs = 0;
    let inlineMs = 0;
    let pool_: Worker[] | undefined;
    let stat: Float64Array | undefined; // the statistic for the first step of the next segment
    try {
      for (const seg of planSegments(steps, scale, { twoPhase: true })) {
        const from = enabled;
        enabled += seg.steps.length;
        const first = stat;
        stat = undefined;
        const pixels = current.width * current.height;
        const worth = seg.halo !== 'global' && pixels >= (workers ? useAtPixels : createAtPixels);
        const bands: BandPlan[] = worth ? planBands(current.height, threads * 2, seg.halo as number, { force: pool.forceBands ?? false }) : [];
        const t0 = performance.now();
        if (bands.length <= 1) {
          seg.steps.forEach((s, k) => (current = runStepCpu(s, current, { scale, fast: true }, undefined, k === 0 ? first : undefined)));
          if (seg.statFor) stat = twoPhaseStat(seg.statFor, current, { y0: 0, fullHeight: current.height }, { scale });
          inlineMs += performance.now() - t0;
          continue;
        }
        pool_ ??= await start();
        const { width, height } = current;
        const rowLength = width * 4;
        const key = ++renders;
        const pending = [...bands];
        const parts: Float64Array[] = [];
        bandJobs += bands.length;
        const job = { type: 'band' as const, edit, luts, key, scale, from, to: enabled, width, height, ...(first && { stat: first }), ...(seg.statFor && { statFor: true }) };
        // A segment of no steps only makes a statistic: its rows are the input's, nothing to write back.
        const out = seg.steps.length > 0 ? createImage(width, height) : undefined;
        const source = current.data;
        await Promise.all(
          pool_.map(async (worker) => {
            for (let band = pending.shift(); band; band = pending.shift()) {
              const length = (band.to - band.from) * rowLength;
              const buffer = acquire(length * 4);
              new Float32Array(buffer, 0, length).set(source.subarray(band.from * rowLength, band.to * rowLength)); // a copy, transferred
              const result = await call(worker, { ...job, band, buffer, length }, [buffer]);
              if (out) out.data.set(new Float32Array(result.buffer!, 0, result.length), band.y0 * rowLength);
              if (result.stat) parts.push(result.stat);
              release(result.buffer!);
            }
          }),
        );
        if (seg.statFor) stat = sumStats(parts);
        if (out) current = out;
        bandedMs += performance.now() - t0;
      }
    } catch (e) {
      stop(); // a worker that failed may be half way through a band: start afresh next time
      throw e;
    }
    return { image: current, bands: bandJobs, bandedMs, inlineMs };
  };

  return {
    run(edit, luts, steps, image, scale) {
      const result = queue.then(() => execute(edit, luts, steps, image, scale));
      queue = result.catch(() => undefined);
      return result;
    },
    destroy() {
      destroyed = true;
      stop();
      free.length = 0;
    },
  };
}
