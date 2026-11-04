# Getting started

rullino turns a photo edit into JSON and renders that JSON the same way in the browser, in a worker, in Node and on a Konva canvas. Pick the path that matches what you are building; each takes a few minutes. If a word is new, [Concepts](./concepts.md) explains it in one page.

| I am building... | Install | Start here |
|---|---|---|
| A web page or app that previews and exports edits | `@rullino/web` | [In the browser](#in-the-browser) |
| A server, a script or a batch job that renders files | `@rullino/node` | [In Node](#in-node) |
| A [Konva](https://konvajs.org) canvas editor | `@rullino/konva` | [On a Konva canvas](#on-a-konva-canvas) |
| Something custom on the GPU, with my own textures | `@rullino/core` + `@rullino/filters` | [`@rullino/core` README](../packages/core/README.md) |

## Requirements

- **ESM only**, TypeScript or JavaScript. Node.js 22.12 or newer for tooling and for `@rullino/node`.
- **Browsers**: WebGPU gives the GPU path (Chrome and Edge from version 113; Safari and Firefox in their recent versions, depending on platform: check the browser's current WebGPU status). Everywhere else `@rullino/web` runs the same edit on the CPU in a Web Worker, so nothing needs a fallback from you. WebGPU needs a **secure context** (HTTPS or `localhost`).
- **Node**: the CPU path works anywhere. The GPU path needs the optional `webgpu` package (Dawn, about 130 MB) and, on a Linux server without a GPU, a Vulkan driver (`apt install mesa-vulkan-drivers`).
- TypeScript users who call the low-level GPU API also want `npm install -D @webgpu/types`.

## An edit, in one line

Whatever the path, the input is an [edit document](./edit-document.md). The quickest way to get one is the [playground](https://stefanomasneri.com/rullino/): load a photo, add effects, press **Code**, and copy the JSON (and a snippet that renders it). You can also write it by hand:

```json
{
  "version": 2,
  "steps": [
    { "filter": "exposure", "params": { "ev": 0.3 } },
    { "filter": "contrast", "params": { "amount": 0.15 } },
    { "filter": "vignette", "params": {} }
  ],
  "output": { "format": "jpeg", "quality": 0.9 }
}
```

Filters and their parameters are listed in the [filter reference](./filters.md); the ten built-in looks are `applyLut` steps with a `look:<id>` LUT (see [looks in your editor](./guides/looks-in-your-editor.md)).

## In the browser

```sh
npm install @rullino/web
```

```ts
import { createRenderer } from '@rullino/web';

const edit = {
  version: 2,
  steps: [
    { filter: 'exposure', params: { ev: 0.3 } },
    { filter: 'contrast', params: { amount: 0.15 } },
  ],
  output: { format: 'jpeg', quality: 0.9 },
};

// Create the renderer once and keep it: it holds the GPU device, the compiled shaders and the workers.
const renderer = await createRenderer(); // WebGPU if the browser has it, else the CPU in a Web Worker
console.log(renderer.backend, renderer.reason ?? ''); // 'gpu', or 'cpu' and why

export async function develop(file: File): Promise<Blob> {
  return renderer.render(file, edit); // decodes the file, applies the edit, encodes it as `output` says
}
```

`render` is for exports: the full-resolution file in, the encoded `Blob` out. For a live preview while a slider moves, render a reduced copy with `renderer.pixels(imageData, edit, { scale })` and draw it on a canvas; [Preview and export in the browser](./guides/preview-and-export.md) shows the whole loop, including keeping only the latest request.

If you use a bundler, the package starts its workers with `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`, which Vite, webpack 5, Rollup and esbuild-based tools understand. In Vite's *dev server*, add `optimizeDeps: { exclude: ['@rullino/web'] }`.

## In Node

```sh
npm install @rullino/node
npm install sharp     # read image files, write JPEG and WebP (PNG and raw pixels work without it)
npm install webgpu    # optional: render on the GPU through Dawn
```

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createRenderer } from '@rullino/node';

const renderer = await createRenderer(); // Dawn if available, else the CPU; renderer.reason says why not

export async function renderFile(input: string, edit: unknown, output: string): Promise<void> {
  const { bytes } = await renderer.render(await readFile(input), edit);
  await writeFile(output, bytes);
}
```

The document that previewed in the browser is the document you pass here, and the file agrees with the preview within each filter's [published tolerance](./parity.md). More in [the same edit on the server](./guides/same-edit-on-the-server.md), including an HTTP endpoint and `threads` for CPU-only machines; [`examples/node-batch`](https://github.com/Stocastico/rullino/tree/main/examples/node-batch) renders a folder of photos and [`examples/nextjs-server-render`](https://github.com/Stocastico/rullino/tree/main/examples/nextjs-server-render) is a Next.js app that previews in the browser and renders on the server.

## On a Konva canvas

```sh
npm install @rullino/konva konva
```

```ts
import { attachEdit } from '@rullino/konva';

type ImageNode = Parameters<typeof attachEdit>[0]; // a Konva.Image

export async function showEdited(node: ImageNode, ev: number): Promise<void> {
  const editor = await attachEdit(node); // the node's image stays available: editor.detach() puts it back
  await editor.set({ version: 2, steps: [{ filter: 'exposure', params: { ev } }] }); // call on every slider move
}
```

`set` renders at the node's size on screen and coalesces quick calls; `export` renders the full-resolution original. A complete editor with sliders and a look picker is in [`examples/konva-editor`](https://github.com/Stocastico/rullino/tree/main/examples/konva-editor) ([StackBlitz](https://stackblitz.com/github/Stocastico/rullino/tree/main/examples/konva-editor?file=main.js)).

## Checking that it works

1. `renderer.backend` is `'gpu'` where you expect WebGPU. If it says `'cpu'`, `renderer.reason` says why (no `navigator.gpu`, not a secure context, no adapter). Rendering still works, only slower.
2. A document with no steps returns the photo unchanged (apart from `geometry` and `longSide`): a good first test of your plumbing before you add effects.
3. A wrong document fails *before* rendering with a message naming the step and parameter, for example `chain step 0 (exposure): unknown parameter "stops"`.

Anything else: [Troubleshooting](./troubleshooting.md).

## Next

- [Concepts](./concepts.md): the ideas behind the behaviour.
- [The edit document](./edit-document.md): every field of the format.
- Guides: [preview and export](./guides/preview-and-export.md) · [the same edit on the server](./guides/same-edit-on-the-server.md) · [looks and LUTs in your editor](./guides/looks-in-your-editor.md) · [remove an object on-device](./guides/remove-an-object.md) · [migrating from glfx.js and tui.image-editor](./guides/migrating-from-glfx-and-tui.md).
- Add your own filter: [`@rullino/core`: write a filter](../packages/core/README.md#write-a-filter).
