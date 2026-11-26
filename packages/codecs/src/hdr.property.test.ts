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

  it('every byte of small files, set to 0, 255 or one more: an image or a CodecError (exhaustive, deterministic)', async () => {
    const small = load(['one-none-half.exr', 'grey-none-half.exr', 'grey-zip-half.exr', 'grey-piz-half.exr', 'flat-5x7.hdr', 'rle-8x4.hdr', 'cv-9x5.hdr']);
    for (const seed of small)
      for (let i = 0; i < Math.min(seed.length, 900); i++)
        for (const v of [0, 255, (seed[i]! + 1) & 255, (seed[i]! + 128) & 255]) {
          const b = seed.slice();
          b[i] = v;
          await decodesOrRefuses(b);
        }
  });

  it('every byte of the start of a compressed PIZ block (its bitmap, Huffman table and first codes), set to other values', async () => {
    const seed = load(['wide-piz-half.exr'])[0]!;
    for (let i = 368; i < 368 + 700; i++)
      for (const v of [0, 255, (seed[i]! + 1) & 255, (seed[i]! ^ 0x80) & 255, (seed[i]! ^ 0x10) & 255]) {
        const b = seed.slice();
        b[i] = v;
        await decodesOrRefuses(b);
      }
  });

  it('files of the right shape but wrong sizes inside: PIZ and RLE blocks of every length', async () => {
    const piz = load(['grey-piz-half.exr'])[0]!;
    const start = piz.length - 200;
    for (let cut = start; cut < piz.length; cut += 3) await decodesOrRefuses(piz.subarray(0, cut));
    const rle = load(['rgba-rle-float16.exr'])[0]!;
    for (let cut = rle.length - 300; cut < rle.length; cut += 7) await decodesOrRefuses(rle.subarray(0, cut));
  });
});
