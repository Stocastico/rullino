import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CodecError, readExif, readIptc, readMetadata } from './index';

// Fuzzing the metadata readers (#180): mutated fixtures, and mutated EXIF / IPTC blocks on their
// own: the readers return or throw a CodecError, never anything else. RULLINO_FUZZ_RUNS raises the runs.

const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
const SLOW = { timeout: Math.max(60_000, (60_000 * RUNS) / 300) };
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });

const dir = fileURLToPath(new URL('../test/metadata/', import.meta.url));
const files = ['photo.jpg', 'photo.png', 'photo.webp', 'photo.tif'].map((f) => new Uint8Array(readFileSync(dir + f)));
const blocks = await Promise.all(files.slice(0, 3).map((f) => readMetadata(f)));
const exifs = blocks.map((m) => m.exif!);
const iptc = blocks[0]!.iptc!;

const refuses = async (f: () => unknown) => {
  try {
    await f();
  } catch (e) {
    if (!(e instanceof CodecError)) throw new Error(`threw ${(e as Error).name} instead of a CodecError: ${(e as Error).message}`, { cause: e });
  }
};
const changes = fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 6 });
const mutate = (b: Uint8Array, cs: [number, number][], cut: number | null) => {
  let out = b.slice();
  for (const [i, v] of cs) out[i % out.length] = v;
  if (cut !== null) out = out.subarray(0, cut % out.length);
  return out;
};

describe('metadata readers fuzzing', SLOW, () => {
  it('a mutated or cut fixture: readMetadata returns or throws a CodecError', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...files), changes, fc.option(fc.nat()), async (f, cs, cut) => refuses(() => readMetadata(mutate(f, cs, cut)))), { numRuns: RUNS });
  });

  it('a mutated or cut EXIF or IPTC block: readExif / readIptc return or throw a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...exifs), changes, fc.option(fc.nat()), async (e, cs, cut) => {
        await refuses(() => readExif(mutate(e, cs, cut)));
        await refuses(() => readIptc(mutate(iptc, cs, cut)));
      }),
      { numRuns: RUNS },
    );
  });
});
