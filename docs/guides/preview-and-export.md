# Preview and export in the browser

Goal: a slider-driven editor that stays interactive on a large photo and exports the full-resolution file with the same edit. The edit is one JSON document; the preview and the export only differ in size.

```sh
npm install @rullino/web @rullino/filters
```

## 1. One renderer

`createRenderer()` uses WebGPU when the browser has it and otherwise runs the same edit on the fast CPU path in a Web Worker, so the page never freezes. `renderer.backend` and `renderer.reason` say which one you got.

```ts
import { createRenderer } from '@rullino/web';

const renderer = await createRenderer();
console.log(renderer.backend, renderer.reason ?? ''); // 'gpu', or 'cpu' and why
```

Large exports on the CPU can use several cores. Ask for band workers and the image is cut into horizontal bands rendered in parallel, with exactly the result of one thread:

```ts
import { createRenderer } from '@rullino/web';

// Up to 4 band workers; images below about 2 MP stay in the render worker. The default is 1.
const renderer = await createRenderer({ threads: 4 });
console.log(renderer.backend); // the threads only apply on the 'cpu' backend
```

Previews at screen size are small and do not need it; a 12 MP export on four cores is about 3× faster for most chains (equalize, clahe and otsu need the whole image and run alone). `pnpm bench:threads:web` in the repository measures your machine. `threads: 'auto'` (the cores, at most 8) is also accepted, but the default stays 1 until it has been measured on more hardware.

## 2. Describe the edit as data

A document is plain JSON: filter ids and their parameters (defaults left out). Build it from your sliders, or with `serializeChain` from the filter objects.

```ts
import { serializeChain } from '@rullino/core';
import { contrast, exposure } from '@rullino/filters';

export function edit(ev: number, amount: number) {
  return serializeChain(
    [{ filter: exposure, params: { ev } }, { filter: contrast, params: { amount } }],
    { output: { format: 'jpeg', quality: 0.9 } },
  );
}
```

## 3. Preview at the size you show

Render a reduced copy of the photo while the user drags, and tell the renderer how much smaller it is with `scale`: parameters in pixels (blur radii, grain size) are defined on the full-size photo, and `scale` keeps them looking the same. A 1 MP preview takes a few hundred milliseconds on the CPU backend and well under a frame on the GPU.

```ts
import type { Renderer } from '@rullino/web';

const PREVIEW_WIDTH = 800;

// `edit` is the document of step 2.
export async function drawPreview(renderer: Renderer, photo: ImageBitmap, canvas: HTMLCanvasElement, edit: unknown): Promise<void> {
  const scale = Math.min(1, PREVIEW_WIDTH / photo.width);
  const small = new OffscreenCanvas(Math.round(photo.width * scale), Math.round(photo.height * scale));
  small.getContext('2d')!.drawImage(photo, 0, 0, small.width, small.height);
  const pixels = small.getContext('2d')!.getImageData(0, 0, small.width, small.height);
  const out = await renderer.pixels(pixels, edit, { scale });
  canvas.width = out.width;
  canvas.height = out.height;
  canvas.getContext('2d')!.putImageData(out, 0, 0);
}
```

Render one preview at a time and keep only the latest request while a render is running (see [`examples/worker-fallback`](https://github.com/Stocastico/rullino/tree/main/examples/worker-fallback)).

## 4. Export the original

`render` takes the original file and answers with the encoded `Blob` the document's `output` asks for (PNG 8 / 16 bit, JPEG or WebP, with an optional `longSide`). Pixel-sized parameters keep their full-size meaning; a `longSide` shrinks after the chain, never before.

```ts
import type { Renderer } from '@rullino/web';

export async function exportPhoto(renderer: Renderer, file: File, edit: unknown): Promise<Blob> {
  return renderer.render(file, edit);
}
```

## Next

- On a [Konva](https://konvajs.org) canvas, [`@rullino/konva`](../../packages/konva/README.md) does steps 3 and 4 for a `Konva.Image`.
- Render the same document on a server: [the same edit on the server](./same-edit-on-the-server.md).
- GPU and CPU agree within the [published per-filter tolerance](../parity.md), not pixel for pixel.
