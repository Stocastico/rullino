# Roadmap: 0.7 → 1.0

**Two products, one engine.**
- **The library**: the open photo-development engine. One edit document (JSON, specified), previewed on the GPU in the browser, rendered the same (within a published tolerance) in Node and from the command line; codecs, colour management, HDR, RAW, masks, Lightroom-preset and LUT interop, an embeddable editor.
- **rullino tools**: web pages that each do one job on your machine (apply a look to a folder, make a LUT, web-ready export, compare renders; later Lightroom preset → LUT, RAW batch develop), each ending with "the same in your code".

Everything runs locally. No generative AI. Full proposal: [road-to-1.0.md](https://github.com/Stocastico/rullino/blob/main/docs/design/road-to-1.0.md). Tracking: [#165](https://github.com/Stocastico/rullino/issues/165). Status: **proposal**, open for comments.

| Release | Theme | Epic |
|---|---|---|
| 0.8 | Foundations (v3 graph, tiles, hardening) + rullino tools step 1 | [#166](https://github.com/Stocastico/rullino/issues/166) |
| 0.9 | Codecs, metadata, colour management, HDR | [#167](https://github.com/Stocastico/rullino/issues/167) |
| 0.10 | `<rullino-editor>` + interop (Lightroom XMP, .cube / .3dl / .acv) | [#206](https://github.com/Stocastico/rullino/issues/206) |
| 0.11 | RAW development | [#168](https://github.com/Stocastico/rullino/issues/168) |
| 0.12 | Smart masks, exposure fusion, focus stacking, alignment | [#170](https://github.com/Stocastico/rullino/issues/170) |
| 0.13 | Plugins, gallery, CLI++ and MCP, overlay node | [#171](https://github.com/Stocastico/rullino/issues/171) |
| 1.0 | Specification + conformance suite, semver promise | [#173](https://github.com/Stocastico/rullino/issues/173) |
| after | Full composition, video, panorama | [#207](https://github.com/Stocastico/rullino/issues/207) |

## Open RFCs

[v3 graph #174](https://github.com/Stocastico/rullino/issues/174) · [colour management #181](https://github.com/Stocastico/rullino/issues/181) · [plugins #196](https://github.com/Stocastico/rullino/issues/196). To propose one, use the RFC issue form.

## What rullino will not do

Become another general browser editor, PSD compatibility, generative AI, accounts, cloud sync, server rendering as a service, telemetry, ads.
