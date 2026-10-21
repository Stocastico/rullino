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
pnpm dev              # playground dev server
npx vitest run path/to/file.test.ts   # single file
```

## Layout

- `packages/core`
  - `params.ts` parameter schema (float/int/bool/enum/kernel, optional `unit: 'px'`): types, validation, defaults, `scaleParams`, uniform layout/packing, generated WGSL `Params` struct.
  - `filter.ts` / `define.ts` filter contracts and `defineFilter()`: `pointwise` (CPU reference derived from `pixel()`) and `multipass` (fixed list of passes + whole-image CPU reference).
  - `color.ts`, `oklab.ts` CPU colour maths; `wgsl.ts` the `rl_*` WGSL twins prepended to every shader.
  - `gpu/` context, rgba16float upload/readback, `importImage` / `encodeToTexture` / `readSrgb8` (sRGB edges), area `downscale`, `runMultipass`, `runFilter` (any kind).
  - `pipeline/` `Step` chains: `fuse.ts` (namespacing + fused shader), `pipeline.ts` (cached incremental `Pipeline`), `chain.ts` (`runChainCpu` reference).
  - `resize.ts` CPU area downscale and `fitWithin`.
- `packages/filters` — one directory per filter: `index.ts` (schema + WGSL + CPU reference) and `*.test.ts` (CPU semantics). `convolution.ts` holds shared CPU convolution code and WGSL pass builders. `index.ts` at the root is the registry; `parity.browser.test.ts` checks every registered filter GPU <-> CPU at defaults and parameter extremes.
- `apps/playground` — Vite site; consumes packages through their public `index.ts` only. `controls.ts` generates the parameter UI from a schema; `chain-ui.ts` is the chain editor; `scripts/smoke.mjs` is the e2e smoke test.

## Rules

- **Red/green.** Write the test first, run it, see it fail, then implement. For GPU code, also check that the parity test catches a deliberately broken shader before trusting it.
- **Every filter ships with both implementations, CPU semantics tests, and is registered** in `packages/filters/src/index.ts` (which gives it the parity test). The CPU version is the specification: obvious, unoptimised, never mutates its input.
- **Every parameter has a `label`** (the registry test enforces it); the UI is generated from the schema.
- **Working space is linear, premultiplied RGBA, `rgba16float` on GPU / `Float32Array` on CPU.** sRGB exists only at the I/O edges. Filters that need straight alpha (LUTs, curves, OKLab) must un-premultiply internally.
- **Pointwise WGSL is a pure function** `fn apply(c: vec4f, p: Params) -> vec4f`; no bindings, no globals, no `Params` declaration (it is generated from the schema). This is what lets consecutive pointwise filters fuse into one shader.
- **Multipass pass WGSL** defines `fn run(xy: vec2i, p: Params) -> vec4f` and reads inputs only through the generated `load_<input>(xy)` (clamp to edge). Pass lists are static: anything that varies with params goes in uniforms, so the shader cache keys stay `filter:pass`. Iteration goes through `repeat: '<int param>'` (ping-pong on `inputs[0]`), never through a params-dependent pass list.
- **Reductions** (histograms, global statistics) use filter `buffers` (zeroed `array<atomic<u32>, N>`) and `kind: 'compute'` passes (`dispatch: 'pixels'` or `'single'`); store floats with `bitcast<u32>`.
- **Filters with hard decisions** (thresholds, comparisons) mirror the GPU's f16 intermediates in their CPU reference (round each intermediate image) and may declare a small `tolerance.outliers` fraction. Measure the actual outliers before choosing it.
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
| Playground: display ≤ 2048 px, preview ≤ 768 px while dragging | Two Pipelines with their own caches; release re-renders at display size. Full-resolution export is M3. |
| `multipass` filter kind = static list of named passes over textures | Covers convolutions, edges, morphology without a general graph language; each multipass filter is its own Pipeline stage, so the stages before it are reused when something after it changes. Workgroup-memory tiling is a later optimisation; correctness first. |
| Convolutions work on premultiplied linear values with clamp-to-edge | Blurring premultiplied light is physically right and avoids dark fringes at alpha edges. Sharpening touches colour only (alpha kept) and floors colour at 0. |
| Unsharp mask has no threshold (yet) | A hard threshold makes GPU (f16 intermediates) and CPU (f64) disagree on pixels near it; add a soft one later. |
| Custom kernel is always 5×5 | One shape in the schema and UI; a 3×3 kernel is the centre of the grid. |
| Canny hysteresis = fixed number of 8-connected propagation rounds (`iterations` param) | Exact GPU/CPU parity and a static pass list; enough rounds equal full hysteresis. A convergence check (atomics) can cut the passes later. |
| Canny thresholds on |∇|/4 of sRGB-encoded luminance, 45° directions without atan2 | Perceptual edges; comparing |gy| with tan(22.5°)|gx| gives identical sectors on CPU and GPU. NMS uses `>=` on one side and `>` on the other so a symmetric ridge stays one pixel wide. |
| Parity suite runs every filter on random noise *and* a ring image with fading contrast | Noise never produces connected weak edges or smooth gradients; a "hysteresis runs once" mutation passed on noise alone. |
| Reductions via storage buffers + compute passes inside the multipass model | Otsu needs histogram -> threshold -> apply; keeping it inside one filter means the Pipeline needs no new stage type. Buffers are recreated per run (WebGPU zero-fills new buffers). |
| Explicit bind group layouts for multipass passes | `layout: 'auto'` drops bindings the shader never reads; an input declared but unused then made the bind group invalid. |
| Otsu on a 256-bin histogram of perceptual luminance of the straight colour, transparent pixels skipped | Matches `threshold`'s units; transparent areas would otherwise drag the threshold to black. Ties keep the first maximum on both sides. |
| Adaptive threshold = luminance > Gaussian local mean − C (OpenCV's ADAPTIVE_THRESH_GAUSSIAN_C) | Familiar semantics; σ is a px param so it scales with previews. |
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
- **WGSL cannot dynamically index an array held by value** (e.g. the `p` parameter). Index through the global `params` uniform instead (`params.kernel[n / 4][n % 4]`).
- **Multi-pass GPU filters round intermediates to f16**; anything that amplifies a difference (unsharp `amount`) amplifies that rounding, so its tolerance must grow with the gain.
- **Symmetric test kernels hide transposed indexing**: parity tests use an asymmetric kernel.
- **Random-noise test images miss structure-dependent bugs** (hysteresis, gradient direction). Mutation-check new filters against the ring image too.
- **Do not judge the playground from a screenshot taken after a fixed timeout**: first-use shader compilation on SwiftShader takes seconds. Wait for `#status[data-frame]` to advance, as `scripts/smoke.mjs` does.
- **Resizing a canvas clears it.** The after canvas is resized only when a new frame is drawn, so the previous image stays up while a new one loads.
- **A filter's `id` is not unique**: two filter objects can share it. Anything cached per filter (shaders, Pipeline stages) keys on `objectKey(filter)` too.
- **Async loads in the playground must not overlap**: each destroys the previous textures. `loadImage` queues them and skips superseded ones; swap Pipeline sources before destroying old textures.
- **Integer-like object keys are reordered by JS** (`{ '5': …, '3': … }` iterates '3' first), so enum option keys must not be integer-like.
- **WGSL `round()` is round-half-to-even, `Math.round` is half-up.** Use `floor(x + 0.5)` on both sides when parity matters.
- **OKLab round trips leave float noise** (~1e-26 instead of 0): assert with a small epsilon, not `>= 0`.
- **Uint8ClampedArray needs `<ArrayBuffer>`** for `new ImageData(...)` under TS's typed-array generics; `readSrgb8` returns that type.
- **Playwright version must match the installed Chromium build** in cloud sessions (1.56.x ↔ chromium-1194), or it tries to download a browser.
