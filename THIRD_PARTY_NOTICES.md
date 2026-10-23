# Third-party notices

rullino's own code is MIT (see [LICENSE](./LICENSE)). The packages have no runtime dependencies. The
optional ML tools in `@rullino/ml` use the models below, which are **not bundled**: the playground
downloads them on first use from Hugging Face (pinned revisions) and caches them in the browser.
`@rullino/ml` takes ONNX Runtime as an argument; the playground ships `onnxruntime-web` (MIT).

| Model | Used for | Licence | Source |
|---|---|---|---|
| SlimSAM-77 (uniform), ONNX export by Xenova, int8 / fp32 | click to select objects | Apache-2.0 | https://huggingface.co/Xenova/slimsam-77-uniform |
| MI-GAN (Picsart AI Research), `migan_pipeline_v2.onnx` | object removal | MIT (code and weights: `LICENSE-WEIGHTS` in the original repository) | https://huggingface.co/andraniksargsyan/migan |
| Depth Anything V2 Small, ONNX export by onnx-community, int8 | depth for lens blur | Apache-2.0 | https://huggingface.co/onnx-community/depth-anything-v2-small |

Only the Small size of Depth Anything V2 is Apache-2.0; the larger sizes are non-commercial and are
not used. Descriptors with the exact revisions are in `packages/ml/src/models.ts`.

The sample photos of the playground and their credits are listed in
[apps/playground/public/samples/NOTICE.md](./apps/playground/public/samples/NOTICE.md).
