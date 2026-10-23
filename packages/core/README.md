# @rullino/core

The core of [rullino](https://github.com/Stocastico/rullino): GPU-first image processing for the web on **WebGPU**, written in TypeScript. Zero runtime dependencies.

It holds what every filter builds on: the parameter schema and `defineFilter()`, the cached filter-chain `Pipeline`, masks, geometry (crop, perspective, straighten), 3D LUTs, colour maths, and export to PNG (8/16-bit), JPEG and WebP. The filters themselves are in [`@rullino/filters`](../filters/README.md).

> Pre-alpha (0.x): the API may change between minor versions. Only the package root is public; `@rullino/core/internal` is plumbing without any stability promise.

## Install

```sh
npm install @rullino/core @rullino/filters
npm install -D @webgpu/types   # TypeScript only: the type declarations mention GPUDevice, GPUTexture...
```

ESM only. A browser with WebGPU is needed for the GPU path (recent Chrome / Edge; Safari and Firefox where WebGPU is enabled). Every filter also has a plain TypeScript CPU implementation that works anywhere, Node included.

## Run a chain on the GPU

Images live on the GPU as linear, premultiplied `rgba16float` textures; sRGB exists only when you import and read back.

```ts
import { createGpuContext, importImage, Pipeline, readSrgb8 } from '@rullino/core';
import { contrast, exposure } from '@rullino/filters';

const ctx = await createGpuContext(); // throws WebGpuUnavailableError without WebGPU
const bitmap = await createImageBitmap(await (await fetch('photo.jpg')).blob());
const source = importImage(ctx, bitmap);

const pipeline = new Pipeline(ctx);
pipeline.setSource(source);
// Consecutive pointwise filters are fused into one pass; changing a param recomputes only from
// the first affected step on.
const out = pipeline.run([
  { filter: exposure, params: { ev: 0.5 } },
  { filter: contrast, params: { amount: 0.2 } },
]);
const rgba = await readSrgb8(ctx, out); // Uint8ClampedArray, straight sRGB: ready for ImageData
```

## Errors and device loss

WebGPU reports mistakes asynchronously: a shader that does not compile gives an all-zero image, not an exception. Pass `onError` to hear about it, with the shader's name and the compiler's lines (without it the errors go to `console.error`). `ctx.lost` resolves when the device is lost (driver reset, GPU switch): create a new context and upload your images again. `ctx.limits` holds the device limits, raised to the adapter's own.

```ts
import { createGpuContext, ShaderCompileError } from '@rullino/core';

const ctx = await createGpuContext({
  onError: (error) => {
    if (error instanceof ShaderCompileError) console.error(error.label, error.messages); // line, column, message
    else console.error(error.kind, error.message); // 'validation' | 'out-of-memory' | 'internal'
  },
});
const info = await ctx.lost; // when the device is lost
console.warn('GPU device lost:', info.reason, info.message, ctx.limits.maxTextureDimension2D);
```

## Run the same chain on the CPU

The CPU version is the specification the GPU shaders are tested against, so results agree within the filter's tolerance.

```ts
import { createImage, runChainCpu } from '@rullino/core';
import { exposure } from '@rullino/filters';

const image = createImage(2, 1, Float32Array.from([0.1, 0.2, 0.3, 1, 0.4, 0.2, 0.1, 0.5])); // linear, premultiplied
const result = runChainCpu([{ filter: exposure, params: { ev: 1 } }], image); // doubles the light
console.log(result.data);
```

## Write a filter

A filter is a schema, a WGSL function and a CPU reference. The UI, the validation and the serialisation are generated from the schema.

```ts
import { defineFilter } from '@rullino/core';

export const gain = defineFilter({
  id: 'gain',
  label: 'Gain',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: { amount: { type: 'float', min: 0, max: 4, step: 0.01, default: 1, label: 'Amount' } },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return vec4f(c.rgb * p.amount, c.a);
}`,
  pixel: ([r, g, b, a], { amount }) => [r * amount, g * amount, b * amount, a],
  tolerance: { abs: 1e-4, rel: 2 ** -10 },
});
```

Neighbourhood filters use `kind: 'multipass'` (a fixed list of passes); see the [filters' sources](../filters/src) for blurs, edges and reductions.

## Export

```ts
import { exportImage, type GpuContext } from '@rullino/core';

export async function savePng(ctx: GpuContext, texture: GPUTexture): Promise<Blob> {
  return exportImage(ctx, texture, { format: 'png', bitDepth: 16 }); // or 'jpeg' / 'webp' with `quality`
}
```

## License

MIT. See the [repository](https://github.com/Stocastico/rullino) for the design notes, the filter reference and the playground.
