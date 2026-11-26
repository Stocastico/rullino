# RFC: colour management and a wide-gamut working space

> **Status: accepted (26 Nov 2026)**, issue [#181](https://github.com/Stocastico/rullino/issues/181), part of 0.9 ([#167](https://github.com/Stocastico/rullino/issues/167)). The maintainer's answers are in §9, and the text below already follows them.

## 1. Problem

rullino reads 8-bit sRGB and writes 8- or 16-bit sRGB. Colour outside sRGB is lost before the first filter runs:

- **The browser** decodes with `createImageBitmap(file, { colorSpaceConversion: 'default' })`, which converts to sRGB and clips.
- **sharp** decodes with `.toColourspace('srgb')` to 8 bits, which also clips.

The losses are real:

- **Phone photos.** Every recent iPhone and many Android phones write Display P3 JPEGs and HEICs. A saturated red or green in them is outside sRGB.
- **Camera exports.** Adobe RGB is a common setting.
- **Precision.** 16-bit PNG and TIFF lose half their bits before the first filter runs.
- **Profile tags.** After #180, `render()` copies the source's ICC profile into the export. That is only correct because nothing converts the pixels. Once pixels are converted, the embedded profile has to describe the *output*.

## 2. Goals and non-goals

Goals:

- **Embedded profiles are honoured.** Matrix/TRC profiles (ICC v2 and v4) are converted into the working space when an image is read. This covers sRGB, Display P3, Adobe RGB, Rec. 2020, ProPhoto, camera and phone profiles, and grey.
- **Wide colour survives the pipeline.** It is written out as sRGB, Display P3, Adobe RGB or Rec. 2020, with the profile embedded in the file.
- **The sRGB path stays bit for bit.** An sRGB document on an sRGB (or untagged) 8-bit image renders exactly what it renders today. A golden test pins every look and every filter (at its preview params) on the CPU, as hashes written before any of this was built; the GPU follows through the parity suite, whose sRGB path is unchanged.
- **Filters stay unchanged.** There is no per-filter colour-space switch and no second copy of every constant.

Non-goals (now):

- **LUT-based ICC profiles** (A2B / B2A, `mft1` / `mft2` / `mAB`: CMYK and print profiles). They are read as sRGB, with a warning that says so. They come later.
- **Soft proofing, rendering intents other than relative colorimetric, and black point compensation.** Matrix/TRC profiles have no perceptual intent anyway.
- **Writing profiles other than the four output spaces.**
- **A colour-managed playground preview.** This is HDR / wide display, #182.

## 3. The working space: extended linear sRGB

The working space stays **linear sRGB primaries with D65 white**, but values outside [0, 1] are allowed: negative for colours outside the sRGB triangle, above 1 for light brighter than diffuse white. This is scRGB. It is also what a WebGPU canvas with `colorSpace: 'srgb'` and `toneMapping: { mode: 'extended' }` displays, which ties in with #182.

Why not Rec. 2020 or ACEScg primaries:

- **The perceptual tools come out the same.** OKLab is defined from XYZ, and its matrix from linear sRGB is exact for every value, negative ones included. The Rec. 709 luminance weights are likewise exact for any linear sRGB triple.
- **Mixing and blurring come out the same.** Exposure, mixes and convolutions are linear in RGB, so the result is the same in any set of primaries.
- **What does depend on the primaries** is per-channel operations: white balance gains, per-channel curves, the channel mixer, per-channel levels and gamma. In rullino they act on sRGB primaries, as they always have. That is a definition, not an error, and the filter reference says it.
- **Already in place.** `rl_srgb_to_linear`, `rl_linear_to_srgb`, `rl_cbrt` and their CPU twins are already mirrored for negative values. float16 holds ±65504.
- **What a Rec. 2020 working space would cost:** a space-dependent version of every OKLab and luminance constant, LUT domain and baked look, and a second parity suite. All of that would buy different numbers only for the per-channel tools.

What filters must do: produce finite values for finite input, negative input included (no `pow` of a negative, no `sqrt` of one). Where a filter defines its maths in [0, 1] (thresholds, levels clipping, LUTs), clipping or mapping into that range is its specification. §6 says which filters do what.

## 4. Input

`render()` in `@rullino/web` and `@rullino/node` decodes **PNG, JPEG and TIFF with `@rullino/codecs`**: the same pixels in every browser and in Node, and 16 bits kept. EXIF orientation is applied as an exact permutation of the pixels. Other formats still go through the browser's or sharp's decoder (8-bit sRGB, as today).

Then:

1. **No profile, or an sRGB profile, on 8 bits.** The image goes in as today, as `Rgba8Image`, decoded on the GPU or in the worker. Nothing changes.
   - "sRGB profile" means the profile's colorants are within 1e-4 of sRGB's (D50-adapted with Bradford) and every TRC is within half an 8-bit step of the sRGB curve.
   - That test accepts the common sRGB profiles (IEC 61966-2.1, Apple's, Google's, Facebook's compact one).
2. **A matrix/TRC or grey profile.** Each channel is decoded through its TRC (`curv` as identity, gamma or table; `para` of types 0–4) to linear values in [0, 1]. Then `M = XYZ(D50) → linear sRGB · [rXYZ gXYZ bXYZ]` gives linear sRGB, possibly out of [0, 1]. This is relative colorimetric, as in littleCMS for a matrix-shaper profile in floating point, which does not clip.
   - Grey profiles use `kTRC` and put the value on all three channels.
   - The result is a `LinearImage` (`Float32Array`), premultiplied.
3. **A profile that cannot be used** (LUT-based, CMYK, Lab, broken). The pixels are treated as sRGB and the renderer reports a warning (`onWarning` / the CLI's stderr). It never fails.

16-bit sRGB images take path 2 with the sRGB TRC, so their 16 bits reach the filters.

## 5. Output

The document's `output` gains two fields:

```json
{ "output": { "format": "jpeg", "colorSpace": "display-p3", "gamut": "map" } }
```

- **`colorSpace`**: `'srgb'` (default), `'display-p3'`, `'adobe-rgb'` or `'rec2020'`. It sets the primaries and the transfer function of the samples written:
  - sRGB and Display P3 use the sRGB curve.
  - Adobe RGB uses gamma 563/256.
  - Rec. 2020 uses the BT.2020 / BT.709 curve.
- **`gamut`**: `'map'` or `'clip'`. It says what happens to colours the output space does not contain.
  - `'clip'` clamps each channel to [0, 1], which is today's behaviour.
  - `'map'` is the CSS Color 4 gamut-mapping algorithm in OKLCh: binary search on chroma at constant L and h, with the local MINDE test (JND 0.02, ε 0.0001). L ≥ 1 maps to white and L ≤ 0 to black.
- **The default for `gamut`** is `'map'` when the source had a non-sRGB profile or `colorSpace` is not `'srgb'`, and `'clip'` otherwise. An sRGB document on an sRGB image therefore writes exactly what it writes today. That case is the golden test.
- **The embedded profile describes the samples written.**
  - For `colorSpace: 'srgb'`, the source's own sRGB profile is kept as it is (as since #180). If the source had none, none is written.
  - Every other case gets a small matrix/TRC profile written by rullino (ICC v2.4: `desc`, `cprt`, `wtpt`, colorants, TRCs). littleCMS reads it back in the tests.
  - The `'strip'` metadata policy keeps it, for the same reason it keeps ICC today: it says how to read the pixels.

`apply()` and `pixels()` return the working space (linear) or 8-bit sRGB, as today. Colour spaces are an export concern.

## 6. Filters and the audit

| Assumption | Where | With extended values |
|---|---|---|
| Rec. 709 luminance weights | `rl_luminance`, histogram, grain, colour mixer, threshold family | Exact for linear sRGB at any value; no change. |
| OKLab matrices | `oklab.ts`, `wgsl.ts`; brightness, contrast, saturation, vibrance, hue, colour mixer / grading, black point, shadows / highlights, equalize, CLAHE, bilateral | Exact (OKLab is defined from XYZ); `rl_cbrt` is signed. No change. |
| sRGB-encoded "perceptual levels" | levels, curves, invert, posterize, threshold, dither, halftone, ascii, gradient map, sketch, emboss, Canny… | The mirrored sRGB curve is continuous through 0. Clipping filters clip as specified, and the others stay finite. A test checks this for every filter. |
| Per-channel power | gamma | `pow(negative)` is NaN on the GPU: mirrored, like the sRGB curve. |
| LUT domain [0, 1]³ | `applyLut`, baked looks, `.cube` export | A colour with a negative channel is **gamut-mapped into sRGB (OKLCh) before the lookup**. Values that are only above 1 are clamped as today, so sRGB documents do not change. Intensity 0 remains an exact no-op. |
| Looks baked for sRGB | `presets` | Through `applyLut`: as above. |

The parity suite gains a **wide-gamut image**: Display P3 and Rec. 2020 primaries and ramps converted to linear sRGB, so they have negative channels and channels above 1. Every filter runs on it at defaults and extremes, CPU against GPU, and a test fails on any NaN or ±Infinity.

## 7. API (proposal)

- **Core:**
  - `parseIcc(bytes) → IccProfile`: `{ kind: 'matrix-trc' | 'gray' | 'unsupported', reason?, description, toLinearSrgb (Mat3), curves }`.
  - `isSrgbProfile(profile)`.
  - `profileImage(samples, profile) → LinearImage`: 8- or 16-bit straight RGBA in, linear premultiplied out.
  - `outputProfile(colorSpace) → Uint8Array`, the ICC bytes.
  - `gamutMap(rgb, space)`.
  - `exportSamples(img, { colorSpace, gamut })` (internal).
  - `OutputSettings.colorSpace` / `.gamut` in the parser and the JSON Schema.
- **`@rullino/codecs`:** `orient(image, orientation)`, the exact EXIF rotation and flip.
- **Renderers:** `render()` as in §4 and §5, plus `onWarning`.

## 8. Tests (written before the code)

- **The parser against littleCMS** (`transicc` in floating point, unbounded) on:
  - real profiles: sRGB and "compatible with Adobe RGB (1998)" from icc-profiles-free (zlib licence), the grey profiles, and an L\* TRC profile;
  - profiles written by the test fixture script: Display P3 and Rec. 2020; v2 and v4; `para` types 0–4; table curves.
  - The criterion: |Δ| ≤ 1e-5 on a grid of inputs.
- **Our output profiles read back by littleCMS** give the conversion we computed.
- **Golden** (`packages/presets/src/golden-srgb.test.ts`, written first): every look and every filter at its preview params, sRGB in and sRGB out, renders bit for bit what the previous version rendered (the linear result, its 8- and 16-bit samples, a JPEG's flattened samples).
- **A Display P3 JPEG** keeps a P3 red through the pipeline: exported as `display-p3` it comes back at its P3 values within 8-bit rounding, and exported as sRGB with `'map'` it has the same hue in OKLCh (Δh < 2°).
- **Gamut mapping:**
  - in-gamut colours are unchanged, bit for bit;
  - the result is in gamut;
  - L and h are kept within the algorithm's JND;
  - CPU and GPU agree (for `applyLut`).
- **Filters on the wide-gamut image:** finite everywhere; GPU and CPU agree within each filter's tolerance.
- **Mutation checks:** of the matrices (transposed, wrong white), of the TRC types and of the sRGB detection.

## 9. Decisions of the maintainer (26 Nov 2026)

1. **Working space:** extended linear sRGB, as in §3, not an optional Rec. 2020 or ACEScg space.
2. **Gamut mapping:** OKLCh (CSS Color 4), `output.gamut: 'map' | 'clip'`. To keep the sRGB path bit for bit, `'map'` is the default only when the source or the output is not sRGB (§5).
3. **ICC in 0.9:** matrix/TRC and grey. LUT-based profiles are read as sRGB with a warning and come later.
4. **`.cube` and looks:** colours outside sRGB are gamut-mapped into sRGB before the lookup (§6).
5. **Input:** `render()` decodes PNG, JPEG and TIFF with `@rullino/codecs` (16 bits, ICC, orientation). Other formats keep the browser's or sharp's decoder.
