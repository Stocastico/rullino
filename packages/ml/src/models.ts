// Model weights: where they live (pinned revisions, licences) and how they are fetched (with
// progress, cached in the Cache API so a second visit does not download them again).

export interface ModelFiles {
  readonly encoder: string;
  readonly decoder: string;
  /** Total download size in bytes (both files), for progress messages. */
  readonly bytes: number;
}

const SLIMSAM_REVISION = '5850ab45f587c112167512ffef949107115e26a0';
const slimsam = (file: string) => `https://huggingface.co/Xenova/slimsam-77-uniform/resolve/${SLIMSAM_REVISION}/onnx/${file}`;

/**
 * SlimSAM-77 (a pruned SAM ViT-B, Apache-2.0, ONNX export by Xenova): point prompts → object mask.
 * `quantized` (int8, 14 MB) downloads fast; `fp32` (40 MB) runs entirely on WebGPU.
 */
export const SLIMSAM_77 = {
  id: 'slimsam-77-uniform',
  licence: 'Apache-2.0',
  source: 'https://huggingface.co/Xenova/slimsam-77-uniform',
  variants: {
    quantized: { encoder: slimsam('vision_encoder_quantized.onnx'), decoder: slimsam('prompt_encoder_mask_decoder_quantized.onnx'), bytes: 13_785_975 },
    fp32: { encoder: slimsam('vision_encoder.onnx'), decoder: slimsam('prompt_encoder_mask_decoder.onnx'), bytes: 39_833_906 },
  },
} as const satisfies { id: string; licence: string; source: string; variants: Record<string, ModelFiles> };

const MIGAN_REVISION = '406830d0fa60666da0071c342ad2fbc8f30c5c64';

/**
 * MI-GAN (Picsart AI Research, ICCV 2023; code and weights MIT): object removal. The "pipeline"
 * ONNX export takes an 8-bit image and mask of any size and handles resizing and blending itself.
 */
export const MIGAN = {
  id: 'migan-pipeline-v2',
  licence: 'MIT',
  source: 'https://huggingface.co/andraniksargsyan/migan',
  model: `https://huggingface.co/andraniksargsyan/migan/resolve/${MIGAN_REVISION}/migan_pipeline_v2.onnx`,
  bytes: 28_079_181,
} as const;

const DEPTH_REVISION = '4472b7362082ad9968fee890ca0f1e5aca36b93d';

/**
 * Depth Anything V2 Small (Apache-2.0; the larger sizes are not), Xenova's ONNX export, int8 (27 MB).
 * Measured against the fp32 export (99 MB) on the sample photos: the same map. Depth Anything 3
 * Small (105 MB, fp32 only) gave a blurrier map with coarser edges, so it is not used.
 */
export const DEPTH_ANYTHING_V2_SMALL = {
  id: 'depth-anything-v2-small',
  licence: 'Apache-2.0',
  source: 'https://huggingface.co/onnx-community/depth-anything-v2-small',
  model: `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${DEPTH_REVISION}/onnx/model_int8.onnx`,
  bytes: 27_258_801,
} as const;

export interface FetchModelOptions {
  /** Called as bytes arrive: (received, total); total is 0 when the server does not say. */
  readonly onProgress?: (received: number, total: number) => void;
  /** Cache API bucket; files are cached by URL (pinned revisions never change). */
  readonly cacheName?: string;
  readonly fetch?: (url: string) => Promise<Response>;
}

/** The bytes of a model file, from the cache if present, else downloaded (and then cached). */
export async function fetchModel(url: string, options: FetchModelOptions = {}): Promise<Uint8Array> {
  const cache = typeof caches === 'undefined' || !caches ? undefined : await caches.open(options.cacheName ?? 'rullino-models');
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());

  const res = await (options.fetch ?? fetch)(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    options.onProgress?.(received, total);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  await cache?.put(url, new Response(bytes));
  return bytes;
}
