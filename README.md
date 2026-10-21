# rullino

GPU-first image processing for the web, built on **WebGPU** and written in **TypeScript**.

rullino spans the whole arc from classic computer-vision operations (thresholds, convolutions, edge detection, morphology, Canny, Hough) to photo-app adjustments and looks (exposure, curves, white balance, LUT-based "insta" presets, vignette, grain). A companion **playground** lets you load a photo, chain filters and tweak their parameters live.

> **Status:** pre-alpha. M0 (skeleton, CI, GPU/CPU parity) and M1 (parameter schema, `defineFilter()`, eleven pointwise filters, playground with generated UI and before/after) are done. M2 is under way: filter chains with pointwise fusion, incremental recompute and reduced-resolution preview, plus convolutions (Gaussian, box, sharpen, unsharp mask, custom kernel), are in. See [PLAN.md](./PLAN.md) for the design and roadmap.

## Why

| Existing | Problem |
|---|---|
| OpenCV.js | WASM, several MB, translated C++ API, no GPU |
| glfx.js | WebGL1, unmaintained since 2015 |
| CamanJS | abandoned, CPU only |
| pixi-filters | tied to the Pixi renderer |

rullino aims to be modern, typed, composable and GPU-first, with zero runtime dependencies.

## Design highlights

- **Two implementations per filter**: a WGSL compute shader (fast) and a plain TypeScript CPU version (reference). Tests check GPU ↔ CPU parity pixel by pixel; the CPU path doubles as a fallback.
- **Correct color**: linear `rgba16float` internal pipeline, sRGB decode/encode at the edges, OKLab/OKLCH for perceptual adjustments, premultiplied alpha.
- **Schema-driven parameters**: each filter declares typed parameters with ranges and defaults; the playground UI, validation and URL serialization are generated from them.
- **Looks are data**: Instagram-style filters are presets built from a 3D LUT engine plus vignette and grain.
- **Pass graph**: consecutive pointwise filters are fused into one shader; changing a parameter only recomputes downstream nodes.

## Layout

```
packages/
  core/        WebGPU device, texture pool, pass graph, color conversions, I/O
  filters/     one module per filter: schema + WGSL + CPU reference
  presets/     looks = LUT + parameters
apps/
  playground/  Vite demo site
```

## Development

Requirements: Node.js ≥ 22.12, pnpm 10, a browser with WebGPU (recent Chrome/Edge, or Safari/Firefox with WebGPU enabled).

```sh
pnpm install
pnpm dev              # playground at http://localhost:5173
pnpm typecheck
pnpm test             # unit tests (Node)
pnpm test:browser     # GPU tests in headless Chromium, incl. GPU <-> CPU parity
pnpm build
pnpm test:e2e         # smoke test of the built playground
```

Browser tests need Playwright's Chromium (`pnpm exec playwright install chromium`). WebGPU runs on SwiftShader when no GPU is present, so they also work in CI.

See [CLAUDE.md](./CLAUDE.md) for conventions and the reasoning behind key decisions.

## License

[MIT](./LICENSE)
