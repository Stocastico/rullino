# Konva photo editor

A Konva stage with a draggable, resizable photo, three sliders and a look picker, all in one file (`main.js`, about 60 lines).

[Open in StackBlitz](https://stackblitz.com/github/Stocastico/rullino/tree/main/examples/konva-editor?file=main.js)

```sh
npm install
npm run dev
```

- The sliders build an [edit document](../../packages/core/edit.schema.json). This is plain JSON, and `@rullino/node` can render the same document on a server.
- `attachEdit(node)` from `@rullino/konva` renders the document on the `Konva.Image` at the size the image has on screen. It uses WebGPU when the browser has it, otherwise the CPU in a Web Worker. Quick slider moves are coalesced.
- **Export** renders the same document on the full-resolution photo as a JPEG.

`vite.config.js` keeps `@rullino/web` and `@rullino/konva` out of Vite's dependency pre-bundling, so the CPU worker file is found in development.

CI builds this example against the packed packages and moves its exposure slider (`pnpm test:pack`).
