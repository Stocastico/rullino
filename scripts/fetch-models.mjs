// Downloads the ML models used by `pnpm test:ml` into .cache/models (once; pinned revisions never
// change). curl honours the proxy settings of CI and cloud sessions, which Node's fetch does not.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { basename } from 'node:path';

const MODELS = [
  ['https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/vision_encoder_quantized.onnx', 8882165],
  ['https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/prompt_encoder_mask_decoder_quantized.onnx', 4903810],
];
const dir = new URL('../.cache/models/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
for (const [url, size] of MODELS) {
  const file = dir + basename(url);
  if (existsSync(file) && statSync(file).size === size) continue;
  console.log(`downloading ${basename(url)} (${(size / 1e6).toFixed(1)} MB)`);
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', `${file}.part`, url], { stdio: 'inherit' });
  if (statSync(`${file}.part`).size !== size) throw new Error(`${basename(url)}: unexpected size`);
  renameSync(`${file}.part`, file);
}
