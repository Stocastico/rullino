# Concepts

The few ideas that explain how rullino behaves. Read this once; the rest of the documentation assumes it.

## An edit is data

rullino does not give you "a function that blurs an image". It gives you an **edit document**: JSON that lists filters and their parameters in order, with optional masks, a crop and export settings (see [the edit document](./edit-document.md)). Everything else follows from that choice:

- the **same document** is rendered by the browser (WebGPU, or the CPU in a worker), by Node (the same shaders through Dawn, or the CPU) and inside a Konva canvas;
- it can be **stored** next to a photo, put in a **link**, sent in an API request, diffed, versioned, and replayed years later;
- a UI can be **generated** from the filters' schemas (the [playground](https://stefanomasneri.com/rullino/) is), and a document can be **validated** before any pixel is touched.

You can still drive filters directly from code (`Pipeline` on the GPU, `runChainCpu` on the CPU, see [`@rullino/core`](../packages/core/README.md)); documents are what the renderers use.

## Two implementations of every filter

Each filter exists twice: a **WGSL compute shader** (fast, runs on the GPU) and a **plain TypeScript function** (the *reference*: obvious, unoptimised, never mutates its input). The reference is the specification. Tests run both on the same inputs, at the default parameters and at the extremes of every parameter, and fail if they differ by more than the filter's declared tolerance. A third implementation, an optional faster CPU path, is held to the reference in the same way.

This is what makes "preview in the browser, render on the server" a claim you can check rather than hope for.

## "The same" means "within a published tolerance"

GPU and CPU do **not** produce identical bytes. The GPU keeps intermediate images in 16-bit floats; the CPU uses 32-bit floats, so rounding differs, and filters with hard decisions (thresholds, Canny's hysteresis, halftone dots) can flip a few pixels. Each filter therefore declares a tolerance (absolute, relative, and sometimes an allowed fraction of outlier pixels), and the [parity table](./parity.md) lists all of them, generated from the numbers the tests use.

What you can rely on:

- the browser's GPU, the browser's CPU fallback and the Node renderer agree **within those tolerances** (CI renders every built-in look and mixed edits on Chromium's WebGPU and on Dawn in Node and compares them);
- the CPU path is deterministic, and with several threads it gives exactly the bytes of one thread (tests compare them bit for bit);
- a different GPU or driver can differ more than the software renderers CI uses. The parity table says which filters have a looser bound on real hardware; `pnpm report:parity` in the repository measures your machine.

What you should not assume: bit-identical files across backends. If you need a pixel-exact guarantee (for example, to hash outputs), pin one backend on one machine.

## Colour: linear, premultiplied, converted at the edges

Pictures enter as 8-bit sRGB (what browsers and decoders give), are converted to **linear light with premultiplied alpha**, and are processed as 16-bit floats on the GPU (32-bit on the CPU). They return to sRGB only when they are shown or encoded. Working in linear light is why blurs, resizes and blends do not darken edges the way canvas filters do; perceptual adjustments (contrast, saturation, curves, vibrance) work in OKLab or in sRGB-encoded units, where people judge tone. Values above 1 (HDR headroom) survive between steps and are clipped only at export.

Not covered yet: 16-bit or HDR *input* files (decoding gives 8 bits). 16-bit PNG *output* is supported.

## Pixel sizes and `scale`

Parameters measured in pixels (a blur `sigma`, the grain `size`) are defined on the **full-resolution original**. To preview quickly you render a smaller copy and tell the renderer its `scale` (for example `0.25` for a quarter-size copy); the lengths shrink with it, so the preview looks like the export. Without `scale`, a 40 px blur on a 400 px thumbnail would be ten times too strong.

## Geometry first, then steps

Crop, turn, flip, straighten and perspective belong to the document's `geometry`, not to a step: they are applied to the photo *before* the chain (as Lightroom does), so the steps and their masks see the framed picture. Export `longSide` is applied *after* the chain.

## Masks

A mask limits one step to part of the picture: `out = mix(before, after, mask)`. Masks are linear gradients, ellipses or painted rasters, in coordinates normalised to the image, so they survive any resolution.

## The pipeline is incremental

On the GPU, consecutive pointwise filters (exposure, contrast, curves, ...) are fused into **one shader**, and a `Pipeline` caches the result after every stage keyed on everything before it. Moving a slider re-uploads a few bytes of parameters, never recompiles, and recomputes only from the changed step onwards. In practice: build the renderer or pipeline **once** and keep it; creating one per edit throws the caches away.

## Where the time goes

- **GPU**: the compute for a typical chain is small; most of the latency of a preview is reading the pixels back for a canvas (about 25 ms at 12 MP on an RTX 40-class GPU, measured). The first use of a filter compiles its shader (tens to hundreds of milliseconds).
- **CPU fallback**: a 1 MP preview takes a few hundred milliseconds; a 12 MP chain a few seconds, less with `threads` (the image is cut into bands rendered in parallel, with identical output). Render previews at reduced size with `scale`.
- **Node on Dawn**: about a second for common 12 MP chains on 4 cores with a software Vulkan driver, faster on a GPU. Create the renderer once at start-up.

[`apps/bench`](../apps/bench) compares rullino with PixiJS filters, Photon and wasm-vips on the same chains; the numbers in the repository come from real hardware and the losses are published with the wins.

## What rullino is not

- Not an editor: there is a playground and the pieces to build one, but no layers, text, drawing tools or accounts.
- Not a video library (frame input is not supported).
- Not a computer-vision toolbox: the classical operations are there because they are image filters (edges, thresholds, morphology), but there is no feature detection or tracking.
- Not a server that stores your photos: everything runs in the process you start.

## Where to go next

- Choose your integration: [Getting started](./getting-started.md).
- Write or read documents: [the edit document](./edit-document.md).
- Something not working: [Troubleshooting](./troubleshooting.md).
