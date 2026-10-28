// rullino's CPU backend as browsers without WebGPU get it: @rullino/web with backend 'cpu', the
// fast CPU path in a Web Worker. Every run sends the image to the worker and back (no caching).
import { decodeSrgb8, encodeSrgb8, serializeChain, type LinearImage } from '@rullino/core';
import { lookLutRef } from '@rullino/presets';
import { createRenderer, type Renderer } from '@rullino/web';
import type { Adapter } from '../adapter';
import { rullinoSteps } from '../rullino-chains';
import { versions } from '../versions';

let renderer: Renderer | undefined;
let image: LinearImage | undefined;

export const adapter: Adapter = {
  id: 'rullino-cpu',
  label: 'rullino (CPU, Web Worker)',
  version: versions['@rullino/web'],
  backend: 'JS worker',
  notes: {
    'exposure-curves-lut': 'exact (fast CPU path, within each filter\'s published tolerance of the GPU).',
    'blur-unsharp': 'exact (fast CPU path).',
    'levels-vignette-grain': 'exact (fast CPU path; levels and grain on the fast path, vignette too).',
  },
  async init() {
    renderer = await createRenderer({ backend: 'cpu' });
  },
  async load(rgba, width, height) {
    image = decodeSrgb8(rgba, width, height);
  },
  async run(chain, variant) {
    const doc = serializeChain(rullinoSteps(chain, variant), { lutRef: lookLutRef });
    return encodeSrgb8(await renderer!.apply(image!, doc));
  },
  dispose() {
    renderer?.destroy();
    [renderer, image] = [undefined, undefined];
  },
};
