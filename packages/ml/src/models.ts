// Model weights: where they live (pinned revisions, licences) and how they are fetched (with
// progress, cached in the Cache API so a second visit does not download them again).

/** A model file pinned by content: the URL (a fixed revision), its size and its SHA-256 (lowercase hex). */
export interface ModelFile {
  readonly url: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ModelFiles {
  readonly encoder: ModelFile;
  readonly decoder: ModelFile;
  /** Total download size in bytes (both files), for progress messages. */
  readonly bytes: number;
}

const SLIMSAM_REVISION = '5850ab45f587c112167512ffef949107115e26a0';
const slimsam = (file: string, sha256: string, bytes: number): ModelFile => ({
  url: `https://huggingface.co/Xenova/slimsam-77-uniform/resolve/${SLIMSAM_REVISION}/onnx/${file}`,
  sha256,
  bytes,
});

/**
 * SlimSAM-77 (a pruned SAM ViT-B, Apache-2.0, ONNX export by Xenova): point prompts → object mask.
 * `quantized` (int8, 14 MB) downloads fast; `fp32` (40 MB) runs entirely on WebGPU.
 */
export const SLIMSAM_77 = {
  id: 'slimsam-77-uniform',
  licence: 'Apache-2.0',
  source: 'https://huggingface.co/Xenova/slimsam-77-uniform',
  variants: {
    quantized: {
      encoder: slimsam('vision_encoder_quantized.onnx', 'cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971', 8_882_165),
      decoder: slimsam('prompt_encoder_mask_decoder_quantized.onnx', 'cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2', 4_903_810),
      bytes: 13_785_975,
    },
    fp32: {
      encoder: slimsam('vision_encoder.onnx', '9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0', 23_276_014),
      decoder: slimsam('prompt_encoder_mask_decoder.onnx', 'f4514391764fbd56e08e119060d874ecd7d52994bfb1968af159e12d4943b5bb', 16_557_892),
      bytes: 39_833_906,
    },
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
  model: {
    url: `https://huggingface.co/andraniksargsyan/migan/resolve/${MIGAN_REVISION}/migan_pipeline_v2.onnx`,
    sha256: '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
    bytes: 28_079_181,
  },
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
  model: {
    url: `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${DEPTH_REVISION}/onnx/model_int8.onnx`,
    sha256: '01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001',
    bytes: 27_258_801,
  },
  bytes: 27_258_801,
} as const;

export interface FetchModelOptions {
  /** Called as bytes arrive: (received, total); total is 0 when the server does not say. */
  readonly onProgress?: (received: number, total: number) => void;
  /** Cache API bucket; files are cached by URL (pinned revisions never change). */
  readonly cacheName?: string;
  readonly fetch?: (url: string) => Promise<Response>;
}

/** A download that is not the file it should be (truncated, corrupted or replaced). */
export class ModelIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelIntegrityError';
  }
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Throws unless `bytes` has the size and SHA-256 `file` declares. */
async function verify(file: ModelFile, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  if (bytes.length !== file.bytes) throw new ModelIntegrityError(`${file.url}: got ${bytes.length} bytes, expected ${file.bytes}`);
  const actual = await sha256Hex(bytes);
  if (actual !== file.sha256) throw new ModelIntegrityError(`${file.url}: sha256 is ${actual}, expected ${file.sha256}`);
}

/**
 * The bytes of a model file, from the cache if present, else downloaded (and then cached).
 * A `ModelFile` is verified (size and SHA-256) before it is cached and before it is returned; a
 * corrupt cache entry is dropped and downloaded again. A bare URL is only checked against the
 * server's Content-Length (truncation).
 */
export async function fetchModel(file: string | ModelFile, options: FetchModelOptions = {}): Promise<Uint8Array> {
  const pinned = typeof file === 'string' ? undefined : file;
  const url = typeof file === 'string' ? file : file.url;
  const cache = typeof caches === 'undefined' || !caches ? undefined : await caches.open(options.cacheName ?? 'rullino-models');
  const hit = await cache?.match(url);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if (!pinned) return bytes;
    try {
      await verify(pinned, bytes);
      return bytes;
    } catch (e) {
      if (!(e instanceof ModelIntegrityError)) throw e;
      await cache?.delete(url);
    }
  }

  const res = await (options.fetch ?? fetch)(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const announced = Number(res.headers.get('content-length') ?? 0);
  const total = announced || pinned?.bytes || 0;
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (pinned && received > pinned.bytes) {
      await reader.cancel();
      throw new ModelIntegrityError(`${url}: more than ${pinned.bytes} bytes received`);
    }
    options.onProgress?.(received, total);
  }
  if (announced && received !== announced) throw new ModelIntegrityError(`${url}: got ${received} bytes, Content-Length said ${announced}`);
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  if (pinned) await verify(pinned, bytes);
  await cache?.put(url, new Response(bytes));
  return bytes;
}
