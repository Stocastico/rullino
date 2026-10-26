# @rullino/ml

Optional machine-learning tools for [rullino](https://github.com/Stocastico/rullino), running small ONNX models in the browser:

| Tool | Model | Size |
|---|---|---|
| Click to select an object | SlimSAM-77 (Apache-2.0) | 14 MB int8 / 40 MB fp32 |
| Remove an object | MI-GAN (MIT) | 28 MB |
| Depth for a lens blur | Depth Anything V2 Small (Apache-2.0) | 27 MB int8 |

The weights are **not bundled**: `fetchModel` downloads a pinned revision from Hugging Face on first use and caches it in the browser (Cache API). Licences and sources are in [THIRD_PARTY_NOTICES.md](https://github.com/Stocastico/rullino/blob/main/THIRD_PARTY_NOTICES.md).

> Pre-alpha (0.x): the API may change between minor versions.

**[API reference](https://stefanomasneri.com/rullino/docs/modules/_rullino_ml.html)** (generated from the sources)

## Install

ONNX Runtime is **passed in, not imported**: the package has no runtime dependency, and you choose the build (WASM or WebGPU).

```sh
npm install @rullino/core @rullino/ml onnxruntime-web
```

## Select an object

```ts
import { createImage } from '@rullino/core';
import { createSamSegmenter, fetchModel, SLIMSAM_77, type OrtModule } from '@rullino/ml';
import * as ort from 'onnxruntime-web';

const model = SLIMSAM_77.variants.quantized;
const [encoder, decoder] = await Promise.all([fetchModel(model.encoder), fetchModel(model.decoder)]);
const sam = await createSamSegmenter(ort as unknown as OrtModule, { encoder, decoder }, { sessionOptions: { executionProviders: ['wasm'] } });

const image = createImage(640, 480); // your image: linear, premultiplied (see @rullino/core)
const embedding = await sam.encode(image); // slow, once per image
// A click at the centre; positive: true marks the object, false excludes a part.
const { mask } = await sam.segment(embedding, [{ x: 0.5, y: 0.5, positive: true }], 640, 480);
console.log(mask.width, mask.height); // a soft raster mask, usable as a rullino mask
```

## Remove an object, and estimate depth

```ts
import { createImage, createRasterMask } from '@rullino/core';
import { createDepthEstimator, createMiganInpainter, DEPTH_ANYTHING_V2_SMALL, fetchModel, growMask, MIGAN, type OrtModule } from '@rullino/ml';
import * as ort from 'onnxruntime-web';

const options = { sessionOptions: { executionProviders: ['wasm'] } };
const image = createImage(640, 480);

const inpainter = await createMiganInpainter(ort as unknown as OrtModule, await fetchModel(MIGAN.model), options);
const hole = growMask(createRasterMask(640, 480), 3); // grow the selection a little: soft edges would survive as an outline
const filled = await inpainter.inpaint(image, hole); // the image with the hole filled in

const depth = await (await createDepthEstimator(ort as unknown as OrtModule, await fetchModel(DEPTH_ANYTHING_V2_SMALL.model), options)).estimate(image);
console.log(filled.width, depth.width); // depth: a grey image, near = 1, for the lens blur filter
```

## Which backend

A real GPU can run the fp32 SlimSAM and MI-GAN models on ONNX Runtime's `webgpu` provider. On a software GPU (or none) use `wasm`: WebGPU through a software renderer was measured ~25x slower. The int8 models run well on WASM only.

## License

MIT.
