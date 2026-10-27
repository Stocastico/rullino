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

Types: `float`, `int`, `bool`, `enum`, `color`, `curve`, `kernel`, `lut`, `image` (a patch or a depth map set by the app). The playground UI is **generated** from the schema: a new filter gets sliders and menus without writing any UI. The schema is also used to validate input and to serialize a chain into a URL.

### 2.5 A filter is a self-contained module

```ts
export const exposure = defineFilter({
  id: 'exposure',
  category: 'adjust',
  kind: 'pointwise',        // 'pointwise' | 'multipass' (neighbourhoods and reductions are multipass filters)
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
  presets/    looks = LUT + parameters (generated from recipes, no bundled assets)
  ml/         optional ML tools (select, remove, depth), ONNX Runtime passed in
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
- **A** edges: Sobel, Scharr, Prewitt (`gradient`) and Laplacian (*done*), **Canny** (*done*)
- **B** non-linear: median, bilateral, guided filter, Kuwahara
- **B** morphology: erode, dilate, open, close, gradient, top-hat; configurable structuring element
- **B** histogram (computation + display), equalization, **CLAHE**
- **B** geometry: rotate, flip, crop, straighten, perspective / homography (*done*, as a frame before the chain), export size (*done*); lens distortion correction and higher-quality resampling (bicubic, Lanczos) later
- **C** **Hough** lines and circles, Harris / Shi-Tomasi, connected components, distance transform, denoise (non-local means), FFT and frequency-domain filters

### 4.4 Stylization and creative
- **B** pixelate / mosaic, halftone, dithering (Floyd–Steinberg, Bayer), toon (edges + flat colors), emboss, pencil sketch
- **C** glitch / RGB shift, tilt-shift, motion blur and radial blur, Voronoi / crystallize, ASCII art

### 4.5 Tools (not filters)
- **A** before/after comparison; masks (linear and radial gradient) to apply a filter to a region only
- **B** chain saved and shareable via URL, undo/redo, PNG / JPEG / WebP export
- **C** ML segmentation masks (subject, sky) — *done* as the optional `@rullino/ml` package (click to select with SlimSAM)

### 4.6 Interactive editing
The user marks regions by hand; the library turns marks into masks and applies operations through them.
- **B** **Mask layer**: a single-channel texture that a step can be applied through (`out = mix(in, filtered, mask)`), from linear/radial gradients, a brush (paint / erase, soft edge) or a lasso. Needs a second texture input to a step, so it is a change to the `Step` / `Pipeline` model, designed together with the gradient masks.
- **B** **Cut-out**: mask to alpha (transparent background). Selection helpers without ML: magic wand (flood fill by colour distance — on the CPU at mask resolution: linear there, while GPU propagation needs a pass per pixel of path length) and edge refinement of a rough brush mask with the guided filter. *Done.*
- **B** **Object removal, small regions**: inpainting of a masked area (normalised convolution + diffusion) for blemishes and thin objects. *Done.* Next: multi-scale fill for wider areas, PatchMatch for textured ones.
- **C** Large-object inpainting (*done*: MI-GAN in `@rullino/ml`) and one-click background removal (not yet; a portrait / salient-object matting net). Neural models live in the separate optional package, so the core keeps zero runtime dependencies.

## 5. Testing strategy

- **Unit (Node, `node --test` or Vitest)**: CPU implementations against cases with a known answer (a vertical step for Sobel x, a constant image for blur, a known histogram for Otsu).
- **GPU ↔ CPU parity (browser, Playwright + Chromium with WebGPU)**: same image, same parameters, maximum difference within the filter's tolerance. Every new filter lands with its parity test.
- **Golden images** for presets: hash or perceptual comparison against a committed reference image.
- **Schema**: every filter has defaults within `[min, max]`; every preset references only existing filters and parameters.
- **Red/green**: write the test first, watch it fail, then implement.
- **Size budget** on the library bundle (gzip), raised only by a deliberate edit.

## 6. Work plan

### M0 — Skeleton (1–2 days) — done
- Monorepo with pnpm workspaces, strict TypeScript, Vite for the playground, CI on GitHub Actions (test + build).
- `core`: device init, texture upload/readback, sRGB ↔ linear conversion.
- **First filter: exposure**, in WGSL and CPU, with its parity test. Nothing else moves until this is green.

### M1 — Schema and generated UI — done
- `defineFilter()` and the parameter type system.
- Minimal playground: load image / sample images, one filter, sliders generated from the schema, before/after.
- Tier-A pointwise filters: contrast, brightness, saturation, vibrance, temperature/tint, gamma, invert, grayscale, fixed threshold.

### M2 — The graph — done
- Filter chain, pointwise fusion, incremental recompute, reduced preview while dragging.
- Tier-A convolutions (separable Gaussian, box, sharpen, unsharp, custom kernel).
- **Canny** as the stress test: multipass, non-maximum suppression, iterative hysteresis. If the graph handles Canny, it handles almost everything.
- Otsu and adaptive threshold (first reduction with atomics).

### M3 — Photography — done
- Curves and levels (with a curve widget in the playground), highlights / shadows, black point.
- 3D LUT engine, vignette, grain; the first ten presets.
- PNG / JPEG / WebP export.

### M4 — Second wave — done
- Tier-B filters: morphology, median, bilateral, Kuwahara, CLAHE, histogram, geometry, stylizations.
- Mask layer (gradient, brush, lasso) and masked steps; cut-out to alpha with magic wand and edge refinement; small-region inpainting (§4.6).
- Chain via URL, undo/redo.

### M5 — Release — done
- M5.1 API audit, M5.2 `dist/` + pack smoke + size budget, M5.3 generated filter reference, M5.4 playground on GitHub Pages, M5.5 release workflow: `0.1.0-rc.1` is on npm under `next`.

## 6b. Reach and adoption (from 26 Oct 2026, 16 weeks)

Goal: rullino becomes the MIT engine for photo edits that **preview on the GPU in the browser and render in Node with matching output**, with at least one production user we did not recruit. Breadth is not what is missing: **no new filters until the week-16 review**. The 0.2 creative-effects list below is frozen until then.

Pitch: *describe a photo edit once as JSON; preview it live in the browser, render the final file on the server; output within a published per-filter tolerance; MIT, no runtime dependencies.* WebGPU, fusion and zero-deps are never the headline (fusion only after benchmarks show a win).

Reality checks against the original proposal (measured or verified 26 Oct):
- **The CPU path is a reference, not a product.** Node 22, 4000×3000: exposure + curves 10.0 s, Gaussian blur + sharpen 8.0 s, levels + vignette + grain 14.3 s. Both the browser fallback and the server renderer depend on it, so CPU speed is Phase 1 work, not an afterthought.
- **"Same pixels" is not true and must not be claimed**: GPU intermediates are f16, some filters allow outliers (halftone 2% at 1e-2). The claim is "within the published tolerance of each filter", backed by a table generated from the schemas.
- **Already done**: the repo is public; model licences are in `THIRD_PARTY_NOTICES.md` (all Apache-2.0 / MIT); a versioned edit JSON exists (`serializeChain`, chain + masks + geometry); share links in the URL hash exist.
- **Konva and Fabric filters are synchronous** (`(imageData) => void`, Fabric `applyTo`); WebGPU is async. Adapters cannot be plain filters: they render asynchronously and swap the node's image source.
- **Node has no decoder or JPEG / WebP encoder without dependencies** (`encodeImage` uses `OffscreenCanvas`). The Node renderer takes decoded RGBA in and writes PNG itself; JPEG / WebP and decoding go through an optional peer (`sharp`), outside the zero-dependency packages.

### Phase 0 — release hygiene (week 1) — [#64](https://github.com/Stocastico/rullino/issues/64) — done
- [x] `0.1.0` on `latest` for all four packages; deprecate `0.0.0` (27 Oct; `0.0.0-stage` deprecated too). Done when the README quick-start runs in a clean project after `npm install @rullino/core @rullino/filters`.
- [x] Root README quick-start: one install line, ~10 lines, a before / after image; works in under 5 minutes.
- [x] Playground header: version, install line, GitHub link, link to the filter reference.
- [x] Parity badge + generated tolerance table (`docs/parity.md`, per filter: abs / rel / outliers).

### Phase 1 — the product (weeks 2–6) — [#65](https://github.com/Stocastico/rullino/issues/65)
0. ~~**Spike: WebGPU in Node through Dawn**~~ — done 27 Oct ([#72](https://github.com/Stocastico/rullino/issues/72)): the published packages run unchanged on `webgpu` (Dawn) in Node; on a GPU-less GitHub runner with Mesa lavapipe all 50 non-mask filters pass parity and the 12 MP chains take 0.3–1.4 s warm vs 12–14 s for the CPU reference. **Decision: the Node renderer runs the same WGSL through Dawn**; the fast CPU path is the fallback (browsers without WebGPU, servers without `webgpu`). Found on the way: float16 → float32 conversion in JS dominated readback ([#84](https://github.com/Stocastico/rullino/issues/84)).
1. ~~**Edit document v2**~~ — done 27 Oct (#86, #87, this PR) (weeks 2–3, [#73](https://github.com/Stocastico/rullino/issues/73)): extend `ChainDocument` rather than start over — add export settings (format, size, bit depth, background), a JSON Schema file and a migration function from v1; `applyEdit(image, edit, { backend })`; looks (`@rullino/presets`) available as edit documents.
2. **Fast CPU path, as fallback** (weeks 2–4, [#74](https://github.com/Stocastico/rullino/issues/74)): fused pointwise chains in one pass over the buffer, separable convolutions without per-pixel allocations, then the worst offenders found by a CPU bench; every fast filter has a parity test against its reference (the reference stays the specification). Target (relaxed after the spike): ~1 MP previews in < 200 ms, a 12 MP export in a few seconds.
3. **One entry point with fallback** (weeks 3–4, [#75](https://github.com/Stocastico/rullino/issues/75)): `createContext()` picks WebGPU, else CPU in a Web Worker, and reports the backend; CPU previews at reduced resolution; `WebGpuUnavailableError` only when the caller demands the GPU. No WebGL2.
4. ~~**Node renderer**~~ — done 27 Oct (`@rullino/node`, #89, #90, browser-vs-Node test in CI) (weeks 4–5, [#76](https://github.com/Stocastico/rullino/issues/76)): Node entry (subpath of core or `@rullino/node`): RGBA in, `applyEdit` on Dawn (`webgpu` optional peer, ~132 MB; lavapipe on GPU-less Linux), CPU fallback, PNG 8/16 out; `sharp` as optional peer for decode / JPEG / WebP. CI test: browser GPU vs Node output on a fixed image set within the table's tolerances. Example: one-file Express route.
5. **Benchmarks** (weeks 5–6, [#77](https://github.com/Stocastico/rullino/issues/77)): 3 chains (exposure + curves + LUT; blur + unsharp; levels + vignette + grain) at 12 and 24 MP vs pixi-filters, Photon, wasm-vips: first preview, per-change latency, memory, gzip size. **Run on real hardware** (SwiftShader numbers are meaningless here); publish the losses too; drop the fusion claim if it shows no win.

### Phase 2 — distribution (weeks 6–10) — [#66](https://github.com/Stocastico/rullino/issues/66)
- [ ] `@rullino/konva` (Konva.Image source swapped after an async render) — first, it is where GPU speed shows most.
- [ ] `@rullino/fabric` — after Konva, only if Konva gets interest; Fabric already has WebGL filters and two GPU contexts cannot share textures (one readback per render).
- [ ] Each adapter: < 200 lines, README, StackBlitz demo.
- [ ] Docs by job: preview + export, LUT looks in your editor, same edit on the server, remove an object on-device. Five one-file examples: Konva editor, Fabric editor, Next.js server render, Node batch, Worker fallback.
- [ ] Migration notes from glfx and tui.image-editor (filter mapping).
- [ ] Playground: **Copy as code** (edit JSON + snippet; was UX review step 6), backend + render time in plain words. The film strip (UX review step 4) is done; the examples gallery (step 5) waits: the playground is a developer demo, not an editor.

### Phase 3 — launch and first users (weeks 10–16) — [#67](https://github.com/Stocastico/rullino/issues/67)
- [ ] 3–5 design partners (teams on Konva / Fabric), one production integration live before launch.
- [ ] Launch post (preview / render mismatch, honest benchmarks), Show HN around the job, Konva / Fabric discussions, r/webdev, r/javascript, JavaScript Weekly, Frontend Focus.
- [ ] After launch: issues answered within 48 h for a month, good-first-issue labels, monthly release, a talk proposal on CPU/GPU parity testing.

### Week-16 review
Signals (targets are guesses, revise after the first partner calls): ≥ 1 production user not recruited, ≥ 3 design partners integrated, ≥ 10 outside issues / PRs, ≥ 15 public dependents; downloads as a trend against pixi-filters and Photon only. Decide: **grow** (WebGL2 tier if fallback speed is the top complaint, more adapters), **narrow** (Node-parity engine + adapters only) or **freeze** (reference implementation, no active development).

Not doing until then: new filters, node-graph editor, full editor UI, WebGL2, marketing to photographers, ML expansion.

### 0.2 creative effects (frozen until the week-16 review)
Done: gradient map, dither / halftone extensions (except gooey and moiré), ASCII. Remaining, if the review says grow: other cell effects (LED, receipt, Lego, crochet), outlines / hatching (Moebius), fluted glass and caustics, anisotropic / Papari Kuwahara. Other candidates: bicubic / Lanczos resize, NLM denoise, clarity / dehaze, blend modes, drop shadow, `.cube` export, memory budget, Firefox / WebKit CI (Firefox / WebKit CI moves up if partners need it).

### Later
- Tier-C filters (Hough, Harris, FFT, NLM, …), film simulations, a WebGL2 backend if fallback users ask for it.

## 7. Open decisions

- ~~Library name~~ → **rullino**, npm scope `@rullino` (org to be registered).
- ~~License~~ → **MIT**.
- ~~Test runner~~ → **Vitest** (unit in Node + browser mode via Playwright).
- ~~16-bit output~~ → 16-bit PNG export (own encoder). HDR / 16-bit *input* still to be decided (needs a decoder).
- ~~LUT assets~~ → looks are generated in-house from recipes (`bakeLut`); users can load their own `.cube` / Hald files.
