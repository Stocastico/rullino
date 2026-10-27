# Changelog

All notable changes to the `@rullino/*` packages (core, filters, presets, ml). They share one version number. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/), with the usual 0.x caveat: minor versions may change the API. `@rullino/core/internal` and `@rullino/ml/internal` are plumbing without any stability promise.

## Releasing (maintainer checklist)

1. One-time, per package on npmjs.com: Settings → Trusted Publisher → GitHub Actions: user `Stocastico`, repository `rullino`, workflow `release.yml`, no environment.
2. `node scripts/set-version.mjs X.Y.Z[-rc.N]`, add a `## [X.Y.Z[-rc.N]]` section below, merge to `main` through a pull request.
3. `git tag vX.Y.Z[-rc.N] origin/main && git push origin vX.Y.Z[-rc.N]` (from a maintainer's machine: Claude cloud sessions cannot push tags). The workflow checks the tag, runs the tests, publishes with provenance (`next` for a pre-release, `latest` otherwise) and creates the GitHub release from the section below.
4. Never `npm publish` from a package directory (`prepublishOnly` refuses): the dist exports exist only in the packed tarball.

## [Unreleased]

### Added
- **core**: edit documents version 2: an optional `output` (format, quality, bit depth, background, `longSide`) next to the steps and geometry (`serializeChain(steps, { output })`, `parseChain(doc).output`, type `OutputSettings`); `migrateChain` brings version 1 documents up to date, and `parseChain` accepts both. A JSON Schema of the format ships as `@rullino/core/edit.schema.json`.

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
