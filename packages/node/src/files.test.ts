import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { createRenderer } from './renderer';

// Files in and JPEG / WebP out go through sharp (an optional peer). The CPU backend keeps these
// tests about I/O; the GPU path is the same applyEdit (renderer.test.ts).
const renderer = await createRenderer({ backend: 'cpu' });

/** A 40×20 PNG: opaque red left half, fully transparent right half. */
async function halfTransparentPng() {
  const raw = new Uint8Array(40 * 20 * 4);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) raw.set([255, 0, 0, 255], (y * 40 + x) * 4);
  return sharp(raw, { raw: { width: 40, height: 20, channels: 4 } }).png().toBuffer();
}

const decode = (bytes: Uint8Array) => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

describe('files through sharp', () => {
  it('decodes a PNG file and encodes JPEG, flattened onto white, at the long side', async () => {
    const out = await renderer.render(await halfTransparentPng(), { version: 2, steps: [], output: { format: 'jpeg', quality: 0.9, longSide: 20 } });
    expect(out.format).toBe('jpeg');
    expect([out.bytes[0], out.bytes[1]]).toEqual([0xff, 0xd8]);
    const { data, info } = await decode(out.bytes);
    expect([info.width, info.height]).toEqual([20, 10]);
    const px = (x: number) => Array.from(data.subarray((5 * 20 + x) * 4, (5 * 20 + x) * 4 + 3));
    expect(px(2)[0]).toBeGreaterThan(240); // red stays red
    expect(px(2)[1]).toBeLessThan(20);
    expect(Math.min(...px(17))).toBeGreaterThan(240); // transparent became white
  });

  it('encodes WebP with alpha kept, and honours an explicit background', async () => {
    const webp = await renderer.render(await halfTransparentPng(), { version: 2, steps: [], output: { format: 'webp', quality: 1 } });
    expect(new TextDecoder().decode(webp.bytes.subarray(8, 12))).toBe('WEBP');
    const { data } = await decode(webp.bytes);
    expect(data[(5 * 40 + 35) * 4 + 3]).toBe(0); // transparent stays transparent
    const black = await renderer.render(await halfTransparentPng(), { version: 2, steps: [], output: { format: 'webp', background: [0, 0, 0] } });
    const flat = await decode(black.bytes);
    expect(flat.data[(5 * 40 + 35) * 4 + 3]).toBe(255);
    expect(flat.data[(5 * 40 + 35) * 4]).toBeLessThan(10);
  });

  it('applies the EXIF orientation of the input', async () => {
    const raw = new Uint8Array(4 * 2 * 4).fill(255);
    const rotated = await sharp(raw, { raw: { width: 4, height: 2, channels: 4 } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await renderer.render(rotated, { version: 2, steps: [] });
    expect([out.width, out.height]).toEqual([2, 4]);
  });

  it('PNG output from a file stays rullino’s own encoder (16 bit possible)', async () => {
    const out = await renderer.render(await halfTransparentPng(), { version: 2, steps: [], output: { bitDepth: 16 } });
    expect(out.format).toBe('png');
    expect(out.bytes[24]).toBe(16);
  });
});
