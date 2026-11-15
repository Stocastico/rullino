# Roadmap: 0.7 → 1.0

**Goal**: an open, client-side imaging platform — a specified, versioned edit format for non-destructive photo development and composition, from RAW to HDR output, with layers, text, masks and on-device ML, rendered the same (within a published tolerance) in any modern browser, in Node and from the command line, with a local-first web app anyone can use offline, and nothing on a server.

Full proposal with reasons and risks: [road-to-1.0.md](https://github.com/Stocastico/rullino/blob/main/docs/design/road-to-1.0.md). Tracking: [#165](https://github.com/Stocastico/rullino/issues/165). Status: **proposal**, open for comments.

| Release | Theme | Epic |
|---|---|---|
| 0.8 | Foundations: edit document v3 as a graph, tiled GPU rendering, memory budget, hardening; studio step 1 | [#166](https://github.com/Stocastico/rullino/issues/166) |
| 0.9 | Codecs, metadata, colour management, wide gamut, HDR / gain maps | [#167](https://github.com/Stocastico/rullino/issues/167) |
| 0.10 | RAW development (DNG in pure TS, GPU demosaic, camera profiles, lens corrections) | [#168](https://github.com/Stocastico/rullino/issues/168) |
| 0.11 | Composition: layers, blend modes, deterministic text, shapes, templates | [#169](https://github.com/Stocastico/rullino/issues/169) |
| 0.12 | Smart masks, upscale / denoise, exposure fusion, focus stacking, alignment | [#170](https://github.com/Stocastico/rullino/issues/170) |
| 0.13 | `<rullino-editor>`, plugins + filter kit, community gallery, Lightroom XMP import, CLI++, MCP | [#171](https://github.com/Stocastico/rullino/issues/171) |
| 0.14 | Video (experimental) | [#172](https://github.com/Stocastico/rullino/issues/172) |
| 1.0 | Specification + conformance suite, semver promise | [#173](https://github.com/Stocastico/rullino/issues/173) |

## Open RFCs

Design decisions that are hard to undo are argued before they are built: [v3 graph #174](https://github.com/Stocastico/rullino/issues/174) · [colour management #181](https://github.com/Stocastico/rullino/issues/181) · [layers and blend modes #187](https://github.com/Stocastico/rullino/issues/187) · [plugins #196](https://github.com/Stocastico/rullino/issues/196). To propose one, use the RFC issue form.

## What rullino will not do

PSD compatibility or a Photoshop clone, generative AI, accounts, cloud sync, server rendering as a service, telemetry, ads.
