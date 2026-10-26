---
name: add-filter
description: Recipe for adding an image filter to rullino (packages/filters) — CPU reference, WGSL, tests first, registry, GPU parity, mutation check, tolerances, bench and CLAUDE.md. Use whenever a new filter is created or an existing filter's maths changes.
---

# Adding a filter to rullino

Follow CLAUDE.md (Rules, Decisions, Traps); this is the order of work that has proven itself.

## 1. Decide the semantics before the code
- Which space? Perceptual tools (levels, posterize, halftone, dither, curves) work in **sRGB-encoded** units of the straight colour; physical ones (exposure, blur, bloom, means) in **linear premultiplied** light; hue / chroma tools in **OKLab / OKLCh**. Write the reason in the doc comment.
- Kind: `pointwise` (pure `fn apply(c: vec4f, p: Params) -> vec4f`, fuses with neighbours) unless the filter needs neighbours, position or reductions → `multipass` (static pass list, `fn run(xy: vec2i, p: Params) -> vec4f`, `load_<input>(xy)`, `size()`).
- Params: every one has a `label`; lengths in pixels are `unit: 'px'`; enums use non-integer-like keys; colours are `type: 'color'` (sRGB triple); long schemas get a `group` (tabs in the UI).
- Texts: the filter needs a `description`, a `tryThis` and a `description` on every param (the registry test enforces it). Check each claim against the code (direction of a slider, units, defaults) before committing; first drafts got a sign wrong twice.
- Avoid hard decisions (thresholds, argmin) where a smooth blend does the job: they cost parity outliers. If unavoidable, mirror the GPU's f16 intermediates in the CPU reference (`q16`).

## 2. Tests first (red)
Create `packages/filters/src/<id>/<id>.test.ts` with CPU semantics: identity at neutral params, the defining behaviour on a tiny synthetic image (`imageOf`, `px`, `at` from `../test-utils`), alpha handling (premultiplied, transparent pixels), `unit: 'px'` where relevant. Run it and see it fail.

## 3. Implement `packages/filters/src/<id>/index.ts`
- CPU reference first: obvious, unoptimised, never mutates its input. It is the specification.
- WGSL twin step by step; top-level `fn` / `const` at column 0 (fusion namespaces them); helpers read the global `params`, only `run()` gets `p`.
- WGSL gotchas that fail silently (all-zero output): `&` / `|` next to comparisons need parentheses; shift amounts must be `u32`; `round()` is half-to-even (use `floor(x + 0.5)` on both sides).

## 4. Register and check parity
- Add the import, the export and the entry at the end of `filters` in `packages/filters/src/index.ts`; add the id to the list in `registry.test.ts`.
- `npx vitest run --project browser packages/filters/src/parity.browser.test.ts -t "<id>"` (noise + ring images, each param at its extremes).
- Params that do nothing at their partners' defaults (e.g. a colour whose strength defaults to 0) are never exercised by the registry test: add a dedicated `<id>.browser.test.ts` with everything switched on.

## 5. Tolerance: measure, do not guess
Start with `{ abs: 1e-3, rel: 2e-3 }` and `outliers: 0`. If it fails, find out why (a throwaway browser test that writes GPU vs CPU values with `commands.writeFile`), fix real differences (sampling on exact pixel boundaries, f16 intermediates not mirrored), and only then widen — just above what you measured, with a comment saying why.

## 6. Mutation check (mandatory)
Break the shader slightly (a constant × 1.003, an offset, a threshold) and confirm parity goes red in most cases; restore and confirm green. A generous `outliers` allowance hides subtle mutations.

## 7. Finish
- `pnpm typecheck && pnpm test` and the filter's browser tests; `pnpm bench` (note the timing at 1024×768; slow filters go into Decisions as performance-review candidates).
- `pnpm build && pnpm test:e2e` (the smoke test chains every filter).
- CLAUDE.md: a Decisions row for any non-obvious choice (space, algorithm variant, tolerance) and a Traps entry for anything that bit you.
- Commit small: filter + tests, then registration / tolerance fixes.
