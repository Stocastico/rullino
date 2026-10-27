# @rullino/web

Render [rullino](https://github.com/Stocastico/rullino) edit documents in the browser with one call: on **WebGPU** when the browser has it, otherwise on the CPU in a **Web Worker**, so the page never freezes. Both give the same result within the [published per-filter tolerance](https://github.com/Stocastico/rullino/blob/main/docs/parity.md), and the same as [`@rullino/node`](https://www.npmjs.com/package/@rullino/node) on the server.

> 0.x: the API may change between minor versions.

## Install

```sh
npm install @rullino/web
```

## Render an edit

```ts
import { createRenderer } from '@rullino/web';

const renderer = await createRenderer(); // 'auto': WebGPU if available, else the CPU (see renderer.reason)
console.log(renderer.backend, renderer.reason ?? '');

export async function exportPhoto(file: File, edit: unknown): Promise<Blob> {
  return renderer.render(file, edit); // PNG (8 / 16 bit), JPEG or WebP, as the document's output says
}
```

`render` takes an image file the browser can decode or an `ImageData`; documents come from `serializeChain` in `@rullino/core`, the playground's share links or `lookEdit` in `@rullino/presets`. Every filter of `@rullino/filters` and every look (`look:<id>` LUTs) is available by default.

- `createRenderer({ backend: 'gpu' })` fails with `WebGpuUnavailableError` instead of falling back; `'cpu'` never touches WebGPU.
- `renderer.apply(image, doc, { scale })` works on linear images (see `applyEdit` in `@rullino/core`). On the CPU, render previews at reduced size and pass `scale` (e.g. 0.25 for a quarter-size copy), so pixel-sized params such as blur radii look the same as at full size: a 1 MP preview takes a few hundred milliseconds, a 12 MP export a few seconds.
- With custom `filters` the CPU backend runs on the main thread (functions cannot be sent to a worker); `worker: false` does the same for built-in filters.

### Bundlers

The worker is loaded with `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`, which Vite, webpack 5, Rollup and esbuild-based tools understand. In Vite's dev server, exclude the package from dependency pre-bundling so the worker file is found:

```js
// vite.config.js
export default { optimizeDeps: { exclude: ['@rullino/web'] } };
```

## License

MIT.
