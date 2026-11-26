import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng, encodeJpeg, readExif, readMetadata, writeMetadata } from '@rullino/codecs';
import { encodePng, linearToOklab, linearToSrgb, outputProfile } from '@rullino/core';
import { encodeColour, gamutMapOklab, toLinearSrgb } from '@rullino/core/internal';
import { describe, expect, it } from 'vitest';
import { createRenderer } from './index';

// #181: render() reads PNG / JPEG / TIFF with @rullino/codecs, honours embedded colour profiles, and
// writes the output colour space (profile embedded), mapping what the output cannot hold.

const fixture = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../core/test/icc/${name}`, import.meta.url))));
const P3 = fixture('display-p3-v4.icc');
const doc = (output: Record<string, unknown>, steps: unknown[] = []) => ({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps }], output });

/** A 16 × 16 JPEG of one colour, tagged with a Display P3 profile (q 1: the colour comes back within 1-2 levels). */
async function p3Jpeg(rgb: [number, number, number]): Promise<Uint8Array> {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) data.set([...rgb, 255], i * 4);
  return (await writeMetadata(encodeJpeg({ width: 16, height: 16, data }, { quality: 1 }), { icc: P3 })).bytes;
}
const firstPixel = async (png: Uint8Array) => Array.from((await decodePng(png)).data.subarray(0, 4));

describe('@rullino/node render and colour management', { timeout: 120_000 }, () => {
  it('a Display P3 photo exported as Display P3 keeps its numbers, with the P3 profile embedded', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const out = await renderer.render(await p3Jpeg([230, 40, 60]), doc({ format: 'png', colorSpace: 'display-p3', metadata: 'strip' }));
    const px = await firstPixel(out.bytes);
    [230, 40, 60].forEach((v, i) => expect(Math.abs(px[i]! - v), `channel ${i}`).toBeLessThanOrEqual(3));
    expect(Array.from((await readMetadata(out.bytes)).icc!)).toEqual(Array.from(outputProfile('display-p3')));
    renderer.destroy();
  });

  it('exported as sRGB the same photo is mapped into the gamut at the same hue, with no profile written', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const src = [20, 255, 40];
    const out = await renderer.render(await p3Jpeg(src as [number, number, number]), doc({ format: 'png', metadata: 'strip' }));
    // What it should be, worked out here from the specification: P3 -> linear sRGB (outside sRGB) -> OKLCh mapping -> sRGB.
    const lin = toLinearSrgb('display-p3', src.map((v) => srgbDecode(v / 255)));
    expect(Math.min(...lin)).toBeLessThan(0); // the colour is outside sRGB
    const want = gamutMapOklab('srgb', linearToOklab(lin[0]!, lin[1]!, lin[2]!)).map((v) => Math.round(linearToSrgb(v) * 255));
    const px = await firstPixel(out.bytes);
    want.forEach((v, i) => expect(Math.abs(px[i]! - v), `channel ${i}`).toBeLessThanOrEqual(3));
    // Clipping per channel gives another colour.
    const clipped = lin.map((v) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255));
    const withClip = await firstPixel((await renderer.render(await p3Jpeg(src as [number, number, number]), doc({ format: 'png', metadata: 'strip', gamut: 'clip' }))).bytes);
    clipped.forEach((v, i) => expect(Math.abs(withClip[i]! - v), `clip ${i}`).toBeLessThanOrEqual(3));
    expect(withClip).not.toEqual(px);
    expect((await readMetadata(out.bytes)).icc).toBeUndefined(); // converted to sRGB: the source's P3 profile must not stay
    renderer.destroy();
  });

  it('an sRGB photo with no or an sRGB profile renders exactly as before (the plain 8-bit path), profile kept', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const photo = new Uint8Array(readFileSync(fileURLToPath(new URL('../../codecs/test/metadata/photo.jpg', import.meta.url))));
    const out = await renderer.render(photo, doc({ format: 'png' }, [{ filter: 'exposure', params: { ev: 0.5 } }]));
    expect((await readMetadata(out.bytes)).icc).toBeDefined();
    expect(readExif((await readMetadata(out.bytes)).exif!).find((e) => e.tag === 0x0112)!.value).toBe(1);
    expect([out.width, out.height]).toEqual([48, 64]); // upright
    renderer.destroy();
  });

  it('a 16-bit PNG keeps more than 8 bits through the pipeline', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const samples = new Uint16Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) samples.set([1000 + i * 700, 20000 + i * 5, 65535 - i * 300, 65535], i * 4);
    const out = await renderer.render(await encodePng(8, 8, samples), doc({ format: 'png', bitDepth: 16 }));
    const back = await decodePng(out.bytes);
    expect(back.bitDepth).toBe(16);
    let finer = 0;
    for (let i = 0; i < 64; i++) for (let c = 0; c < 3; c++) {
      const want = samples[i * 4 + c]!;
      expect(Math.abs((back.data as Uint16Array)[i * 4 + c]! - want), `pixel ${i} channel ${c}`).toBeLessThan(80);
      if (want % 257 !== 0) finer++;
    }
    expect(finer).toBeGreaterThan(100);
    renderer.destroy();
  });

  it('reports a profile it cannot use, reads the colours as sRGB, and still renders', async () => {
    const messages: string[] = [];
    const renderer = await createRenderer({ backend: 'cpu', onWarning: (m) => messages.push(m) });
    const data = new Uint8Array(16 * 16 * 4).fill(120);
    const file = (await writeMetadata(encodeJpeg({ width: 16, height: 16, data }), { icc: fixture('ITULab.icc') })).bytes;
    const out = await renderer.render(file, doc({ format: 'png', metadata: 'strip' }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/not supported/);
    expect(out.width).toBe(16);
    renderer.destroy();
  });

  it('writes the output space as an 8-bit PNG even when the source has no profile', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const out = await renderer.render({ width: 2, height: 2, data: new Uint8Array(16).fill(128) }, doc({ format: 'png', colorSpace: 'rec2020', metadata: 'strip' }));
    expect(Array.from((await readMetadata(out.bytes)).icc!)).toEqual(Array.from(outputProfile('rec2020')));
    const want = encodeColour('rec2020', 'map', [srgbDecode(128 / 255), srgbDecode(128 / 255), srgbDecode(128 / 255)]).map((v) => Math.round(v * 255));
    expect((await firstPixel(out.bytes)).slice(0, 3).map((v, i) => Math.abs(v - want[i]!))).toEqual([0, 0, 0]);
    renderer.destroy();
  });
});

const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
