import { decodeJpeg, encodeTiff, readMetadata, readUltraHdr } from '@rullino/codecs';
import { describe, expect, it } from 'vitest';
import { createRenderer } from './index';

// #182 in the browser: output.hdr "gain-map" writes an Ultra HDR JPEG, and an Ultra HDR input starts from
// its HDR rendition.

const W = 48;
const H = 32;
async function hdrTiff(): Promise<Blob> {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = 0.05 * 200 ** (x / (W - 1));
      data.set([t, t * (0.8 - 0.2 * (y / H)), t * (0.6 - 0.2 * (y / H)), 1], (y * W + x) * 4);
    }
  return new Blob([(await encodeTiff({ width: W, height: H, bitDepth: 32, data }, { compression: 'none' })) as Uint8Array<ArrayBuffer>], { type: 'image/tiff' });
}
const doc = (output: Record<string, unknown>, steps: unknown[] = []) => ({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps }], output });
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('@rullino/web render and HDR', { timeout: 120_000 }, () => {
  it('writes an Ultra HDR JPEG from HDR light, and reads its HDR rendition back', async () => {
    const renderer = await createRenderer();
    const first = await renderer.render(await hdrTiff(), doc({ format: 'jpeg', quality: 0.95, hdr: 'gain-map' }));
    expect(first.type).toBe('image/jpeg');
    const parts = readUltraHdr(await bytesOf(first))!;
    expect(parts).toBeDefined();
    expect(parts.metadata.alternateHdrHeadroom).toBeGreaterThan(2);
    const sdr = await decodeJpeg(parts.primary);
    expect([sdr.width, sdr.height]).toEqual([W, H]);
    expect((sdr.data as Uint8Array)[(W - 1) * 4]).toBeGreaterThan(240);
    expect((await readMetadata(await bytesOf(first))).xmp).toContain('Container:Directory');
    // From its HDR rendition two stops down: about two stops less gain; from the SDR picture there would be none to lose.
    const second = await renderer.render(first, doc({ format: 'jpeg', quality: 0.95, hdr: 'gain-map' }, [{ filter: 'exposure', params: { ev: -2 } }]));
    const b = readUltraHdr(await bytesOf(second))!.metadata;
    expect(parts.metadata.alternateHdrHeadroom - b.alternateHdrHeadroom).toBeGreaterThan(1.2);
    expect(parts.metadata.alternateHdrHeadroom - b.alternateHdrHeadroom).toBeLessThan(2.6);
    // Without hdr it is just the SDR JPEG.
    const plain = await renderer.render(first, doc({ format: 'jpeg' }));
    expect(readUltraHdr(await bytesOf(plain))).toBeUndefined();
    renderer.destroy();
  });
});
