import fc from 'fast-check';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodeJpeg, encodeJpeg } from './index';

// Any image, size and settings: the encoder writes a file that libjpeg-turbo (sharp) and our decoder
// read back to the same pixels. RULLINO_FUZZ_RUNS raises the runs.

const RUNS = Number(process.env.RULLINO_FUZZ_RUNS ?? 300);
const SLOW = { timeout: Math.max(60_000, (60_000 * RUNS) / 300) };
if (process.env.RULLINO_FUZZ_SEED) fc.configureGlobal({ seed: Number(process.env.RULLINO_FUZZ_SEED) });

describe('encodeJpeg properties', SLOW, () => {
  it('a random image encodes to a file sharp and decodeJpeg read alike', async () => {
    const image = fc.record({ width: fc.integer({ min: 1, max: 40 }), height: fc.integer({ min: 1, max: 40 }) }).chain(({ width, height }) =>
      fc.record({ width: fc.constant(width), height: fc.constant(height), data: fc.uint8Array({ minLength: width * height * 4, maxLength: width * height * 4 }) }),
    );
    await fc.assert(
      fc.asyncProperty(image, fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom('4:4:4' as const, '4:2:2' as const, '4:2:0' as const), async (img, quality, subsampling) => {
        const jpeg = encodeJpeg(img, { quality, subsampling });
        const ours = await decodeJpeg(jpeg);
        const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
        expect([ours.width, ours.height, info.width, info.height]).toEqual([img.width, img.height, img.width, img.height]);
        for (let i = 0, j = 0; i < ours.data.length; i += 4, j += 3) if (ours.data[i] !== data[j] || ours.data[i + 1] !== data[j + 1] || ours.data[i + 2] !== data[j + 2]) expect.fail(`pixel ${i / 4} differs`);
      }),
      { numRuns: RUNS },
    );
  });
});
