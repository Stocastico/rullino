import type { LinearImage, RasterMaskData } from '@rullino/core';
import { createMiganInpainter, fetchModel, MIGAN, type Inpainter, type OrtModule } from '@rullino/ml';
import { chooseBackend } from './object-select';

// "Remove object": MI-GAN fills the hole of a mask with plausible content. ONNX Runtime and the
// model (28 MB) are loaded on first use only. MI-GAN has one model file, so the backend choice
// only decides the execution provider (WebGPU on a real GPU, WASM otherwise).

/** The mask is grown by this many mask pixels before filling: an object's soft edge would otherwise survive as an outline. */
export const REMOVE_GROW = 3;

export interface ObjectRemoverDeps {
  readonly loadOrt: () => Promise<OrtModule>;
  /** The WebGPU adapter's kind, or undefined without WebGPU. */
  readonly gpu: () => Promise<{ software: boolean } | undefined>;
  readonly status: (message: string) => void;
  readonly fetchModel?: typeof fetchModel;
  readonly createInpainter?: typeof createMiganInpainter;
}

export interface ObjectRemover {
  /** `image` with the hole (`mask` above 0.5; grow it first, see REMOVE_GROW) filled in, at the image's size. */
  fill(image: LinearImage, mask: RasterMaskData): Promise<LinearImage>;
}

export function createObjectRemover(deps: ObjectRemoverDeps): ObjectRemover {
  let inpainter: Promise<Inpainter> | undefined;
  const load = () =>
    (inpainter ??= (async () => {
      const backend = chooseBackend(await deps.gpu());
      const bytes = await (deps.fetchModel ?? fetchModel)(MIGAN.model, {
        onProgress: (done) => deps.status(`Downloading the removal model (${(MIGAN.bytes / 1e6).toFixed(0)} MB, first use only)… ${Math.min(100, Math.round((done / MIGAN.bytes) * 100))}%`),
      });
      deps.status(`Starting the removal model on ${backend.label}…`);
      const ort = await deps.loadOrt();
      return (deps.createInpainter ?? createMiganInpainter)(ort, bytes, { sessionOptions: { executionProviders: [...backend.providers] } });
    })().catch((e) => {
      inpainter = undefined; // allow a retry
      throw e;
    }));

  return {
    async fill(image, mask) {
      const model = await load();
      deps.status('Filling the area…');
      return model.inpaint(image, mask);
    },
  };
}
