# Handoff: next session (26 Nov 2026)

Branch `claude/nifty-faraday-7767og`, from `main` after PR #233 (#180) merged. **Delete this file before opening the PR.**

The user asked for #181 (colour management) and then #182 (HDR): one PR per issue, #181 first. The design is accepted: `docs/design/colour-management.md` (§9 has the maintainer's answers; read it first).

## Done (committed)

1. RFC doc + golden test `packages/presets/src/golden-srgb.test.ts`: hashes of the sRGB path, written **before** any change. It must never change; if it does, a change broke existing documents.
2. `packages/core/src/icc.ts`: `parseIcc` (matrix/TRC v2/v4, grey XYZ/Lab, curv/para 0-4, never throws), `profileImage` (8/16-bit straight RGBA → premultiplied extended linear sRGB), `isSrgbProfile`, `rgbToXyzD50`, `XYZ_D50_TO_LINEAR_SRGB`. Tests are against littleCMS (`packages/core/test/icc/make-icc-fixtures.py`, `reference.json`) and mutation-checked. Exported from the root (+ internal) and in `api.test.ts`.
3. Filters on colours outside sRGB: `wideImage()` in `packages/filters/src/test-utils.ts`, used by the GPU parity suite and `fast.test.ts`; `wide.test.ts` (every filter finite). colorMixer got `outliers: 0.002` (measured 0.12%, cancellation); `docs/parity.md` regenerated.

## In progress (step 4, last commit may be WIP)

- `packages/core/src/colour-space.ts`: `COLOR_SPACES`, `fromLinearSrgb` / `toLinearSrgb`, `encodeTransfer` / `decodeTransfer`, `gamutMapOklab` (CSS Color 4, checked against a Python port: `packages/core/test/gamut/make-gamut-reference.py`), `encodeColour`, `outputProfile(space)` (ICC v4.3, written by `writeIcc` in `icc.ts`; fixtures `test/icc/rullino-*.icc`, `RULLINO_WRITE_ICC=1` rewrites them; littleCMS reads them in `icc.test.ts`). Tests: `colour-space.test.ts` (26 passing).
  - A surviving mutant (`minInGamut = false` removed) is **equivalent**; that's fine.
- `packages/core/src/encode.ts`: `ExportOptions.colorSpace` / `.gamut`. `exportSamples` keeps the old sRGB path exactly for `srgb` + `clip` (the default); the others go through `encodeSpace`. `encodeImage` rejects non-sRGB (it writes no ICC).
- **Not done yet in step 4:**
  - [ ] Exports: add to `packages/core/src/index.ts` `export { COLOR_SPACES, outputProfile, type ColorSpace, type GamutMapping } from './colour-space';`. Add to `internal.ts` `decodeTransfer, encodeColour, encodeTransfer, fromLinearSrgb, gamutMapOklab, inGamut, linearSrgbTo, PRIMARIES, toLinearSrgb` and `writeIcc`. Update `packages/core/src/api.test.ts` (sorted lists).
  - [ ] Then `pnpm typecheck` and the core tests.
  - [ ] Edit document: `serialize.ts` `OUTPUT_KEYS` + `parseOutput` validation of `colorSpace` (one of `COLOR_SPACES`) and `gamut` ('map' | 'clip'); `edit.schema.json` (both output defs, near `bitDepth`/`embedEdit`), `edit-schema.test.ts`, `docs/edit-document.md`.
  - [ ] `applyLut` (filters/src/applyLut): a colour with a **negative** channel is gamut-mapped into sRGB (OKLCh) before the lookup, on CPU, fast path and WGSL (needs a WGSL twin of `gamutMapOklab` for sRGB, fixed loop). Colours only above 1 are clamped as today, so the golden test must not change. Parity + mutation check.
  - [ ] Commit.

## Step 5 (#181): renderers

- [ ] `@rullino/codecs`: `orient(image, orientation)` (exact EXIF rotate / flip of a `DecodedImage`), with tests.
- [ ] `render()` in `packages/web/src/renderer.ts` and `packages/node/src/renderer.ts`: PNG/JPEG/TIFF through `@rullino/codecs` `decode` (dynamic import, as `carryMetadata` already is) + EXIF orientation (`readMetadata`) + ICC:
  - no profile, or `isSrgbProfile`, on 8 bits → the old `Rgba8Image` path (bit-identical);
  - matrix/TRC / grey or 16-bit → `profileImage` → `LinearImage`;
  - unsupported profile → treat as sRGB + `onWarning` (CLI: stderr).
  - Other formats keep the browser / sharp decoders.
- [ ] Output: samples via `exportSamples(out, { ...output, gamut: output.gamut ?? (wideSource || space !== 'srgb' ? 'map' : 'clip') })`, encoded (node: sharp for JPEG/WebP, own PNG; web: `encodeSamples`). Embedded ICC = `outputProfile(space)` for non-sRGB. For sRGB: keep the source's sRGB profile, none if the source had none or was converted. That needs an `icc` override in codecs' `ExportMetadataOptions` / `carryMetadata` (policy.ts); 'strip' keeps it. Set EXIF ColorSpace (0xA001): 1 for sRGB, 0xFFFF otherwise (`editExif`).
- [ ] Tests: a Display P3 JPEG fixture (made with the new codecs encoder + `writeMetadata` icc, or Pillow) keeps a P3 red: exported as `display-p3` it comes back within 8-bit rounding; as sRGB with 'map', Δh < 2°. The 16-bit PNG keeps 16 bits. `browser-vs-node` still passes. Golden unchanged.
- [ ] CLI `--color-space`? (optional; the document's `output.colorSpace` already works.)
- [ ] Docs:
  - `docs/concepts.md` (working space)
  - `docs/edit-document.md`
  - `docs/troubleshooting.md`
  - CHANGELOG: Added; Changed: render() decodes PNG/JPEG/TIFF with codecs, 16-bit input kept, ICC converted
  - CLAUDE.md: Layout entries for `icc.ts` / `colour-space.ts` / the fixtures, a Decisions row, `colorjs.io` not added
  - size-budget.json if core grows (measure with `pnpm build && pnpm size`)
- [ ] Full checks (CLAUDE.md "Commands"):
  - `pnpm typecheck && pnpm test:coverage`
  - `pnpm build && pnpm test:e2e` plus `:cpu`, `:base`, `:tools`
  - `pnpm test:pack`
  - `pnpm build:docs`
- [ ] PR "Colour management (#181)", watch CI, merge when green with no open threads.

## Then #182 (HDR), its own PR

Issue text: OpenEXR (none / zip / piz) and Radiance `.hdr` decoders in codecs; 16-bit / float TIFF and PNG already decode, and they now reach the pipeline as `LinearImage` (from step 5); Ultra HDR / ISO 21496-1 gain maps (read: reconstruct HDR; write: an SDR base by tone map + gain map); HDR display in the playground (`toneMapping: { mode: 'extended' }`, the working space is already scRGB); tone-mapping filters with CPU references (filmic / AgX-like, local "brilliance"); tests: gain-map round trip, values > 1 survive (f16 max 65504). Propose a step plan to the user before starting; ask about gain-map write defaults.

## Environment notes

- Cloud Chromium shim before browser tests (CLAUDE.md Traps, Playwright 1.56 ↔ chromium-1243).
- **Fixture scripts:**
  - `make-icc-fixtures.py` needs `apt install liblcms2-utils icc-profiles-free`.
  - `make-gamut-reference.py` needs `pip install colour-science` (numpy).
- Adding the dev dependency `colorjs.io` was refused by the permission classifier; don't retry it, the Python port is the reference instead.
