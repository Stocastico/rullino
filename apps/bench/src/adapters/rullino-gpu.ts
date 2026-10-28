// rullino on WebGPU through the core Pipeline: the source texture stays on the GPU, a change
// re-runs the chain from the changed step (here the first) and reads the result back.
import { createGpuContext, decodeSrgb8, Pipeline, readSrgb8, uploadImage, type GpuContext } from '@rullino/core';
import type { Adapter } from '../adapter';
import { rullinoSteps } from '../rullino-chains';
import { versions } from '../versions';

let ctx: GpuContext | undefined;
let pipeline: Pipeline | undefined;
let source: GPUTexture | undefined;

export const adapter: Adapter = {
  id: 'rullino-gpu',
  label: 'rullino (WebGPU)',
  version: versions['@rullino/core'],
  backend: 'WebGPU',
  notes: {
    'exposure-curves-lut': 'exact: exposure in linear light, monotone S-curve, 33³ LUT (look "warm"); exposure + curves fuse into one shader.',
    'blur-unsharp': 'exact: separable Gaussian σ, unsharp mask amount 0.8 σ 2.',
    'levels-vignette-grain': 'exact: levels, vignette −0.4, film grain 0.3.',
  },
  async init() {
    ctx = await createGpuContext();
  },
  async load(rgba, width, height) {
    source?.destroy();
    pipeline?.destroy();
    source = uploadImage(ctx!, decodeSrgb8(rgba, width, height));
    pipeline = new Pipeline(ctx!);
    pipeline.setSource(source);
  },
  async run(chain, variant) {
    return readSrgb8(ctx!, pipeline!.run(rullinoSteps(chain, variant)));
  },
  dispose() {
    pipeline?.destroy();
    source?.destroy();
    ctx?.device.destroy();
    [ctx, pipeline, source] = [undefined, undefined, undefined];
  },
};
