import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEPTH_ANYTHING_V2_SMALL, MIGAN, SLIMSAM_77, type ModelFile } from '../src/models';

// The descriptors' sha256 and size must be those of the real files (fetched by scripts/fetch-models.mjs).
const files: ModelFile[] = [
  ...Object.values(SLIMSAM_77.variants).flatMap((v) => [v.encoder, v.decoder]),
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
