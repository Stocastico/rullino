import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CodecError, decodeJpeg } from './index';

// Fuzzing the JPEG decoder (#179): whatever bytes come in, decodeJpeg resolves to an image of the size
// its header gives or rejects with a CodecError (never a TypeError, a RangeError from an allocation,
// or a hang). JPEG has no checksums, so mutated bytes reach the Huffman decoding, the scans and the
// upsampling as they are. RULLINO_FUZZ_RUNS raises the runs.

const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
const SLOW = { timeout: Math.max(60_000, (60_000 * RUNS) / 300) };
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });

const dir = fileURLToPath(new URL('../test/jpeg/', import.meta.url));
const seeds = readdirSync(dir)
  .filter((f) => f.endsWith('.jpg') && !f.startsWith('noise-') && !f.startsWith('q100'))
  .map((f) => new Uint8Array(readFileSync(dir + f)));

const mutation = fc.oneof(
  fc.record({ kind: fc.constant('set' as const), at: fc.nat(), value: fc.integer({ min: 0, max: 255 }), count: fc.integer({ min: 1, max: 4 }) }),
  fc.record({ kind: fc.constant('flip' as const), at: fc.nat(), bit: fc.integer({ min: 0, max: 7 }) }),
  fc.record({ kind: fc.constant('cut' as const), at: fc.nat() }),
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(), bytes: fc.uint8Array({ minLength: 1, maxLength: 8 }) }),
  fc.record({ kind: fc.constant('delete' as const), at: fc.nat(), count: fc.integer({ min: 1, max: 8 }) }),
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
    case 'flip': {
      const out = b.slice();
      if (out.length) out[at] = out[at]! ^ (1 << m.bit);
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
    const img = await decodeJpeg(bytes, { maxPixels: 1 << 20 });
    if (img.data.length !== img.width * img.height * 4) throw new Error(`data length ${img.data.length} for ${img.width}×${img.height}`);
  } catch (e) {
    if (!(e instanceof CodecError)) throw new Error(`threw ${(e as Error).name} instead of a CodecError: ${(e as Error).message}`, { cause: e });
  }
}

/** Offsets of the bytes inside marker segments before the first scan (tables, frame and scan headers). */
function headerBytes(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 2; i + 4 <= b.length && b[i] === 0xff; ) {
    const length = (b[i + 2]! << 8) | b[i + 3]!;
    for (let j = i + 2; j < i + 2 + length; j++) out.push(j);
    if (b[i + 1] === 0xda) break;
    i += 2 + length;
  }
  return out;
}

describe('decodeJpeg fuzzing', SLOW, () => {
  it('a fixture with up to 4 mutations anywhere: an image or a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...seeds), fc.array(mutation, { minLength: 1, maxLength: 4 }), async (seed, ms) => {
        let b: Uint8Array = seed;
        for (const m of ms) b = apply(b, m);
        await decodesOrRefuses(b);
      }),
      { numRuns: RUNS },
    );
  });

  it('a fixture with header bytes (tables, frame, scan headers) changed: an image or a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...seeds), fc.array(fc.tuple(fc.nat(), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 3 }), async (seed, changes) => {
        const at = headerBytes(seed);
        const b = seed.slice();
        for (const [i, v] of changes) b[at[i % at.length]!] = v;
        await decodesOrRefuses(b);
      }),
      { numRuns: RUNS },
    );
  });

  it('random bytes after SOI: a CodecError', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), async (tail) => decodesOrRefuses(Uint8Array.from([0xff, 0xd8, ...tail]))),
      { numRuns: RUNS },
    );
  });
});
