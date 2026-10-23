import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEPTH_ANYTHING_V2_SMALL, MIGAN, SLIMSAM_77, type ModelFile } from '../src/models';

// The descriptors' sha256 and size must be those of the real files (fetched by scripts/fetch-models.mjs).
// The fp32 SlimSAM variant is not downloaded by CI (40 MB, unused by the tests): its hashes come from the Hub's LFS metadata.
const files: ModelFile[] = [
  SLIMSAM_77.variants.quantized.encoder,
  SLIMSAM_77.variants.quantized.decoder,
  MIGAN.model,
  DEPTH_ANYTHING_V2_SMALL.model,
];

describe('model descriptors match the downloaded files', () => {
  it.each(files.map((f) => [f.url.split('/').at(-1)!, f] as const))('%s', (_, f) => {
    const bytes = readFileSync(new URL(`../../../.cache/models/${f.url.split('/').at(-1)}`, import.meta.url));
    expect(bytes.length).toBe(f.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
  });
});
