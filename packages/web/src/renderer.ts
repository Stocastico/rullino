import {
  applyEdit,
  createGpuContext,
  createImage,
  decodeSrgb8,
  encodeImage,
  parseChain,
  WebGpuUnavailableError,
  type Filter,
  type GpuContext,
  type GpuError,
  type LinearImage,
  type Lut,
} from '@rullino/core';
import { filters as allFilters } from '@rullino/filters';
import { resolveLookLut } from '@rullino/presets';
import type { RenderRequest, RenderResponse } from './protocol';

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
  apply(image: LinearImage, edit: unknown, options?: { readonly scale?: number }): Promise<LinearImage>;
  /**
   * Renders an edit document on 8-bit pixels (`ImageData`) or an image file the browser can decode
   * (a `Blob`), and encodes the result as the document's `output` says (PNG by default).
   */
  render(input: ImageData | Blob, edit: unknown): Promise<Blob>;
  /** Releases the GPU device and stops the worker. Pending renders are rejected. */
  destroy(): void;
}

/** The CPU backend in a Web Worker: one worker, requests matched to responses by id. */
function workerBackend() {
  let worker: Worker | undefined;
  let nextId = 0;
  const pending = new Map<number, { resolve: (image: LinearImage) => void; reject: (error: Error) => void }>();
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
      else p?.resolve(createImage(data.image.width, data.image.height, data.image.data));
    };
    w.onerror = (event) => failAll(new Error(`rullino's CPU worker failed: ${event.message}`));
    return w;
  };
  return {
    run(image: LinearImage, edit: unknown, luts: Record<string, Lut>, scale: number | undefined): Promise<LinearImage> {
      worker ??= start();
      const id = nextId++;
      // A copy, transferred: the caller keeps its image.
      const data = image.data.slice();
      const request: RenderRequest = { id, image: { width: image.width, height: image.height, data }, edit, luts, scale };
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
  const worker = !ctx && options.worker !== false && !options.filters ? workerBackend() : undefined;

  const apply = async (image: LinearImage, edit: unknown, o: { readonly scale?: number } = {}): Promise<LinearImage> => {
    if (!worker) return applyEdit(image, edit, { filters, resolveLut, gpu: ctx, scale: o.scale });
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
    return worker.run(image, edit, luts, o.scale);
  };

  return {
    backend: ctx ? 'gpu' : 'cpu',
    ...(reason !== undefined ? { reason } : {}),
    ...(ctx ? { gpu: ctx } : {}),
    apply,
    async render(input, edit) {
      const { output = {} } = parseChain(edit, { filters, resolveLut });
      const pixels = input instanceof Blob ? await decodeFile(input) : input;
      const out = await apply(decodeSrgb8(pixels.data, pixels.width, pixels.height), edit);
      return encodeImage(out, output);
    },
    destroy() {
      ctx?.device.destroy();
      worker?.terminate();
    },
  };
}
