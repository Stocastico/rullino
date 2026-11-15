# Road to 1.0 — from a filter library to a client-side imaging platform

> **Status: proposal (15 Nov 2026), for the maintainer to accept or change.** Nothing here is decided until it is ticked in [PLAN.md](../../PLAN.md) §8 and recorded in the Decisions table of [CLAUDE.md](../../CLAUDE.md). Each release below has an epic issue on GitHub (label `roadmap-1.0`), and each work item a sub-issue under it.

## 1. Where we are (0.7.0)

The engine is complete for what it set out to be: 51 filters, each a WGSL shader and a TypeScript reference held to a published tolerance; a versioned JSON edit document (chain + masks + geometry + output); renderers for the browser (WebGPU, else CPU workers) and Node (Dawn, else worker threads), a CLI, a Konva adapter, three on-device ML tools, `.cube` export, a playground that works without WebGPU.

What it is **not** yet:

- **Input is 8-bit sRGB only.** No RAW, no 16-bit or HDR input, no colour management (embedded ICC profiles are ignored), no metadata (EXIF / XMP are dropped on export). A photographer's first file is a RAW or an iPhone HEIC/HDR photo, and we cannot read it.
- **An edit is a single linear chain on a single image.** No layers, no second image, no text, no blend modes, no branches. Everything that combines pictures (a watermark, a collage, an HDR merge, a focus stack, a social card) is out of reach.
- **Images are bounded by one texture** (8192 or 16384 px a side, and the GPU's memory). A 100 MP stitched panorama does not render on the GPU.
- **The ML is three tools**, not a system: no subject / sky / people masks, no upscaling, no denoising.
- **The playground is a developer demo**, not something a person can live in: no library of photos, no batch, no offline install.
- **The document format is a JS-library artefact**, not a specification someone else could implement.

## 2. The goal of 1.0

> **rullino 1.0 is an open, client-side imaging platform: a specified, versioned edit format for non-destructive photo development and composition — from RAW to HDR output, with layers, text, masks and on-device ML — rendered identically (within a published tolerance) in any modern browser, in Node and from the command line, with a local-first web app anyone can use offline, and nothing on a server.**

Five pillars:

1. **Develop anything**: RAW (DNG first), 16-bit, HDR and wide-gamut input, colour-managed end to end, metadata kept.
2. **Compose anything**: the edit document becomes a graph — layers, blend modes, several inputs, text, shapes, templates with variables.
3. **Understand the picture**: smart masks (subject, sky, people, background), upscaling, denoising, computational photography (exposure fusion, focus stacking, alignment).
4. **A product, not only a library**: *rullino studio*, a local-first PWA (library, culling, develop, compose, batch export), the embeddable `<rullino-editor>`, a plugin API, a static community gallery of looks.
5. **A specification**: edit format v3 written down, with a conformance suite any implementation can run, and a stability promise.

## 3. The constraint: client only

The one non-negotiable requirement (maintainer, 15 Nov): **everything runs on the user's machine** — browser, Node, CLI. Each item below has a "client-only check". Allowed off-device, and only where it costs nothing or close to it:

| What | Where | Cost |
|---|---|---|
| The web app, docs, API reference, hardware check | GitHub Pages (already) | free |
| ML model weights | Hugging Face at pinned revisions (already), Cache API on the client | free |
| Community gallery of looks / templates / plugins | a JSON index in this repository (or a `rullino-gallery` repo), built to Pages; submissions by pull request | free |
| *Optional*: short share links for edit documents (never images) | one Cloudflare Worker + KV, free tier (100k reads / day) | free → a few €/year with a domain |

Never: image upload, accounts, server-side rendering as a service, telemetry, ads, a database. Collaboration that needs a server (live co-editing) is out of scope for 1.0; edit documents travel as files and links.

## 4. Releases

Each release is a theme of about 5–8 weeks of work (the maintainer's pace, not a promise of dates; roughly 9–12 months to 1.0). Order follows dependencies: the graph and tiles before what needs them, colour management before RAW, the format frozen last. **The studio grows with every release** (§4b), so there is something people can use from 0.8 on, not only at the end.

### 0.8 — Foundations: the graph, big images, hardening

*Why first*: composition, HDR merge, text and large panoramas all need a document that is a graph and a renderer that is not bounded by one texture. Doing this before features means features are written once.

- **Ship what is on `main`**: the CLI, the playground's CPU fallback, the benchmarks page (they are not on npm yet). Real-hardware parity from the M1 runs (Chrome / Safari / Firefox) decided per filter, as for the RTX.
- **Edit document v3, RFC then executor.** An RFC in `docs/design/edit-document-v3.md` (open for comments in Discussions) before any code. Proposed shape: named `inputs`, a list of `nodes` (each a chain, a blend, a layer stack or a generator) with explicit `from` references, one `output` node; a v2 document is the special case "one input, one chain" and `migrateChain` lifts it exactly. Core gets a DAG executor that reuses `Pipeline` per chain node and caches per node key (the incremental recompute already works per stage). CPU reference, GPU and banded CPU executors all take graphs; parity and "banded = whole" tests extended to graphs.
- **Tiled GPU rendering** for images beyond the texture limit or the memory budget: tiles with halos from each filter's `reach` (the CPU band planner, generalised to two dimensions), `'global'` filters through their `twoPhase` statistics (already done for bands), output assembled on the CPU or streamed to the encoder. Target: a 200 MP image renders on a laptop GPU, bit-for-bit equal to the untiled render where the untiled one fits.
- **Memory budget**: renderers take `{ memoryBudget }`, the planner picks tile size from it; texture-pool limits from it.
- **Hardening**: property-based tests (fast-check) over the document parser and the planners; a fuzz job for every decoder from 0.9 on (untrusted files are the new attack surface); Firefox CI where Playwright's Firefox exposes WebGPU, otherwise the CPU path in Firefox and WebKit at least.

*Client-only check*: nothing new off-device.
*Risks*: v3 is the single most important design decision before 1.0; it must be argued in public and allowed to take weeks. Tiled GPU rendering multiplies passes: measure on real hardware, keep untiled as the fast path.

### 0.9 — Pixels in, pixels out: codecs, colour management, HDR, metadata

*Why*: "within tolerance between browser and Node" is only as true as the decoded input. Browsers and sharp decode JPEG differently (IDCT, chroma upsampling); our own decoder makes the input identical everywhere, removes `sharp` as a requirement in Node, and opens 16-bit and HDR.

- **`@rullino/codecs`** (zero dependencies, pure TS with fast paths, each decoder fuzzed): PNG decode (8 / 16 bit, palette, interlace), JPEG decode (baseline + progressive) and encode (baseline, quality, 4:4:4 / 4:2:0), TIFF read / write (8 / 16 / 32-bit float, uncompressed + deflate + LZW), plus a decoder plug-in point for formats we will not write ourselves (AVIF, HEIC, JPEG XL: the app injects the browser's decoder or a WASM build, as ORT is injected today).
- **Metadata**: EXIF / XMP / IPTC / ICC read and written back on export (orientation applied, GPS optionally stripped — the default is a choice for the RFC: privacy says strip), the edit document optionally embedded as XMP so a JPEG carries its own recipe.
- **Colour management**: ICC v2 / v4 matrix-TRC and LUT-based profiles parsed in pure TS; embedded profiles converted into the working space on input, output profiles written (sRGB, Display P3, Adobe RGB, Rec. 2020). **A wide-gamut working space** (linear Rec. 2020 primaries) as an option of the document (`workingSpace`), with gamut mapping to the output in OKLCh. Every filter is audited for hard-coded sRGB / Rec. 709 assumptions (luminance weights, OKLab matrices) and parity-tested in both spaces.
- **HDR**: float input (EXR read — zip / piz / none, or a WASM decoder injected; Radiance HDR), Ultra HDR / ISO 21496-1 gain-map JPEGs read **and written** (an SDR base + gain map: shows HDR where supported, SDR elsewhere), HDR display in the studio (`toneMapping: 'extended'` canvases), tone-mapping operators as filters (filmic / AgX-like curves, local tone mapping = the "brilliance" of tier B).

*Client-only check*: all in-process; injected decoders run on the client.
*Risks*: a colour-managed working space touches every filter: this is the largest refactor of the road and must keep the sRGB path bit-for-bit unchanged. JPEG decoding is a security surface: fuzz in CI from the first commit.

### 0.10 — RAW development

*Why*: this is the distinctive one. Nothing open develops RAW files in the browser with a non-destructive, exportable recipe; Lightroom web uploads them. It needs 0.9's 16-bit / wide-gamut pipeline.

- **`@rullino/raw`**: a DNG reader in pure TS (uncompressed, lossless JPEG / LJ92, deflate; tiles; DNG 1.7's JPEG XL through the injected decoder of 0.9), so phone RAWs (iPhone ProRAW, Pixel, most Androids) and every converted RAW work out of the box. Proprietary formats (CR3, NEF, ARW, RAF…) through an **injected** decoder (a LibRaw WASM build chosen by the app: LGPL code stays out of our MIT packages).
- **The RAW pipeline as filters with CPU references and parity**: black / white level, linearisation tables, white balance in camera space, **demosaicing on the GPU** (bilinear as the reference, then a quality algorithm in the RCD / AMaZE class; X-Trans later), highlight reconstruction, camera → working space through the DNG colour matrices (dual-illuminant interpolation by CCT), DCP profiles (hue / sat maps, look tables), DNG opcode lists (WarpRectilinear for lens distortion, GainMap for vignetting — phones ship them).
- **Lens corrections without DNG opcodes**: distortion / vignetting / CA models as filters; the lensfun database (CC BY-SA data) fetched on demand, never bundled.
- **Raw denoising**: a classic one first (wavelet / NLM, tier C already), the ML one in 0.12.
- **Develop defaults** that make a RAW look like the camera's JPEG on first open (base curve + profile), so a user is never shown a flat image.

*Client-only check*: everything local; lensfun data from GitHub on demand, cached.
*Risks*: demosaicing quality is judged by eye against Lightroom / darktable: build a small public test set (CC0 RAWs) and compare. Memory: a 50 MP RAW in 16-bit floats is 400 MB; tiles from 0.8 are required.

### 0.11 — Composition: layers, blending, text, templates

*Why*: "more than filters". It turns the edit document into something that can make a watermark, a collage, an Open Graph card or a product shot on a new background, the same in the browser and the CLI.

- **Layer stacks as v3 nodes**: image layers (another input, an ML patch, a solid, a gradient), adjustment layers (a chain over everything below, with a mask), groups; per layer: affine transform (position, scale, rotation, anchor), opacity, mask, **blend modes** (normal, multiply, screen, overlay, soft light, hard light, colour dodge / burn, difference, colour, luminosity, hue, saturation; defined in linear light with the perceptual ones in OKLab — written down in the spec, because editors disagree).
- **Text, deterministic everywhere**: an OpenType reader in pure TS (TrueType `glyf` first, CFF later, variable fonts' axes), glyph outlines filled by the existing `fillShape` rasteriser at any size, so a text layer renders the same in Chrome, Safari and Node. Simple scripts shaped by us (kerning, ligatures through GSUB basics); **complex scripts through an injected shaper** (harfbuzzjs, MIT, WASM). Fonts are inputs of the document (a file, or a Google Fonts family fetched on the client).
- **Shapes and strokes**: rectangles, ellipses, polygons, paths (SVG path syntax), fills and strokes, drop shadow / glow / outline as layer styles.
- **Templates**: `variables` in the document (`{{title}}`, `{{photo}}`, colour and number variables bound to params), so one template renders a thousand social cards: `rullino render --template card.json --set title="…" photo.jpg`, or a CSV of rows.
- **Frames, borders, collages** as templates in the gallery, not as code.
- **Layout**: a document can be a canvas of its own size (not the input's), for collages and cards.

*Client-only check*: fonts are user files or fetched from a CDN by the client; no server rasteriser.
*Risks*: text is a deep hole (shaping, bidi, line breaking): 1.0 ships single-paragraph text with wrapping, left / centre / right; rich text later. Blend-mode definitions must be in the spec before code.

### 0.12 — Intelligence and computational photography

*Why*: masks are where an editor saves the user's time, and several pictures together beat one.

- **Smart masks** as mask kinds of the document (computed on the client, cached, re-computed on another image): subject, background, sky, people / skin / hair, by **text prompt** if a permissively licensed model fits. Masks are stored as rasters plus the recipe that made them (model id, revision, prompt), so a batch re-runs them per photo.
- **Generative-free ML tools**: upscaling ×2 / ×4, denoising (including raw-domain), face detection for auto-masks and auto-crop, matting for clean cut-outs (hair), auto-straighten (horizon by Hough, tier C, or a model), learned auto-enhance only with a licence that allows it.
- **Model registry**: every model a `ModelFile` with hash, size, licence and the backend it runs best on; `@rullino/ml` grows a small scheduler (one ORT session at a time, cancellation, progress), and a model is a plug-in (the plugin API of 0.13) so the community can add one.
- **Multi-resolution passes in core** (Gaussian / Laplacian pyramids as a pass primitive), which unlock: **exposure fusion** (Mertens) and HDR merge of brackets, **focus stacking**, frequency separation, local contrast / clarity / dehaze done properly.
- **Alignment**: feature detection (FAST / ORB-like) + RANSAC homography, on the GPU with a CPU reference, for handheld brackets and stacks; panorama stitching (cylindrical projection + multiband blending) as the stretch goal.

*Client-only check*: all inference on ORT WASM / WebGPU; weights from Hugging Face.
*Risks*: **licences**. Every candidate model's code *and* weights must be permissive (Apache-2.0 / MIT / BSD) and recorded in `THIRD_PARTY_NOTICES.md` before it is wired in; several popular ones (RMBG, some Depth Anything sizes) are non-commercial and excluded. Size: models are tens of MB, always lazy, always optional.

### 0.13 — Platform: editor, plugins, gallery, interop, automation

- **`<rullino-editor>`**: the studio's develop / compose UI as a framework-free web component (inspector, film strip / layers panel, masks, geometry, compare), input an image and a document, output a document; themable with CSS custom properties; keyboard and screen-reader accessible. Konva / React / Vue wrappers are a few lines each.
- **Plugin API**: a plugin is an npm package or an ES module URL exporting filters, mask generators, codecs, models, templates. `@rullino/filter-kit` gives plugin authors our parity harness (CPU reference vs WGSL, tolerance, mutation hints) so third-party filters meet the same bar. Documents name plugins with a version; a renderer that lacks one says which.
- **Community gallery**: looks, templates, LUTs, plugins, as a JSON index in a repository, previews rendered by CI, browsed from the studio; submissions are pull requests (review = the licence check). Free on Pages.
- **Interop**: import **Lightroom / Camera Raw XMP presets** (the basic, tone curve, HSL, colour grading, split toning, grain, vignette, effects panels mapped onto our filters, with a report of what was approximated) — millions of presets exist; `.cube` / `.3dl` / Hald in and out (`.cube` out exists); Photoshop `.acv` curves; export a document as a darktable style or an RT `.pp3` where a mapping exists (later).
- **CLI, the rest**: `rullino watch` (a folder in, renders on change), sidecars (`photo.jpg.rullino.json` next to the photo, picked up automatically), `rullino validate` / `rullino diff a.png b.png --tolerance` / `rullino info` (metadata, profile), templates with CSV rows, `rullino studio` (serves the PWA locally on a folder).
- **`@rullino/mcp`**: a local MCP server over the CLI (stdio, no network), so AI assistants can develop and compose photos on the user's machine through edit documents. Cheap once the CLI and the spec exist.

*Client-only check*: plugins are loaded by the client from npm / a URL; the gallery is static.
*Risks*: a plugin is third-party code running in the page: document the trust model (same as any npm dependency), never auto-load plugins named by a document without the user's consent.

### 0.14 — Video (experimental, does not block 1.0)

- Per-frame grading of video in the browser through **WebCodecs** (decode → the same document on each frame → encode), MP4 / WebM demuxing and muxing (own minimal muxer or an injected library), temporal effects (grain that moves, stabilised vignettes), LUT-based previews at full frame rate.
- Node: no WebCodecs there; frames in and out of the CLI (`ffmpeg` pipes, the user's own binary) is the most we do.
- *Risk*: `VideoFrame` imports lose the device on SwiftShader (see Traps), so CI cannot test the GPU path as is: the CPU path and frame-by-frame tests first. This is why it is experimental.

### 1.0 — Stable

1.0 is a promise, not a feature list:

- **Specification**: `spec/` with edit document v3 written as a standard (every node, param, blend mode, colour space and their exact maths — the CPU references *are* the normative definitions), versioned independently of the packages.
- **Conformance suite**: inputs + documents + reference outputs + tolerances, runnable by any implementation (ours run it in CI on every backend; a Python or Rust reader could run it too).
- **Stability**: semver from 1.0 on for every public root; every future reader reads v3 documents; deprecations last at least one minor release with a warning; `./internal` stays unstable.
- **API audit** like M5.1: everything exported is something we want to keep for years.
- **Quality bars**: real-hardware parity on at least NVIDIA, Apple, AMD or Intel, in Chrome, Safari and Firefox; performance budgets per release checked by the bench; size budgets per package; accessibility audit of the editor and studio; decoders fuzzed; docs for every pillar (guides by job, a "from Lightroom" guide).

### After 1.0 (1.x, not promised)

Panorama stitching if not in 0.12, video out of experimental, peer-to-peer sharing of documents (WebRTC, needs only a free signalling service), rich text, a WebGL2 backend only if users without WebGPU and with slow CPUs ask, more RAW formats in pure TS.

## 4b. Two tracks that run through every release

### Studio (the app people use)

The playground evolves into **rullino studio** instead of a second app being written (proposal; the developer panels stay behind `?dev`). A PWA, installable, works offline:

- 0.8: install / offline; open a folder (File System Access, OPFS elsewhere) as a **library**: thumbnails, EXIF, ratings, flags, filter and sort; edits stored as sidecars or in OPFS; copy / paste / sync an edit across a selection; batch export with band workers.
- 0.9: open 16-bit / HDR / wide-gamut files, show HDR, keep metadata; histogram per channel in the working space.
- 0.10: open RAW, develop module.
- 0.11: compose module (layers, text, templates).
- 0.12: smart-mask buttons, upscale / denoise on export, merge (HDR / focus).
- 0.13: the editor is `<rullino-editor>`; gallery browser; XMP preset import.

### Engine quality (every release)

Each new filter or node follows the existing rules (CPU reference, WGSL, parity, banded = whole, mutation check); performance and size budgets updated with reasons; real-hardware numbers rerun with the hardware check page.

## 5. New packages (proposal)

| Package | Release | Notes |
|---|---|---|
| `@rullino/codecs` | 0.9 | PNG / JPEG / TIFF / EXR / ICC / EXIF / XMP; injected decoders for AVIF / HEIC / JXL |
| `@rullino/raw` | 0.10 | DNG + RAW pipeline filters; injected LibRaw for proprietary formats |
| `@rullino/text` | 0.11 | OpenType reader + layout; injected shaper for complex scripts |
| `@rullino/editor` | 0.13 | `<rullino-editor>` web component |
| `@rullino/filter-kit` | 0.13 | parity harness for plugin authors |
| `@rullino/mcp` | 0.13 | local MCP server over the CLI |
| `@rullino/video` | 0.14 (exp.) | WebCodecs pipeline |

All keep the rules: zero runtime dependencies, heavy third-party code injected by the caller, ESM, one version number.

## 6. What I recommend *not* doing (opinion)

- **No PSD compatibility, no vector illustration, no Photoshop clone.** Photopea already is one, and its moat is ten years of features. Our layers exist to *compose photos reproducibly*, not to edit arbitrary documents.
- **No generative AI** (inpainting with diffusion, relighting, "AI expand"): models are hundreds of MB to GBs, the good ones are not permissively licensed, and on-device speed is poor. MI-GAN-class removal stays.
- **No accounts, no cloud sync, no server rendering as a service**, even "just for convenience": the constraint is the product.
- **Do not let breadth erase the moat.** Every new capability must stay inside the edit document and the parity contract; a feature that only exists in the studio UI, or only on the GPU, is a regression of what makes rullino different.
- **A word of caution** on the change of direction itself: the 6b plan froze breadth because the library had no users. Building the platform first is a legitimate bet (a studio people can use is also the best launch material), but the risk is a year of work nobody sees. Mitigation: ship each release to npm and Pages, and keep the studio usable at every step.

## 7. Open questions for the maintainer

1. Accept the direction and the release order? (In particular: RAW before composition, or the other way round?)
2. Evolve the playground into the studio, or keep the playground as a developer demo and build the studio separately?
3. Default for GPS / personal metadata on export: strip (privacy) or keep (fidelity)?
4. The optional Cloudflare Worker for short links: yes, or links stay in the URL fragment only?
5. Video in 0.14 as experimental, or after 1.0?
6. Spec licence: MIT like the code, or CC BY 4.0 for the text?
