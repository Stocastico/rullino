import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CodecError, decodeTiff } from './index';

// Fuzzing the TIFF decoder (#179): whatever bytes come in, decodeTiff resolves to an image of the size
// its fields give or rejects with a CodecError (never a TypeError, a RangeError from an allocation, or
// a hang). Mutations anywhere, and changes aimed at the IFD's values (types, counts, offsets), which
// is where TIFF readers break. RULLINO_FUZZ_RUNS raises the runs.

const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
const SLOW = { timeout: Math.max(60_000, (60_000 * RUNS) / 300) };
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });

const dir = fileURLToPath(new URL('../test/tiff/', import.meta.url));
const manifest: { file: string }[] = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8'));
const seeds = manifest.map((m) => new Uint8Array(readFileSync(dir + m.file)));

async function decodesOrRefuses(bytes: Uint8Array): Promise<void> {
  try {
    const img = await decodeTiff(bytes, { maxPixels: 1 << 20 });
    if (img.data.length !== img.width * img.height * 4) throw new Error(`data length ${img.data.length} for ${img.width}×${img.height}`);
  } catch (e) {
    if (!(e instanceof CodecError)) throw new Error(`threw ${(e as Error).name} instead of a CodecError: ${(e as Error).message}`, { cause: e });
  }
}

/** Byte offsets of the first IFD's entries (12 bytes each), little or big endian. */
function ifdEntries(b: Uint8Array): number[] {
  const little = b[0] === 0x49;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ifd = dv.getUint32(4, little);
  const n = dv.getUint16(ifd, little);
  return Array.from({ length: n }, (_, i) => ifd + 2 + 12 * i);
}

describe('decodeTiff fuzzing', SLOW, () => {
  it('a fixture with up to 4 byte changes anywhere, or cut: an image or a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...seeds), fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 4 }), fc.option(fc.nat()), async (seed, changes, cut) => {
        let b = seed.slice();
        for (const [i, v] of changes) b[i % b.length] = v;
        if (cut !== null) b = b.subarray(0, cut % b.length);
        await decodesOrRefuses(b);
      }),
      { numRuns: RUNS },
    );
  });

  it("a fixture with an IFD entry's type, count or value replaced: an image or a CodecError", async () => {
    const value = fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.constantFrom(0, 1, 2, 3, 4, 7, 8, 16, 32, 255, 256, 65535, 0x7fffffff, 0xffffffff));
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...seeds), fc.array(fc.tuple(fc.nat(), fc.constantFrom(2, 4, 8), value), { minLength: 1, maxLength: 3 }), async (seed, changes) => {
        const b = seed.slice();
        const little = b[0] === 0x49;
        const dv = new DataView(b.buffer);
        const entries = ifdEntries(b);
        for (const [i, field, v] of changes) {
          const e = entries[i % entries.length]!;
          if (field === 2) dv.setUint16(e + 2, v & 0xffff, little);
          else dv.setUint32(e + field, v >>> 0, little);
        }
        await decodesOrRefuses(b);
      }),
      { numRuns: RUNS },
    );
  });

  it('random bytes after a TIFF header: a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.uint8Array({ maxLength: 300 }), async (little, tail) =>
        decodesOrRefuses(Uint8Array.from([...(little ? [0x49, 0x49, 42, 0, 8, 0, 0, 0] : [0x4d, 0x4d, 0, 42, 0, 0, 0, 8]), ...tail])),
      ),
      { numRuns: RUNS },
    );
  });
});
