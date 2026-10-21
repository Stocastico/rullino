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
pnpm dev              # playground dev server
npx vitest run path/to/file.test.ts   # single file
```

## Layout

- `packages/core` — `LinearImage`, sRGB <-> linear, float16, `compareImages`, WebGPU context, rgba16float upload/readback, pointwise runner, filter contract (`filter.ts`).
- `packages/filters` — one directory per filter: `index.ts` (schema + WGSL + CPU), `*.test.ts` (CPU, Node), `*.browser.test.ts` (parity, browser).
- `apps/playground` — Vite site; consumes packages through their public `index.ts` only.

## Rules

- **Red/green.** Write the test first, run it, see it fail, then implement. For GPU code, also check that the parity test catches a deliberately broken shader before trusting it.
- **Every filter ships with both implementations and a parity test.** The CPU version is the specification: obvious, unoptimised, never mutates its input.
- **Working space is linear, premultiplied RGBA, `rgba16float` on GPU / `Float32Array` on CPU.** sRGB exists only at the I/O edges. Filters that need straight alpha (LUTs, curves, OKLab) must un-premultiply internally.
- **Pointwise WGSL is a pure function** `fn apply(c: vec4f, p: Params) -> vec4f`; no bindings, no globals, no `Params` declaration (it is generated from the schema). This is what lets M2 fuse consecutive pointwise filters into one shader.
- **Zero runtime dependencies** in `packages/*`.
- Parity tests feed CPU and GPU the same **float16-quantised** input, so the tolerance only covers output rounding and math differences. Use odd image sizes to exercise workgroup bounds and row padding.
- Commit small and often; run `pnpm typecheck && pnpm test:all` before pushing.
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
| `shader-f16` not required | Textures are rgba16float but shaders compute in f32; SwiftShader does not expose `shader-f16`. |

## Traps

Things that already bit us. Add new ones as they come up.

- **`navigator.gpu` needs a secure context.** In Chromium, `about:blank` and plain-HTTP non-localhost pages have no `navigator.gpu` even with `--enable-unsafe-webgpu`. Vitest serves from localhost, which counts as secure.
- **Headless Chromium needs `--enable-unsafe-webgpu`** to expose WebGPU; without it `requestAdapter()` returns null. Set in `vitest.config.ts`.
- **`copyTextureToBuffer` needs `bytesPerRow` to be a multiple of 256**; `writeTexture` does not. `readImage` pads and un-pads rows; test with odd widths.
- **Compute dispatch rounds up to whole workgroups**, so shaders must bounds-check `global_invocation_id` against `textureDimensions`. Test with sizes that are not multiples of 8.
- **Parity tests must quantise the input to float16 first**, otherwise the tolerance has to absorb input rounding too and stops catching real bugs.
- **Check that a parity test can fail**: break the shader slightly (e.g. scale by 1.002) and confirm it goes red before trusting it.
- **Playwright version must match the installed Chromium build** in cloud sessions (1.56.x ↔ chromium-1194), or it tries to download a browser.
