# Troubleshooting

Symptoms first, then the cause and the fix. If yours is not here, [open an issue](https://github.com/Stocastico/rullino/issues/new/choose) with the browser or Node version, the GPU, `renderer.backend` / `renderer.reason` and the edit document (the playground's **Code** button or a share link).

## The renderer picked the CPU

`renderer.backend` is `'cpu'` and `renderer.reason` says why. The result is the same within tolerance, only slower.

| `reason` mentions... | Cause and fix |
|---|---|
| no `navigator.gpu` / WebGPU not available | The browser has no WebGPU. Nothing to fix; the CPU fallback is the product here. |
| a secure context | WebGPU only exists on `https://` pages and on `localhost`. Serve your page over HTTPS. |
| no adapter | The browser supports WebGPU but found no usable GPU (a blocklisted driver, a headless or virtual machine). Update the driver; in Chromium, `chrome://gpu` shows what it decided. |
| the `webgpu` package could not be loaded (Node) | Run `npm install webgpu` next to `@rullino/node`. Without it the Node renderer uses the CPU. |
| `vkCreateInstance: Found no drivers` (Node, Linux) | Dawn needs a Vulkan driver. On a machine without a GPU: `apt install mesa-vulkan-drivers` (a software driver). |

Force a backend with `createRenderer({ backend: 'gpu' })` (throws `WebGpuUnavailableError` instead of falling back) or `'cpu'`.

## The CPU path is slow

- Render previews at a reduced size and pass `scale` (a 1 MP preview takes a few hundred milliseconds; a 12 MP export a few seconds). Do not render the full photo on every slider move.
- Browser: images of about 2 MP and more are cut into bands rendered by up to 4 workers by default (`threads`, needs nested workers and at least 4 cores; `threads: 1` turns it off, `'auto'` uses the cores up to 8).
- Node: `createRenderer({ threads: 4 })` (default 1: servers usually scale with processes). Install `webgpu` plus a driver for the GPU path instead.
- A few filters are heavy by nature on the CPU (inpaint, lens blur, Kuwahara, bilateral with a large radius, median): use them on previews with `scale`, and measure yours with `pnpm bench:cpu` in the repository.

## The worker fails to load

Errors like `rullino's CPU worker failed` or `could not start the band workers ... band-worker.js` mean the bundler did not ship the worker files. `@rullino/web` starts them with `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`:

- **Vite dev server**: `optimizeDeps: { exclude: ['@rullino/web'] }` (production builds are fine). Pin `vite@^7` on StackBlitz.
- **webpack, Rollup, esbuild-based tools**: they understand the pattern when the package is not pre-bundled; make sure `node_modules/@rullino/web/dist/*.js` is not marked external.
- **Custom setups**: `createRenderer({ pool: { workerUrl } })` (band workers) lets you say where the file is; `worker: false` runs the CPU on the main thread.
- **Next.js and other server bundlers**: keep `@rullino/node`, `webgpu` and `sharp` out of the server bundle (`serverExternalPackages: ['@rullino/node', 'webgpu', 'sharp']`) and use the Node runtime for the route. See `examples/nextjs-server-render`.

## The image is black or transparent (GPU)

A shader that fails to compile does not throw: WebGPU reports it asynchronously and the output is empty. Ask for the errors:

```ts
import { createRenderer } from '@rullino/web';

export const renderer = await createRenderer({ onError: (e) => console.error(e.kind, e.message) });
```

(`ShaderCompileError` carries the shader's name and the compiler's line and column.) Report it with your GPU and driver: the parity tests catch most of these, but only on the GPUs they run on. `ctx.lost` (on `renderer.gpu`) resolves when the device is lost; create a new renderer and upload your images again.

## Preview and export do not look the same

Check these in order:

1. **Pixel-sized parameters and `scale`**: if you rendered a reduced copy, pass `scale` (reduced width / original width); otherwise blurs, grain and similar are too strong on the small image. See [Concepts](./concepts.md#pixel-sizes-and-scale).
2. **Grain, dither and halftone** are patterns anchored to the pixel grid; at another resolution the *statistics* match, not the individual specks.
3. **GPU versus CPU** differ within the [published tolerance](./parity.md): a couple of 8-bit steps on smooth gradients, a few flipped pixels at hard thresholds. That is by design, not a bug. A visible, large difference *is* a bug: please report it with the document.
4. **Colour management**: rullino reads 8-bit sRGB. Browsers convert wide-gamut images to sRGB when decoding (`colorSpaceConversion: 'default'`); Node reads files through sharp, which converts to sRGB. rullino does not write an ICC profile.
5. **Orientation**: browsers and sharp apply the EXIF orientation when decoding. A custom decoder must too, or the geometry in the document will not match.

## An edit document is rejected

The message names the step and the parameter (see [Errors](./edit-document.md#errors)). Common ones:

- `unknown filter "..."`: a typo, or a filter you did not pass in `filters` (custom filters must be listed when you build the renderer).
- `unknown parameter "..."`: parameter names are in the [filter reference](./filters.md).
- `unknown LUT {"ref":...}`: the renderer cannot resolve that name. The built-in looks are `look:<id>`; for your own LUTs pass `resolveLut`.
- `its LUT "..." has no reference and cannot be serialised` (when writing a document): a loaded `.cube` file has no name. Give it one with the `lutRef` option of `serializeChain`, or keep that edit out of links.
- `image param ... cannot be serialised`: *Remove object* and *Lens blur* hold images in memory; their results cannot go into a document or link.

## Memory and large images

A linear float image costs 16 bytes per pixel on the CPU (a 12 MP photo: 192 MB), 8 bytes on the GPU. A 24 MP photo renders fine on a desktop GPU, but phones and small servers can run out of memory: shrink with `output.longSide` where the final size allows it, render previews from a downscaled copy, and `destroy()` renderers you no longer need. The GPU path requests the adapter's own texture and buffer limits (`renderer.gpu.limits`); a photo larger than the texture limit cannot be uploaded whole.

## Node

- **`reading image files needs the optional sharp package`**: `npm install sharp`. Passing raw RGBA pixels (`{ data, width, height }`) and writing PNG need no sharp; JPEG and WebP output do.
- **The first render of a process is slow** (a second or two): Dawn loads and shaders compile. Create the renderer once at start-up and reuse it.
- **Serverless**: `webgpu` is about 130 MB because it ships all platforms; if that is too big, use the CPU path (`backend: 'cpu'`), which has no native dependency.

## The ML tools (`@rullino/ml`)

- The models are downloaded on first use from Hugging Face (14 to 40 MB each) and cached in the browser; the download is checked against a SHA-256 and a corrupt copy is fetched again. Behind a proxy or offline, host the files yourself and pass your own URLs.
- On a software GPU (and without a GPU) use the WASM execution provider; the WebGPU one is much slower there.
- ONNX Runtime is **passed in** (`onnxruntime-web`), never bundled: install it yourself, and serve its `.wasm` files from the same origin if your CSP forbids CDNs.
