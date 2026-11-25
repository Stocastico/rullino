import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CodecError, decodePng } from './index';
import { crc32 } from './png';
import { chunks, png, unzlib, zlib } from './test-utils';

// Fuzzing the PNG decoder (#179): whatever bytes come in, decodePng resolves to an image of the size
// its header gives or rejects with a CodecError (never a TypeError, a RangeError from an allocation,
// or a hang). Mutated files get their CRCs recomputed, or almost every mutation would stop at the
// first checksum and the decoder behind it would never be exercised. RULLINO_FUZZ_RUNS raises the runs.

const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
const SLOW = { timeout: Math.max(60_000, (60_000 * RUNS) / 300) };
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });

const dir = fileURLToPath(new URL('../test/pngsuite/', import.meta.url));
const seeds = readdirSync(dir)
  .filter((f) => /^(bas|tb|tp|s0|oi|f0)/.test(f))
  .map((f) => new Uint8Array(readFileSync(dir + f)));

/** Recomputes every chunk's CRC that can be found (stops at the first chunk that does not fit). */
function fixCrcs(b: Uint8Array): Uint8Array {
  const out = b.slice();
  for (let at = 8; at + 12 <= out.length; ) {
    const length = ((out[at]! << 24) | (out[at + 1]! << 16) | (out[at + 2]! << 8) | out[at + 3]!) >>> 0;
    const end = at + 8 + length;
    if (end + 4 > out.length) break;
    const crc = crc32(out, at + 4, end);
    out.set([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255], end);
    at = end + 4;
  }
  return out;
}

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

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function decodesOrRefuses(bytes: Uint8Array): Promise<void> {
  try {
    const img = await decodePng(bytes, { maxPixels: 1 << 20 });
    if (img.data.length !== img.width * img.height * 4) throw new Error(`data length ${img.data.length} for ${img.width}×${img.height}`);
  } catch (e) {
    if (!(e instanceof CodecError)) throw new Error(`threw ${(e as Error).name} instead of a CodecError: ${(e as Error).message}`, { cause: e });
  }
}

describe('decodePng fuzzing', SLOW, () => {
  it('a PngSuite file with up to 4 mutations, CRCs recomputed: an image or a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...seeds), fc.array(mutation, { minLength: 1, maxLength: 4 }), fc.boolean(), async (seed, ms, fix) => {
        let b: Uint8Array = seed;
        for (const m of ms) b = apply(b, m);
        await decodesOrRefuses(fix ? fixCrcs(b) : b);
      }),
      { numRuns: RUNS },
    );
  });

  it('a PngSuite file with its decompressed data and header fields mutated, then recompressed: an image or a CodecError', async () => {
    // Mutations of compressed bytes rarely survive inflating: this reaches the filters, the pass
    // layout and the pixel decoding with valid zlib streams of the wrong content or length.
    const header = fc.record({ at: fc.integer({ min: 0, max: 12 }), value: fc.integer({ min: 0, max: 255 }) });
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...seeds), fc.array(mutation, { maxLength: 3 }), fc.array(header, { maxLength: 2 }), async (seed, ms, hs) => {
        const parts = chunks(seed);
        let raw: Uint8Array = await unzlib(concat(parts.filter(([t]) => t === 'IDAT').map(([, d]) => d)));
        for (const m of ms) raw = apply(raw, m);
        const ihdrData = parts[0]![1].slice();
        for (const h of hs) ihdrData[h.at] = h.value;
        const idat = await zlib(raw);
        const rebuilt = parts.filter(([t]) => t !== 'IDAT').flatMap(([t, d]): [string, Uint8Array][] => (t === 'IHDR' ? [[t, ihdrData]] : t === 'IEND' ? [['IDAT', idat], [t, d]] : [[t, d]]));
        await decodesOrRefuses(png(rebuilt));
      }),
      { numRuns: RUNS },
    );
  });

  it('random bytes behind a PNG signature: a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 200 }), async (tail) => decodesOrRefuses(fixCrcs(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...tail])))),
      { numRuns: RUNS },
    );
  });
});
