# Plan — WebGPU image processing library + playground

> Name: **rullino** (Italian for "roll of film").

## 1. What and why

A **TypeScript library on WebGPU** covering the full arc from classic image processing (what you'd do with OpenCV: thresholds, convolutions, edges, morphology, Canny, Hough) to the adjustments and looks of photo apps (iPhone Photos, Lightroom, Instagram filters). Plus a **playground**: a small website where you upload a photo (or pick a sample), chain filters, and tune their parameters with sliders and menus that have sensible defaults.

The space is open:

| Existing | Problem |
|---|---|
| OpenCV.js | WASM, several MB, translated C++ API, no GPU |
| glfx.js | WebGL1, unmaintained since 2015 |
| CamanJS | abandoned, CPU |
| pixi-filters | tied to the Pixi renderer |

None of them offers a modern, typed, composable, GPU-first library.

## 2. Design principles

### 2.1 "Insta" filters are data, not code
Almost every Instagram look is **a 3D LUT + vignette + grain** (sometimes a border). We don't hand-write forty filters: we build a solid **LUT engine** (`.cube`, HaldCLUT, adjustable intensity) and looks become **presets** = LUT + a few parameters. The original formulas aren't public; any "recipe" is an approximation, so we say so and curate the LUTs.

### 2.2 Every filter exists twice: GPU and CPU
- **WGSL** (compute shader): the fast implementation.
- **TypeScript on CPU**: the reference implementation, written to be obvious, not fast.

This is what makes the library testable: tests compare GPU and CPU pixel by pixel with a per-filter declared tolerance, and the CPU side runs in Node without a browser. The CPU path also serves as a fallback where WebGPU is missing. A WebGL2 backend is **out of scope for v1**.

### 2.3 Color is handled correctly from day one
- Internal pipeline in **linear, `rgba16float`**: decode sRGB on input, encode on output.
- Exposure, white balance, blur and compositing in **linear** (in sRGB gamma they are wrong, and it shows).
- Perceptual adjustments (vibrance, hue, HSL) in **OKLab / OKLCH**.
- Premultiplied alpha internally.

This cannot be retrofitted later without rewriting everything.

### 2.4 The parameter schema is the contract
Every filter declares its parameters:

```ts
{ name: 'lowThreshold', type: 'float', min: 0, max: 1, step: 0.01, default: 0.1, label: 'Low threshold' }
```

Types: `float`, `int`, `bool`, `enum`, `color`, `curve`, `point`, `kernel`, `lut`. The playground UI is **generated** from the schema: a new filter gets sliders and menus without writing any UI. The schema is also used to validate input and to serialize a chain into a URL.

### 2.5 A filter is a self-contained module

```ts
export const exposure = defineFilter({
  id: 'exposure',
  category: 'adjust',
  kind: 'pointwise',        // 'pointwise' | 'neighborhood' | 'reduction' | 'multipass'
  params: { ev: { type: 'float', min: -5, max: 5, step: 0.05, default: 0 } },
  wgsl,                     // shader (or shader graph for multipass)
  cpu,                      // reference implementation
});
```

## 3. Architecture

```
packages/
  core/       WebGPU device, texture pool, pass graph (DAG), color conversions, I/O, readback
  filters/    one file per filter: schema + WGSL + CPU
  presets/    looks = LUT + parameters (bundled .cube assets)
apps/
  playground/ the small website (Vite), consumes the packages like any other user
```

- **Pass graph**: consecutive `pointwise` filters (curves, levels, saturation…) are **fused into a single shader**; neighborhood filters (blur, Canny) use workgroup memory and tiling; reduction filters (histogram, Otsu, Hough) use atomics and separate passes.
- **Incremental recompute**: moving a slider recomputes only from the modified node downstream; intermediate results stay cached.
- **Reduced-resolution preview** while dragging, full resolution on release and on export.
- **Zero runtime dependencies** in the library.

## 4. Effects catalog

Tiers: **A** = MVP, **B** = second wave, **C** = once the rest is solid.

### 4.1 Basic adjustments (iPhone Photos / Lightroom)
- **A** exposure, contrast, brightness, black point, highlights / shadows, saturation, vibrance, temperature / tint, gamma
- **A** curves (RGB and per channel), levels
- **B** brilliance (local tone mapping), definition / clarity (local contrast), HSL per color range, split toning, shadows/midtones/highlights color balance, channel mixer
- **B** auto-levels, auto white balance (gray world, white patch)

### 4.2 Looks and style ("insta")
- **A** 3D LUT engine (`.cube` / Hald) with intensity; vignette; film grain (luminance-dependent, not white noise)
- **A** about ten initial presets: warm, cool, fade, Ilford-style B&W, cross-process, teal & orange, …
- **B** B&W via channel mixer, duotone / gradient map, sepia, light leak, bloom / halation, chromatic aberration, borders and frames
- **C** film simulations (Portra, Velvia, …) as curated LUTs

### 4.3 Classic image processing (OpenCV style)
- **A** grayscale, threshold (fixed, Otsu, adaptive), invert, posterize
- **A** convolutions: box, Gaussian (separable), sharpen, unsharp mask, custom 3×3 / 5×5 kernel
- **A** edges: Sobel, Scharr, Prewitt, Laplacian, **Canny**
- **B** non-linear: median, bilateral, guided filter, Kuwahara
- **B** morphology: erode, dilate, open, close, gradient, top-hat; configurable structuring element
- **B** histogram (computation + display), equalization, **CLAHE**
- **B** geometry: resize (bilinear, bicubic, Lanczos), rotate, flip, crop, straighten, perspective / homography, lens distortion correction
- **C** **Hough** lines and circles, Harris / Shi-Tomasi, connected components, distance transform, denoise (non-local means), FFT and frequency-domain filters

### 4.4 Stylization and creative
- **B** pixelate / mosaic, halftone, dithering (Floyd–Steinberg, Bayer), toon (edges + flat colors), emboss, pencil sketch
- **C** glitch / RGB shift, tilt-shift, motion blur and radial blur, Voronoi / crystallize, ASCII art

### 4.5 Tools (not filters)
- **A** before/after comparison; masks (linear and radial gradient) to apply a filter to a region only
- **B** chain saved and shareable via URL, undo/redo, PNG / JPEG / WebP export
- **C** ML segmentation masks (subject, sky) — probably a separate project

### 4.6 Interactive editing
The user marks regions by hand; the library turns marks into masks and applies operations through them.
- **B** **Mask layer**: a single-channel texture that a step can be applied through (`out = mix(in, filtered, mask)`), from linear/radial gradients, a brush (paint / erase, soft edge) or a lasso. Needs a second texture input to a step, so it is a change to the `Step` / `Pipeline` model, designed together with the gradient masks.
- **B** **Cut-out**: mask to alpha (transparent background). Selection helpers without ML: magic wand (flood fill by colour distance — on the CPU at mask resolution: linear there, while GPU propagation needs a pass per pixel of path length) and edge refinement of a rough brush mask with the guided filter. *Done.*
- **B** **Object removal, small regions**: inpainting of a masked area (normalised convolution + diffusion) for blemishes and thin objects. *Done.* Next: multi-scale fill for wider areas, PatchMatch for textured ones.
- **C** Large-object inpainting and one-click background removal need neural models (e.g. LaMa, a segmentation net via ONNX / WebNN). They would live in a separate optional package, so the core keeps zero runtime dependencies.

## 5. Testing strategy

- **Unit (Node, `node --test` or Vitest)**: CPU implementations against cases with a known answer (a vertical step for Sobel x, a constant image for blur, a known histogram for Otsu).
- **GPU ↔ CPU parity (browser, Playwright + Chromium with WebGPU)**: same image, same parameters, maximum difference within the filter's tolerance. Every new filter lands with its parity test.
- **Golden images** for presets: hash or perceptual comparison against a committed reference image.
- **Schema**: every filter has defaults within `[min, max]`; every preset references only existing filters and parameters.
- **Red/green**: write the test first, watch it fail, then implement.
- **Size budget** on the library bundle (gzip), raised only by a deliberate edit.

## 6. Work plan

### M0 — Skeleton (1–2 days)
- Monorepo with pnpm workspaces, strict TypeScript, Vite for the playground, CI on GitHub Actions (test + build).
- `core`: device init, texture upload/readback, sRGB ↔ linear conversion.
- **First filter: exposure**, in WGSL and CPU, with its parity test. Nothing else moves until this is green.

### M1 — Schema and generated UI
- `defineFilter()` and the parameter type system.
- Minimal playground: load image / sample images, one filter, sliders generated from the schema, before/after.
- Tier-A pointwise filters: contrast, brightness, saturation, vibrance, temperature/tint, gamma, invert, grayscale, fixed threshold.

### M2 — The graph
- Filter chain, pointwise fusion, incremental recompute, reduced preview while dragging.
- Tier-A convolutions (separable Gaussian, box, sharpen, unsharp, custom kernel).
- **Canny** as the stress test: multipass, non-maximum suppression, iterative hysteresis. If the graph handles Canny, it handles almost everything.
- Otsu and adaptive threshold (first reduction with atomics).

### M3 — Photography
- Curves and levels (with a curve widget in the playground), highlights / shadows, black point.
- 3D LUT engine, vignette, grain; the first ten presets.
- PNG / JPEG / WebP export.

### M4 — Second wave
- Tier-B filters: morphology, median, bilateral, Kuwahara, CLAHE, histogram, geometry, stylizations.
- Mask layer (gradient, brush, lasso) and masked steps; cut-out to alpha with magic wand and edge refinement; small-region inpainting (§4.6).
- Chain via URL, undo/redo.

### M5 — Release
- Publish packages to npm (semver, changelog), documentation generated from the schemas.
- Playground on GitHub Pages; possibly an off-site entry on the personal website.

### Later
- Tier-C filters (Hough, Harris, FFT, NLM, …), film simulations, possibly a WebGL2 backend if the user base asks for it.

## 7. Open decisions

- ~~Library name~~ → **rullino**, npm scope `@rullino` (org to be registered).
- ~~License~~ → **MIT**.
- ~~Test runner~~ → **Vitest** (unit in Node + browser mode via Playwright).
- ~~16-bit output~~ → 16-bit PNG export (own encoder). HDR / 16-bit *input* still to be decided (needs a decoder).
- ~~LUT assets~~ → looks are generated in-house from recipes (`bakeLut`); users can load their own `.cube` / Hald files.
