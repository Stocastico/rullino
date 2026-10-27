# GPU ↔ CPU parity

51 filters. Generated from the filters' tolerances (`packages/filters`): do not edit by hand; `npx vitest run packages/filters -u` rewrites it.

Every filter has two implementations: a WGSL compute shader (GPU) and a plain TypeScript reference (CPU), which is the specification. They do not produce identical numbers (the GPU keeps intermediate images in float16 and its maths functions differ slightly), so each filter declares how far apart they may be, and CI checks it on every change. This table is that declaration.

**What is checked.** For every channel of every pixel, in linear light (0 = black, 1 = white, values above 1 are HDR): `|gpu − cpu| ≤ abs + rel · |cpu|`. *At 1.0* is the resulting allowance for a full-white channel. *Outliers* is the fraction of channels allowed to exceed that: only filters with hard decisions (thresholds, comparisons, cell or glyph choices) have one, because a float16 intermediate can flip a pixel that sits right on the decision.

**On what.** Two odd-sized images (random noise with transparent and HDR pixels; concentric rings with fading contrast), both quantised to float16 first so CPU and GPU read the same input, at the default parameters and at the extremes of every parameter (every option, an asymmetric kernel, a non-linear LUT). See `packages/filters/src/parity.browser.test.ts`. Chains add up their filters' tolerances.

For scale: one 8-bit step of sRGB output is about 0.0003 in linear light near black and 0.009 near white.

## Adjust (18)

| Filter | Kind | abs | rel | At 1.0 | Outliers |
|---|---|---|---|---|---|
| Exposure (`exposure`) | pointwise | 1e-7 | 0.000977 | 0.000977 | 0 |
| Contrast (`contrast`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Brightness (`brightness`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Black point (`blackPoint`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Shadows / highlights (`shadowsHighlights`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Curves (`curves`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Levels (`levels`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Equalise histogram (`equalize`) | multipass | 0.0002 | 0.002 | 0.0022 | 0 |
| CLAHE (local contrast) (`clahe`) | multipass | 0.0002 | 0.002 | 0.0022 | 0 |
| Gamma (`gamma`) | pointwise | 0.0001 | 0.002 | 0.0021 | 0 |
| Saturation (`saturation`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Vibrance (`vibrance`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Hue (`hue`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Colour mixer (`colorMixer`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Colour grading (`colorGrading`) | pointwise | 0.0002 | 0.002 | 0.0022 | 0 |
| Channel mixer (`channelMixer`) | pointwise | 0.001 | 0.002 | 0.003 | 0 |
| White balance (`whiteBalance`) | pointwise | 0.000001 | 0.000977 | 0.000978 | 0 |
| Transparency (`transparency`) | pointwise | 0.000001 | 0.000977 | 0.000978 | 0 |

## Look (4)

| Filter | Kind | abs | rel | At 1.0 | Outliers |
|---|---|---|---|---|---|
| LUT (`applyLut`) | multipass | 0.0002 | 0.002 | 0.0022 | 0 |
| Vignette (`vignette`) | multipass | 0.0001 | 0.00195 | 0.00205 | 0 |
| Grain (`grain`) | multipass | 0.0002 | 0.002 | 0.0022 | 0 |
| Gradient map (`gradientMap`) | pointwise | 0.0005 | 0.001 | 0.0015 | 0 |

## Classic (19)

| Filter | Kind | abs | rel | At 1.0 | Outliers |
|---|---|---|---|---|---|
| Grayscale (`grayscale`) | pointwise | 0.000001 | 0.000977 | 0.000978 | 0 |
| Invert (`invert`) | pointwise | 0.0001 | 0.002 | 0.0021 | 0 |
| Threshold (`threshold`) | pointwise | 0 | 0 | 0 | 0 |
| Otsu threshold (`otsu`) | multipass | 0 | 0 | 0 | 0.2% |
| Adaptive threshold (`adaptiveThreshold`) | multipass | 0 | 0 | 0 | 0.2% |
| Posterize (`posterize`) | pointwise | 0.0001 | 0.002 | 0.0021 | 0 |
| Gaussian blur (`gaussianBlur`) | multipass | 0.0001 | 0.00195 | 0.00205 | 0 |
| Box blur (`boxBlur`) | multipass | 0.0001 | 0.00195 | 0.00205 | 0 |
| Sharpen (`sharpen`) | multipass | 0.001 | 0.002 | 0.003 | 0 |
| Unsharp mask (`unsharpMask`) | multipass | 0.005 | 0.005 | 0.01 | 0 |
| Custom kernel (`convolve`) | multipass | 0.002 | 0.002 | 0.004 | 0 |
| Canny edges (`canny`) | multipass | 0 | 0 | 0 | 0.2% |
| Morphology (`morphology`) | multipass | 0.000001 | 0.000977 | 0.000978 | 0 |
| Median (`median`) | multipass | 0 | 0 | 0 | 0 |
| Bilateral (`bilateral`) | multipass | 0.001 | 0.002 | 0.003 | 0 |
| Remove (inpaint) (`inpaint`) | multipass | 0.002 | 0.004 | 0.006 | 0 |
| Remove object (`patch`) | multipass | 0.0002 | 0.002 | 0.0022 | 0 |
| Gradient (`gradient`) | multipass | 0.0005 | 0.001 | 0.0015 | 0 |
| Laplacian (`laplacian`) | multipass | 0.0005 | 0.001 | 0.0015 | 0 |

## Stylize (10)

| Filter | Kind | abs | rel | At 1.0 | Outliers |
|---|---|---|---|---|---|
| ASCII art (`ascii`) | multipass | 0.002 | 0.002 | 0.004 | 0 |
| Pixelate (`pixelate`) | multipass | 0.001 | 0.00195 | 0.00295 | 0 |
| Halftone (`halftone`) | multipass | 0.01 | 0.01 | 0.02 | 2% |
| Dither (`dither`) | multipass | 0.002 | 0.002 | 0.004 | 0.2% |
| Emboss (`emboss`) | multipass | 0.002 | 0.002 | 0.004 | 0 |
| Sketch (`sketch`) | multipass | 0.002 | 0.004 | 0.006 | 0 |
| Bloom (`bloom`) | multipass | 0.002 | 0.002 | 0.004 | 0 |
| Chromatic aberration (`chromaticAberration`) | multipass | 0.001 | 0.002 | 0.003 | 0 |
| Kuwahara (painterly) (`kuwahara`) | multipass | 0.002 | 0.002 | 0.004 | 0 |
| Lens blur (depth) (`lensBlur`) | multipass | 0.0003 | 0.001 | 0.0013 | 0 |
