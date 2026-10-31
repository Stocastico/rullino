import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { createImage, type LinearImage, type Lut, type Step } from '@rullino/core';
import { planBands, planSegments, runStepCpu, type BandPlan } from '@rullino/core/internal';

// CPU rendering on worker threads: the image is cut into horizontal bands (docs/design/tiled-cpu.md),
// each worker runs the whole segment of the chain on its band plus a halo of extra rows and writes
// only the rows it owns into a shared output. The source and the output are SharedArrayBuffers, so
// the only copies are the halos a worker reads. Everything that cannot be banded (a step that needs
// the whole image, small images) runs on the calling thread, exactly as without threads.

/** What the main thread asks a worker to do: one band of one segment. */
export interface BandJob {
  readonly type: 'band';
  /** The edit document and the LUTs it names: the worker parses it again (functions cannot be posted). */
  readonly edit: unknown;
  readonly luts: Readonly<Record<string, Lut>>;
  /** Which render and segment this is, so a worker parses a document once for all its bands. */
  readonly key: number;
  readonly scale: number;
  /** The segment's steps: indices into the enabled steps of the document, `from` to `to`. */
  readonly from: number;
  readonly to: number;
  readonly width: number;
  readonly height: number;
  readonly band: BandPlan;
  readonly src: SharedArrayBuffer;
  readonly dst: SharedArrayBuffer;
}

export type WorkerReply = { readonly type: 'ready' } | { readonly type: 'done' } | { readonly type: 'error'; readonly message: string };

export interface ThreadedOptions {
  /** Worker threads (at least 2: with one the caller runs unthreaded). */
  readonly threads: number;
  readonly workerUrl: URL;
  /** An image of at least this many pixels starts the pool when there is none. */
  readonly createAtPixels: number;
  /** An existing pool is used from this many pixels. */
  readonly useAtPixels: number;
  /** Cut into the requested number of bands whatever the halo (tests); normally a band is at least 4 × halo rows. */
  readonly forceBands: boolean;
}

/** The worker, next to this file once built (`dist/worker.js`). */
export const DEFAULT_WORKER_URL = new URL('./worker.js', import.meta.url);

/** The number of threads an option stands for: 1 (none) by default, 'auto' = the cores, at most 8. */
export function resolveThreads(option: number | 'auto' | undefined): number {
  if (option === undefined) return 1;
  if (option === 'auto') return Math.max(1, Math.min(8, availableParallelism()));
  if (!Number.isInteger(option) || option < 1) throw new RangeError(`threads must be a whole number >= 1 or 'auto', got ${String(option)}`);
  return Math.min(option, 64);
}

const sharedBuffer = (image: LinearImage): SharedArrayBuffer | undefined => {
  const { buffer, byteOffset, byteLength } = image.data;
  return buffer instanceof SharedArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength ? buffer : undefined;
};

export interface RunOptions {
  readonly scale: number;
  /**
   * Leave the result in shared memory instead of copying it to ordinary memory (192 MB at 12 MP):
   * for callers that only read it, like the encoders. Some APIs (Blob, TextDecoder) refuse views of
   * shared buffers, so images that leave the renderer are copied.
   */
  readonly shared?: boolean;
}

export interface ThreadedExecutor {
  /**
   * Runs `steps` (parsed from `edit`) on `image` like `runChainCpu(steps, image, { scale, fast: true })`
   * does, bands on worker threads where the chain allows. Renders are queued, one at a time.
   */
  run(edit: unknown, luts: ReadonlyMap<string, Lut>, steps: readonly Step[], image: LinearImage, options: RunOptions): Promise<LinearImage>;
  /** Stops the workers and forgets the spare buffers; a render in progress fails. */
  destroy(): void;
}

export function createThreadedExecutor(options: ThreadedOptions): ThreadedExecutor {
  let workers: Worker[] | undefined;
  let starting: Promise<Worker[]> | undefined;
  let destroyed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let renders = 0;
  // Shared buffers of past renders, kept for the next one of the same size: a fresh 192 MB buffer costs
  // 0.1-0.8 s of page faults at 12 MP. At most two (the source copy and the output).
  const spare: SharedArrayBuffer[] = [];
  const take = (bytes: number) => {
    const i = spare.findIndex((b) => b.byteLength === bytes);
    return i >= 0 ? spare.splice(i, 1)[0]! : new SharedArrayBuffer(bytes);
  };
  const give = (buffer: SharedArrayBuffer) => {
    spare.push(buffer);
    while (spare.length > 2) spare.shift();
  };

  const stop = () => {
    const w = workers ?? [];
    workers = undefined;
    starting = undefined;
    for (const worker of w) void worker.terminate();
  };

  /** Resolves with the first message of a new worker, or rejects with what it died of. */
  const spawn = () =>
    new Promise<Worker>((resolve, reject) => {
      const worker = new Worker(options.workerUrl);
      const fail = (e: Error) => reject(new Error(`could not start the worker threads (${e.message}); @rullino/node loads ${options.workerUrl.href}`));
      worker.once('error', fail);
      worker.once('exit', () => fail(new Error('the worker exited')));
      worker.once('message', (m: WorkerReply) => {
        worker.off('error', fail);
        if (m.type === 'ready') resolve(worker);
        else fail(new Error(m.type === 'error' ? m.message : 'unexpected reply'));
      });
    });

  const start = async (): Promise<Worker[]> => {
    if (workers) return workers;
    starting ??= Promise.all(Array.from({ length: options.threads }, spawn)).then(
      (w) => {
        if (destroyed) {
          for (const worker of w) void worker.terminate();
          throw new Error('the renderer was destroyed');
        }
        for (const worker of w) worker.unref();
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
  const call = (worker: Worker, job: BandJob) =>
    new Promise<void>((resolve, reject) => {
      const done = (m: WorkerReply) => {
        cleanup();
        if (m.type === 'done') resolve();
        else reject(new Error(m.type === 'error' ? m.message : 'unexpected reply from a worker'));
      };
      const failed = (e: Error) => {
        cleanup();
        reject(e);
      };
      const exited = () => failed(new Error(destroyed ? 'the renderer was destroyed' : 'a worker thread exited'));
      const cleanup = () => {
        worker.off('message', done);
        worker.off('error', failed);
        worker.off('exit', exited);
      };
      worker.on('message', done);
      worker.on('error', failed);
      worker.on('exit', exited);
      worker.postMessage(job);
    });

  const execute = async (edit: unknown, luts: ReadonlyMap<string, Lut>, steps: readonly Step[], image: LinearImage, { scale, shared: keepShared = false }: RunOptions): Promise<LinearImage> => {
    if (destroyed) throw new Error('the renderer was destroyed');
    const lutRecord = Object.fromEntries(luts);
    let current = image;
    let ours: SharedArrayBuffer | undefined; // the buffer behind `current`, if this render made it
    let enabled = 0; // steps handled so far, counted among the enabled ones
    let pool: Worker[] | undefined;
    try {
      for (const seg of planSegments(steps, scale)) {
        const from = enabled;
        enabled += seg.steps.length;
        const pixels = current.width * current.height;
        const worth = seg.halo !== 'global' && pixels >= (workers ? options.useAtPixels : options.createAtPixels);
        const bands: BandPlan[] = worth ? planBands(current.height, options.threads * 2, seg.halo as number, { force: options.forceBands }) : [];
        if (bands.length <= 1) {
          for (const s of seg.steps) current = runStepCpu(s, current, { scale, fast: true });
          if (ours && sharedBuffer(current) !== ours) {
            give(ours); // the steps made ordinary memory: the shared buffer is free again
            ours = undefined;
          }
          continue;
        }
        pool ??= await start();
        for (const w of pool) w.ref();
        const bytes = current.data.byteLength;
        let srcBuffer = sharedBuffer(current);
        if (!srcBuffer) {
          srcBuffer = ours = take(bytes);
          new Float32Array(srcBuffer).set(current.data);
        }
        const dst = take(bytes);
        const key = ++renders;
        const pending = [...bands];
        const [width, height] = [current.width, current.height];
        // Workers take the next band when they finish one: uneven bands even out.
        await Promise.all(
          pool.map(async (worker) => {
            for (let band = pending.shift(); band; band = pending.shift())
              await call(worker, { type: 'band', edit, luts: lutRecord, key, scale, from, to: enabled, width, height, band, src: srcBuffer, dst });
          }),
        );
        if (ours) give(ours); // this segment's input is not needed any more
        ours = dst;
        current = createImage(width, height, new Float32Array(dst));
      }
    } catch (e) {
      stop(); // a worker that failed may be half way through a band: start afresh next time
      throw e;
    } finally {
      for (const w of workers ?? []) w.unref();
    }
    if (!sharedBuffer(current) || keepShared) return current;
    // Hand back ordinary memory: some APIs (Blob, TextDecoder) refuse views of shared buffers.
    const copy = createImage(current.width, current.height, current.data.slice());
    if (ours) give(ours);
    return copy;
  };

  return {
    run(edit, luts, steps, image, options) {
      const result = queue.then(() => execute(edit, luts, steps, image, options));
      queue = result.catch(() => undefined);
      return result;
    },
    destroy() {
      destroyed = true;
      stop();
      spare.length = 0;
    },
  };
}
