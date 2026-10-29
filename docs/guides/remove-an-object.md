# Remove an object on-device

Goal: let the user click an object, remove it, and keep editing the photo, with the models running in the browser. Nothing is uploaded. Two small models do the work: SlimSAM turns a click into a mask, MI-GAN fills the hole.

```sh
npm install @rullino/core @rullino/filters @rullino/ml onnxruntime-web
```

`@rullino/ml` does not import ONNX Runtime: you pass it in, so you choose the build and how it is bundled. The weights (SlimSAM 14 MB int8, MI-GAN 28 MB) are not bundled either: `fetchModel` downloads a pinned revision from Hugging Face on first use, checks its size and SHA-256, and caches it in the browser.

## 1. Click to select

Encode the image once (slow, seconds), then every click is fast. A positive point marks the object, a negative one excludes a part of it. The result is a soft raster mask at the size you ask for.

```ts
import type { LinearImage, RasterMaskData } from '@rullino/core';
import { createSamSegmenter, fetchModel, SLIMSAM_77, type OrtModule, type SamPoint } from '@rullino/ml';
import * as ort from 'onnxruntime-web';

export async function select(image: LinearImage, points: readonly SamPoint[]): Promise<RasterMaskData> {
  const model = SLIMSAM_77.variants.quantized;
  const [encoder, decoder] = await Promise.all([fetchModel(model.encoder), fetchModel(model.decoder)]);
  const sam = await createSamSegmenter(ort as unknown as OrtModule, { encoder, decoder }, { sessionOptions: { executionProviders: ['wasm'] } });
  const embedding = await sam.encode(image); // once per image: keep it for the next click
  const { mask } = await sam.segment(embedding, points, image.width, image.height);
  await sam.release();
  return mask;
}
```

In an app, create the segmenter and the embedding once and call `segment` per click; this function does everything per call to stay short. Points are normalised to the image (`{ x: 0.5, y: 0.5, positive: true }` is the centre).

## 2. Fill the hole

Grow the mask a little first: the soft edge of a selection would otherwise survive as an outline. `inpaint` returns the image with the hole (mask above 0.5) filled in, at the size you gave it.

```ts
import type { LinearImage, RasterMaskData } from '@rullino/core';
import { createMiganInpainter, fetchModel, growMask, MIGAN, type OrtModule } from '@rullino/ml';
import * as ort from 'onnxruntime-web';

export async function fill(image: LinearImage, selection: RasterMaskData): Promise<{ filled: LinearImage; hole: RasterMaskData }> {
  const inpainter = await createMiganInpainter(ort as unknown as OrtModule, await fetchModel(MIGAN.model), { sessionOptions: { executionProviders: ['wasm'] } });
  const hole = growMask(selection, 3);
  const filled = await inpainter.inpaint(image, hole);
  await inpainter.release();
  return { filled, hole };
}
```

Work on a copy of the photo of at most about 1024 px on its long side, and give the mask the same size: that is what the models are built for. The fill is 512-class quality, upsampled over the hole.

## 3. Put the fill in the edit

The fill becomes an ordinary step: the `patch` filter lays an image over its input, and the step's mask decides where it shows. Make it the first step, so the rest of the edit (exposure, looks, blur...) applies on top. It works at any size: the patch and the mask are stretched to the image they meet, so the same step serves the preview and the full-resolution export.

```ts
import { runChainCpu, type LinearImage, type RasterMaskData } from '@rullino/core';
import { exposure, patch } from '@rullino/filters';

export function withoutObject(original: LinearImage, filled: LinearImage, hole: RasterMaskData): LinearImage {
  return runChainCpu(
    [
      { filter: patch, params: { patch: filled }, mask: { kind: 'raster', raster: hole } },
      { filter: exposure, params: { ev: 0.2 } },
    ],
    original,
  );
}
```

With WebGPU, give the same steps to a `Pipeline` (see the quick start in the root README) instead of `runChainCpu`.

## What does not travel

The `patch` step holds an image, and an edit document cannot: `serializeChain` throws for it, so a removal is not part of a share link or of a document you send to `@rullino/node`. Two ways round it:

- Render the removal on the client (step 3), export that image, and let the server apply the rest of the edit to it.
- Keep the filled image and the hole next to the document in your own storage, and rebuild the step when you load it.

## Which backend

On a real GPU the fp32 models can run on ONNX Runtime's `webgpu` provider. On a software GPU, or none, use `wasm` as above: WebGPU through a software renderer was measured about 25 times slower. The int8 SlimSAM model runs well on WASM only. Select the provider once, from the adapter you get (the playground's `chooseBackend` does this).

The [playground](https://stefanomasneri.com/rullino/) has the whole flow: add the **Remove object** effect, select with the brush, the wand or the Object tool, then press **Fill with AI**.

## Next

- [`@rullino/ml` README](../../packages/ml/README.md) for the depth model (lens blur) and the options.
- [Preview and export in the browser](./preview-and-export.md).
