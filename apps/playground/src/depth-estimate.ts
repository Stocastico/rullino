import type { LinearImage } from '@rullino/core';
import { createDepthEstimator, DEPTH_ANYTHING_V2_SMALL, fetchModel, type DepthEstimator, type OrtModule } from '@rullino/ml';

// "Estimate depth" for the lens blur: Depth Anything V2 Small (int8, 27 MB). ONNX Runtime and the
// model load on first use only. Always the WASM backend: the int8 model runs poorly on WebGPU, the
// fp32 one is 99 MB, and on WASM a depth map takes a few seconds.

export interface DepthMapperDeps {
  readonly loadOrt: () => Promise<OrtModule>;
  readonly status: (message: string) => void;
  readonly fetchModel?: typeof fetchModel;
  readonly createEstimator?: typeof createDepthEstimator;
}

export interface DepthMapper {
  /** The depth map of `image` (grey, near = 1); its size is the model's, not the image's. */
  estimate(image: LinearImage): Promise<LinearImage>;
}

export function createDepthMapper(deps: DepthMapperDeps): DepthMapper {
  let estimator: Promise<DepthEstimator> | undefined;
  const load = () =>
    (estimator ??= (async () => {
      const model = DEPTH_ANYTHING_V2_SMALL;
      const bytes = await (deps.fetchModel ?? fetchModel)(model.model, {
        onProgress: (done) => deps.status(`Downloading the depth model (${(model.bytes / 1e6).toFixed(0)} MB, first use only)… ${Math.min(100, Math.round((done / model.bytes) * 100))}%`),
      });
      deps.status('Starting the depth model…');
      const ort = await deps.loadOrt();
      return (deps.createEstimator ?? createDepthEstimator)(ort, bytes, { sessionOptions: { executionProviders: ['wasm'] } });
    })().catch((e) => {
      estimator = undefined; // allow a retry
      throw e;
    }));

  return {
    async estimate(image) {
      const model = await load();
      deps.status('Estimating depth…');
      return model.estimate(image);
    },
  };
}
