# rullino benchmark

The three chains of PLAN §6b — *exposure + curves + LUT*, *blur + unsharp*, *levels + vignette + grain* — on the same image in rullino (WebGPU, and the CPU path in a Web Worker), PixiJS + pixi-filters (WebGL2), Photon (WASM) and wasm-vips (WASM, threads). Issue [#77](https://github.com/Stocastico/rullino/issues/77).

## Run it on your machine

```sh
pnpm install
pnpm bench:web
```

Open the printed URL in Chrome or Edge, close other tabs, plug the laptop in, press **Run** (12 and 24 MP take a few minutes), then **Download JSON** and attach it to #77. The page shows which GPU it got: "software fallback" means WebGPU is not using your GPU, and its numbers are not worth sending.

- Leave the sizes at `4000x3000,6000x4000` unless a library runs out of memory; then try `4000x3000` alone.
- **Photo** runs the chains on your own picture (scaled to each size) instead of the synthetic one.

## What it measures

Every library gets the same 8-bit RGBA image and must hand back 8-bit RGBA in memory, so the GPU libraries pay for their readback like the CPU ones pay for their copies.

| column | meaning |
|---|---|
| init | loading the library: WASM instantiation, GPU context |
| first | the first run of a chain at that size: shader compilation and warm-up included |
| change | re-running after one parameter changed (median, min–max of N runs): what dragging a slider costs |
| \|Δ\| vs rullino | mean difference from rullino's result in 8-bit steps: 0 = same picture |
| memory | after the chains: the whole page with workers and WASM (`measureUserAgentSpecificMemory`), else the JS heap only; GPU memory is never included |
| gzip | per library: its chunk, the chunks it alone imports, its workers and WASM (`sizes.json`, computed at build) |

rullino runs the chains exactly. The other libraries run their **closest equivalent**, and the notes say what that means (hover a row): PixiJS has no curves, unsharp mask or vignette of this kind; Photon has no curves, LUTs, levels or vignette, and its noise functions trap in WASM; libvips has no 3D LUT. A library that skips a step does less work, so read the time together with |Δ|. rullino's gzip includes its whole filter registry (all 51 filters), which an app importing only the filters it uses would not ship.

`pnpm bench:web --headless --strict --sizes 320x240 --runs 1` is the CI smoke run: it only checks that every library still runs (headless Chromium uses SwiftShader, so its timings say nothing).
