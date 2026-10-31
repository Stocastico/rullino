# The same edit on the server

Goal: preview an edit in the browser, then render the final files in Node with output that matches the preview. The browser sends (or stores) the edit document; the server renders it with the same WGSL shaders through [Dawn](https://dawn.googlesource.com/dawn), or on the CPU if there is no GPU.

```sh
npm install @rullino/node
npm install webgpu   # optional: GPU rendering through Dawn (~130 MB)
npm install sharp    # optional: read image files, write JPEG and WebP
```

On a Linux server without a GPU, Dawn needs a Vulkan driver: `apt install mesa-vulkan-drivers` (Mesa's software driver renders common 12 MP chains in about a second on 4 cores). Without `webgpu` the renderer runs the CPU reference: the same results within tolerance, in seconds instead.

## 1. Get the document

Anything that produces an [edit document](../../packages/core/edit.schema.json) works: `serializeChain` in your own code, the playground's **Code** button (which gives the JSON and the snippet that renders it), or a share link. Store it next to the photo, or send it with the upload. It is plain JSON, so any language can pass it along; `parseChain` on the server rejects an invalid one with a message that says what is wrong.

## 2. Render a file

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { createRenderer } from '@rullino/node';

const renderer = await createRenderer(); // 'auto': Dawn if available, else the CPU
console.log(renderer.backend, renderer.reason ?? '');

export async function renderFile(input: string, editJson: string, output: string): Promise<void> {
  const { bytes } = await renderer.render(await readFile(input), JSON.parse(editJson));
  await writeFile(output, bytes); // PNG, JPEG or WebP, as the document's output says
}
```

Create the renderer once, at start-up: loading Dawn and compiling shaders costs a second or two, and every later render reuses them.

### Several cores on the CPU

When the renderer runs on the CPU (no `webgpu`, or no Vulkan driver), `threads` spreads big images over worker threads with the same result, bit for bit:

```ts
import { createRenderer } from '@rullino/node';

export const renderer = await createRenderer({ threads: 4 }); // default 1; 'auto' is the cores, at most 8
```

On 4 cores a 12 MP blur + unsharp goes from 5.8 s to 1.5 s. Images below about 2 MP and steps that need the whole image (equalize, clahe, otsu) stay on the calling thread. Create the renderer once and call `destroy()` when the process is done with it: it stops the threads and frees the shared buffers it keeps between renders.

## 3. Serve it

The same call fits an HTTP route, a queue worker or a serverless function. A route that takes the photo as the body and the edit in the query:

```ts
import { createServer } from 'node:http';
import { createRenderer } from '@rullino/node';

const renderer = await createRenderer();

createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const edit = JSON.parse(new URL(req.url ?? '/', 'http://localhost').searchParams.get('edit') ?? '');
    const { bytes, format } = await renderer.render(Buffer.concat(chunks), edit);
    res.writeHead(200, { 'content-type': `image/${format}` }).end(bytes);
  } catch (e) {
    res.writeHead(400).end((e as Error).message);
  }
}).listen(3000);
```

For a whole folder, see [`examples/node-batch`](https://github.com/Stocastico/rullino/tree/main/examples/node-batch).

## What matches, and what does not

- The preview and the server run the same shaders when both have a GPU; CI renders every look and mixed edits on Chromium's WebGPU and on Dawn in Node and checks they agree within |Δ| ≤ 4e-3 + 4e-3·|v| per channel.
- A CPU render (either side) agrees with the GPU within each filter's [published tolerance](../parity.md): usually well under one 8-bit step, a few filters with hard decisions (thresholds, halftone) allow a small share of outlier pixels.
- Grain and other noise patterns differ between a preview and the full-size render (their statistics match, not the pixels): preview at `scale`, judge the export.
- Input is decoded to 8-bit sRGB by sharp with the EXIF orientation applied; 16-bit and HDR input are not supported yet. PNG output can be 16 bit.

## Next

- [Preview and export in the browser](./preview-and-export.md).
- [`@rullino/node` README](../../packages/node/README.md) for the full options.
