import { decodePng, encodeJpeg, readMetadata, writeMetadata } from '@rullino/codecs';
import { encodePng, linearToOklab, linearToSrgb, outputProfile } from '@rullino/core';
import { gamutMapOklab, toLinearSrgb } from '@rullino/core/internal';
import { describe, expect, it } from 'vitest';
import { createRenderer } from './index';

// #181 in the browser: render() reads PNG / JPEG with @rullino/codecs (the same pixels everywhere),
// honours embedded colour profiles and writes the output colour space with its profile.

const P3 = new Uint8Array(await (await fetch(new URL('../../core/test/icc/display-p3-v4.icc', import.meta.url))).arrayBuffer());
const doc = (output: Record<string, unknown>) => ({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [] }], output });
const srgbDecode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

async function p3Jpeg(rgb: number[]): Promise<Blob> {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) data.set([...rgb, 255], i * 4);
  const bytes = (await writeMetadata(encodeJpeg({ width: 16, height: 16, data }, { quality: 1 }), { icc: P3 })).bytes;
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
}
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const firstPixel = async (b: Blob) => Array.from((await decodePng(await bytesOf(b))).data.subarray(0, 4));

describe('@rullino/web render and colour management', { timeout: 120_000 }, () => {
  it('a Display P3 photo exported as Display P3 keeps its numbers, with the P3 profile embedded', async () => {
    const renderer = await createRenderer();
    const out = await renderer.render(await p3Jpeg([230, 40, 60]), doc({ format: 'png', colorSpace: 'display-p3', metadata: 'strip' }));
    const px = await firstPixel(out);
    [230, 40, 60].forEach((v, i) => expect(Math.abs(px[i]! - v), `channel ${i}`).toBeLessThanOrEqual(3));
    expect(Array.from((await readMetadata(await bytesOf(out))).icc!)).toEqual(Array.from(outputProfile('display-p3')));
    renderer.destroy();
  });

  it('exported as sRGB it is mapped into the gamut at the same hue, with no profile written', async () => {
    const renderer = await createRenderer();
    const src = [20, 255, 40];
    const out = await renderer.render(await p3Jpeg(src), doc({ format: 'png', metadata: 'strip' }));
    const lin = toLinearSrgb('display-p3', src.map((v) => srgbDecode(v / 255)));
    expect(Math.min(...lin)).toBeLessThan(0);
    const want = gamutMapOklab('srgb', linearToOklab(lin[0]!, lin[1]!, lin[2]!)).map((v) => Math.round(linearToSrgb(v) * 255));
    const px = await firstPixel(out);
    want.forEach((v, i) => expect(Math.abs(px[i]! - v), `channel ${i}`).toBeLessThanOrEqual(3));
    expect((await readMetadata(await bytesOf(out))).icc).toBeUndefined();
    renderer.destroy();
  });

  it('a 16-bit PNG keeps more than 8 bits', async () => {
    const renderer = await createRenderer();
    const samples = new Uint16Array(8 * 8 * 4);
    for (let i = 0; i < 64; i++) samples.set([1000 + i * 700, 20000 + i * 5, 65535 - i * 300, 65535], i * 4);
    const file = new Blob([(await encodePng(8, 8, samples)) as Uint8Array<ArrayBuffer>], { type: 'image/png' });
    const back = await decodePng(await bytesOf(await renderer.render(file, doc({ format: 'png', bitDepth: 16 }))));
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

  it('files the codecs do not read (WebP) go through the browser, upright, as before', async () => {
    const canvas = new OffscreenCanvas(6, 4);
    const g = canvas.getContext('2d')!;
    g.fillStyle = 'rgb(200, 50, 50)';
    g.fillRect(0, 0, 6, 4);
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 1 });
    const renderer = await createRenderer();
    const out = await renderer.render(webp, doc({ format: 'png', metadata: 'strip' }));
    const px = await firstPixel(out);
    expect(Math.abs(px[0]! - 200)).toBeLessThan(6);
    renderer.destroy();
  });

  it('reports a profile it cannot use through onWarning and still renders', async () => {
    const messages: string[] = [];
    const lab = new Uint8Array(await (await fetch(new URL('../../core/test/icc/ITULab.icc', import.meta.url))).arrayBuffer());
    const bytes = (await writeMetadata(encodeJpeg({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(150) }), { icc: lab })).bytes;
    const renderer = await createRenderer({ onWarning: (m) => messages.push(m) });
    const out = await renderer.render(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), doc({ format: 'png', metadata: 'strip' }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/not supported/);
    expect((await firstPixel(out))[0]).toBeGreaterThan(100);
    renderer.destroy();
  });

  it('reads an OpenEXR file as linear HDR light: values far above 1 survive until the exposure cut', async () => {
    const get = async (name: string) => new Uint8Array(await (await fetch(new URL(`../../codecs/test/hdr/${name}`, import.meta.url))).arrayBuffer());
    const ref = new Float32Array((await get('block-none-half.f32')).buffer.slice(0));
    const renderer = await createRenderer();
    const file = new Blob([(await get('block-none-half.exr')) as Uint8Array<ArrayBuffer>]);
    const out = await renderer.render(file, { version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [{ filter: 'exposure', params: { ev: -5 } }] }], output: { format: 'png', metadata: 'strip' } });
    const png = await decodePng(await bytesOf(out));
    const i = 2 * 64 + 3; // the 900-bright pixel
    for (let c = 0; c < 3; c++) {
      const want = Math.round(linearToSrgb(Math.min(1, ref[i * 4 + c]! * 2 ** -5)) * 255);
      expect(Math.abs((png.data as Uint8Array)[i * 4 + c]! - want), `channel ${c}`).toBeLessThanOrEqual(2);
    }
    renderer.destroy();
  });
});
