import { createImage, type LinearImage, type Lut, type Step } from '@rullino/core';
import { planBands, planSegments, runStepCpu, type BandPlan } from '@rullino/core/internal';
import type { BandJob, BandReply, PoolOptions } from './protocol';

// CPU rendering on a pool of band workers (docs/design/tiled-cpu.md), driven from the render worker:
// the image is cut into horizontal bands, each band worker runs the whole segment of the chain on
// its band plus a halo of extra rows and returns only the rows it owns. Everything that cannot be
// banded (a step that needs the whole image, small images) runs on the calling thread, exactly as
// without threads. Bands travel by copy by default (structured clone: no cross-origin isolation
// needed); `pool.shared` (cross-origin isolated pages) uses SharedArrayBuffers for the bands instead.

/** The number of threads an option stands for: 1 (none) by default, 'auto' = the cores, at most 8. */
export function resolveThreads(option: number | 'auto' | undefined, cores = (globalThis.navigator?.hardwareConcurrency ?? 1)): number {
  if (option === undefined) return 1;
  if (option === 'auto') return Math.max(1, Math.min(8, cores));
  if (!Number.isInteger(option) || option < 1) throw new RangeError(`threads must be a whole number >= 1 or 'auto', got ${String(option)}`);
  return Math.min(option, 64);
}

export interface ThreadedExecutor {
  /**
   * Runs `steps` (parsed from `edit`) on `image` like `runChainCpu(steps, image, { scale, fast: true })`
   * does, bands on workers where the chain allows. Renders are queued, one at a time.
   */
  run(edit: unknown, luts: Readonly<Record<string, Lut>>, steps: readonly Step[], image: LinearImage, scale: number): Promise<{ readonly image: LinearImage; readonly bands: number; readonly shared: boolean }>;
  /** Stops the workers; a render in progress fails. */
  destroy(): void;
}

const MP = 1_000_000;

export function createThreadedExecutor(threads: number, pool: PoolOptions = {}): ThreadedExecutor {
  const createAtPixels = pool.createAtPixels ?? 2 * MP;
  const useAtPixels = pool.useAtPixels ?? 0.5 * MP;
  // Copied bands are the default: measured at 12 MP, shared memory is no faster (the source is copied into it and the result out of it).
  const shared = pool.shared ?? false;
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

  /** One band on one worker; rejects if the worker reports an error or dies. */
  const call = (worker: Worker, job: BandJob, transfer: Transferable[]) =>
    new Promise<Float32Array | undefined>((resolve, reject) => {
      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
      };
      worker.onmessage = ({ data }: MessageEvent<BandReply>) => {
        cleanup();
        if (data.type === 'done') resolve(data.rows);
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
    let usedShared = false;
    let pool_: Worker[] | undefined;
    try {
      for (const seg of planSegments(steps, scale)) {
        const from = enabled;
        enabled += seg.steps.length;
        const pixels = current.width * current.height;
        const worth = seg.halo !== 'global' && pixels >= (workers ? useAtPixels : createAtPixels);
        const bands: BandPlan[] = worth ? planBands(current.height, threads * 2, seg.halo as number, { force: pool.forceBands ?? false }) : [];
        if (bands.length <= 1) {
          for (const s of seg.steps) current = runStepCpu(s, current, { scale, fast: true });
          continue;
        }
        pool_ ??= await start();
        const { width, height } = current;
        const rowLength = width * 4;
        const key = ++renders;
        const pending = [...bands];
        bandJobs += bands.length;
        const job = { type: 'band' as const, edit, luts, key, scale, from, to: enabled, width, height };
        let out: LinearImage;
        if (shared) {
          usedShared = true;
          const src = new SharedArrayBuffer(current.data.byteLength);
          new Float32Array(src).set(current.data);
          const dst = new SharedArrayBuffer(current.data.byteLength);
          await Promise.all(
            pool_.map(async (worker) => {
              for (let band = pending.shift(); band; band = pending.shift()) await call(worker, { ...job, band, src, dst }, []);
            }),
          );
          // Ordinary memory out: Blob, ImageData and the like refuse views of shared buffers.
          out = createImage(width, height, new Float32Array(dst).slice());
        } else {
          out = createImage(width, height);
          const source = current.data;
          await Promise.all(
            pool_.map(async (worker) => {
              for (let band = pending.shift(); band; band = pending.shift()) {
                const rows = source.slice(band.from * rowLength, band.to * rowLength); // a copy, transferred
                const result = await call(worker, { ...job, band, rows }, [rows.buffer]);
                out.data.set(result!, band.y0 * rowLength);
              }
            }),
          );
        }
        current = out;
      }
    } catch (e) {
      stop(); // a worker that failed may be half way through a band: start afresh next time
      throw e;
    }
    return { image: current, bands: bandJobs, shared: usedShared };
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
    },
  };
}
