# @rullino/konva

Edit a [Konva](https://konvajs.org) `Konva.Image` with a [rullino](https://github.com/Stocastico/rullino) edit document: previews rendered on **WebGPU** (or the CPU in a Web Worker, through [`@rullino/web`](https://www.npmjs.com/package/@rullino/web)) at the size the node has on screen, and exports at full resolution.

> 0.x: the API may change between minor versions.

## Install

```sh
npm install @rullino/konva konva
```

A complete editor (sliders, a look picker, export) is in [`examples/konva-editor`](https://github.com/Stocastico/rullino/tree/main/examples/konva-editor): [open it in StackBlitz](https://stackblitz.com/github/Stocastico/rullino/tree/main/examples/konva-editor?file=main.js).

## Edit an image node

```ts
import { attachEdit } from '@rullino/konva';

type ImageNode = Parameters<typeof attachEdit>[0]; // a Konva.Image

export async function edit(node: ImageNode): Promise<Blob> {
  const editor = await attachEdit(node); // keeps the node's original image
  await editor.set({ version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }] }); // call it on every slider move
  const blob = await editor.export({ version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }], output: { format: 'jpeg', quality: 0.9 } });
  editor.detach(); // the original image is back on the node
  return blob;
}
```

- `set(doc)` renders at the node's width / height times its absolute scale and the device pixel ratio (`pixelRatio` option), never beyond the source's size, swaps the result in and redraws the layer. Calls made while a render runs coalesce: only the latest document is rendered next. Pixel-sized params (blur radii) are scaled so the preview looks like the export.
- `export(doc?)` renders the last (or the given) document on the full-resolution original and encodes it as its `output` says (PNG, JPEG or WebP, `longSide`).
- The node keeps its size: a geometry that crops or turns the picture changes its proportions, so resize the node if it should follow.
- Pass `renderer` (from `createRenderer` in `@rullino/web`) to share one between several nodes; otherwise each `attachEdit` makes its own and `detach()` destroys it. See `@rullino/web` for the bundler note about its worker. On the CPU backend, `createRenderer({ threads: 4 })` makes `export()` of a large original use several cores (previews are small and do not need it).

Documents come from `serializeChain` in `@rullino/core`, the playground's share links or `lookEdit` in `@rullino/presets`.

## License

MIT.
