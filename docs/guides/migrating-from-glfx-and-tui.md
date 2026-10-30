# Migrating from glfx.js and tui.image-editor

Both libraries apply filters one after the other to a canvas. rullino describes the same thing as an ordered list of steps in a JSON document, renders it on WebGPU (or on the CPU in a worker), and can replay it on a server. This page maps their filters to rullino's and lists what has no counterpart. It was written against the [glfx.js documentation](https://evanw.github.io/glfx.js/docs/) and the source of tui.image-editor's filter menu (a fabric.js editor).

Read the mappings as "the same job", not "the same numbers". rullino works in linear light and does its perceptual adjustments (contrast, brightness, saturation, vibrance) in OKLab; both libraries add and multiply on the encoded RGB values. Start at the same position of the slider, then adjust by eye. The same goes for pixel-sized parameters: in rullino they are defined on the full-resolution photo and scaled for previews (`scale`), so a blur radius means the same on a thumbnail and on the export.

## The shape of the code

glfx: draw a texture, chain filters, `update()`. tui: `applyFilter(type, options)` per filter. In rullino the chain is data, and rendering is a separate step:

```ts
import { serializeChain } from '@rullino/core';
import { brightness, contrast, grayscale, hue, pixelate, saturation, vignette } from '@rullino/filters';

// glfx:  canvas.draw(texture).brightnessContrast(0.1, 0.2).hueSaturation(0.1, 0.3).update();
export const fromGlfx = serializeChain([
  { filter: brightness, params: { amount: 0.1 } },
  { filter: contrast, params: { amount: 0.2 } },
  { filter: hue, params: { degrees: 0.1 * 180 } }, // glfx hue: -1…1 is ±180°
  { filter: saturation, params: { amount: 0.3 } },
]);

// tui:   imageEditor.applyFilter('Pixelate', { blocksize: 8 }); imageEditor.applyFilter('Grayscale');
export const fromTui = serializeChain([
  { filter: pixelate, params: { size: 8 } },
  { filter: grayscale },
]);

// glfx: canvas.vignette(size, amount): the closest step is a vignette with a negative amount (darkening).
export const vignetted = serializeChain([{ filter: vignette, params: { amount: -0.4, midpoint: 0.5 } }]);
```

Render the document with [`@rullino/web`](./preview-and-export.md) in the browser, or with [`@rullino/node`](./same-edit-on-the-server.md) on a server. Check the direction of `hue` against your old output: the angle matches glfx's, but glfx rotates RGB around the grey axis and rullino rotates OKLab, so the colours land close, not identical.

## glfx.js

| glfx.js | rullino | Notes |
|---|---|---|
| `brightnessContrast(brightness, contrast)` | `brightness` + `contrast` (`amount`, −1 … 1) | Two steps. Contrast pivots on 18% grey. |
| `hueSaturation(hue, saturation)` | `hue` (`degrees`) + `saturation` (`amount`) | glfx `hue` × 180 gives degrees. |
| `vibrance(amount)` | `vibrance` (`amount`) | Both leave saturated colours alone. |
| `curves(red, green, blue)` | `curves` (`rgb`, `red`, `green`, `blue` curves) | Points in [0, 1] as in glfx; rullino uses a monotone spline (no overshoot). One curve for all channels is `rgb`. |
| `unsharpMask(radius, strength)` | `unsharpMask` (`sigma`, `amount`) | `sigma` is the blur size in pixels. `sharpen` is the quick version. |
| `triangleBlur(radius)` | `gaussianBlur` (`sigma`) or `boxBlur` (`radius`) | A Gaussian is the smoother choice. |
| `denoise(exponent)` | `bilateral` (`sigmaSpace`, `sigmaRange`) or `median` | Edge-preserving smoothing. |
| `noise(amount)` | `grain` (`amount`, `size`, `seed`) | Grain is weighted to the midtones, like film. |
| `vignette(size, amount)` | `vignette` (`amount`, `midpoint`, `feather`, `roundness`) | `size` is closest to `midpoint`; a negative `amount` darkens. |
| `lensBlur(radius, brightness, angle)` | `lensBlur` (needs a depth map) | rullino's is a depth-driven blur, not a uniform bokeh: [estimate the depth](../../packages/ml/README.md) first. |
| `colorHalftone(…)` / `dotScreen(…)` | `halftone` (`mode: 'cmy'` / `'mono'`, `size`, `angle`) | Printed dots rather than sine patterns; also hex grids and ring or square dots. |
| `edgeWork(radius)` / `ink(strength)` | `gradient`, `canny`, `sketch` | No exact twin. `sketch` is the pencil-line look. |
| `matrixWarp(…)` / `perspective(…)` | Geometry (rotate, flip, straighten, crop, perspective) | Not a step: [geometry](../../packages/core/README.md) frames the photo before the steps. |

No rullino counterpart: `sepia` (build one with `gradientMap` or take a look from `@rullino/presets`), `tiltShift`, `zoomBlur`, `hexagonalPixelate`, `bulgePinch`, `swirl`. New filters are frozen until the project's week-16 review (see PLAN.md), so do not wait for these.

## tui.image-editor

tui's filter menu has Grayscale, Invert, Sepia, Blur, Sharpen, Emboss, RemoveWhite, Brightness, Noise, Pixelate, ColorFilter, Tint, Multiply and Blend (and its code also names Vintage, Polaroid, Contrast, Saturation, Hue and Gamma).

| tui.image-editor | rullino | Notes |
|---|---|---|
| `Grayscale` | `grayscale` | `method` and `amount` too. |
| `Invert` | `invert` | |
| `Sepia` | `gradientMap` or a look | No sepia filter. |
| `Blur` (`blur`) | `gaussianBlur` (`sigma`, px) | tui's value is relative (its slider starts at 0.1), not a size in pixels; rullino's `sigma` is in pixels. |
| `Sharpen` | `sharpen` (`amount`) | |
| `Emboss` | `emboss` (`angle`, `strength`, `distance`, `mode`) | |
| `Brightness` (`brightness`, −1 … 1) | `brightness` (`amount`, −1 … 1) | Same range, different colour space. |
| `Noise` (`noise`, 0 … 1000) | `grain` (`amount`, 0 … 1) | tui's range is not a fraction: scale by eye. |
| `Pixelate` (`blocksize`, 2 … 20) | `pixelate` (`size`, px) | Same unit; rullino goes to 128. |
| `Contrast`, `Saturation`, `Hue`, `Gamma` | `contrast`, `saturation`, `hue`, `gamma` | |
| `Vintage`, `Polaroid` | a look from `@rullino/presets` | Ten looks, adjustable steps. |
| `RemoveWhite`, `ColorFilter` | none | Remove a background with a mask and `transparency` (magic wand or the Object tool in the playground). |
| `Tint`, `Multiply`, `Blend` | none | Blend modes are a candidate for later. `gradientMap` recolours by brightness. |

Everything else in tui (crop, rotate, flip, draw, shapes, text, icons) is editor UI, and rullino has none of it. It has the image processing part and the geometry (crop, rotate, flip, straighten, perspective), not an editor. If you need the editing UI around it, keep your editor and swap the filter engine: render the preview with `@rullino/web` and draw it into your canvas, or use [`@rullino/konva`](../../packages/konva/README.md) on a Konva stage.

## What you gain, and what you give up

- You gain: a document you can store, send and replay on a server; masks and selections per step; looks as LUTs; a CPU fallback with a published GPU↔CPU tolerance ([parity table](../parity.md)); 16-bit PNG export; ML tools for object selection and removal.
- You give up: glfx's warps and WebGL 1 reach (rullino wants WebGPU, or the CPU worker), and tui's editor UI.

Every `ts` block on this page is type-checked against the sources by `pnpm typecheck`; the parameter names above come from the [filter reference](../filters.md), which is generated from the filters themselves.
