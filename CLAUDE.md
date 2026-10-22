# CLAUDE.md

Guidance for working in this repo. Design and roadmap: [PLAN.md](./PLAN.md). Keep this file current: when a decision is made or reversed, record it under **Decisions** with its reason.

## Commands

```sh
pnpm install
pnpm typecheck        # tsc over all packages and apps
pnpm test             # unit tests (Node): CPU references, color, float16, compare
pnpm test:browser     # GPU tests in headless Chromium (WebGPU), incl. GPU<->CPU parity
pnpm test:all         # both
pnpm build            # builds the playground (Vite)
pnpm test:e2e         # smoke-tests the built playground in headless Chromium (run after build)
pnpm bench            # GPU timings per filter + a chain at 1024x768 (SwiftShader numbers: compare runs, not machines)
pnpm dev              # playground dev server
npx vitest run path/to/file.test.ts   # single file
npx vitest run packages/presets -u    # rewrite golden look snapshots after a deliberate recipe change
```

## Layout

- `packages/core`
  - `params.ts` parameter schema (float/int/bool/enum/kernel/curve, optional `unit: 'px'`): types, validation, defaults, `scaleParams`, uniform layout/packing, generated WGSL `Params` struct.
  - `filter.ts` / `define.ts` filter contracts and `defineFilter()`: `pointwise` (CPU reference derived from `pixel()`) and `multipass` (fixed list of passes + whole-image CPU reference).
  - `curve.ts` monotone tone curves sampled to a 256-entry LUT, CPU sampler and WGSL sampler generator.
  - `color.ts`, `oklab.ts` CPU colour maths; `wgsl.ts` the `rl_*` WGSL twins prepended to every shader.
  - `gpu/` context, rgba16float upload/readback, `importImage` / `encodeToTexture` / `readSrgb8` (sRGB edges), area `downscale`, `runMultipass`, `runFilter` (any kind).
  - `pipeline/` `Step` chains: `fuse.ts` (namespacing + fused shader), `pipeline.ts` (cached incremental `Pipeline`), `chain.ts` (`runChainCpu` reference).
  - `resize.ts` CPU area downscale and `fitWithin`.
  - `png.ts` dependency-free PNG encoder (8/16-bit RGBA); `encode.ts` `encodeImage` (PNG / JPEG / WebP from a `LinearImage`); `gpu/export.ts` `exportImage` from a texture.
  - `mask.ts` masks (linear, radial, raster), CPU `maskValue` / `maskImage` / `blendMasked` / `resampleRaster`; `gpu/mask.ts` the WGSL twin, `blendMask` and `renderMask`; `paint.ts` `paintStroke` (brush on raster masks); `wand.ts` `magicWand`; `refine.ts` `refineMask` (guided filter).
  - `geometry.ts` `Geometry` (orientation, perspective, straighten, crop) composed into one homography, `geometryFrame`, CPU `applyGeometryCpu`; `gpu/geometry.ts` `applyGeometry`.
  - `lut.ts` 3D LUTs: `createLut`, `.cube` / HaldCLUT parsers, CPU trilinear sampler and its WGSL twin; `gpu/lut.ts` the cached 3D texture.
- `packages/filters` — one directory per filter: `index.ts` (schema + WGSL + CPU reference) and `*.test.ts` (CPU semantics). `convolution.ts` holds shared CPU convolution code and WGSL pass builders. `index.ts` at the root is the registry; `parity.browser.test.ts` checks every registered filter GPU <-> CPU at defaults and parameter extremes.
- `packages/presets` — `bake.ts` (`bakeLut`: a pointwise chain baked into a 33³ LUT) and `looks.ts` (the looks: grade + vignette + grain, `lookSteps`, `lookLut`); golden charts in `__snapshots__`.
- `apps/playground` — Vite site; consumes packages through their public `index.ts` only. `controls.ts` generates the parameter UI from a schema (curve params share one `curve-editor.ts` with tabs); `chain-ui.ts` is the chain editor; `mask-ui.ts` the per-step mask panel and `mask-overlay.ts` the on-image handles / brush; `geometry-ui.ts` the Geometry panel, `crop-overlay.ts` / `perspective-overlay.ts` its on-image editors; `histogram-view.ts`; `scripts/smoke.mjs` is the e2e smoke test.

## Rules

- **Red/green.** Write the test first, run it, see it fail, then implement. For GPU code, also check that the parity test catches a deliberately broken shader before trusting it.
- **Every filter ships with both implementations, CPU semantics tests, and is registered** in `packages/filters/src/index.ts` (which gives it the parity test). The CPU version is the specification: obvious, unoptimised, never mutates its input.
- **Every parameter has a `label`** (the registry test enforces it); the UI is generated from the schema.
- **Working space is linear, premultiplied RGBA, `rgba16float` on GPU / `Float32Array` on CPU.** sRGB exists only at the I/O edges. Filters that need straight alpha (LUTs, curves, OKLab) must un-premultiply internally.
- **Pointwise WGSL is a pure function** `fn apply(c: vec4f, p: Params) -> vec4f`; no bindings, no globals, no `Params` declaration (it is generated from the schema). This is what lets consecutive pointwise filters fuse into one shader.
- **Multipass pass WGSL** defines `fn run(xy: vec2i, p: Params) -> vec4f` and reads inputs only through the generated `load_<input>(xy)` (clamp to edge). Pass lists are static: anything that varies with params goes in uniforms, so the shader cache keys stay `filter:pass`. Iteration goes through `repeat: '<int param>'` (ping-pong on `inputs[0]`), never through a params-dependent pass list.
- **Reductions** (histograms, global statistics) use filter `buffers` (zeroed `array<atomic<u32>, N>`) and `kind: 'compute'` passes (`dispatch: 'pixels'` or `'single'`); store floats with `bitcast<u32>`.
- **Filters with hard decisions** (thresholds, comparisons) mirror the GPU's f16 intermediates in their CPU reference (round each intermediate image) and may declare a small `tolerance.outliers` fraction. Measure the actual outliers before choosing it.
- **Curve params are read in WGSL only through the generated `curve_<name>(x)`** (never index the LUT yourself): it handles the fused-stage namespacing and linear extrapolation outside [0, 1].
- **Lengths in pixels are `unit: 'px'` params**, defined at the original image's resolution; chains scale them (`setSource({ scale })`, `runChainCpu({ scale })`).
- **In filter WGSL, top-level declarations (`fn`, `const`, `struct`) start at column 0 and locals are indented.** Fusion prefixes top-level names by matching line starts; an indented top-level declaration would not be namespaced and could collide with another filter's.
- **Zero runtime dependencies** in `packages/*`.
- Parity tests feed CPU and GPU the same **float16-quantised** input, so the tolerance only covers output rounding and math differences. Use odd image sizes to exercise workgroup bounds and row padding.
- Commit small and often; run `pnpm typecheck && pnpm test:all` before pushing (and `pnpm build && pnpm test:e2e` when the playground or filter list changes). When piping their output (`| tail`), use `set -o pipefail`, or a failure slips through to the commit.
- **Workflow**: one branch and one PR per milestone step, based on `main`. Claude may merge its own PR once CI is green and no review thread is open; afterwards delete the branch and start the next one from `main`.

## Decisions

| Decision | Why |
|---|---|
| pnpm workspaces monorepo | core / filters / presets / playground version and test together; playground consumes the packages like an outside user would. |
| Vitest (not `node --test`) | One runner for Node unit tests and browser mode (Playwright), so parity tests share assertions and config. |
| WebGPU tests in headless Chromium with `--enable-unsafe-webgpu` | Hosted CI has no GPU; Chromium falls back to SwiftShader. Verified on day one because it is the riskiest piece of M0. Needs a secure context (Vitest serves from localhost). |
| `playwright` pinned to 1.56.x | Matches the Chromium pre-installed in Claude Code cloud sessions (no download). CI installs its own browser. Bump deliberately. |
| WGSL kept in TS template strings (`/* wgsl */`), not `.wgsl?raw` | Works in any bundler and in Node without a plugin; the library must not depend on Vite. |
| Own float16 conversion (`half.ts`) | `Float16Array` is not available everywhere yet (Node 22). Round-to-nearest-even, tested against known bit patterns. |
| Package `exports` point at `src/*.ts` | Packages are private until M5; no build step to keep in sync. Revisit when publishing (emit `dist/`, keep `src` for the workspace). |
| npm scope `@rullino/*`, `publishConfig.access: public` | The npm org exists (Free plan); scoped packages default to private, which Free cannot publish. |
| Library packages keep `"private": true` until M5 | `exports` points at `.ts` sources, so an accidental publish would ship unusable packages. Remove it together with adding a real build. The playground stays private forever. |
| Publishing via npm trusted publishing (OIDC) from Actions | No long-lived token. Never add an `NPM_TOKEN` secret. Set up in M5. |
| GPU tests never skip when WebGPU is missing | A skipped parity test looks green and is indistinguishable from a deleted one. `adapter.browser.test.ts` runs first in CI and fails if `requestAdapter()` is null. |
| License: MIT | Permissive and conventional for a JS library; see `LICENSE`. |
| `noUncheckedIndexedAccess` on | Catches out-of-range reads elsewhere; in pixel loops, where the bounds are obvious, write `data[i]!`. |
| Pointwise filters declare `alpha: 'straight' \| 'premultiplied'`; core does the (un)premultiply on both CPU and GPU | One place for the alpha rules instead of every filter re-implementing them; parity tests cover both wrappers. Linear-in-colour ops (exposure, white balance, grayscale) stay premultiplied. |
| Perceptual adjustments (contrast, brightness, saturation, vibrance) in OKLab | Hue-stable and perceptually even; plan §2.3. Contrast pivots on 18% grey (L = cbrt 0.18). |
| Perceptual "levels" (invert, threshold level, posterize) in sRGB-encoded units | That is what people mean by "50%" or "invert"; mid grey stays mid grey. |
| Brightness = power curve on OKLab L, gamma = per-channel power on linear RGB | Two different tools: brightness keeps hue/chroma, gamma is the classic channel operation. |
| White balance = luminance-normalised RGB gains | Simple creative control; a proper chromatic adaptation (Bradford / CCT) can come with auto WB in tier B. |
| Enum values are passed to WGSL as the option's index (u32) | Uniforms stay 4 bytes per param; WGSL `switch` on `0u, 1u, ...` in option declaration order. |
| Playground output via `readSrgb8` + `putImageData` on a 2D canvas, not a WebGPU canvas | A WebGPU canvas loses the device in headless Chromium/SwiftShader, so direct presentation could not be tested in CI. Costs one readback per frame; revisit with M2's reduced preview. |
| Sample images generated in code | No image assets to license. |
| Fused shaders keyed on filter structure only; params live in a uniform block | Moving a slider re-uploads uniforms but never recompiles. |
| `runPointwise` is the one-filter case of `runFused` | One codegen path; every per-filter parity test also exercises fusion. |
| Pipeline caches each stage's output keyed on everything upstream | Changing a step recomputes from that stage on; with neighbourhood filters (next) the stages before a blur are reused. Fused GPU chains keep f32 between filters, so they are slightly *more* precise than the CPU reference applied in f16 steps would be; chain parity uses summed tolerances. |
| Linear-light area downscale for display and preview | Box filtering premultiplied linear values is the correct way to shrink; `createImageBitmap` / canvas resizes work in sRGB. Only images beyond the device's texture limit get a browser resize first. |
| Playground: display ≤ 2048 px, preview ≤ 768 px while dragging | Two Pipelines with their own caches; release re-renders at display size. Export re-runs the chain on the full-resolution texture in a throwaway Pipeline, so its intermediates do not stay in memory. |
| `multipass` filter kind = static list of named passes over textures | Covers convolutions, edges, morphology without a general graph language; each multipass filter is its own Pipeline stage, so the stages before it are reused when something after it changes. Workgroup-memory tiling is a later optimisation; correctness first. |
| Convolutions work on premultiplied linear values with clamp-to-edge | Blurring premultiplied light is physically right and avoids dark fringes at alpha edges. Sharpening touches colour only (alpha kept) and floors colour at 0. |
| Unsharp mask has no threshold (yet) | A hard threshold makes GPU (f16 intermediates) and CPU (f64) disagree on pixels near it; add a soft one later. |
| Custom kernel is always 5×5 | One shape in the schema and UI; a 3×3 kernel is the centre of the grid. |
| Canny hysteresis = fixed number of 8-connected propagation rounds (`iterations` param) | Exact GPU/CPU parity and a static pass list; enough rounds equal full hysteresis. A convergence check (atomics) can cut the passes later. |
| No ghost-zone (workgroup-memory) hysteresis | Tried: K steps per dispatch on a (16 + 2K)² block, exact parity. On SwiftShader Canny went from 2.4 s to 19.5 s (K=8) / 11.1 s (K=4): barriers and workgroup memory are very slow there and each block redoes ~4x the pixels. Kept on branch `claude/canny-ghost-zone-experiment` for a real-GPU comparison. |
| Canny thresholds on |∇|/4 of sRGB-encoded luminance, 45° directions without atan2 | Perceptual edges; comparing |gy| with tan(22.5°)|gx| gives identical sectors on CPU and GPU. NMS uses `>=` on one side and `>` on the other so a symmetric ridge stays one pixel wide. |
| Parity suite runs every filter on random noise *and* a ring image with fading contrast | Noise never produces connected weak edges or smooth gradients; a "hysteresis runs once" mutation passed on noise alone. |
| Reductions via storage buffers + compute passes inside the multipass model | Otsu needs histogram -> threshold -> apply; keeping it inside one filter means the Pipeline needs no new stage type. Buffers are recreated per run (WebGPU zero-fills new buffers). |
| Explicit bind group layouts for multipass passes | `layout: 'auto'` drops bindings the shader never reads; an input declared but unused then made the bind group invalid. |
| Otsu on a 256-bin histogram of perceptual luminance of the straight colour, transparent pixels skipped | Matches `threshold`'s units; transparent areas would otherwise drag the threshold to black. Ties keep the first maximum on both sides. |
| Adaptive threshold = luminance > Gaussian local mean − C (OpenCV's ADAPTIVE_THRESH_GAUSSIAN_C) | Familiar semantics; σ is a px param so it scales with previews. |
| Texture pool (`createWorkingTexture` / `releaseTexture`) | New textures are lazily zero-filled; with one per pass, allocation dominated long filters (Canny hysteresis 5.8 s -> 2.5 s on SwiftShader with ping-pong alone). Reuse is safe because the queue runs in order and every pass overwrites every pixel. Capped at 16 free textures per device. |
| Gaussian weights by recurrence, taps summed in symmetric pairs | One `exp()` per tap was a large share of blur cost (~-20 to -25%); f32 drift over 150 taps stays far inside the parity tolerance. |
| Benchmarks are a separate Vitest project (`pnpm bench`), not tests | Timing assertions would be flaky on shared runners; results are written to `packages/filters/bench/results.txt` because browser console output is not forwarded. |
| Curves = Fritsch-Carlson monotone cubic sampled to 256 f32 values, linear interpolation, linear extrapolation outside [0, 1] | No overshoot between points; CPU and GPU read the very same LUT; identity curves keep HDR. 1 KB of uniforms per curve. |
| Generated `curve_<name>()` samplers read the global uniform | Pointwise `apply()` gets `Params` by value, which WGSL cannot index dynamically; the sampler is emitted with the filter's code so fusion namespaces it. |
| Curves filter in sRGB-encoded units, RGB curve then channel curves | Matches how photo editors present curves. |
| Levels clip to the output range, HDR included | Classic levels semantics; an unclipped top made narrow input ranges overflow float16. Minimum input range is one 8-bit step. |
| Black point and shadows/highlights on OKLab lightness, global | Hue/chroma stay put. Local (detail-preserving) shadows/highlights is tier B "brilliance". |
| `lut` param: domain (32 B) in the uniform block, table in an `rgba32float` 3D texture cached per `Lut` object and device | Uniforms stay small; one upload per LUT. Stage keys use the LUT's identity (`objectKey`), never its data, so LUTs must be treated as immutable. Multipass filters only (pointwise fusion has no bindings). |
| Manual trilinear LUT interpolation with `textureLoad`, not a hardware sampler | `rgba32float` is not filterable without the optional `float32-filterable` feature, and hardware filtering uses low-precision weights; the manual version matches `applyLutCpu` step for step. |
| `applyLut` works on straight sRGB-encoded colour; intensity blends in the same units | That is what `.cube` / Hald LUTs are authored for; intensity 0 is an exact no-op even for HDR values the LUT would clamp. |
| Vignette darkens by multiplying linear light, lightens towards white; smoothstep on a corner-normalised distance | Multiplying light is what lens falloff does; normalising so corners are 1 keeps `midpoint` meaningful at any aspect ratio and roundness. |
| Grain = PCG-hashed value noise (cells of `size` px) added to sRGB-encoded colour with a midtone-weighted response | Deterministic and identical on CPU/GPU (integer hash, 24-bit floats); film grain is most visible in the midtones, not uniform white noise. The noise pattern differs between preview and full resolution (only its statistics match). |
| Looks are recipes of ordinary pointwise filters, baked once into a 33³ LUT (`bakeLut`), plus vignette and grain steps | Readable, tweakable, no third-party LUT licences (PLAN §7), and one LUT lookup per pixel at run time. A baked grade clamps HDR to [0, 1] and differs from the live chain by < 1/255 on average (up to ~0.02 for saturated colours at the gamut edge). |
| `lookSteps(look, { intensity })` returns plain chain steps | A look is not a new concept for the Pipeline; the playground expands it into editable steps. Intensity scales the LUT blend, vignette and grain together. |
| Golden look charts are Vitest snapshots of a 12-colour chart rounded to 1e-3 | Catches unintended recipe or filter changes; regenerate with `-u` only for deliberate ones. |
| Own PNG encoder over `CompressionStream('deflate')`; JPEG / WebP via `OffscreenCanvas.convertToBlob` | Canvas encoding goes through premultiplied 8-bit storage (lossy for semi-transparent pixels) and cannot write 16 bits; zlib is built into browsers and Node, so the encoder stays dependency-free (filter 0 only: larger files, simple code). |
| 16-bit PNG export; input stays 8-bit for now | 16 bits keep the float16 pipeline's precision on output (PLAN §7); 16-bit / HDR input needs a decoder and is left open. |
| Flattening (JPEG, or an explicit `background`) composites in linear light on the float readback | Same rule as the rest of the pipeline: blending in sRGB darkens edges. Plain 8-bit exports keep the faster GPU encode path. |
| Masks are a property of a step: `out = mix(in, step(in), m)` on premultiplied values, alpha included | Works for every filter kind without touching filters; a masked step is its own Pipeline stage (never fused) plus one blend pass. |
| Mask coordinates normalised to the image, distances in units of the longer side | The same mask at preview, display and export resolution; circles stay circles on non-square images. |
| Raster masks immutable, keyed by identity, GPU textures in a 4-entry LRU per device (evicted ones destroyed) | Same contract as LUTs for caching; painting makes a new raster per pointer move, and a WeakMap left their textures alive until GC. |
| Brush rasters at the image's aspect ratio, ≤ 1024 px | Round dabs; bilinear upsampling at export keeps soft edges soft. Fine detail beyond 1024 px is a future option. |
| Cut-out = `transparency` filter + mask | No separate mechanism; any mask kind can cut out. |
| Magic wand and edge refinement run on the CPU at mask resolution (≤ 1024 px) | A flood fill is linear on the CPU but needs as many GPU passes as the longest path through the region; the guided filter is linear with integral images. Both produce raster masks directly. The image comes from `maskSource` (original shrunk in linear light), cached per image. |
| Wand subtract and eraser remove coverage: `max(0, m − v)` | Adding then subtracting the same soft selection must be a no-op; `min(m, 1 − v)` left soft borders half selected. Dab values are computed in f32 so they cancel exactly. |
| Mask-aware filters (`usesMask`): passes read `mask`, the CPU reference gets it per pixel; the step still blends with its mask | Inpainting must know which pixels to rebuild; one generic mechanism instead of a special stage. Using one without a mask is an error; the playground gives such steps an empty brush mask. |
| Inpainting diffusion returns the input immediately outside the hole | Most pixels are outside it; same result, −24% at the defaults. The remaining cost is the number of full-image passes (60 iterations). |
| Inpainting = normalised convolution + Jacobi diffusion, single resolution | Fits the static multipass model and gives near-invisible results on thin strokes; wide areas need a reach ≥ half their width. Multi-scale / patch-based (PatchMatch) inpainting is a later step. |
| Morphology and median per channel (as OpenCV), on premultiplied values, alpha included; gradient / top-hat / black-hat keep the input's alpha | Simple, familiar semantics and exact parity (min / max / selection never round). Per-channel ordering can create colours that were not in the image; a luminance-ordered (vector) variant can come later. |
| Morphology: one 2-D pass per operation for every element shape (no separable square) | One code path for square / disk / cross; O(r²) per pixel, so radius is capped at 15. A separable square (O(r)) is a performance-review candidate. |
| Median: radius ≤ 3, selection by counting over a `vec4` array; radius 1 by a fixed 19-exchange network (min/max on `vec4`) | No sort and no data-dependent branching on the GPU. The counting loop indexes a private array dynamically, which SwiftShader handles slowly: the network makes the common 3×3 case 7× faster (1310 → 186 ms at 1024×768) and stays exact. |
| Bilateral range distance = OKLab ΔE + alpha, OKLab precomputed in a first pass | Perceptual edges like the other OKLab tools; computing OKLab once per pixel instead of once per tap avoids a cube root per neighbour. Window 2σs, max 40 px. |
| Histogram of the output computed on the CPU from the displayed frame's bytes (`histogramSrgb8`) | The playground already reads every frame back; a GPU reduction would add work for no gain. Luminosity = Rec. 709 weights on encoded values, as photo editors show it. |
| Equalisation (global and CLAHE) on OKLab lightness, CDF interpolated linearly inside each bin | Hue and chroma stay put; the continuous mapping keeps GPU (f32) and CPU (f64) within tolerance even when a pixel lands in a neighbouring bin. Transparent pixels are ignored. |
| CLAHE: tiles × tiles grid (≤ 16), clip at `clipLimit` × mean bin with one even redistribution of the excess, bilinear blend of the 4 nearest tiles' mappings | OpenCV-like semantics without seams. One invocation per tile builds its CDF (reusing the pixel dispatch); tiles are capped at the image size so none is empty. A single redistribution can still give slopes up to ~(clip + 1), so clip 1 is not the identity. |
| Geometry is a frame applied to the source before the chain (Lightroom model), not a chain step | The chain keeps one size throughout, so caching, masks, fusion and the CPU reference are untouched. Geometry produces the Pipeline's source texture; preview, display, the before image, the wand's image and export all use it. |
| Geometry = orientation (quarter turns, flips) → perspective (4 points onto the frame) → straighten (±45°, clockwise positive) → crop, all normalised, composed into one homography; bilinear resampling of premultiplied values, transparent outside | One shader and one CPU path for every transform; normalised parameters mean the same at every resolution. Uncovered corners stay visible (transparent) so the user crops them deliberately; an auto-constrained crop can come later. |
| Turns and flips act on what is shown (`turnGeometry` / `flipGeometry`): crop, perspective quad and straighten follow the content | Changing only `rotate` / flips made 'rotate right' turn the wrong way after a flip (a mirror reverses rotations) and left an existing crop or perspective on other content. |
| The output pixels of a geometry span exactly the crop rectangle (`crop.width·W / outW` per pixel) | The result no longer depends on which corner the pixel grid is anchored to, so turned / flipped crops give exactly the turned / flipped result (it was a sub-pixel shift). Scale is exactly 1 when the crop is a whole number of pixels. |
| While a geometry control is dragged only the preview is reframed; the display image catches up on release | Reframing and reading back the 2048 px display on every move cost ~330 ms per move on SwiftShader; preview only: ~70 ms. |
| Wand clicks are queued and target the step selected at click time | Two quick clicks used to start from the same mask (the second erased the first), and a slow result could land on another step. |
| Masks and the crop live in the framed image's coordinates | Masks are drawn on what is shown. Changing the crop or straighten after drawing a mask moves it relative to the content (it keeps its normalised position). |
| Crop / perspective edited on the image with the frame shown without them; applied on Done | You need to see what is outside the crop or before the correction to place the handles. |
| Export size = long side, linear-light area downscale after the full-resolution chain; never enlarges | Pixel-unit params keep their full-resolution meaning; shrinking after the chain is the correct order. |
| `shader-f16` not required | Textures are rgba16float but shaders compute in f32; SwiftShader does not expose `shader-f16`. |

## Traps

Things that already bit us. Add new ones as they come up.

- **`navigator.gpu` needs a secure context.** In Chromium, `about:blank` and plain-HTTP non-localhost pages have no `navigator.gpu` even with `--enable-unsafe-webgpu`. Vitest serves from localhost, which counts as secure.
- **Headless Chromium needs `--enable-unsafe-webgpu`** to expose WebGPU; without it `requestAdapter()` returns null. Set in `vitest.config.ts`.
- **`copyTextureToBuffer` needs `bytesPerRow` to be a multiple of 256**; `writeTexture` does not. `readImage` pads and un-pads rows; test with odd widths.
- **Compute dispatch rounds up to whole workgroups**, so shaders must bounds-check `global_invocation_id` against `textureDimensions`. Test with sizes that are not multiples of 8.
- **Parity tests must quantise the input to float16 first**, otherwise the tolerance has to absorb input rounding too and stops catching real bugs.
- **Check that a parity test can fail**: break the shader slightly (e.g. scale by 1.002) and confirm it goes red before trusting it.
- **Configuring a WebGPU canvas in headless Chromium (SwiftShader) loses the device** ("A valid external Instance reference no longer exists"), with or without `STORAGE_BINDING`, old or new headless. Anything a test must check goes through textures and readback.
- **Integer downscale ratios hide weighting bugs** (every coverage weight is 1). Test resizes with fractional ratios.
- **`layout: 'auto'` silently drops unused bindings**, so binding an unused input fails validation with an empty output and no exception. `cachedPipeline` takes explicit layout entries; multipass passes always use them.
- **A failed pipeline/bind group shows up as an all-zero output** (alpha 0), not as an exception. When a GPU test gets zeros, suspect validation first.
- **Only `run()` receives `p`**: helper functions in pass WGSL must read the global `params` uniform (shared pass builders take `params.<name>` expressions).
- **WGSL cannot dynamically index an array held by value** (e.g. the `p` parameter). Index through the global `params` uniform instead (`params.kernel[n / 4][n % 4]`).
- **Multi-pass GPU filters round intermediates to f16**; anything that amplifies a difference (unsharp `amount`) amplifies that rounding, so its tolerance must grow with the gain.
- **Symmetric test kernels hide transposed indexing**: parity tests use an asymmetric kernel.
- **Workgroup memory and barriers are very slow on SwiftShader**: an "optimisation" built on them can be a large regression in CI and cloud sessions. Measure with `pnpm bench` before keeping it.
- **Hard contrast switches make T-junctions**, which non-maximum suppression breaks; Canny test images that need connected weak edges must fade contrast gradually.
- **Random-noise test images miss structure-dependent bugs** (hysteresis, gradient direction). Mutation-check new filters against the ring image too.
- **Do not judge the playground from a screenshot taken after a fixed timeout**: first-use shader compilation on SwiftShader takes seconds. Wait for `#status[data-frame]` to advance, as `scripts/smoke.mjs` does.
- **Resizing a canvas clears it.** The after canvas is resized only when a new frame is drawn, so the previous image stays up while a new one loads.
- **A filter's `id` is not unique**: two filter objects can share it. Anything cached per filter (shaders, Pipeline stages) keys on `objectKey(filter)` too.
- **Async loads in the playground must not overlap**: each destroys the previous textures. `loadImage` queues them and skips superseded ones; swap Pipeline sources before destroying old textures.
- **Integer-like object keys are reordered by JS** (`{ '5': …, '3': … }` iterates '3' first), so enum option keys must not be integer-like.
- **Allocating textures is expensive** (lazy zero-fill): get working textures from `createWorkingTexture` and give intermediates back with `releaseTexture`, never create one per iteration.
- **Browser-mode `console.log` does not reach the terminal** here; use `commands.writeFile` from `vitest/browser` (paths are relative to the repo root).
- **`sampleCurve` caches its LUT per points array**: never mutate a points array after sampling it (the curve editor samples a copy).
- **The registry parity test varies one param at a time**: interactions between params (curve order, combined settings) need a dedicated GPU test.
- **WGSL rejects mixing `&` / `|` with comparisons without parentheses** (`a <= k & k < b` does not compile): write `(a <= k) & (k < b)`. Like any shader error, it shows up as an all-zero output.
- **WGSL `round()` is round-half-to-even, `Math.round` is half-up.** Use `floor(x + 0.5)` on both sides when parity matters.
- **OKLab round trips leave float noise** (~1e-26 instead of 0): assert with a small epsilon, not `>= 0`.
- **Uint8ClampedArray needs `<ArrayBuffer>`** for `new ImageData(...)` under TS's typed-array generics; `readSrgb8` returns that type.
- **A LUT cannot follow the sRGB curve's kink at 0**: grades that push colours out of gamut (saturation boosts) interpolate poorly next to the gamut edge. Compare baked vs live chains as displayed (clipped) and on average, not by the worst pixel alone.
- **`convertToBlob` silently falls back to PNG** for a type the browser cannot encode (e.g. WebP in some browsers); `encodeSamples` checks `blob.type` and throws.
- **Replacing an SVG element while it is dragged drops its pointer capture**: the mask overlay updates attributes and rebuilds elements only when the mask kind changes.
- **UI modules that keep their own copy of shared state go stale** once a second editor exists (panel vs on-image handles): read the current state through a getter.
- **A mask outlives image changes** (normalised coordinates), so a raster can have another image's proportions: refit it (`fitRaster` / `resampleRaster`) before tools that need the image at the raster's size.
- **Playwright's `mouse.click` has no `modifiers` option** (only `page.click` does): hold keys with `keyboard.down` / `up`.
- **`pnpm bench` is not run in CI**: it broke silently when a mask-aware filter was registered. Run it after adding filters.
- **An e2e check can pass without exercising the path it is about**: e.g. preview-only reframing never runs on images ≤ 768 px (preview and display are the same texture). Mutation-check new smoke checks too.
- **Playwright clicks are too slow to provoke async races**: dispatch the events in one `page.$eval` task (as the wand-race check does).
- **A new frame is not proof the latest state is shown**: changes made while a frame is in flight coalesce into the next one. E2E checks of geometry wait for the expected result (sizes, pixels), not for a frame count.
- **Handles on the image edge are half clipped** by an `overflow: hidden` overlay: the crop / perspective overlay uses `overflow: visible`.
- **Playwright version must match the installed Chromium build** in cloud sessions (1.56.x ↔ chromium-1194), or it tries to download a browser.
