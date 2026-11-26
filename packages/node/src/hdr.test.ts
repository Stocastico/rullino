import { encodeTiff, readUltraHdr } from '@rullino/codecs';
import { createRenderer } from './index';
import { describe, expect, it } from 'vitest';
import { decodeJpeg, readMetadata } from '@rullino/codecs';

// #182: render() writes an Ultra HDR JPEG when the document says output.hdr "gain-map" and starts from
// the HDR rendition of an Ultra HDR input; without it, the SDR JPEG is all there is.

const W = 48;
const H = 32;
/** Scene-linear light: a warm ramp from 0.05 to about 10 times SDR white. */
async function hdrTiff(): Promise<Uint8Array> {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = 0.05 * 200 ** (x / (W - 1)); // 0.05 .. 10
      data.set([t, t * (0.8 - 0.2 * (y / H)), t * (0.6 - 0.2 * (y / H)), 1], (y * W + x) * 4);
    }
  return await encodeTiff({ width: W, height: H, bitDepth: 32, data }, { compression: 'none' });
}
const doc = (output: Record<string, unknown>, steps: unknown[] = []) => ({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps }], output });

describe('@rullino/node render and HDR', { timeout: 120_000 }, () => {
  it('a float TIFF rendered with hdr "gain-map" is an Ultra HDR JPEG: the SDR picture rolled off, the gain map, the metadata', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const out = await renderer.render(await hdrTiff(), doc({ format: 'jpeg', quality: 0.95, hdr: 'gain-map' }));
    const parts = readUltraHdr(out.bytes);
    expect(parts).toBeDefined();
    expect(parts!.metadata.alternateHdrHeadroom).toBeGreaterThan(2); // ~ 10× SDR white needs 3+ stops
    const sdr = await decodeJpeg(parts!.primary);
    expect([sdr.width, sdr.height]).toEqual([W, H]);
    const last = (W - 1) * 4;
    expect((sdr.data as Uint8Array)[last]).toBeGreaterThan(240); // the highlights are (nearly) white in SDR
    const gm = await decodeJpeg(parts!.gainMap);
    expect(gm.width).toBe(W);
    // The edit travels in the primary's XMP next to the container directory.
    const meta = await readMetadata(out.bytes);
    expect(meta.xmp).toContain('rullino:edit');
    expect(meta.xmp).toContain('Container:Directory');
    renderer.destroy();
  });

  it('rendering that file again from its HDR rendition gives the HDR light back, within JPEG and 8-bit gain precision', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const first = await renderer.render(await hdrTiff(), doc({ format: 'jpeg', quality: 0.98, hdr: 'gain-map', metadata: 'strip' }));
    // Two stops down from the HDR picture (not from the SDR base: that one is clipped at 1).
    const second = await renderer.render(first.bytes, doc({ format: 'jpeg', quality: 0.98, hdr: 'gain-map', metadata: 'strip' }, [{ filter: 'exposure', params: { ev: -2 } }]));
    const a = readUltraHdr(first.bytes)!.metadata;
    const b = readUltraHdr(second.bytes)!.metadata;
    // Two stops less light: the HDR picture needs about two stops less gain.
    expect(a.alternateHdrHeadroom - b.alternateHdrHeadroom).toBeGreaterThan(1.2);
    expect(a.alternateHdrHeadroom - b.alternateHdrHeadroom).toBeLessThan(2.6);
    renderer.destroy();
  });

  it('without hdr an Ultra HDR file is just its SDR JPEG', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const uhdr = (await renderer.render(await hdrTiff(), doc({ format: 'jpeg', hdr: 'gain-map', metadata: 'strip' }))).bytes;
    const plain = await renderer.render(uhdr, doc({ format: 'jpeg', metadata: 'strip' }));
    expect(readUltraHdr(plain.bytes)).toBeUndefined();
    expect([plain.width, plain.height]).toEqual([W, H]);
    renderer.destroy();
  });
});
