# Changelog

All notable changes to the `@rullino/*` packages (core, filters, presets, ml, node, web, konva). They share one version number. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/), with the usual 0.x caveat: minor versions may change the API. `@rullino/core/internal` and `@rullino/ml/internal` are plumbing without any stability promise.

## Releasing (maintainer checklist)

1. One-time, per package on npmjs.com: Settings → Trusted Publisher → GitHub Actions: user `Stocastico`, repository `rullino`, workflow `release.yml`, no environment. A **new package** must exist on npm before that page is there: publish a placeholder once from a maintainer's machine (`npm publish` of a `0.0.0` package.json with just name, version and description, `--access public`), configure the Trusted Publisher, then `npm deprecate @rullino/<name>@0.0.0 "placeholder"`.
2. `node scripts/set-version.mjs X.Y.Z[-rc.N]`, add a `## [X.Y.Z[-rc.N]]` section below, merge to `main` through a pull request.
3. `git tag vX.Y.Z[-rc.N] origin/main && git push origin vX.Y.Z[-rc.N]` (from a maintainer's machine: Claude cloud sessions cannot push tags). The workflow checks the tag, runs the tests, publishes with provenance (`next` for a pre-release, `latest` otherwise) and creates the GitHub release from the section below.
4. Never `npm publish` from a package directory (`prepublishOnly` refuses): the dist exports exist only in the packed tarball.

## [Unreleased]

## [0.7.0]

Documentation for integrators, the `rullino` command, a synchronous Konva filter for colour edits, `.cube` export, a playground that works without WebGPU, and three bug fixes.

### Added
- Documentation: [Benchmarks](docs/benchmarks.md), the real-hardware numbers (GPU against PixiJS, wasm-vips and Photon; the CPU backend on worker threads) with the machine, the code each came from, the losses and the limits.
- **node**: the `rullino` command (`npx rullino render --edit edit.json photos/ -o out/`, `--look <id>`, `rullino looks`): renders an edit document or a built-in look onto files and folders, with `--format`, `--quality`, `--long-side`, `--backend` and `--threads`. It never overwrites an input and reports a bad document once, before reading any photo. Exit codes: 0 ok, 1 a photo failed, 2 usage. `pnpm test:pack` runs it from the installed tarball.
- **konva**: `konvaFilter(doc)`, a synchronous Konva filter from an edit document, for colour edits (exposure, curves, saturation, LUTs, the looks; no masks, geometry or neighbourhood steps, which it refuses with a message): the document is baked once into a 33³ LUT and each pixel costs one lookup (about 45 ms per megapixel), so `node.filters([...])` + `cache()` and tools that look filters up by name in `Konva.Filters` (Filerobot) can use rullino. `@rullino/konva` now depends on `@rullino/filters` and `@rullino/presets` directly.
- Example `examples/filerobot-looks`: Filerobot Image Editor with rullino looks as Konva filters (`konvaFilter`), loaded by name from its design state and switched while it runs; built and driven in `pnpm test:pack`.
- **core**: `formatCube(lut)` writes a LUT as a `.cube` file (the inverse of `parseCube`). With the playground's **Export look (.cube)** (bakes the enabled colour steps of the chain into a 33³ LUT), a look made in rullino works in DaVinci Resolve, Premiere, OBS and phone apps.
- **presets**: `bakeLut` accepts per-pixel steps such as `applyLut` (a baked look can contain a LUT), refuses masked steps and skips disabled ones.
- Documentation: [Getting started](docs/getting-started.md), [Concepts](docs/concepts.md), the [edit document reference](docs/edit-document.md) (its JSON examples are parsed and rendered by a test) and [Troubleshooting](docs/troubleshooting.md); the root README now starts from the edit document and lists the packages. The `ts` blocks of `docs/*.md` are type-checked like the guides'.
- Playground: compare with any step (**Compare with** menu) and hold `\` to see the original.
- Example `examples/nextjs-server-render`: a Next.js app that previews an edit document in the browser with `@rullino/web` and renders it at full resolution in a route handler with `@rullino/node`; built and driven in `pnpm test:pack`.

### Changed
- Playground without WebGPU (Firefox, Safari, older machines): the CPU fallback now renders in `@rullino/web`'s worker with the fast paths instead of the reference on the main thread, so the page stays usable (Kuwahara on a 1024 px picture: 3.2 s frozen → 1.2 s in the background). Chains that cannot travel to a worker (a LUT file loaded by hand, an ML patch or depth map) still render on the main thread, with the fast paths. New e2e `pnpm test:e2e:cpu` runs the built playground in a browser with no WebGPU.

### Fixed
- **node**: JPEG / WebP output with `quality` below 0.005 (including 0) threw "Expected integer between 1 and 100" from sharp; the quality is now at least 1.
- **konva**: `set()` of an edit with a crop made the preview from the source at the node's size, so a crop showing half the picture was rendered at half the resolution and stretched; the source is now made large enough for the crop to fill the node. A failed preview render is no longer cached (every later `set()` used to fail with the same error until the node's size changed).
- **web**: a renderer that was destroyed started a new worker when asked to render again, one nothing would stop; it now rejects with "the renderer was destroyed".

## [0.6.0]

The CPU backend uses all the cores: `@rullino/node` and `@rullino/web` render bands of the image on worker threads, with the same result as one thread bit for bit.

### Added
- **node**: `createRenderer({ threads: n | 'auto' })` spreads CPU renders over worker threads (default 1). The image is cut into horizontal bands rendered in parallel with the same result as one thread, bit for bit; equalize, clahe and otsu run in two phases (the bands count their rows first) and images below about 2 MP stay on the calling thread. On 4 cores at 12 MP: 2.3–4.0× on the banded chains. `renderer.threads` reports the count; `pool` holds advanced options. Needs `dist/worker.js`, which ships in the package.
- **web**: `createRenderer({ threads: n | 'auto' })` (**by default 4 workers on a machine with at least 4 cores**, 1 below; `threads: 1` turns it off) does the same for the CPU backend with nested module workers (`dist/band-worker.js`); bands travel by copy through reused buffers (a shared-memory variant was measured to be no faster and is not offered). `PoolOptions` is exported. In Chromium on 4 cores at 12 MP: 2.5–3.95× at four workers; `pool.onRender` reports where a render's time went.
- **core** (internal): `Filter.reach`, `planSegments`, `planBands`, `runChainBands`, `runChainBand`, `runChainBandRows` and the `cpu` hook of `applyEdit`, the plumbing the two executors are built on (`@rullino/core/internal`, no stability promise); position-dependent filters take the frame (`RowRegion`) as a fourth argument.
- Benchmarks `pnpm bench:threads` (Node) and `pnpm bench:threads:web` (Chromium).

- **core / filters** (internal plumbing, `twoPhase` on a filter): `equalize`, `clahe` and `otsu` can run in bands: their statistic is a histogram, so the statistics of the bands add up to the one of the whole image bit for bit, and the pixel map reads nothing else. `threads` in `@rullino/node` and `@rullino/web` use it.

### Not done
- `@rullino/node` keeps `threads: 1` by default (servers scale with processes; opt in with a number or `'auto'`). Not measured on laptops or phones: the web default of 4 is the cap chosen for them.

## [0.5.1]

Documentation only: no code of any package changed since 0.5.0. The npm pages of two packages now point at the new examples; the guides, the new examples and the playground's plain-words status line live in the repository and the playground, not in the packages.

### Changed
- **konva**: the README links the complete editor in `examples/konva-editor` (with a StackBlitz link).
- **node**: the README links `examples/node-batch`, which renders one edit document onto a folder of photos.

## [0.5.0]

A first editor adapter: `@rullino/konva` edits a `Konva.Image` with the same edit documents the browser, the CPU worker and the Node renderer already share.

### Added
- **konva** (new package): `attachEdit(node)` edits a `Konva.Image` with edit documents: `set(doc)` renders a preview at the node's size on screen (WebGPU or the CPU worker, through `@rullino/web`), coalescing quick successive calls, `export(doc)` renders the full-resolution original, `detach()` restores it.
- **web**: `renderer.pixels(image, doc, { scale })` returns 8-bit `ImageData` ready for a canvas, encoded on the GPU or in the worker (an eighth of the data a linear image would send back).

### Fixed
- Release and CI: the Dawn tests no longer time out on a fresh runner, where the first render compiles every shader from scratch (#100).

## [0.4.0]

Faster image I/O on the GPU, found by the first benchmarks on real hardware ([#77](https://github.com/Stocastico/rullino/issues/77)): on an RTX 40-class GPU, loading a 12 MP image went from 473 to 22 ms and re-rendering after a change from ~36 to ~25 ms (24 MP: ~85 to ~46 ms, ahead of PixiJS on the benchmark chains).

### Added
- **core**: `uploadSrgb8(ctx, rgba, width, height)` uploads 8-bit RGBA pixels and decodes them on the GPU (also on Dawn, unlike `importImage`); `applyEdit` takes 8-bit pixels (`Rgba8Image`) as well as linear images and decodes them where it renders.

### Changed
- **core**: `readSrgb8` and `readImage` reuse their staging buffer and encode target from one read to the next (they allocated 48 MB per 12 MP read).
- **web**, **node**: `render()` hands the pixels to `applyEdit` undecoded: decoded on the GPU, or in the worker, which now receives 8-bit pixels (a quarter of the data). `apply()` accepts 8-bit pixels too.

## [0.3.0]

The CPU path becomes usable: filters can carry a fast CPU implementation held to the reference within each filter's tolerance (about 4–5× faster on typical chains), and a new `@rullino/web` package renders edit documents in the browser on WebGPU or, without it, on that CPU path in a Web Worker.

### Added
- **core**: filters can carry `fast`, a second CPU implementation held to the reference within the filter's tolerance; `runChainCpu(steps, src, { fast: true })` uses it where present, and `applyEdit` without a GPU (so `@rullino/node`'s CPU fallback) always does.
- **web** (new package `@rullino/web`): `createRenderer()` renders edit documents in the browser on WebGPU, or, when the browser has none (or `backend: 'cpu'`), with the fast CPU path in a module Web Worker; `renderer.reason` says why it fell back, `backend: 'gpu'` throws `WebGpuUnavailableError` instead. `render(file or ImageData, doc)` → a PNG / JPEG / WebP `Blob`; `apply(image, doc, { scale })` for linear images and reduced-size previews. Every filter and look built in; custom filters run on the main thread.
- **filters**: fast CPU paths for Gaussian blur, box blur, unsharp mask, exposure, curves, levels, LUT, vignette, grain and the colour mixer: about 4–5× faster than the reference on typical chains (12 MP: 24–28 s → 5–7 s in a cloud container).

### Changed
- **core**: OKLab → linear conversion cubes by multiplication instead of `** 3` (the OKLab filters' CPU references are ~2× faster); `runChainCpu` no longer copies the source up front.

## [0.2.0]

Render on the server what the browser previews: a new `@rullino/node` package runs the same WGSL shaders on Dawn (CPU fallback), and edit documents (version 2) now carry their output settings, so one JSON describes the whole render. Version 1 documents are still read (migrated on parse).

### Added
- **core**: edit documents version 2: an optional `output` (format, quality, bit depth, background, `longSide`) next to the steps and geometry (`serializeChain(steps, { output })`, `parseChain(doc).output`, type `OutputSettings`); `migrateChain` brings version 1 documents up to date, and `parseChain` accepts both. A JSON Schema of the format ships as `@rullino/core/edit.schema.json`.
- **core**: `applyEdit(image, doc, { filters, gpu?, scale? })` renders an edit document in one call (geometry, steps, `output.longSide` shrink), on the GPU when given a context, on the CPU otherwise.
- **presets**: looks as edit documents: `lookEdit(look, options)`, and `lookLutRef` / `resolveLookLut` to name a look's LUT `look:<id>` in any document (what the playground's share links already did).
- **node** (new package `@rullino/node`): `createRenderer()` renders edit documents in Node with the same WGSL shaders as the browser through Dawn (`webgpu`, optional peer), falling back to the CPU reference (`backend: 'auto' | 'gpu' | 'cpu'`, `renderer.reason`); `render(file or rgba8, doc)` → PNG 8 / 16 bit (rullino's encoder), JPEG or WebP (through `sharp`, optional peer, which also decodes input files with their EXIF orientation); every filter and look built in.
- **core**: `createGpuContext({ gpu })` takes a WebGPU entry point other than `navigator.gpu` (e.g. Dawn's); `decodeSrgb8` accepts a `Uint8Array` too.

### Changed
- **core**: `serializeChain` writes `version: 2` (`CHAIN_VERSION` is 2). Readers of version 1 keep working through `parseChain` / `migrateChain`.
- **core**: `fromFloat16Array` (and so every `readImage`) is ~20× faster: a lookup table instead of a conversion per value.

## [0.1.0]

First stable 0.x release, on the `latest` tag. Same library as `0.1.0-rc.1`, plus what is listed below.

### Added
- **core**: filters can carry `tryThis` (a suggestion for exploring them) and `preview` (params that make a filter visible on a thumbnail when it does nothing at its defaults). `Mat3`, `Json` and `ImageParam` are exported as types, since public signatures mention them.
- **filters**: every filter has a description, a "try this" and parameter help, shown by the generated reference (`docs/filters.md`).
- Docs: an [API reference](https://stefanomasneri.com/rullino/docs/) generated from the sources, and a [parity table](docs/parity.md) with the GPU ↔ CPU tolerance of each filter, generated from the tolerances the tests use.

### Changed
- npm keywords, and the homepage now points at the playground.

## [0.1.0-rc.1]

First release candidate. (`0.1.0-rc.0` was tagged but never published: the release workflow's publish step read the tarball path as a GitHub repository. Nothing was released under that version.)

### Added
- **core**: schema-driven filter parameters and `defineFilter()` (pointwise and multipass kinds, each with a WGSL shader and a TypeScript CPU reference), cached incremental filter-chain `Pipeline` with pointwise fusion, masks (linear, radial, brush, magic wand, guided-filter refinement), geometry (orientation, perspective, straighten, crop), 3D LUTs (`.cube`, Hald), colour maths in linear light and OKLab, export to PNG (8 / 16-bit), JPEG and WebP, chain serialisation, GPU errors reported to a callback (`createGpuContext({ onError })`, `ctx.limits`, `ctx.lost`).
- **filters**: adjustments (exposure, contrast, curves, levels, white balance, colour mixer, colour grading, ...), convolutions, edges (Canny, Sobel / Scharr / Prewitt, Laplacian), thresholds (Otsu, adaptive), morphology, median, bilateral, histogram equalisation and CLAHE, inpainting, stylize (halftone, dither, Kuwahara, bloom, emboss, sketch, ...), lens blur. The generated reference is `docs/filters.md`.
- **presets**: ten looks (LUT recipe, vignette, grain).
- **ml** (optional, ONNX Runtime passed in by the caller): click-to-select objects (SlimSAM), object removal (MI-GAN), depth for lens blur (Depth Anything V2 Small); model files are fetched from pinned revisions and verified by SHA-256 and size.

### Notes
- Pre-1.0: input is 8-bit sRGB; WebGPU is required for the GPU path (the CPU references run anywhere, Node included).
