import { readExif, readMetadata, readXmpEdit } from '@rullino/codecs';
import { describe, expect, it } from 'vitest';
import { createRenderer } from './index';

// #180 in the browser: render() from a file carries its metadata onto the export as output.metadata
// says and embeds the document; the browser itself turns the photo upright on decode.

const photo = async () => new Blob([await (await fetch(new URL('../../codecs/test/metadata/photo.jpg', import.meta.url))).arrayBuffer()], { type: 'image/jpeg' });
const doc = (output: Record<string, unknown>) => ({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [{ filter: 'exposure', params: { ev: 0.5 } }] }], output });
const read = async (b: Blob) => readMetadata(new Uint8Array(await b.arrayBuffer()));

describe('@rullino/web render and metadata', { timeout: 60_000 }, () => {
  it.each(['jpeg', 'png', 'webp'] as const)('%s: keeps everything by default, upright, with the document embedded', async (format) => {
    const renderer = await createRenderer();
    const edit = doc({ format });
    const out = await renderer.render(await photo(), edit);
    expect(out.type).toBe(`image/${format}`);
    const meta = await read(out);
    const exif = readExif(meta.exif!);
    expect(exif.find((e) => e.tag === 0x0112)!.value).toBe(1);
    expect([exif.find((e) => e.tag === 0xa002)!.value, exif.find((e) => e.tag === 0xa003)!.value]).toEqual([48, 64]); // turned upright
    expect(exif.some((e) => e.ifd === 'gps')).toBe(true);
    expect(JSON.parse(readXmpEdit(meta.xmp!)!)).toEqual(edit);
    renderer.destroy();
  });

  it("'strip' keeps only the colour profile; { strip: ['personal'] } takes the names", async () => {
    const renderer = await createRenderer();
    expect(Object.keys(await read(await renderer.render(await photo(), doc({ format: 'jpeg', metadata: 'strip' }))))).toEqual(['icc']);
    const clean = await read(await renderer.render(await photo(), doc({ format: 'jpeg', metadata: { strip: ['personal'] } })));
    expect(clean.xmp).not.toContain('Jane Photographer');
    expect(readExif(clean.exif!).some((e) => e.ifd === 'gps')).toBe(true);
    renderer.destroy();
  });
});
