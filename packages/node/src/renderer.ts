import { applyEdit, createGpuContext, makeGainMap, manageSource, outputProfile, parseEdit, reconstructHdr, sdrFromHdr, WebGpuUnavailableError, type Filter, type GpuContext, type GpuError, type LinearImage, type Lut, type OutputSettings, type Rgba8Image } from '@rullino/core';
import { chainDocument, encodeSamples, exportSamples, setPoolLimit } from '@rullino/core/internal';
import { filters as allFilters } from '@rullino/filters';
import { resolveLookLut } from '@rullino/presets';
import { createThreadedExecutor, DEFAULT_WORKER_URL, resolveThreads } from './threads';

export interface RendererOptions {
  /**
   * Bytes of GPU memory a render may use (roughly: the working textures it holds). Larger images are
   * rendered in tiles that fit it, with the same result bit for bit; the texture pool keeps at most
   * half of it in idle textures. Without it only images larger than the GPU's largest texture are
   * tiled. Ignored on the CPU.
   */
  readonly memoryBudget?: number | undefined;
  /**
   * Called with a message when `render()` could not use something in a file, e.g. an embedded colour
   * profile it does not support (the colours are then read as sRGB). Default: nothing (the CLI prints it).
   */
  readonly onWarning?: ((message: string) => void) | undefined;
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
  /**
   * Worker threads for the CPU backend: a number, or 'auto' (the cores, at most 8). Default 1: the
   * calling thread. With more, large images are cut into bands rendered in parallel with the same
   * result, bit for bit; small images stay on the calling thread, and so do the steps that need the
   * whole image (equalize, clahe, otsu) except for their statistic, which the bands compute. Ignored on the GPU, and with custom `filters` (functions cannot be sent to a
   * worker). Call `destroy()` to stop the threads.
   */
  readonly threads?: number | 'auto' | undefined;
  /** Advanced (bundlers, tests): where the worker script is, and from how many pixels threads are worth it. */
  readonly pool?:
    | {
        readonly workerUrl?: URL | undefined;
        readonly createAtPixels?: number | undefined;
        readonly useAtPixels?: number | undefined;
        readonly forceBands?: boolean | undefined;
        /** Called after each render that used the executor, with the band jobs it ran and where its time went (diagnostics, benchmarks). */
        readonly onRender?: ((info: { readonly bands: number; readonly bandedMs: number; readonly inlineMs: number }) => void) | undefined;
      }
    | undefined;
}

/** 8-bit straight-alpha sRGB pixels, row by row: what image decoders produce. */
export type RgbaImage = Rgba8Image;

export interface Rendered {
  /** The encoded file. */
  readonly bytes: Uint8Array;
  readonly format: 'png' | 'jpeg' | 'webp';
  readonly width: number;
  readonly height: number;
}

/** What `render()` made of the source file's colours. */
interface Source {
  readonly image: RgbaImage | LinearImage;
  /** The source had a profile wider than sRGB. */
  readonly wide: boolean;
  /** Its pixels were converted from a profile: the source's own profile must not be copied. */
  readonly converted: boolean;
}

export interface Renderer {
  readonly backend: 'gpu' | 'cpu';
  /** Worker threads in use for the CPU backend: 1 means the calling thread. */
  readonly threads: number;
  /** Why 'auto' chose the CPU. */
  readonly reason?: string;
  /** The GPU context, when the backend is 'gpu'. */
  readonly gpu?: GpuContext;
  /** Renders an edit document on a linear image (see `applyEdit` in `@rullino/core`). */
  apply(image: LinearImage | Rgba8Image, edit: unknown, options?: { readonly scale?: number }): Promise<LinearImage>;
  /**
   * Renders an edit document and encodes the result as the document's `output` says. The input is
   * 8-bit RGBA pixels, or an encoded image file: PNG, JPEG and TIFF are decoded by @rullino/codecs (embedded colour profiles converted, 16 bits kept), the others (WebP, AVIF...) by sharp,
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

/**
 * A file as pixels (RFC #181): PNG, JPEG and TIFF through `@rullino/codecs` (the same pixels as in the
 * browser; 16-bit kept; EXIF orientation applied; an embedded colour profile converted), anything
 * else through sharp. A file the codecs refuse (a variant they do not read) falls back to sharp.
 */
async function loadSource(file: Uint8Array, warn: ((message: string) => void) | undefined, hdr: boolean): Promise<Source> {
  const codecs = await import('@rullino/codecs');
  const format = codecs.detectFormat(file);
  if (hdr && format === 'jpeg') {
    // An Ultra HDR file starts from its HDR rendition (the SDR picture and its gain map): both turned upright like the file.
    const uhdr = codecs.readUltraHdr(file);
    if (uhdr) {
      const orientation = codecs.exifOrientation((await codecs.readMetadata(uhdr.primary).catch(() => ({}) as { exif?: Uint8Array })).exif);
      const sdr = codecs.orient(await codecs.decodeJpeg(uhdr.primary), orientation);
      const gain = codecs.orient(await codecs.decodeJpeg(uhdr.gainMap), orientation);
      if (sdr.bitDepth !== 8 || gain.bitDepth !== 8) throw new Error('an Ultra HDR file needs 8-bit JPEGs');
      const m = reconstructHdr(sdr, gain, uhdr.metadata);
      if (m.warning) warn?.(m.warning);
      return m;
    }
  }
  if (format === 'png' || format === 'jpeg' || format === 'tiff' || format === 'hdr' || format === 'exr') {
    try {
      const m = manageSource(await codecs.decodeOriented(file));
      if (m.warning) warn?.(m.warning);
      return m;
    } catch (e) {
      if (!(e instanceof codecs.CodecError)) throw e;
    }
  }
  return { image: await decodeFile(file), wide: false, converted: false };
}

async function decodeFile(file: Uint8Array): Promise<RgbaImage> {
  const sharp = await loadSharp('reading image files');
  const { data, info } = await sharp(file).rotate().toColourspace('srgb').ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

let dawn: Promise<GPU> | undefined;

/**
 * Loads Dawn from the optional `webgpu` package, defines the WebGPU globals core relies on, and
 * creates its instance once per process (#223): every renderer asks it for an adapter and a device
 * of its own. Several instances in one process made Dawn crash or hang now and then. A failed load
 * is not kept, so a later renderer tries again.
 */
function loadDawn(): Promise<GPU> {
  dawn ??= import('webgpu').then(({ create, globals }) => {
    for (const [name, value] of Object.entries(globals)) if (!(name in globalThis)) (globalThis as Record<string, unknown>)[name] = value;
    return create([]);
  });
  return dawn.catch((e: unknown) => {
    dawn = undefined;
    throw e;
  });
}

/**
 * An export with the metadata it should carry (#180): the source file's as `output.metadata` says, and
 * the document as XMP unless `output.embedEdit` is false. `@rullino/codecs` is loaded only here.
 */
async function carry(source: Uint8Array | undefined, encoded: Uint8Array, edit: unknown, output: OutputSettings, size: { width: number; height: number }, icc: Uint8Array | null | undefined): Promise<Uint8Array> {
  const embed = output.embedEdit !== false;
  if (!source && !embed && icc === undefined) return encoded;
  const { carryMetadata } = await import('@rullino/codecs');
  return carryMetadata(source, encoded, { metadata: output.metadata ?? 'keep', width: size.width, height: size.height, ...(embed ? { edit: JSON.stringify(edit) } : {}), ...(icc !== undefined ? { icc } : {}) });
}

export async function createRenderer(options: RendererOptions = {}): Promise<Renderer> {
  const backend = options.backend ?? 'auto';
  const parse = { filters: options.filters ?? allFilters, resolveLut: options.resolveLut ?? resolveLookLut };
  let ctx: GpuContext | undefined;
  let reason: string | undefined;
  // Kept referenced for the renderer's lifetime: the device belongs to this Dawn instance (shared by
  // the process's renderers, see loadDawn).
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

  if (ctx && options.memoryBudget !== undefined) setPoolLimit(ctx, options.memoryBudget / 2);
  const threads = ctx || options.filters ? 1 : resolveThreads(options.threads);
  const executor =
    threads > 1
      ? createThreadedExecutor({
          threads,
          workerUrl: options.pool?.workerUrl ?? DEFAULT_WORKER_URL,
          // A pool takes 80-240 ms to start: from ~2 MP a render is long enough to pay for it; an existing one pays from ~0.5 MP.
          createAtPixels: options.pool?.createAtPixels ?? 2_000_000,
          useAtPixels: options.pool?.useAtPixels ?? 500_000,
          forceBands: options.pool?.forceBands ?? false,
          onRender: options.pool?.onRender,
        })
      : undefined;

  const applyInternal = (image: LinearImage | Rgba8Image, edit: unknown, o: { readonly scale?: number } = {}, shared = false) => {
    if (!executor) return applyEdit(image, edit, { ...parse, gpu: ctx, scale: o.scale, memoryBudget: options.memoryBudget });
    // The workers parse the document again: they need the LUTs it names, by name.
    const luts = new Map<string, Lut>();
    const resolveLut = (ref: string) => {
      const lut = parse.resolveLut(ref);
      if (lut) luts.set(ref, lut);
      return lut;
    };
    return applyEdit(image, edit, { ...parse, resolveLut, scale: o.scale, cpu: (steps, framed, c) => executor.run(chainDocument(edit, c.node), luts, steps, framed, { scale: c.scale, shared }) });
  };
  // Images that leave the renderer are ordinary memory; `render` only reads its result, so it can stay in shared memory.
  const apply = (image: LinearImage | Rgba8Image, edit: unknown, o: { readonly scale?: number } = {}) => applyInternal(image, edit, o);

  return {
    backend: ctx ? 'gpu' : 'cpu',
    threads,
    ...(reason !== undefined ? { reason } : {}),
    ...(ctx ? { gpu: ctx } : {}),
    apply,
    async render(input, edit) {
      const { output } = parseEdit(edit, parse); // validates first: a bad document gets its own message
      const format = output.format ?? 'png';
      const source: Source = 'width' in input ? { image: input, wide: false, converted: false } : await loadSource(input, options.onWarning, output.hdr === 'gain-map');
      const out = await applyInternal(source.image, edit, {}, true); // decoded where it renders (on Dawn: on the GPU)
      // The output colour space (RFC #181) and what to do with colours it cannot hold: sRGB documents on sRGB photos clip, as they always did.
      const space = output.colorSpace ?? 'srgb';
      const settings = { ...output, colorSpace: space, gamut: output.gamut ?? (space !== 'srgb' || source.wide ? ('map' as const) : ('clip' as const)) };
      // The profile that describes the samples: the output space's, or none when sRGB comes from a converted source; else the source's own.
      const icc = space !== 'srgb' ? outputProfile(space) : source.converted ? null : undefined;
      // The source file's metadata, as output.metadata says, and the document itself (#180).
      const done = async (bytes: Uint8Array) => ({ bytes: await carry('width' in input ? undefined : input, bytes, edit, output, out, icc), format, width: out.width, height: out.height });
      if (output.hdr === 'gain-map') {
        // Ultra HDR (#182): the result is HDR light; the SDR picture rolls the highlights off, the gain map brings them back.
        const sdr = sdrFromHdr(out);
        const { map, metadata } = makeGainMap(sdr, out);
        const sharp = await loadSharp('JPEG output');
        const q = output.quality === undefined ? {} : { quality: Math.max(1, Math.round(output.quality * 100)) };
        const base = new Uint8Array(await sharp(exportSamples(sdr, settings) as Uint8ClampedArray, { raw: { width: out.width, height: out.height, channels: 4 } }).jpeg(q).toBuffer());
        const carried = await carry('width' in input ? undefined : input, base, edit, output, out, icc);
        const codecs = await import('@rullino/codecs');
        const rgba = new Uint8Array(map.width * map.height * 4).fill(255);
        for (let i = 0; i < map.width * map.height; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = map.data[i * map.channels + (map.channels === 1 ? 0 : c)]!;
        const gainJpeg = codecs.encodeJpeg({ width: map.width, height: map.height, data: rgba }, { quality: 0.9, ...(map.channels === 1 ? { grey: true } : { subsampling: '4:4:4' as const }) });
        return { bytes: codecs.writeUltraHdr({ primary: carried, gainMap: gainJpeg, metadata }), format, width: out.width, height: out.height };
      }
      const samples = exportSamples(out, settings);
      if (format === 'png') return done(new Uint8Array(await (await encodeSamples(samples, out.width, out.height, settings)).arrayBuffer()));
      const sharp = await loadSharp(`${format.toUpperCase()} output`);
      const encoder = sharp(samples as Uint8ClampedArray, { raw: { width: out.width, height: out.height, channels: 4 } });
      const quality = output.quality === undefined ? undefined : Math.max(1, Math.round(output.quality * 100)); // sharp takes 1-100
      const file = format === 'jpeg' ? encoder.jpeg(quality === undefined ? {} : { quality }) : encoder.webp(quality === undefined ? {} : { quality });
      return done(new Uint8Array(await file.toBuffer()));
    },
    destroy() {
      executor?.destroy();
      ctx?.device.destroy();
      gpu = undefined;
    },
  };
}
