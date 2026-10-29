# @rullino/node

Render [rullino](https://github.com/Stocastico/rullino) edit documents in Node: the **same WebGPU shaders** as the browser preview, through [Dawn](https://dawn.googlesource.com/dawn) (the `webgpu` package), with the CPU reference as fallback. Preview an edit live in the browser, render the final file on the server; GPU and CPU agree within the [published per-filter tolerance](https://github.com/Stocastico/rullino/blob/main/docs/parity.md).

> 0.x: the API may change between minor versions.

## Install

```sh
npm install @rullino/node
npm install webgpu          # optional: GPU rendering through Dawn (~130 MB, prebuilt for Linux, macOS, Windows)
npm install sharp           # optional: read image files, write JPEG and WebP
```

Without `webgpu` (or without a GPU adapter) the renderer runs the CPU reference: same results within tolerance, much slower (seconds per 12 MP image). On Linux servers without a GPU, Dawn needs a Vulkan driver: Mesa's software one works well (`apt install mesa-vulkan-drivers`; ~0.3–1.5 s for common 12 MP chains on 4 cores).

## Render an edit

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createRenderer } from '@rullino/node';

const renderer = await createRenderer(); // 'auto': Dawn if available, else the CPU (see renderer.reason)

export async function renderFile(input: string, editJson: string, output: string): Promise<void> {
  const { bytes } = await renderer.render(await readFile(input), JSON.parse(editJson));
  await writeFile(output, bytes); // PNG (8 / 16 bit), JPEG or WebP, as the document's output says
}
```

`render` takes an image file (decoded by sharp, EXIF orientation applied) or 8-bit straight-alpha sRGB pixels `{ data, width, height }`, which needs no sharp. Documents come from `serializeChain` in `@rullino/core`, the playground's share links or `lookEdit` in `@rullino/presets`; every filter of `@rullino/filters` and every look (`look:<id>` LUTs) is available by default. PNG is written by rullino's own encoder (16 bit keeps the float pipeline's precision); JPEG and WebP by sharp, after flattening transparency onto `output.background` (white by default for JPEG) in linear light.

- `createRenderer({ backend: 'gpu' })` fails with `WebGpuUnavailableError` instead of falling back; `'cpu'` never loads Dawn.
- `renderer.apply(image, doc)` returns the linear image instead of a file (see `applyEdit` in `@rullino/core`).

### An HTTP endpoint

One file, no framework (the same handler body works in Express, Fastify or a serverless function):

```ts
import { createServer } from 'node:http';
import { createRenderer } from '@rullino/node';

const renderer = await createRenderer();

// POST /render?edit=<edit JSON, URL-encoded> with the image file as the body; answers with the rendered file.
createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const edit = JSON.parse(new URL(req.url ?? '/', 'http://localhost').searchParams.get('edit') ?? '');
    const { bytes, format } = await renderer.render(Buffer.concat(chunks), edit);
    res.writeHead(200, { 'content-type': `image/${format}` }).end(bytes);
  } catch (e) {
    res.writeHead(400).end((e as Error).message); // invalid documents say what is wrong
  }
}).listen(3000);
```

### A folder of photos

[`examples/node-batch`](https://github.com/Stocastico/rullino/tree/main/examples/node-batch) renders one edit document onto every photo in a folder (`node batch.mjs edit.json photos out`).

## License

MIT.
