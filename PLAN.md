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
2. ~~**Fast CPU path, as fallback**~~ — first round done 27 Oct ([#74](https://github.com/Stocastico/rullino/issues/74)): filters carry an optional `fast` CPU implementation, `runChainCpu(…, { fast: true })` and `applyEdit`'s CPU path use it, `fast.test.ts` holds each against its reference within the GPU tolerance; `pnpm bench:cpu`. Done: separable convolutions (Gaussian, box, unsharp), table-based sRGB, exposure / curves / levels / LUT / vignette / grain, colour mixer, OKLab cubes without pow. Measured in a cloud container (2–3× slower than the 26 Oct machine), reference → fast: 12 MP chains 24–28 s → 5–7 s, 1 MP chains 1.7–2.3 s → 0.35–0.43 s; so ~1 MP previews land around the 200 ms target on an ordinary machine. Not done ([#95](https://github.com/Stocastico/rullino/issues/95), if the fallback needs more): fusing consecutive pointwise steps into one pass, tiling across Workers / worker threads, fast paths for the remaining filters (OKLab adjustments, the slow stylize ones: bilateral, Kuwahara, ASCII, inpaint).
3. ~~**One entry point with fallback**~~ — done 27 Oct as `@rullino/web` ([#75](https://github.com/Stocastico/rullino/issues/75); its own package, like `@rullino/node`, the user's call): `createRenderer({ backend: 'auto' | 'gpu' | 'cpu' })` picks WebGPU, else the fast CPU path in a module Web Worker, and reports `backend` / `reason`; `WebGpuUnavailableError` only for `'gpu'`; `apply(image, doc, { scale })` for reduced-size previews, `render(file | ImageData, doc)` → encoded `Blob`. No WebGL2. Tested in Chromium (worker vs WebGPU within the browser-vs-Node bound, protocol identical to `applyEdit` on the main thread) and from the packed tarball in a Vite bundle. Not done: the playground itself still needs WebGPU ([#96](https://github.com/Stocastico/rullino/issues/96)); detecting software adapters (SwiftShader) to prefer the CPU is left until real-hardware numbers (#77) say which is faster.
4. ~~**Node renderer**~~ — done 27 Oct (`@rullino/node`, #89, #90, browser-vs-Node test in CI) (weeks 4–5, [#76](https://github.com/Stocastico/rullino/issues/76)): Node entry (subpath of core or `@rullino/node`): RGBA in, `applyEdit` on Dawn (`webgpu` optional peer, ~132 MB; lavapipe on GPU-less Linux), CPU fallback, PNG 8/16 out; `sharp` as optional peer for decode / JPEG / WebP. CI test: browser GPU vs Node output on a fixed image set within the table's tolerances. Example: one-file Express route.
5. ~~**Benchmarks**~~ — done 28 Oct ([#77](https://github.com/Stocastico/rullino/issues/77), results in its comments): `apps/bench` (`pnpm bench:web`), 3 chains at 12 and 24 MP vs pixi-filters, Photon, wasm-vips on the maintainer's RTX 40-class machine. The first run showed rullino losing on image load (473 ms vs PixiJS's 14 ms at 12 MP) and flat, readback-bound change latency; #99 moved decoding to the GPU and pooled readbacks: load 22 ms (12 MP) / 56 ms (24 MP), change latency ~25 ms at 12 MP (level with PixiJS) and 44–49 ms at 24 MP (PixiJS 52–65 ms), less memory than PixiJS and Photon. Losses kept public: the CPU fallback is 4–9 s per 12 MP chain ([#95](https://github.com/Stocastico/rullino/issues/95)). The fusion claim stays out of the pitch: change latency is dominated by readback, not by passes.

### Phase 2 — distribution (weeks 6–10) — [#66](https://github.com/Stocastico/rullino/issues/66)
- [x] `@rullino/konva` (Konva.Image source swapped after an async render, #102) — first, it is where GPU speed shows most.
- [ ] `@rullino/fabric` — after Konva, only if Konva gets interest; Fabric already has WebGL filters and two GPU contexts cannot share textures (one readback per render).
- [ ] Each adapter: < 200 lines, README, StackBlitz demo. Konva done (`examples/konva-editor`, 0.5.0; checked on StackBlitz 29 Oct: WebGPU in Chrome, CPU worker in Firefox on Linux).
- [ ] Docs by job (`docs/guides/`, `ts` blocks type-checked by `pnpm typecheck`): ~~preview + export~~, ~~LUT looks in your editor~~, ~~same edit on the server~~, ~~remove an object on-device~~ (all four done 29 Oct). Five one-file examples: ~~Konva editor~~ (done), ~~Node batch~~ (done 29 Oct), ~~Worker fallback~~ (done 29 Oct), Fabric editor, Next.js server render.
- [x] Migration notes from glfx and tui.image-editor (filter mapping): `docs/guides/migrating-from-glfx-and-tui.md`, done 30 Oct; written against glfx's documentation and tui's filter-menu source, with the gaps (sepia, warps, tint / multiply / blend, remove colour) listed.
- [ ] Playground: ~~**Copy as code**~~ (done 29 Oct, #108: the Code button, edit JSON + browser / Konva / Node snippets), ~~backend + render time in plain words~~ (done 29 Oct). The film strip (UX review step 4) is done; the examples gallery (step 5) waits: the playground is a developer demo, not an editor.

**Where we are (29 Oct, end of day; published: 0.5.0 of all seven packages).** Next, in this order:
1. ~~**Node batch example**~~ (`examples/node-batch`, done 29 Oct): one file that renders an edit document onto a folder of photos with `@rullino/node`; `pnpm test:pack` runs it against the tarballs and checks the files and their size.
2. ~~**Status line in plain words**~~ (done 29 Oct): the playground says "On the GPU (WebGPU) · River 2048×1365 · 3 steps · 370 ms", or "On the CPU (WebGPU unavailable: …)" (`status-text.ts`).
3. ~~**Worker fallback example**~~ (`examples/worker-fallback`, done 29 Oct) and ~~**Next.js server render example**~~ (`examples/nextjs-server-render`, done 3 Nov; Fabric is the one left).
4. ~~Docs by job~~ (four guides, done 29 Oct) and ~~the migration notes~~ (30 Oct). Phase 2 is then only the optional adapters and examples below.
5. Fabric only if Konva gets interest (watch npm downloads / issues of `@rullino/konva`).

**Parity on real GPUs (30 Oct, open).** The published tolerances are verified on software GPUs only. On an RTX 40 (Chrome, Windows) 25 of 936 browser tests failed (`canny`, `inpaint`, `sketch`, `kuwahara`, the 8-bit sRGB decode; see the Trap in CLAUDE.md). `pnpm report:parity` measures every case on the machine's own GPU; next: run it on the RTX, decide per filter (wider tolerance with a note in `docs/parity.md`, change of the reference, or outliers for hard decisions) and rerun on a second GPU if one is at hand. Until then "within the published tolerance" is a claim about software adapters.

Open issues to keep in view: [#127](https://github.com/Stocastico/rullino/issues/127) CPU fast paths for the remaining slow filters (round 2 so far: OKLab adjustments, bilateral, Kuwahara, inpaint, ascii; split from #95), [#128](https://github.com/Stocastico/rullino/issues/128) tiled CPU execution across workers (done 3 Nov: `threads` in Node and the browser, two-phase global filters, web default 4 workers; Node stays at 1), [#96](https://github.com/Stocastico/rullino/issues/96) playground without WebGPU, [#100](https://github.com/Stocastico/rullino/issues/100) the unexplained 28-minute CI stall (timeouts now make it fail fast; the 3.8 s cold-shader cause of the release failures is fixed). Release routine: `node scripts/set-version.mjs X.Y.Z` + CHANGELOG section in a PR, merge, the maintainer pushes the tag (checklist at the top of CHANGELOG.md); npm can take minutes to show a package the workflow already published.

### Phase 3 — launch and first users (weeks 10–16) — [#67](https://github.com/Stocastico/rullino/issues/67)
- [ ] 3–5 design partners (teams on Konva / Fabric), one production integration live before launch.
- [ ] Launch post (preview / render mismatch, honest benchmarks), Show HN around the job, Konva / Fabric discussions, r/webdev, r/javascript, JavaScript Weekly, Frontend Focus.
- [ ] After launch: issues answered within 48 h for a month, good-first-issue labels, monthly release, a talk proposal on CPU/GPU parity testing.

### Before going public (checklist of 4 Nov, after the docs and debug session)

Done in that session: integrator documentation (`docs/getting-started.md`, `concepts.md`, `edit-document.md`, `troubleshooting.md`, a documentation index, a root README that starts from the edit document), three bugs fixed (node JPEG / WebP quality 0, konva preview of a cropped edit and cached failure, web renderer after `destroy()`), a test over every filter at 1×1 / 1×N / N×1 sizes, a test that renders the JSON examples of the format reference. Open, in the order that matters for a launch:
1. **0.7.0** with the above (CHANGELOG `[Unreleased]` is ready; `node scripts/set-version.mjs 0.7.0`, merge, the maintainer pushes the tag).
2. **Real-hardware claim**: the tolerances were verified on software GPUs and one RTX 40. Run `pnpm report:parity` on a non-NVIDIA GPU (Apple silicon, Intel or AMD) and open the playground and `@rullino/web` in Safari and Firefox; Firefox / WebKit CI does not exist. A launch post that says "within the published tolerance" must not be refuted by the first reader on a Mac.
3. **Benchmarks as a page**: the real-hardware numbers of #77 live in issue comments. Put them (losses included) in `docs/benchmarks.md` with the machine and the commit, since the launch post links to it.
4. **GitHub housekeeping**: close #77 and #84 (done), tick the epics #65 / #66, add `good first issue` labels, enable Discussions, set the repository description, topics and a social preview image.
5. **Launch material**: a 20–30 s before / after screen recording of the playground (compare, film strip, Code button), the launch post (Claude can draft it), the Filerobot issue (the maintainer opens it) and the `konvaFilter` decision (needs a yes: new public API).
6. **Design partners**: nothing replaces a person using it; the `konva` and `nextjs-server-render` examples are the thing to send.

### Week-16 review
Signals (targets are guesses, revise after the first partner calls): ≥ 1 production user not recruited, ≥ 3 design partners integrated, ≥ 10 outside issues / PRs, ≥ 15 public dependents; downloads as a trend against pixi-filters and Photon only. Decide: **grow** (WebGL2 tier if fallback speed is the top complaint, more adapters), **narrow** (Node-parity engine + adapters only) or **freeze** (reference implementation, no active development).

Not doing until then: new filters, node-graph editor, full editor UI, WebGL2, marketing to photographers, ML expansion. (Under review: an embeddable editor component, see §6c.)

### 0.2 creative effects (frozen until the week-16 review)
Done: gradient map, dither / halftone extensions (except gooey and moiré), ASCII. Remaining, if the review says grow: other cell effects (LED, receipt, Lego, crochet), outlines / hatching (Moebius), fluted glass and caustics, anisotropic / Papari Kuwahara. Other candidates: bicubic / Lanczos resize, NLM denoise, clarity / dehaze, blend modes, drop shadow, memory budget, Firefox / WebKit CI (Firefox / WebKit CI moves up if partners need it).

### Later
- Tier-C filters (Hough, Harris, FFT, NLM, …), film simulations, a WebGL2 backend if fallback users ask for it.

## 6c. Market and positioning (review of 4 Nov 2026, proposal: not decided yet)

The question raised: now that the engine is complete (51 filters, GPU + CPU, workers, Node, on-device ML), should rullino become a **client-side online editor** with a beautiful UI (no backend), and which niches can we take from the competition?

### Who is already there
| Who | What they do well | Where we are better or could be |
|---|---|---|
| **img.ly CE.SDK** | Complete editor SDK (photo, video, design, templates), web + iOS + Android, polished UI, AI plugins | Price: quote-based, median buyer spend ~$17.5k / year (Vendr). Closed. No published CPU/GPU tolerance, no "same edit on the server" with a parity check. We cover only the photo-adjustment part of what they do. |
| **Pintura** (pqina) | Embeddable image editor, good UX, crop / annotate / filters / redact, $179 per developer and up | Its adjustments are a handful of colour-matrix filters; no curves on OKLab, masks, LUTs, server render, ML. Closed. |
| **Filerobot** (Scaleflex) | MIT, React + Konva, crop / annotate / resize / presets; free and widely used | Its filters are Konva's synchronous CPU filters: slow and basic. **It is built on Konva, and we already have `@rullino/konva`**: the cheapest distribution channel we have. |
| **Photopea, Pixlr** | Photoshop-like layers, PSD, huge feature set, free with ads | Not worth attacking: decades of features, raster-only, no non-destructive grading worth the name. |
| **"Privacy-first" indie editors** (CloakIMG, PhotoQuill on WebGPU, MiniPx, …) | Client-side, no upload, several launched in 2026 | "Runs in your browser" is no longer a differentiator: there is one a week. Most are thin wrappers over canvas filters. |
| **Lightroom (web), Polarr** | Non-destructive grading, presets, sync | Subscription, cloud upload. Nothing open does Lightroom-quality grading in the browser with an exportable edit. |
| **Magnific / Freepik** | Generative AI (upscale, relight, restyle); an editor workspace around it | Server-side, credit-based. Not our game; their editor UX (one panel, before / after) is worth copying, the generative core is not. |
| **OpenReel, FreeCut** (browser video, MIT, WebCodecs + WebGPU, months old) | Timeline editing, export, basic colour (wheels, curves, LUT import) | They need a colour engine; we have one. Partners, not competitors. |

### Assessment (opinion)
- **A general online photo editor is the wrong target.** It is the most crowded segment, the moat is UI polish and years of features, and "client-side" is now table stakes. We would be one more privacy-first editor.
- **Our real moat** is a combination nobody has: a versioned JSON edit document, previewed on the GPU in the browser, rendered on the server within a published tolerance, MIT, with on-device ML. That sells to **developers and products**, not to end users directly.
- **An editor still has value**, as the shop window and as an embeddable component: the playground is 80% of one already (film strip, inspector, masks, geometry, looks, undo, share links, split view).

### Niches, ranked (cost to us vs. chance to win)
1. **Filerobot's filter engine** (cheap, high reach). Offer a rullino-backed Adjust / Filters tab for Filerobot (adapter or upstream PR through `@rullino/konva`). Filerobot users get curves, looks, masks, GPU speed; we get a real integration and users we did not recruit, which is the week-16 target.
2. **Embeddable editor component** (`@rullino/editor`, medium cost): the playground's inspector + film strip + split as a framework-free web component (`<rullino-editor>`), outputting an edit document. Positioned against Pintura and the photo part of img.ly: MIT core, the same document rendered by `@rullino/node`. Monetisation, if ever wanted: paid support / a pro tier of UI, never the engine.
3. **Look and LUT authoring** (cheap, distinctive): grade a photo, export the look as a `.cube` (`bakeLut` exists; `.cube` export is already on the candidates list), usable in DaVinci, Premiere, OBS, phones. Creators sell presets and LUTs; existing web LUT makers are toys or need a colour card. Also the bridge to video without a video editor.
4. **Batch consistency for catalogues** (medium): same edit on hundreds of product / real-estate photos, in the browser (folder via File System Access, band workers) or on the server. Photoroom / Pixelcut charge per image for server AI; ours is deterministic, private, free to run. Perspective correction already covers real estate.
5. **Reproducible edits / provenance** (speculative): the edit document is an exact record of what was done; attaching it to a C2PA manifest would suit newsrooms and insurance claims. Validate demand before building anything.
6. **Video colour engine** (later, expensive to test): per-frame grading through WebCodecs for OpenReel-like editors. Risk: `VideoFrame` import loses the device on SwiftShader (see Traps), so CI cannot test it as is.

### UX worth copying (cheap, now)
The split view exists. On top of it:
- ~~**Compare with any step**~~ (done 4 Nov): the split's "before" side is the original or the picture after a chosen step (**Compare with** menu), so you see what the later steps changed.
- ~~**Hold to compare**~~ (done 4 Nov: hold `\`, as in Lightroom; a long press on touch is still open) and **A / B versions**: two snapshots of the edit (history already keeps immutable states) side by side or under the split.
- **History scrubber**: a slider over undo states, to see the edit evolve.

### Proposed next steps (for the user to accept or change)
1. Now, inside the current plan: ~~the compare UX above~~ (compare with a step and hold `\` done 4 Nov, #148), ~~`.cube` export~~ (done 4 Nov: `formatCube`, `bakeLut` on per-pixel steps, the playground's **Export look (.cube)**), ~~a Filerobot spike~~ (done 4 Nov, [`docs/design/filerobot.md`](docs/design/filerobot.md): no extension point for tabs or the filter list; filters are synchronous Konva filters resolved by name, so the fit is a sync `konvaFilter(doc)` on the CPU fast path, plus an upstream ask for custom filters, which the maintainer opens).
2. Decide whether the "full editor UI" exclusion in 6b holds. Proposal: allow the **embeddable component** (niche 2), still no consumer editor (no layers, text, accounts, ads).
3. Keep the week-16 review; add "Filerobot integration live" and "`.cube` exports used" as signals.

### Next, in this order (as of 4 Nov, end of day)
1. **`konvaFilter(doc)` in `@rullino/konva`** (needs the maintainer's yes: new public API): a synchronous Konva filter `(imageData) => void` on the CPU fast path, colour steps only at first (pointwise / `perPixel`, baked with `bakeLut` when the whole document is colour-only); tests in Chromium with real Konva (`node.filters([...])`, `cache()`), mutation-checked; then measure preview and save at 1 and 12 MP.
2. **Filerobot example** (`examples/filerobot-looks`): registers two or three rullino looks as `Konva.Filters.Rullino*` and loads one through `loadableDesignState`; driven by `pnpm test:pack` like the other examples.
3. **Upstream ask** (the maintainer opens it, not Claude): an issue on Filerobot for custom filters in the Filters tab, with the example as the motivation.
4. **Playground compare, the rest**: A / B versions (two snapshots of the edit side by side or under the split), a history scrubber over the undo states, long press to compare on touch.
5. Then decision 2 above (embeddable `<rullino-editor>`), with what 1–3 taught us about how editors embed rullino.

Sources (4 Nov 2026): img.ly pricing page and Vendr's listing; Pintura store; Filerobot's GitHub README (MIT, react-konva); Magnific's image-editor docs; GitHub pages of CloakIMG, OpenReel Video, FreeCut; web LUT makers (steveseguin, o-l-l-i).

## 7. Open decisions

- ~~Library name~~ → **rullino**, npm scope `@rullino` (org to be registered).
- ~~License~~ → **MIT**.
- ~~Test runner~~ → **Vitest** (unit in Node + browser mode via Playwright).
- ~~16-bit output~~ → 16-bit PNG export (own encoder). HDR / 16-bit *input* still to be decided (needs a decoder).
- ~~LUT assets~~ → looks are generated in-house from recipes (`bakeLut`); users can load their own `.cube` / Hald files.
