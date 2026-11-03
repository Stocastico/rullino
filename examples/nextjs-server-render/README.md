# Next.js: preview in the browser, render on the server

The edit document is plain JSON, so the same one drives both halves: the page previews it at 640 px with `@rullino/web` (WebGPU, else a CPU worker), and **Render on the server** posts it with the original photo to a route handler that renders the full-resolution JPEG with `@rullino/node`.

```sh
npm install
npm run dev
```

- `app/editor.js` (client component): `createRenderer()` from `@rullino/web`, `renderer.pixels(source, edit, { scale })` for the preview, then `fetch('/api/render', …)` with the original file and `JSON.stringify(edit)`.
- `app/api/render/route.js`: one `createRenderer()` per server process, `renderer.render(bytes, edit)` per request. A bad document (unknown filter, parameter out of range) comes back as a 400 with the library's message. The response says which backend rendered (`x-rullino-backend`).
- `edit.js` is the only thing the two sides share. Copy a real document from the playground's **Code** button; its `output` (format, quality, `longSide`) decides what the server returns.
- `next.config.mjs` lists `@rullino/node`, `webgpu` and `sharp` in `serverExternalPackages`: they are native modules (and the Node renderer starts its own worker file), so Next must load them from `node_modules` instead of bundling them.
- With the `webgpu` package the server renders on the GPU through Dawn; on a Linux server without a GPU Dawn needs a Vulkan driver (`apt install mesa-vulkan-drivers`). Remove `webgpu` from `package.json` to render on the CPU, or leave it and the route falls back by itself (the header says why). Pass `threads: 'auto'` to `createRenderer` to spread CPU renders over cores. The route handler runs on the Node.js runtime, not on the edge.
- Serverless platforms with a size limit (`webgpu` is 132 MB installed) are better served by the CPU path; the preview and the server agree within the [published per-filter tolerance](../../docs/parity.md), not pixel for pixel.

`photo.jpg` is public domain, see [NOTICE.md](./NOTICE.md).

CI builds this example with `next build` against the packed packages (CPU, no `webgpu`), starts it, moves a slider, clicks the button and checks that the server's picture is 1600 × 1200 and as bright as the preview (`pnpm test:pack`).
