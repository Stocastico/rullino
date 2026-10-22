import { createRasterMask, type LinearImage, type RasterMaskData } from '@rullino/core';
import { createSamSegmenter, fetchModel, SLIMSAM_77, type OrtModule, type SamEmbedding, type SamPoint, type SamSegmenter } from '@rullino/ml';

// "Object" mask tool: click an object, SAM (SlimSAM) finds its outline. ONNX Runtime and the model
// are loaded on first use only; each image is encoded once (slow), every click then decodes (fast).

export interface Backend {
  readonly variant: keyof typeof SLIMSAM_77.variants;
  readonly providers: readonly string[];
  readonly label: string;
}

/**
 * A real GPU runs the fp32 model on WebGPU (int8 ops of the quantized model run poorly there); a
 * software GPU (SwiftShader, `isFallbackAdapter`) or none runs the quantized model on WASM:
 * measured on SwiftShader, WebGPU took 480 s to encode where WASM took 19 s.
 */
export function chooseBackend(gpu: { software: boolean } | undefined): Backend {
  return gpu && !gpu.software
    ? { variant: 'fp32', providers: ['webgpu', 'wasm'], label: 'WebGPU' }
    : { variant: 'quantized', providers: ['wasm'], label: 'WASM (CPU)' };
}

/** Whether a WebGPU adapter is a software renderer. */
export function isSoftwareAdapter(adapter: GPUAdapter | null): boolean {
  if (!adapter) return true;
  const info = adapter.info as Partial<GPUAdapterInfo> & { isFallbackAdapter?: boolean };
  const text = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''} ${info.device ?? ''}`;
  return Boolean((adapter as { isFallbackAdapter?: boolean }).isFallbackAdapter ?? info.isFallbackAdapter) || /swiftshader|llvmpipe|software/i.test(text);
}

export interface ObjectSelectorDeps {
  /** Loads the ONNX Runtime module (a dynamic import in the app, a fake in tests). */
  readonly loadOrt: () => Promise<OrtModule>;
  /** The WebGPU adapter's kind, or undefined without WebGPU. */
  readonly gpu: () => Promise<{ software: boolean } | undefined>;
  /** The original (framed) image at w x h, linear premultiplied. */
  readonly image: (w: number, h: number) => Promise<LinearImage>;
  readonly status: (message: string) => void;
  readonly fetchModel?: typeof fetchModel;
  readonly createSegmenter?: typeof createSamSegmenter;
}

export interface ObjectSelector {
  /**
   * The selection for `points` at the given raster size, combined with `base` (the mask before
   * this object was started: max of both, so several objects can be added one after the other).
   */
  select(base: RasterMaskData, points: readonly SamPoint[]): Promise<RasterMaskData>;
}

export function createObjectSelector(deps: ObjectSelectorDeps): ObjectSelector {
  let segmenter: Promise<SamSegmenter> | undefined;
  const embeddings = new WeakMap<LinearImage, Promise<SamEmbedding>>();

  const load = () =>
    (segmenter ??= (async () => {
      const backend = chooseBackend(await deps.gpu());
      const model = SLIMSAM_77.variants[backend.variant];
      const received = [0, 0];
      const progress = (i: number) => (done: number) => {
        received[i] = done;
        deps.status(`Downloading the selection model (${(model.bytes / 1e6).toFixed(0)} MB, first use only)… ${Math.min(100, Math.round(((received[0]! + received[1]!) / model.bytes) * 100))}%`);
      };
      const get = deps.fetchModel ?? fetchModel;
      const [encoder, decoder] = await Promise.all([get(model.encoder, { onProgress: progress(0) }), get(model.decoder, { onProgress: progress(1) })]);
      deps.status(`Starting the selection model on ${backend.label}…`);
      const ort = await deps.loadOrt();
      return (deps.createSegmenter ?? createSamSegmenter)(ort, { encoder, decoder }, { sessionOptions: { executionProviders: [...backend.providers] } });
    })().catch((e) => {
      segmenter = undefined; // allow a retry
      throw e;
    }));

  return {
    async select(base, points) {
      const sam = await load();
      // At the raster's size (≤ 1024, the image's proportions): the encoder works at 1024 anyway.
      const image = await deps.image(base.width, base.height);
      let embedding = embeddings.get(image);
      if (!embedding) {
        deps.status('Analysing the image (once per image)…');
        embedding = sam.encode(image);
        embeddings.set(image, embedding);
        embedding.catch(() => embeddings.delete(image));
      }
      const { mask } = await sam.segment(await embedding, points, base.width, base.height);
      const data = new Float32Array(base.data.length);
      for (let i = 0; i < data.length; i++) data[i] = Math.max(base.data[i]!, mask.data[i]!);
      return createRasterMask(base.width, base.height, data);
    },
  };
}
