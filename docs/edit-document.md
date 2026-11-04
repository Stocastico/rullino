# The edit document

A rullino edit is a piece of JSON: the steps to apply, optionally a frame for the picture (crop, turn, perspective) and how to export the result. The same document is previewed in the browser, replayed in a worker or on a server, stored next to a photo, put in a link, and sent between languages. This page is the reference for the format. For the ideas behind it, read [Concepts](./concepts.md); for the filters that go in `steps`, the [filter reference](./filters.md).

- Current version: **2**. Version 1 documents (the same without `output`) are read and migrated.
- Machine-readable description: [`@rullino/core/edit.schema.json`](../packages/core/edit.schema.json) (JSON Schema 2020-12), for validating documents outside JavaScript. The schema covers the shape only; `parseChain` in `@rullino/core` is the authority, because it also knows the filters (ids, parameter ranges and types), that a perspective quad is convex and that a crop lies inside the frame.
- Documents are made by `serializeChain`, the playground (**Code** button, share links) or by hand, and rendered by `applyEdit` or by a renderer (`@rullino/web`, `@rullino/node`, `@rullino/konva`).

## A complete document

```json
{
  "version": 2,
  "steps": [
    { "filter": "exposure", "params": { "ev": 0.3 } },
    { "filter": "contrast", "params": { "amount": 0.15 } },
    { "filter": "vignette", "params": {} }
  ],
  "output": { "format": "jpeg", "quality": 0.9, "longSide": 2048 }
}
```

Order of work: **geometry** (if present), then **steps** in order, then the **`longSide` shrink**, then encoding as `output` says. The document never contains pixels (apart from raster masks), so it is small enough for a URL.

## `steps`

An array, possibly empty (a document with no steps renders the framed, resized original). Each step:

| Field | Type | Meaning |
|---|---|---|
| `filter` | string | The filter's id: `exposure`, `gaussianBlur`, `applyLut`... All ids are in the [filter reference](./filters.md). Unknown ids are an error. |
| `params` | object | The parameters that differ from the defaults. Leave a parameter out to get its default. Unknown parameter names are an error. |
| `enabled` | `false` | Only present to switch a step off; the step stays in the document but is skipped. |
| `mask` | object | Restricts the step to part of the picture, see [Masks](#masks). |

```json
{
  "version": 2,
  "steps": [
    { "filter": "gaussianBlur", "params": { "sigma": 4 }, "mask": { "kind": "radial", "center": [0.5, 0.5], "radius": [0.35, 0.25], "feather": 0.4, "invert": true } },
    { "filter": "grain", "params": {}, "enabled": false }
  ]
}
```

### Parameter values

| Parameter type | JSON | Notes |
|---|---|---|
| number (`float`, `int`) | `0.3` | Out-of-range numbers are **clamped** to the parameter's range; `int` is rounded. `NaN` and strings are errors. |
| `bool` | `true` | |
| `enum` | `"square"` | One of the listed option names. |
| `color` | `[r, g, b]` | Straight sRGB, each channel in [0, 1] (what a colour picker shows). |
| `curve` | `[[0, 0], [0.3, 0.2], [1, 1]]` | 2 to 16 points `[x, y]` in [0, 1], x increasing. Sampled as a smooth monotone curve. |
| `kernel` | `[…25 numbers…]` | The 5×5 custom kernel, row by row. |
| `lut` | `{ "ref": "look:warm" }` | A 3D LUT **by name**: a table is too large for a document. The renderer resolves the name (the built-in looks are `look:<id>`; pass `resolveLut` for your own). |
| `image` | not serialisable | Parameters holding an image (the patch of *Remove object*, the depth map of *Lens blur*) exist only in memory; `serializeChain` throws if one is set. |

Lengths in pixels (blur `sigma`, grain `size`, ...) are always given **for the full-resolution original**. A renderer working on a smaller copy passes `scale` (for example `0.25`) and the lengths follow, so a preview looks like the export.

```json
{
  "version": 2,
  "steps": [
    { "filter": "curves", "params": { "rgb": [[0, 0], [0.25, 0.18], [0.75, 0.84], [1, 1]] } },
    { "filter": "applyLut", "params": { "look": { "ref": "look:tealOrange" }, "intensity": 0.7 } },
    { "filter": "whiteBalance", "params": {} }
  ]
}
```

## Masks

`mask` makes a step act on part of the image: the result is `mix(before, after, mask)`, so a masked blur blurs only where the mask is 1 and fades out where it falls to 0. All coordinates are **normalised** to the image (0 to 1 across the width and the height), so a mask means the same thing at every resolution. Distances (a radius, the length of a gradient) are measured in units of the image's **longer side**, so a circle stays a circle on a portrait photo.

Every kind accepts `invert` (swap inside and outside) and `opacity` (multiplies the mask, 0 to 1).

| `kind` | Fields | Shape |
|---|---|---|
| `linear` | `from`, `to` (`[x, y]`) | 0 at `from`, 1 at `to`, a smooth blend between, constant beyond. `from` and `to` must differ. |
| `radial` | `center`, `radius` (`[rx, ry]`, > 0), `feather` (0 to 1) | 1 inside an ellipse, 0 outside; `feather` is the fraction of the radius over which it fades (0 is a hard edge). |
| `raster` | `width`, `height`, `data` | Any shape you can draw: `data` is `width × height` bytes of coverage (0 to 255), row by row, **base64**. Sampled with bilinear interpolation at any image size. |

```json
{
  "version": 2,
  "steps": [
    { "filter": "exposure", "params": { "ev": 0.8 }, "mask": { "kind": "linear", "from": [0.5, 0], "to": [0.5, 0.6] } },
    { "filter": "saturation", "params": { "amount": 0.4 }, "mask": { "kind": "raster", "width": 2, "height": 2, "data": "AP8A/w==", "opacity": 0.8 } }
  ]
}
```

Filters that need to know *where* they act (*Remove (inpaint)*) require a mask and fail without one; the rest ignore the question.

## `geometry`

The frame put on the photo **before** the steps (as Lightroom does): the steps then see the straightened, cropped picture, and masks refer to it. Optional; leave it out for the untouched photo.

| Field | Type | Meaning |
|---|---|---|
| `rotate` | `0`, `90`, `180`, `270` | Quarter turns, clockwise. |
| `flipH`, `flipV` | boolean | Mirror left-right / top-bottom, applied with `rotate` (together: the orientation). |
| `perspective` | four `[x, y]` | Optional. Top-left, top-right, bottom-right, bottom-left, normalised to the oriented picture; these points become the corners of the frame (keystone correction). The quad must be convex. |
| `straighten` | number, −45 to 45 | Degrees, positive turns the content clockwise about the centre. |
| `crop` | `{ x, y, width, height }` | The rectangle that is kept, normalised to the oriented frame; non-empty and inside [0, 1]². |

```json
{
  "version": 2,
  "steps": [{ "filter": "contrast", "params": { "amount": 0.2 } }],
  "geometry": {
    "rotate": 90,
    "flipH": false,
    "flipV": false,
    "straighten": -1.5,
    "crop": { "x": 0.1, "y": 0.05, "width": 0.8, "height": 0.9 }
  }
}
```

All the parts compose into one transform and one resampling (bilinear, in linear light). Areas the transform brings in from outside the photo are transparent, so crop them away or flatten them with `output.background`.

## `output`

How to encode the result. Everything is optional; unknown keys are rejected so a typo does not pass silently.

| Field | Values | Meaning |
|---|---|---|
| `format` | `"png"` (default), `"jpeg"`, `"webp"` | |
| `quality` | 0 to 1 | JPEG / WebP quality; the encoder's default if left out. |
| `bitDepth` | `8` (default), `16` | 16-bit PNG only: keeps the precision of the float16 pipeline. |
| `background` | `[r, g, b]` in [0, 1] | Flatten transparency onto this sRGB colour, composited in linear light. JPEG has no alpha and defaults to white. |
| `longSide` | integer ≥ 1 | Shrink so the longer side is at most this many pixels (never enlarges). Done after the steps, in linear light, so pixel-sized parameters keep their full-resolution meaning. |

```json
{
  "version": 2,
  "steps": [{ "filter": "unsharpMask", "params": { "amount": 0.6 } }],
  "output": { "format": "png", "bitDepth": 16, "background": [1, 1, 1], "longSide": 4096 }
}
```

`output` describes *export*. Interactive previews (`@rullino/konva`'s `set`, a slider-driven canvas) ignore `longSide` and render at the size they show.

## Errors

`parseChain` (and so every renderer) validates a whole document before rendering anything, and says which step and which parameter is wrong:

```text
chain step 1: unknown filter "exposur"
chain step 0 (exposure): unknown parameter "stops"
chain step 2 (gaussianBlur): parameter "sigma" (float): invalid value "big"
mask (radial): radius must be > 0
geometry: crop must be a non-empty rectangle inside [0, 1]²
output: bitDepth 16 needs format png
chain: unsupported version 3
```

Treat documents from users as untrusted input and render them with a limit on image size and a timeout, like any file you decode: a document cannot run code, but a large raster mask or a very large `sigma` is real work.

## Versioning

The `version` field is the format, not the library. A new library version reads every older document; writing always produces the current one. `migrateChain` lifts old documents explicitly (version 1 → 2 is a copy with `version: 2`). While rullino is 0.x the format may still change between minor versions, with a migration and a note in the [changelog](../CHANGELOG.md); a document you keep for years should be stored with the library version that wrote it.
