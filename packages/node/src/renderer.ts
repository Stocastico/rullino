import { applyEdit, createGpuContext, decodeSrgb8, encodeImage, parseChain, WebGpuUnavailableError, type Filter, type GpuContext, type GpuError, type LinearImage, type Lut } from '@rullino/core';
import { exportSamples } from '@rullino/core/internal';
import { filters as allFilters } from '@rullino/filters';
import { resolveLookLut } from '@rullino/presets';

export interface RendererOptions {
  /**
   * 'auto' (default): Dawn through the `webgpu` package if it is installed and finds an adapter,
   * else the CPU (see `reason`). 'gpu': Dawn or an error. 'cpu': the CPU reference.
   */
  readonly backend?: 'auto' | 'gpu' | 'cpu';
  /** A WebGPU entry point to use instead of loading `webgpu` (e.g. a Dawn instance created with options). */
  readonly gpu?: GPU | undefined;
  /** GPU errors (shaders that do not compile, validation, out of memory). Default: console.error. */
  readonly onError?: ((error: GpuError) => void) | undefined;
  /** The filters documents may use. Default: every filter of `@rullino/filters`. */
  readonly filters?: readonly Filter<any>[] | undefined;
  /** Resolves LUT names in documents. Default: the looks of `@rullino/presets` (`look:<id>`). */
  readonly resolveLut?: ((ref: string) => Lut | undefined) | undefined;
}

/** 8-bit straight-alpha sRGB pixels, row by row: what image decoders produce. */
export interface RgbaImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface Rendered {
  /** The encoded file. */
  readonly bytes: Uint8Array;
  readonly format: 'png' | 'jpeg' | 'webp';
  readonly width: number;
  readonly height: number;
}

export interface Renderer {
  readonly backend: 'gpu' | 'cpu';
  /** Why 'auto' chose the CPU. */
  readonly reason?: string;
  /** The GPU context, when the backend is 'gpu'. */
  readonly gpu?: GpuContext;
  /** Renders an edit document on a linear image (see `applyEdit` in `@rullino/core`). */
  apply(image: LinearImage, edit: unknown, options?: { readonly scale?: number }): Promise<LinearImage>;
  /**
   * Renders an edit document and encodes the result as the document's `output` says. The input is
   * 8-bit RGBA pixels, or an encoded image file (JPEG, PNG, WebP, AVIF, TIFF... decoded by sharp,
   * EXIF orientation applied). PNG is written by rullino (8 or 16 bit); JPEG and WebP by sharp.
   */
  render(input: RgbaImage | Uint8Array, edit: unknown): Promise<Rendered>;
  /** Releases the GPU device. */
  destroy(): void;
}

type Sharp = typeof import('sharp').default;
let sharpModule: Promise<Sharp> | undefined;

/** The optional sharp package, loaded on first use, with an error that says what to install. */
function loadSharp(why: string): Promise<Sharp> {
  const loading = (sharpModule ??= import('sharp').then((m) => m.default));
  return loading.catch((e: Error) => {
    sharpModule = undefined;
    throw new Error(`${why} needs the optional sharp package: npm install sharp (${e.message})`);
  });
}

async function decodeFile(file: Uint8Array): Promise<RgbaImage> {
  const sharp = await loadSharp('reading image files');
  const { data, info } = await sharp(file).rotate().toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Loads Dawn from the optional `webgpu` package and defines the WebGPU globals core relies on. */
async function loadDawn(): Promise<GPU> {
  const { create, globals } = await import('webgpu');
  for (const [name, value] of Object.entries(globals)) if (!(name in globalThis)) (globalThis as Record<string, unknown>)[name] = value;
  return create([]);
}

export async function createRenderer(options: RendererOptions = {}): Promise<Renderer> {
  const backend = options.backend ?? 'auto';
  const parse = { filters: options.filters ?? allFilters, resolveLut: options.resolveLut ?? resolveLookLut };
  let ctx: GpuContext | undefined;
  let reason: string | undefined;
  // Kept referenced for the renderer's lifetime: the device belongs to this Dawn instance.
  let gpu: GPU | undefined;
  if (backend !== 'cpu') {
    try {
      gpu = options.gpu ?? (await loadDawn());
      ctx = await createGpuContext({ gpu, onError: options.onError });
    } catch (e) {
      if (backend === 'gpu') throw e instanceof WebGpuUnavailableError ? e : new WebGpuUnavailableError(`WebGPU (the webgpu package) could not start: ${(e as Error).message}`);
      reason = e instanceof WebGpuUnavailableError ? e.message : `the webgpu package could not be loaded: ${(e as Error).message}`;
    }
  }

  const apply = (image: LinearImage, edit: unknown, o: { readonly scale?: number } = {}) => applyEdit(image, edit, { ...parse, gpu: ctx, scale: o.scale });

  return {
    backend: ctx ? 'gpu' : 'cpu',
    ...(reason !== undefined ? { reason } : {}),
    ...(ctx ? { gpu: ctx } : {}),
    apply,
    async render(input, edit) {
      const { output = {} } = parseChain(edit, parse); // validates first: a bad document gets its own message
      const format = output.format ?? 'png';
      const image = 'width' in input ? input : await decodeFile(input);
      const out = await apply(decodeSrgb8(image.data, image.width, image.height), edit);
      const done = (bytes: Uint8Array) => ({ bytes, format, width: out.width, height: out.height });
      if (format === 'png') return done(new Uint8Array(await (await encodeImage(out, output)).arrayBuffer()));
      const sharp = await loadSharp(`${format.toUpperCase()} output`);
      const encoder = sharp(exportSamples(out, output) as Uint8ClampedArray, { raw: { width: out.width, height: out.height, channels: 4 } });
      const quality = output.quality === undefined ? undefined : Math.round(output.quality * 100);
      const file = format === 'jpeg' ? encoder.jpeg(quality === undefined ? {} : { quality }) : encoder.webp(quality === undefined ? {} : { quality });
      return done(new Uint8Array(await file.toBuffer()));
    },
    destroy() {
      ctx?.device.destroy();
      gpu = undefined;
    },
  };
}
