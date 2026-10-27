# @rullino/node

Render [rullino](https://github.com/Stocastico/rullino) edit documents in Node: the **same WebGPU shaders** as the browser preview, through [Dawn](https://dawn.googlesource.com/dawn) (the `webgpu` package), with the CPU reference as fallback. Preview an edit live in the browser, render the final file on the server; GPU and CPU agree within the [published per-filter tolerance](https://github.com/Stocastico/rullino/blob/main/docs/parity.md).

> 0.x: the API may change between minor versions.

## Install

```sh
npm install @rullino/node
npm install webgpu          # optional: GPU rendering through Dawn (~130 MB, prebuilt for Linux, macOS, Windows)
```

Without `webgpu` (or without a GPU adapter) the renderer runs the CPU reference: same results within tolerance, much slower (seconds per 12 MP image). On Linux servers without a GPU, Dawn needs a Vulkan driver: Mesa's software one works well (`apt install mesa-vulkan-drivers`; ~0.3–1.5 s for common 12 MP chains on 4 cores).

## Render an edit

```ts
import { createRenderer } from '@rullino/node';

const renderer = await createRenderer(); // 'auto': Dawn if available, else the CPU (see renderer.reason)

export async function renderPng(rgba: Uint8Array, width: number, height: number, editJson: string): Promise<Uint8Array> {
  const { bytes } = await renderer.render({ data: rgba, width, height }, JSON.parse(editJson));
  return bytes; // PNG, 8 or 16 bit as the document's output says
}
```

The input is 8-bit straight-alpha sRGB RGBA, what image decoders produce (for example `sharp(file).ensureAlpha().raw().toBuffer()`). Documents come from `serializeChain` in `@rullino/core`, the playground's share links or `lookEdit` in `@rullino/presets`; every filter of `@rullino/filters` and every look (`look:<id>` LUTs) is available by default.

- `createRenderer({ backend: 'gpu' })` fails with `WebGpuUnavailableError` instead of falling back; `'cpu'` never loads Dawn.
- `renderer.apply(image, doc)` returns the linear image instead of a file (see `applyEdit` in `@rullino/core`).
- Output formats: PNG for now; JPEG and WebP (and decoding files) will come through `sharp` as an optional peer.

## License

MIT.
