import {
  applyEdit,
  createGpuContext,
  createImage,
  manageSource,
  outputProfile,
  parseEdit,
  WebGpuUnavailableError,
  type Filter,
  type GpuContext,
  type GpuError,
  type LinearImage,
  type Lut,
  type Rgba8Image,
} from '@rullino/core';
import { applyEditPixels, encodeSamples, exportSamples, setPoolLimit } from '@rullino/core/internal';
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
  /**
   * Bytes of GPU memory a render may use (roughly: the working textures it holds). Larger images are
   * rendered in tiles that fit it, with the same result bit for bit; the texture pool keeps at most
   * half of it in idle textures. Without it only images larger than the GPU's largest texture are
   * tiled. Ignored on the CPU.
   */
  readonly memoryBudget?: number | undefined;
  /** A WebGPU entry point to use instead of `navigator.gpu`. */
  readonly gpu?: GPU | undefined;
  /** GPU errors (shaders that do not compile, validation, out of memory). Default: console.error. */
  readonly onError?: ((error: GpuError) => void) | undefined;
  /**
   * Called with a message when `render()` could not use something in a file, e.g. an embedded colour
   * profile it does not support (the colours are then read as sRGB). Default: nothing.
   */
  readonly onWarning?: ((message: string) => void) | undefined;
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
   * `'auto'` for the cores (at most 8). Default: 4 on a machine with 4 cores or more, else 1; `1` renders in the worker alone. Only images of about 2 MP and more start the
   * pool, and steps that need the whole image (equalize, clahe, otsu) run alone. Needs the worker
   * (the default); ignored with custom `filters` or `worker: false`.
   */
  readonly threads?: number | 'auto' | undefined;
  /** Advanced options of the band workers: where their script is, when they start. */
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
   * Renders an edit document on 8-bit pixels (`ImageData`) or an image file (a `Blob`), and encodes
   * the result as the document's `output` says (PNG by default). PNG, JPEG and TIFF files are decoded
   * by `@rullino/codecs`: the same pixels in every browser, 16 bits kept, EXIF orientation applied and
   * an embedded colour profile (Display P3, Adobe RGB…) converted; other formats by the browser.
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
        pool?.onRender?.({ bands: data.bands, bandedMs: data.bandedMs, inlineMs: data.inlineMs });
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

/** What `render()` made of the source file's colours (RFC #181). */
interface Source {
  readonly image: ImageData | LinearImage;
  /** The source had a profile wider than sRGB. */
  readonly wide: boolean;
  /** Its pixels were converted from a profile: the source's own profile must not be copied. */
  readonly converted: boolean;
}

/** A file as pixels: PNG, JPEG and TIFF through `@rullino/codecs` (a file it refuses falls back to the browser), the rest through the browser. */
async function loadSource(file: Blob, bytes: Uint8Array, warn: ((message: string) => void) | undefined): Promise<Source> {
  const codecs = await import('@rullino/codecs'); // loaded only here: pages that never render a file do not pay for it
  const format = codecs.detectFormat(bytes);
  if (format === 'png' || format === 'jpeg' || format === 'tiff' || format === 'hdr' || format === 'exr') {
    try {
      const m = manageSource(await codecs.decodeOriented(bytes));
      if (m.warning) warn?.(m.warning);
      return { image: 'width' in m.image && m.image.data instanceof Uint8ClampedArray ? new ImageData(m.image.data as Uint8ClampedArray<ArrayBuffer>, m.image.width, m.image.height) : (m.image as LinearImage), wide: m.wide, converted: m.converted };
    } catch (e) {
      if (!(e instanceof codecs.CodecError)) throw e;
    }
  }
  return { image: await decodeFile(file), wide: false, converted: false };
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
  if (ctx && options.memoryBudget !== undefined) setPoolLimit(ctx, options.memoryBudget / 2);
  const worker = !ctx && options.worker !== false && !options.filters ? workerBackend(threads, options.pool) : undefined;

  let destroyed = false;
  const run = async (image: LinearImage | Rgba8Image, edit: unknown, scale: number | undefined, pixels: boolean): Promise<LinearImage | Rgba8Image> => {
    if (destroyed) throw new Error('the renderer was destroyed');
    if (!worker) return (pixels ? applyEditPixels : applyEdit)(image, edit, { filters, resolveLut, gpu: ctx, scale, memoryBudget: options.memoryBudget });
    // Parsed here first: a bad document fails with its own message, and the LUTs it names are
    // resolved on this thread (the resolver is a function, which cannot go to the worker).
    const luts: Record<string, Lut> = {};
    parseEdit(edit, {
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
      const { output } = parseEdit(edit, { filters, resolveLut });
      const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : undefined;
      const source: Source = bytes ? await loadSource(input as Blob, bytes, options.onWarning) : { image: input as ImageData, wide: false, converted: false };
      const out = await apply(source.image, edit); // decoded where it renders: on the GPU, or in the worker
      // The output colour space (RFC #181) and what to do with colours it cannot hold: sRGB documents on sRGB photos clip, as they always did.
      const space = output.colorSpace ?? 'srgb';
      const settings = { ...output, colorSpace: space, gamut: output.gamut ?? (space !== 'srgb' || source.wide ? ('map' as const) : ('clip' as const)) };
      const blob = await encodeSamples(exportSamples(out, settings), out.width, out.height, settings);
      // The profile that describes the samples: the output space's, or none when sRGB comes from a converted source; else the source's own.
      const icc = space !== 'srgb' ? outputProfile(space) : source.converted ? null : undefined;
      // The source file's metadata, as output.metadata says, and the document itself (#180).
      const embed = output.embedEdit !== false;
      if (!bytes && !embed && icc === undefined) return blob;
      const { carryMetadata } = await import('@rullino/codecs');
      const carried = await carryMetadata(bytes, new Uint8Array(await blob.arrayBuffer()), { metadata: output.metadata ?? 'keep', width: out.width, height: out.height, ...(embed ? { edit: JSON.stringify(edit) } : {}), ...(icc !== undefined ? { icc } : {}) });
      return new Blob([carried as Uint8Array<ArrayBuffer>], { type: blob.type });
    },
    destroy() {
      destroyed = true;
      ctx?.device.destroy();
      worker?.terminate();
    },
  };
}
