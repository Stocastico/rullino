import {
  applyEdit,
  createGpuContext,
  createImage,
  encodeImage,
  parseChain,
  WebGpuUnavailableError,
  type Filter,
  type GpuContext,
  type GpuError,
  type LinearImage,
  type Lut,
  type Rgba8Image,
} from '@rullino/core';
import { applyEditPixels } from '@rullino/core/internal';
import { filters as allFilters } from '@rullino/filters';
import { resolveLookLut } from '@rullino/presets';
import type { PoolOptions, RenderRequest, RenderResponse } from './protocol';
import { resolveThreads } from './threads';

export type { PoolOptions };

export interface RendererOptions {
  /**
   * 'auto' (default): WebGPU if the browser has a usable adapter, else the CPU (see `reason`).
   * 'gpu': WebGPU or a `WebGpuUnavailableError`. 'cpu': the CPU.
   */
  readonly backend?: 'auto' | 'gpu' | 'cpu';
  /** A WebGPU entry point to use instead of `navigator.gpu`. */
  readonly gpu?: GPU | undefined;
  /** GPU errors (shaders that do not compile, validation, out of memory). Default: console.error. */
  readonly onError?: ((error: GpuError) => void) | undefined;
  /**
   * The filters documents may use. Default: every filter of `@rullino/filters`. Functions cannot
   * be sent to a worker, so with custom filters the CPU backend runs on the main thread.
   */
  readonly filters?: readonly Filter<any>[] | undefined;
  /** Resolves LUT names in documents. Default: the looks of `@rullino/presets` (`look:<id>`). */
  readonly resolveLut?: ((ref: string) => Lut | undefined) | undefined;
  /** Run the CPU backend in a Web Worker (default), so rendering never blocks the page. */
  readonly worker?: boolean | undefined;
  /**
   * CPU threads for the CPU backend: the image is cut into horizontal bands that a pool of workers
   * renders at once, with the same result as one thread bit for bit. A number (at least 1), or
   * `'auto'` for the cores (at most 8). Default 1. Only images of about 2 MP and more start the
   * pool, and steps that need the whole image (equalize, clahe, otsu) run alone. Needs the worker
   * (the default); ignored with custom `filters` or `worker: false`.
   */
  readonly threads?: number | 'auto' | undefined;
  /** Advanced options of the band workers: where their script is, when they start, copy or shared memory. */
  readonly pool?: PoolOptions | undefined;
}

export interface Renderer {
  readonly backend: 'gpu' | 'cpu';
  /** Why 'auto' chose the CPU. */
  readonly reason?: string;
  /** The GPU context, when the backend is 'gpu'. */
  readonly gpu?: GpuContext;
  /**
   * Renders an edit document on a linear image (see `applyEdit` in `@rullino/core`). `scale` is the
   * image's size relative to the original the edit was made on, e.g. 0.25 for a quick preview.
   */
  apply(image: LinearImage | Rgba8Image, edit: unknown, options?: { readonly scale?: number }): Promise<LinearImage>;
  /**
   * Renders an edit document on 8-bit pixels (`ImageData`) or an image file the browser can decode
   * (a `Blob`), and encodes the result as the document's `output` says (PNG by default).
   */
  render(input: ImageData | Blob, edit: unknown): Promise<Blob>;
  /**
   * Like {@link apply}, but answers with 8-bit sRGB pixels ready for a canvas, encoded where the
   * render ran (on the GPU, or in the worker): the fast path for interactive previews.
   */
  pixels(image: LinearImage | Rgba8Image, edit: unknown, options?: { readonly scale?: number }): Promise<ImageData>;
  /** Releases the GPU device and stops the worker. Pending renders are rejected. */
  destroy(): void;
}

/** The CPU backend in a Web Worker: one worker, requests matched to responses by id. */
function workerBackend(threads: number, pool: PoolOptions | undefined) {
  let worker: Worker | undefined;
  // The callback stays here: functions cannot be posted to a worker.
  const { onRender: _, workerUrl, ...rest } = pool ?? {};
  const workerPool: PoolOptions = { ...rest, ...(workerUrl !== undefined && { workerUrl: String(workerUrl) }) }; // a URL object cannot be posted
  let nextId = 0;
  const pending = new Map<number, { resolve: (image: LinearImage | Rgba8Image) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  const start = () => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }: MessageEvent<RenderResponse>) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if ('error' in data) p?.reject(new Error(data.error));
      else {
        pool?.onRender?.({ bands: data.bands, shared: data.shared });
        p?.resolve(data.image);
      }
    };
    w.onerror = (event) => failAll(new Error(`rullino's CPU worker failed: ${event.message}`));
    return w;
  };
  return {
    run(image: LinearImage | Rgba8Image, edit: unknown, luts: Record<string, Lut>, scale: number | undefined, pixels: boolean): Promise<LinearImage | Rgba8Image> {
      worker ??= start();
      const id = nextId++;
      // A copy, transferred: the caller keeps its image. 8-bit pixels are a quarter of a linear image.
      const data = image.data.slice();
      const request: RenderRequest = { id, image: { width: image.width, height: image.height, data } as LinearImage | Rgba8Image, edit, luts, scale, pixels, threads, pool: workerPool };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage(request, [data.buffer]);
      });
    },
    terminate() {
      worker?.terminate();
      worker = undefined;
      failAll(new Error('the renderer was destroyed'));
    },
  };
}

/** Decodes an image file to 8-bit straight RGBA through the browser's decoders. */
async function decodeFile(file: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

export async function createRenderer(options: RendererOptions = {}): Promise<Renderer> {
  const backend = options.backend ?? 'auto';
  const filters = options.filters ?? allFilters;
  const resolveLut = options.resolveLut ?? resolveLookLut;
  const threads = resolveThreads(options.threads);
  let ctx: GpuContext | undefined;
  let reason: string | undefined;
  if (backend !== 'cpu') {
    try {
      ctx = await createGpuContext({ gpu: options.gpu, onError: options.onError });
    } catch (e) {
      if (backend === 'gpu') throw e instanceof WebGpuUnavailableError ? e : new WebGpuUnavailableError(`WebGPU could not start: ${(e as Error).message}`);
      reason = (e as Error).message;
    }
  }
  const worker = !ctx && options.worker !== false && !options.filters ? workerBackend(threads, options.pool) : undefined;

  const run = async (image: LinearImage | Rgba8Image, edit: unknown, scale: number | undefined, pixels: boolean): Promise<LinearImage | Rgba8Image> => {
    if (!worker) return (pixels ? applyEditPixels : applyEdit)(image, edit, { filters, resolveLut, gpu: ctx, scale });
    // Parsed here first: a bad document fails with its own message, and the LUTs it names are
    // resolved on this thread (the resolver is a function, which cannot go to the worker).
    const luts: Record<string, Lut> = {};
    parseChain(edit, {
      filters,
      resolveLut: (ref) => {
        const lut = resolveLut(ref);
        if (lut) luts[ref] = lut;
        return lut;
      },
    });
    return worker.run(image, edit, luts, scale, pixels);
  };
  const apply = async (image: LinearImage | Rgba8Image, edit: unknown, o: { readonly scale?: number } = {}): Promise<LinearImage> => {
    const out = await run(image, edit, o.scale, false);
    return createImage(out.width, out.height, out.data as Float32Array);
  };

  return {
    backend: ctx ? 'gpu' : 'cpu',
    ...(reason !== undefined ? { reason } : {}),
    ...(ctx ? { gpu: ctx } : {}),
    apply,
    async pixels(image, edit, o = {}) {
      const out = await run(image, edit, o.scale, true);
      return new ImageData(new Uint8ClampedArray(out.data.buffer as ArrayBuffer, out.data.byteOffset, out.data.length), out.width, out.height);
    },
    async render(input, edit) {
      const { output = {} } = parseChain(edit, { filters, resolveLut });
      const pixels = input instanceof Blob ? await decodeFile(input) : input;
      const out = await apply(pixels, edit); // decoded where it renders: on the GPU, or in the worker
      return encodeImage(out, output);
    },
    destroy() {
      ctx?.device.destroy();
      worker?.terminate();
    },
  };
}
