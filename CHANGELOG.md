# Changelog

All notable changes to the `@rullino/*` packages (core, filters, presets, ml). They share one version number. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [semver](https://semver.org/), with the usual 0.x caveat: minor versions may change the API. `@rullino/core/internal` and `@rullino/ml/internal` are plumbing without any stability promise.

## Releasing (maintainer checklist)

1. One-time, per package on npmjs.com: Settings → Trusted Publisher → GitHub Actions: user `Stocastico`, repository `rullino`, workflow `release.yml`, no environment.
2. `node scripts/set-version.mjs X.Y.Z[-rc.N]`, add a `## [X.Y.Z[-rc.N]]` section below, merge to `main` through a pull request.
3. `git tag vX.Y.Z[-rc.N] && git push origin vX.Y.Z[-rc.N]`. The workflow checks the tag, runs the tests, publishes with provenance (`next` for a pre-release, `latest` otherwise) and creates the GitHub release from the section below.
4. Never `npm publish` from a package directory (`prepublishOnly` refuses): the dist exports exist only in the packed tarball.

## [0.1.0-rc.0]

First release candidate.

### Added
- **core**: schema-driven filter parameters and `defineFilter()` (pointwise and multipass kinds, each with a WGSL shader and a TypeScript CPU reference), cached incremental filter-chain `Pipeline` with pointwise fusion, masks (linear, radial, brush, magic wand, guided-filter refinement), geometry (orientation, perspective, straighten, crop), 3D LUTs (`.cube`, Hald), colour maths in linear light and OKLab, export to PNG (8 / 16-bit), JPEG and WebP, chain serialisation, GPU errors reported to a callback (`createGpuContext({ onError })`, `ctx.limits`, `ctx.lost`).
- **filters**: adjustments (exposure, contrast, curves, levels, white balance, colour mixer, colour grading, ...), convolutions, edges (Canny, Sobel / Scharr / Prewitt, Laplacian), thresholds (Otsu, adaptive), morphology, median, bilateral, histogram equalisation and CLAHE, inpainting, stylize (halftone, dither, Kuwahara, bloom, emboss, sketch, ...), lens blur. The generated reference is `docs/filters.md`.
- **presets**: ten looks (LUT recipe, vignette, grain).
- **ml** (optional, ONNX Runtime passed in by the caller): click-to-select objects (SlimSAM), object removal (MI-GAN), depth for lens blur (Depth Anything V2 Small); model files are fetched from pinned revisions and verified by SHA-256 and size.

### Notes
- Pre-1.0: input is 8-bit sRGB; WebGPU is required for the GPU path (the CPU references run anywhere, Node included).
