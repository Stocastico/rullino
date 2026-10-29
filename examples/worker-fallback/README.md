# WebGPU, or the CPU in a worker

One edit, two backends. `createRenderer()` from `@rullino/web` uses WebGPU when the browser has it and otherwise runs the same edit document on the fast CPU path in a module Web Worker, so a slow render never freezes the page. About 80 lines in `main.js`.

[Open in StackBlitz](https://stackblitz.com/github/Stocastico/rullino/tree/main/examples/worker-fallback?file=main.js)

```sh
npm install
npm run dev
```

- The **Backend** menu (or `?backend=cpu` in the URL) forces `'gpu'`, `'cpu'` or `'auto'`. `'gpu'` throws `WebGpuUnavailableError` when WebGPU is missing; `createRenderer` reports which backend it got and why (`renderer.backend`, `renderer.reason`).
- The page shows the longest pause between animation frames: it stays low on the CPU backend because the work happens in the worker.
- The preview is a 640 px copy of the photo. `scale` tells pixel-sized parameters (the blur) that it is smaller than the original, so they look the same as at full size.
- Both backends agree within the [published per-filter tolerance](../../docs/parity.md), not pixel for pixel.

`vite.config.js` keeps `@rullino/web` out of Vite's dependency pre-bundling, so the worker file is found in development.

CI builds this example against the packed packages, forces the CPU backend and moves a slider (`pnpm test:pack`).
