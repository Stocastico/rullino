import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CodecError, editXmp, exportMetadata, readExif, readIptc, readMetadata } from './index';
import { parseXmp } from './xmp';

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

  it('a mangled XMP packet: parseXmp and editXmp return or throw a CodecError', async () => {
    const xmp = blocks[0]!.xmp!;
    const edit = fc.record({ gps: fc.boolean(), personal: fc.boolean(), orientation: fc.boolean(), edit: fc.option(fc.string(), { nil: undefined }) });
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.nat(), fc.constantFrom('<', '>', '/', '"', "'", '=', ':', ' ', '&', '!', '?', 'x', '')), { minLength: 1, maxLength: 6 }), edit, async (cs, e) => {
        let s = xmp;
        for (const [i, c] of cs) {
          const at = i % s.length;
          s = s.slice(0, at) + c + s.slice(at + 1);
        }
        await refuses(() => parseXmp(s));
        await refuses(() => editXmp(s, { remove: { gps: e.gps, personal: e.personal }, ...(e.orientation ? { orientation: 1 } : {}), ...(e.edit !== undefined ? { edit: e.edit } : {}) }));
      }),
      { numRuns: RUNS },
    );
  });

  it('exportMetadata never throws on broken blocks: it drops them', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...blocks), changes, fc.constantFrom('keep' as const, 'strip' as const, { strip: ['gps' as const] }, { strip: ['personal' as const] }), async (m, cs, metadata) => {
        const broken = { ...m, ...(m.exif ? { exif: mutate(m.exif, cs, null) } : {}), ...(m.iptc ? { iptc: mutate(m.iptc, cs, null) } : {}) };
        exportMetadata(broken, { metadata, width: 10, height: 10, edit: '{"version":3}' });
      }),
      { numRuns: RUNS },
    );
  });
});
