# Road to 1.0 — the open photo-development engine, and the web tools built on it

> **Status: accepted direction (15 Nov 2026), revised after a market check; the decisions of the maintainer are in §9.** Nothing here is decided until it is ticked in [PLAN.md](../../PLAN.md) §8 and recorded in the Decisions table of [CLAUDE.md](../../CLAUDE.md). The first draft (same day) put a local Lightroom-like app and full composition at the centre; §2 explains why that changed.

**Tracking**: umbrella [#165](https://github.com/Stocastico/rullino/issues/165) · epics 0.8 [#166](https://github.com/Stocastico/rullino/issues/166) · 0.9 [#167](https://github.com/Stocastico/rullino/issues/167) · 0.10 [#206](https://github.com/Stocastico/rullino/issues/206) · 0.11 [#168](https://github.com/Stocastico/rullino/issues/168) · 0.12 [#170](https://github.com/Stocastico/rullino/issues/170) · 0.13 [#171](https://github.com/Stocastico/rullino/issues/171) · 1.0 [#173](https://github.com/Stocastico/rullino/issues/173) · after 1.0 [#207](https://github.com/Stocastico/rullino/issues/207). RFCs (argued before code): v3 graph [#174](https://github.com/Stocastico/rullino/issues/174), colour management [#181](https://github.com/Stocastico/rullino/issues/181), plugins [#196](https://github.com/Stocastico/rullino/issues/196). Good first issues: [#201](https://github.com/Stocastico/rullino/issues/201), [#202](https://github.com/Stocastico/rullino/issues/202), [#203](https://github.com/Stocastico/rullino/issues/203).

## 1. Where we are (0.7.0)

The engine is complete for what it set out to be: 51 filters, each a WGSL shader and a TypeScript reference held to a published tolerance; a versioned JSON edit document (chain + masks + geometry + output); renderers for the browser (WebGPU, else CPU workers) and Node (Dawn, else worker threads), a CLI, a Konva adapter, three on-device ML tools, `.cube` export, a playground that works without WebGPU.

Not yet: RAW, 16-bit, HDR or colour-managed input; metadata on export; more than one image per edit; images beyond one texture; an embeddable editor; a web page that does a job for someone who is not a developer.

## 2. Market check (15 Nov 2026): what is covered, what is not

**Covered, crowded**: a free, private, in-browser photo or RAW editor. In 2026 there are a dozen: LightCraft (open source, Rust/WASM, library + RAW developer, self-hostable), Safelight, pg0/raw-viewer (WebGL2), OpenLight (WebGPU, MIT), OpticRaw (it already imports Lightroom XMP presets), photopico (LibRaw in the browser), Lumen, RawLite, plus Photopea and Polarr Next. Composition (layers, text, templates) is covered by Photopea, Canva, Polotno and Graphite. A photographer cannot tell a correct colour pipeline from a careless one, so "a better local editor" would read as "another local editor".

**Not covered**: an **open engine** that takes one edit document and renders it the same (within a published tolerance) in the browser, in Node and from the command line. The closest is img.ly's PhotoEditor SDK for server, commercial and expensive; open projects (Image Sequencer, Ente's photo-editor-sdk) have neither the format nor the parity. Every editor listed above writes its own shaders and stops at its own UI. This is also what the 4 Nov review (PLAN §6c) concluded: the moat is the document + parity + server render, not the UI.

**Conclusion**: two products on one engine, with the engine as the headline and the web part as its front door, not as a competitor of the dozen editors.

## 3. Two products, one engine

### 3.1 The library — the open photo-development engine

> One edit document (JSON, specified), previewed on the GPU in the browser, rendered the same in Node and from the CLI; codecs, colour management, HDR, RAW, masks, interop with Lightroom presets and LUTs, an embeddable editor. MIT, zero runtime dependencies, nothing on a server.

Who it is for: developers of products with photo features (e-commerce and marketplaces, real estate, CMS and DAM plugins, print services, photo-sharing apps, Konva / Filerobot users), and makers of editors and tools who would rather not write a colour pipeline (including the indie editors above).

### 3.2 rullino tools — the front door

Not a general editor. **Pages that each do one job completely and locally**, each ending with "the same in your code" (snippet + edit document + a link to the playground):

- apply a look or an edit to a whole folder (preview a few, export all, band workers);
- make a LUT from a grade (`.cube` for DaVinci, Premiere, OBS, phones);
- web-ready export (resize, sharpen for screens, JPEG / WebP, metadata and GPS dropped, a folder at once);
- compare two renders (difference map, within a tolerance or not);
- later, as the library grows: Lightroom preset → LUT / look, a product-photo set made consistent, RAW batch develop.

Why job pages: people search for a job ("batch apply a preset to a folder", "remove GPS from photos", "Lightroom preset to LUT"), not for an editor. Each page is a reason to arrive, and each shows a developer what the library does. The playground stays as the full workspace and developer demo. A dedicated website (domain, landing page) only if the tools get traction; until then GitHub Pages.

## 4. The constraint: client only

The one non-negotiable requirement (maintainer, 15 Nov): **everything runs on the user's machine** — browser, Node, CLI. Allowed off-device, and only where it costs nothing or close to it: GitHub Pages (site, docs, tools), Hugging Face (model weights at pinned revisions), a static JSON gallery index in a repository, one free-tier Cloudflare Worker for short links of documents (never images; agreed, §9). Never: uploads, accounts, server rendering as a service, telemetry, ads, a database. **No generative AI** (maintainer, 15 Nov): not the goal, and the models are huge, rarely permissively licensed and slow on-device.

## 5. Releases

About 5–8 weeks each at the maintainer's pace; dates are not promised. **Visibility runs in parallel** (§7): every release goes to npm with notes, and the tools go live as they are built.

### 0.8 — Foundations + the first tools ([#166](https://github.com/Stocastico/rullino/issues/166))
- 0.7.0 and 0.8.0 on npm (`main` already has the CLI, the playground's CPU fallback, the benchmarks); the M1 parity numbers decided per filter.
- **Edit document v3** as a graph of named inputs and nodes (RFC [#174](https://github.com/Stocastico/rullino/issues/174)), deliberately small: what merging brackets, overlays and alignment need, not a layer editor. v2 lifts exactly. DAG executor on every backend ([#175](https://github.com/Stocastico/rullino/issues/175)).
- Tiled GPU rendering beyond the texture limit and `memoryBudget` ([#176](https://github.com/Stocastico/rullino/issues/176)); property-based tests and Firefox / WebKit CI ([#177](https://github.com/Stocastico/rullino/issues/177)).
- **rullino tools, step 1** ([#178](https://github.com/Stocastico/rullino/issues/178)): the four job pages above, installable and offline.
- Short links of edit documents through one free-tier Cloudflare Worker ([#208](https://github.com/Stocastico/rullino/issues/208)), with the fragment link as fallback.

### 0.9 — Pixels in, pixels out ([#167](https://github.com/Stocastico/rullino/issues/167))
- `@rullino/codecs`: PNG / JPEG / TIFF in pure TS, fuzzed ([#179](https://github.com/Stocastico/rullino/issues/179)). Browsers and sharp decode JPEG differently; an own decoder makes the input identical everywhere and makes `sharp` optional.
- Metadata kept on export by default, with an option to strip them (all, or GPS and personal fields), the edit document inside the file as XMP ([#180](https://github.com/Stocastico/rullino/issues/180)).
- Colour management and an optional wide-gamut working space (RFC [#181](https://github.com/Stocastico/rullino/issues/181)); the sRGB path stays bit-for-bit unchanged.
- HDR: float input, Ultra HDR / ISO 21496-1 gain maps read and written, tone mapping ([#182](https://github.com/Stocastico/rullino/issues/182)).

### 0.10 — Embeddable editor and interop: the adoption channel ([#206](https://github.com/Stocastico/rullino/issues/206))
- `<rullino-editor>` ([#195](https://github.com/Stocastico/rullino/issues/195)): a framework-free web component, document in, document out, themable and accessible, with React / Vue / Svelte / Konva wrappers documented. Positioned against Pintura and img.ly's photo editor: MIT, and the same document renders on the server.
- Interop hub: Lightroom XMP preset import with an approximation report ([#198](https://github.com/Stocastico/rullino/issues/198)), `.3dl` ([#202](https://github.com/Stocastico/rullino/issues/202)), `.acv` ([#203](https://github.com/Stocastico/rullino/issues/203)), `.cube` both ways; conversions in the CLI and as a tool page.
- One integration example per audience (product photos, a CMS / DAM plugin, an editor using rullino as its engine).
- **Adoption gate** (agreed, §9): RAW (0.11) starts only once at least 3 outside developers integrate or seriously try the library (issues, PRs, dependents). If not, the pitch is the problem, not missing features: rethink before investing months in demosaicing.

### 0.11 — RAW development ([#168](https://github.com/Stocastico/rullino/issues/168))
- `@rullino/raw`: DNG in pure TS (phones, converted files); **proprietary formats (CR3, NEF, ARW, RAF…) through an official, optional `@rullino/libraw` adapter** over a LibRaw WASM build (LGPL, its own package and `.wasm`, so the core stays MIT and zero-dependency) ([#183](https://github.com/Stocastico/rullino/issues/183)). Without these formats photographers do not even try.
- The RAW pipeline as filters with CPU references and parity: levels, white balance, GPU demosaic, highlight reconstruction, camera matrices, DCP, DNG opcodes ([#184](https://github.com/Stocastico/rullino/issues/184)); lens corrections and raw denoising ([#185](https://github.com/Stocastico/rullino/issues/185)); a CC0 RAW test set ([#186](https://github.com/Stocastico/rullino/issues/186)).
- Tool page: RAW batch develop.

### 0.12 — Masks and computational photography, non-generative ([#170](https://github.com/Stocastico/rullino/issues/170))
- A licence-first model survey ([#191](https://github.com/Stocastico/rullino/issues/191)), then smart masks (subject, background, sky, people) stored with the recipe that made them so batches recompute them ([#192](https://github.com/Stocastico/rullino/issues/192)); upscale and denoise.
- Pyramids as a core pass primitive: exposure fusion, focus stacking, clarity, dehaze ([#193](https://github.com/Stocastico/rullino/issues/193)); alignment of brackets and stacks ([#194](https://github.com/Stocastico/rullino/issues/194)).
- Tool page: make a product-photo set consistent (white balance, exposure, clean background).

### 0.13 — Platform ([#171](https://github.com/Stocastico/rullino/issues/171))
- Plugin API and `@rullino/filter-kit` (RFC [#196](https://github.com/Stocastico/rullino/issues/196)); community gallery as a static index ([#197](https://github.com/Stocastico/rullino/issues/197)); CLI `watch`, sidecars, `validate`, `diff`, `info`, and `@rullino/mcp` ([#199](https://github.com/Stocastico/rullino/issues/199)).
- A simple overlay node (image or solid, position, scale, opacity, normal / multiply / screen) for watermarks and logos on batches.

### 1.0 — Stable ([#173](https://github.com/Stocastico/rullino/issues/173))
- The v3 format written as a specification, with a conformance suite any implementation can run ([#204](https://github.com/Stocastico/rullino/issues/204)).
- API audit and a stability policy: semver, every future reader reads v3, deprecations warn for a minor release ([#200](https://github.com/Stocastico/rullino/issues/200)).
- Real-hardware parity on at least two GPU vendors in Chrome, Safari and Firefox; budgets; accessibility audit of the editor and the tools.

### After 1.0, not promised ([#207](https://github.com/Stocastico/rullino/issues/207))
Full composition (layer stacks and blend modes #187, text #188, shapes #189, templates #190), video grading through WebCodecs, panorama stitching. Reopen if users ask.

## 6. New packages

| Package | Release | Notes |
|---|---|---|
| `@rullino/codecs` | 0.9 | PNG / JPEG / TIFF / EXR, ICC / EXIF / XMP; injected decoders for AVIF / HEIC / JXL |
| `@rullino/editor` | 0.10 | `<rullino-editor>` |
| `@rullino/raw` | 0.11 | DNG + the RAW pipeline filters |
| `@rullino/libraw` | 0.11 | optional LGPL adapter for proprietary RAW formats, outside the MIT core |
| `@rullino/filter-kit` | 0.13 | parity harness for plugin authors |
| `@rullino/mcp` | 0.13 | local MCP server over the CLI |

All keep the rules: zero runtime dependencies in the MIT packages, heavy third-party code injected or isolated in its own optional package, ESM, one version number.

## 7. Visibility, in parallel

- A release per milestone at least, with notes and one thing to try (`npx rullino …`, a tool page).
- The launch message is the developer one: *one JSON edit, previewed on WebGPU in the browser, rendered the same on the server, with a published tolerance table*. Show HN, r/webdev, r/javascript, JavaScript Weekly; the Filerobot issue; the tool pages for photographers' communities, each with one clear job.
- Watch: npm downloads, dependents, outside issues and PRs, tool page visits (from GitHub Pages' traffic only; no analytics script).

## 8. What I recommend not doing (opinion)

- **Another general browser editor** as the headline: a crowded genre in 2026 (§2).
- **Full composition and video before 1.0**: covered elsewhere, and they do not strengthen what only rullino offers.
- **PSD compatibility, generative AI, accounts, cloud sync, server rendering as a service.**
- **Breadth that skips the moat**: every capability stays inside the edit document and the parity contract; a feature that exists only in a UI, or only on the GPU, is a regression of what makes rullino different.

## 9. Decisions of the maintainer (15 Nov 2026)

1. **Metadata are kept by default** on export (EXIF, XMP, IPTC, ICC, GPS included), with an option to strip them (all, or only GPS and personal fields) in the libraries, the CLI and the tools. The web-ready export tool sets it to strip, and says so.
2. **Short links: yes**, through one Cloudflare Worker on the free tier: edit documents only (never images), size-capped, content-addressed; links in the URL fragment keep working without it.
3. **Licences: MIT for all code; CC BY 4.0 for the specification text** and other non-code content written for the project (docs prose stays MIT with the repository unless it is part of the spec).
4. **Adoption gate agreed**: RAW (0.11) starts once at least 3 outside developers integrate or seriously try the library.

Sources of the market check (15 Nov 2026): [LightCraft](https://lightcraft.run/guides/edit-raw-photos-online), [OpticRaw](https://opticraw.com/lightroom-alternative), [Lumen](https://lumen.mr-development.de/en), [RawLite](https://rawlite.app/), [photopico](https://photopico.pages.dev/), [pg0/raw-viewer](https://github.com/pg0/raw-viewer), [Safelight](https://discuss.pixls.us/t/introducing-safelight-a-free-open-source-raw-editor-built-like-an-ide/58615), [OpenLight](https://21st.dev/community/apps/openlight), [Polarr Next](https://petapixel.com/2024/02/14/polarr-next-is-a-web-based-ai-powered-photo-editor-made-for-pros), [Graphite](https://graphite.art/features/), [img.ly PhotoEditor SDK for server](https://docs.photoeditorsdk.com/guides/server/), [Image Sequencer](https://github.com/jcads/image-sequencer), [libraw-wasm](https://github.com/colorhythm/libraw-wasm).
