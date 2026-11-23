# Architecture in one page

- **Edit document** (JSON, versioned, [JSON Schema](https://github.com/Stocastico/rullino/blob/main/packages/core/edit.schema.json)): steps (filter id + params + optional mask), geometry, output settings. v3 (planned) turns it into a graph of named inputs and nodes.
- **Every filter twice**: a WGSL compute shader (fast) and a TypeScript CPU reference (the specification), held to each other by parity tests with a per-filter tolerance ([table](https://github.com/Stocastico/rullino/blob/main/docs/parity.md)); an optional `fast` CPU path tested against the reference.
- **Colour**: linear, premultiplied RGBA in `rgba16float` (GPU) / `Float32Array` (CPU); sRGB only at the edges; OKLab for perceptual adjustments.
- **Pipeline**: consecutive pointwise filters fuse into one shader; each stage is cached by everything upstream, so a slider recomputes only what follows it; previews run at reduced size.
- **Backends**: WebGPU in the browser; Dawn (the `webgpu` package) in Node; the CPU everywhere, in bands across Web Workers / worker threads (global statistics in two phases).
- **Packages**: `core` (engine), `filters` (51 filters), `presets` (looks), `ml` (on-device models, ONNX Runtime injected), `web` and `node` (renderers; `rullino` CLI), `konva` (adapter).
- **Rules and the reasoning behind every decision**: [CLAUDE.md](https://github.com/Stocastico/rullino/blob/main/CLAUDE.md).
