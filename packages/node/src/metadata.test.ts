import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readExif, readMetadata, readXmpEdit } from '@rullino/codecs';
import { describe, expect, it } from 'vitest';
import { createRenderer } from './index';

// #180: render() carries the source file's metadata onto the export as output.metadata says, and
// embeds the document; apply() (pixels in, pixels out) has no file to carry anything from.

const photo = new Uint8Array(readFileSync(fileURLToPath(new URL('../../codecs/test/metadata/photo.jpg', import.meta.url))));
const doc = (output: Record<string, unknown>) => ({ version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [{ filter: 'exposure', params: { ev: 0.5 } }] }], output });

describe('@rullino/node render and metadata', { timeout: 60_000 }, () => {
  it.each(['jpeg', 'png', 'webp'] as const)('%s: keeps everything by default, upright, at the export size, with the document embedded', async (format) => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const edit = doc({ format, longSide: 32 });
    const out = await renderer.render(photo, edit);
    const meta = await readMetadata(out.bytes);
    const exif = readExif(meta.exif!);
    expect(exif.find((e) => e.tag === 0x0112)!.value).toBe(1);
    // The source is 64 × 48 stored with orientation 6 (turned): upright it is 48 × 64, shrunk to 24 × 32.
    expect([out.width, out.height]).toEqual([24, 32]);
    expect([exif.find((e) => e.tag === 0xa002)!.value, exif.find((e) => e.tag === 0xa003)!.value]).toEqual([24, 32]);
    expect(exif.some((e) => e.ifd === 'gps')).toBe(true);
    expect(exif.some((e) => e.ifd === 'ifd1')).toBe(false);
    expect(JSON.parse(readXmpEdit(meta.xmp!)!)).toEqual(edit);
    expect(meta.icc).toBeDefined();
    renderer.destroy();
  });

  it("'strip' leaves only the colour profile; GPS and personal fields can go alone; embedEdit: false embeds nothing", async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const stripped = await readMetadata((await renderer.render(photo, doc({ format: 'jpeg', metadata: 'strip' }))).bytes);
    expect(Object.keys(stripped)).toEqual(['icc']);
    const clean = await readMetadata((await renderer.render(photo, doc({ format: 'jpeg', metadata: { strip: ['gps', 'personal'] } }))).bytes);
    expect(readExif(clean.exif!).some((e) => e.ifd === 'gps')).toBe(false);
    expect(clean.xmp).not.toContain('Jane Photographer');
    expect(readXmpEdit(clean.xmp!)).toBeDefined();
    const noEdit = await readMetadata((await renderer.render(photo, doc({ format: 'jpeg', embedEdit: false }))).bytes);
    expect(readXmpEdit(noEdit.xmp!)).toBeUndefined();
    renderer.destroy();
  });

  it('rendering from pixels has no source metadata, but still embeds the document', async () => {
    const renderer = await createRenderer({ backend: 'cpu' });
    const out = await renderer.render({ width: 2, height: 2, data: new Uint8Array(16).fill(128) }, doc({ format: 'png' }));
    const meta = await readMetadata(out.bytes);
    expect(Object.keys(meta)).toEqual(['xmp']);
    expect(readXmpEdit(meta.xmp!)).toBeDefined();
    renderer.destroy();
  });
});
