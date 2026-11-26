import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CodecError, decode } from './index';

// Fuzzing the HDR decoders (#182): mutated Radiance and OpenEXR files either decode to an image of the
// size their header gives or are refused with a CodecError (never a TypeError, a RangeError from an
// allocation, or a hang). RULLINO_FUZZ_RUNS raises the runs.

const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
const SLOW = { timeout: Math.max(60_000, (60_000 * RUNS) / 300) };
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });

const dir = fileURLToPath(new URL('../test/hdr/', import.meta.url));
const load = (names: string[]) => names.map((n) => new Uint8Array(readFileSync(dir + n)));
const radiance = load(['cv-9x5.hdr', 'rle-8x4.hdr', 'flat-5x7.hdr', 'old-runs-600x3.hdr', 'flipv-40x20.hdr', 'header-40x20.hdr']);
const exr = load(['one-none-half.exr', 'grey-zip-half.exr', 'grey-piz-half.exr', 'tall-piz-half.exr', 'tall-zip-half.exr', 'rgb-none-float.exr', 'rgba-piz-float16.exr', 'rgba-rle-float16.exr', 'rgba-zips-float16.exr']);

const mutation = fc.oneof(
  fc.record({ kind: fc.constant('set' as const), at: fc.nat(), value: fc.integer({ min: 0, max: 255 }), count: fc.integer({ min: 1, max: 8 }) }),
  fc.record({ kind: fc.constant('cut' as const), at: fc.nat() }),
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(), bytes: fc.uint8Array({ minLength: 1, maxLength: 16 }) }),
  fc.record({ kind: fc.constant('delete' as const), at: fc.nat(), count: fc.integer({ min: 1, max: 16 }) }),
);
type Mutation = typeof mutation extends fc.Arbitrary<infer T> ? T : never;

function apply(b: Uint8Array, m: Mutation): Uint8Array {
  const at = b.length ? m.at % b.length : 0;
  switch (m.kind) {
    case 'set': {
      const out = b.slice();
      for (let i = 0; i < m.count && at + i < out.length; i++) out[at + i] = (m.value + i * 31) & 255;
      return out;
    }
    case 'cut':
      return b.subarray(0, at);
    case 'insert':
      return Uint8Array.from([...b.subarray(0, at), ...m.bytes, ...b.subarray(at)]);
    case 'delete':
      return Uint8Array.from([...b.subarray(0, at), ...b.subarray(at + m.count)]);
  }
}

async function decodesOrRefuses(bytes: Uint8Array): Promise<void> {
  try {
    const img = await decode(bytes, { maxPixels: 1 << 20 });
    if (img.data.length !== img.width * img.height * 4) throw new Error(`data length ${img.data.length} for ${img.width}×${img.height}`);
  } catch (e) {
    if (!(e instanceof CodecError)) throw new Error(`threw ${(e as Error).name} instead of a CodecError: ${(e as Error).message}`, { cause: e });
  }
}

describe('HDR decoder fuzzing', SLOW, () => {
  for (const [name, seeds] of [['Radiance', radiance], ['OpenEXR', exr]] as const)
    it(`${name} files with up to 4 mutations: an image or a CodecError`, async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...seeds), fc.array(mutation, { minLength: 1, maxLength: 4 }), async (seed, ms) => {
          let b: Uint8Array = seed;
          for (const m of ms) b = apply(b, m);
          await decodesOrRefuses(b);
        }),
        { numRuns: RUNS },
      );
    });
});
