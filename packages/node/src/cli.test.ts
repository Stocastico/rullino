import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { editXmp, encodeJpeg, readExif, readMetadata, readXmpEdit, writeMetadata } from '@rullino/codecs';
import { fileURLToPath } from 'node:url';
import { runCli } from './cli';

/** A small opaque PNG of one colour. */
const photo = (r: number, g: number, b: number, w = 40, h = 20) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'rullino-cli-'));
  await mkdir(join(dir, 'in'));
  await writeFile(join(dir, 'in', 'a.png'), await photo(200, 100, 50));
  await writeFile(join(dir, 'in', 'b.png'), await photo(10, 200, 90, 30, 30));
  await writeFile(join(dir, 'in', 'notes.txt'), 'not an image');
  await writeFile(join(dir, 'edit.json'), JSON.stringify({ version: 2, steps: [{ filter: 'invert', params: {} }] }));
  return dir;
}
const run = async (args: string[]) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
};
const pixel = async (file: string) => Array.from((await sharp(await readFile(file)).raw().toBuffer()).subarray(0, 3));

describe('rullino CLI', { timeout: 60_000 }, () => {
  it('renders an edit file onto a folder, skipping what is not an image', async () => {
    const dir = await workspace();
    const r = await run(['render', '--edit', join(dir, 'edit.json'), join(dir, 'in'), '-o', join(dir, 'out'), '--backend', 'cpu']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect((await readdir(join(dir, 'out'))).sort()).toEqual(['a.png', 'b.png']);
    const [red, green, blue] = await pixel(join(dir, 'out', 'a.png'));
    expect(Math.abs(red! - 55)).toBeLessThan(3); // inverted: 255 - 200
    expect(Math.abs(green! - 155)).toBeLessThan(3);
    expect(Math.abs(blue! - 205)).toBeLessThan(3);
    expect(r.out).toContain('2 photos');
  });

  it('renders a named look on single files, with format and size overrides', async () => {
    const dir = await workspace();
    const r = await run(['render', '--look', 'golden', join(dir, 'in', 'a.png'), '-o', join(dir, 'out'), '--format', 'jpeg', '--long-side', '20', '--backend', 'cpu']);
    expect(r.code).toBe(0);
    expect(await readdir(join(dir, 'out'))).toEqual(['a.jpg']);
    const info = await sharp(await readFile(join(dir, 'out', 'a.jpg'))).metadata();
    expect([info.format, info.width, info.height]).toEqual(['jpeg', 20, 10]);
  });

  it('renders a version 3 graph (resize, then a chain), with --long-side merged into its output', async () => {
    const dir = await workspace();
    const graph = {
      version: 3,
      inputs: { photo: {} },
      nodes: [
        { id: 'small', kind: 'resize', from: 'photo', longSide: 20 },
        { id: 'inverted', from: 'small', steps: [{ filter: 'invert', params: {} }] },
      ],
      output: { node: 'inverted', format: 'png' },
    };
    await writeFile(join(dir, 'graph.json'), JSON.stringify(graph));
    const r = await run(['render', '--edit', join(dir, 'graph.json'), join(dir, 'in', 'a.png'), '-o', join(dir, 'out'), '--backend', 'cpu']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const info = await sharp(await readFile(join(dir, 'out', 'a.png'))).metadata();
    expect([info.width, info.height]).toEqual([20, 10]);
    const [red] = await pixel(join(dir, 'out', 'a.png'));
    expect(Math.abs(red! - 55)).toBeLessThan(3);
    const smaller = await run(['render', '--edit', join(dir, 'graph.json'), join(dir, 'in', 'a.png'), '-o', join(dir, 'out2'), '--long-side', '8', '--backend', 'cpu']);
    expect(smaller.code).toBe(0);
    expect((await sharp(await readFile(join(dir, 'out2', 'a.png'))).metadata()).width).toBe(8);
  });

  it('--strip-metadata strips it all, =gps / =personal (comma-separated) only those; without it, everything stays', async () => {
    const dir = await workspace();
    const source = fileURLToPath(new URL('../../codecs/test/metadata/photo.jpg', import.meta.url));
    const out = async (flags: string[]) => {
      const target = join(dir, `out-${flags.join('-').replace(/[^a-z]/g, '') || 'keep'}`);
      const r = await run(['render', '--look', 'golden', source, '-o', target, '--format', 'jpeg', '--backend', 'cpu', ...flags]);
      expect(r.err).toBe('');
      return readMetadata(new Uint8Array(await readFile(join(target, 'photo.jpg'))));
    };
    const kept = await out([]);
    expect(readExif(kept.exif!).some((e) => e.ifd === 'gps')).toBe(true);
    expect(kept.xmp).toContain('Jane Photographer');
    expect(readXmpEdit(kept.xmp!)).toBeDefined();
    expect(Object.keys(await out(['--strip-metadata']))).toEqual(['icc']);
    const gps = await out(['--strip-metadata=gps']);
    expect(readExif(gps.exif!).some((e) => e.ifd === 'gps')).toBe(false);
    expect(gps.xmp).toContain('Jane Photographer');
    const both = await out(['--strip-metadata=gps,personal']);
    expect(both.xmp).not.toContain('Jane Photographer');
    expect(readExif(both.exif!).some((e) => e.ifd === 'gps')).toBe(false);
    const bad = await run(['render', '--look', 'golden', source, '-o', join(dir, 'x'), '--strip-metadata=faces']);
    expect([bad.code, bad.err]).toEqual([2, expect.stringMatching(/--strip-metadata.*gps.*personal/)]);
  });

  it('info prints what a photo carries, and the edit document it was rendered with', async () => {
    const dir = await workspace();
    const source = fileURLToPath(new URL('../../codecs/test/metadata/photo.jpg', import.meta.url));
    const plain = await run(['info', source]);
    expect(plain.code).toBe(0);
    for (const line of ['jpeg', 'RullinoCam Test Model 1', '2026:11:25 09:30:00', 'orientation 6', 'GPS: yes', 'ICC profile', 'edit document: none']) expect(plain.out).toContain(line);
    await run(['render', '--look', 'golden', source, '-o', join(dir, 'out'), '--format', 'jpeg', '--backend', 'cpu']);
    const rendered = await run(['info', join(dir, 'out', 'photo.jpg')]);
    expect(rendered.out).toContain('orientation 1');
    const json = rendered.out.slice(rendered.out.indexOf('{'));
    expect(JSON.parse(json).nodes).toBeDefined();
    expect((await run(['info'])).code).toBe(2);
    const missing = await run(['info', join(dir, 'nope.jpg')]);
    expect([missing.code, missing.err]).toEqual([1, expect.stringContaining('nope.jpg')]);
  });

  it('info on photos without EXIF, with blocks it cannot read, and with an edit that is not JSON', async () => {
    const dir = await workspace();
    const none = await run(['info', join(dir, 'in', 'a.png')]);
    expect(none.out).toContain('EXIF: none');
    expect(none.out).toContain('XMP: none');
    expect(none.out).toContain('IPTC: none');
    const jpeg = encodeJpeg({ width: 2, height: 2, data: new Uint8Array(16) });
    const odd = (await writeMetadata(jpeg, { exif: Uint8Array.from([0x49, 0x49, 42, 0, 99, 0, 0, 0]), iptc: Uint8Array.of(7, 7, 7), xmp: editXmp(undefined, { edit: 'not json {' }) })).bytes;
    await writeFile(join(dir, 'odd.jpg'), odd);
    const r = await run(['info', join(dir, 'odd.jpg')]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/EXIF: unreadable/);
    expect(r.out).toContain('IPTC: unreadable');
    expect(r.out).toContain('edit document:\nnot json {');
    // No DateTimeOriginal: the date comes from IFD0's DateTime.
    const date = Uint8Array.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x32, 0x01, 2, 0, 20, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0, ...new TextEncoder().encode('2020:01:02 03:04:05\0')]);
    await writeFile(join(dir, 'date.jpg'), (await writeMetadata(jpeg, { exif: date })).bytes);
    expect((await run(['info', join(dir, 'date.jpg')])).out).toContain('taken: 2020:01:02 03:04:05');
  });

  it('lists the looks', async () => {
    const r = await run(['looks']);
    expect(r.code).toBe(0);
    expect(r.out.split('\n')).toContain('golden');
  });

  it('refuses to overwrite its input and says what is wrong', async () => {
    const dir = await workspace();
    const same = await run(['render', '--edit', join(dir, 'edit.json'), join(dir, 'in', 'a.png'), '-o', join(dir, 'in'), '--backend', 'cpu']);
    expect(same.code).toBe(1);
    expect(same.err).toMatch(/overwrite/);
    expect(await run(['render', join(dir, 'in')])).toMatchObject({ code: 2, err: expect.stringMatching(/--edit|--look/) });
    expect(await run(['render', '--look', 'nope', join(dir, 'in')])).toMatchObject({ code: 2, err: expect.stringMatching(/nope.*rullino looks/s) });
    expect(await run(['render', '--edit', join(dir, 'edit.json')])).toMatchObject({ code: 2, err: expect.stringMatching(/no input/i) });
    expect(await run(['bogus'])).toMatchObject({ code: 2 });
    expect((await run(['--help'])).out).toMatch(/usage/i);
  });

  it('reports a bad edit document once, before rendering anything, without a stack trace', async () => {
    const dir = await workspace();
    await writeFile(join(dir, 'bad.json'), JSON.stringify({ version: 2, steps: [{ filter: 'doesNotExist', params: {} }] }));
    const r = await run(['render', '--edit', join(dir, 'bad.json'), join(dir, 'in'), '-o', join(dir, 'out'), '--backend', 'cpu']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/doesNotExist/);
    expect(r.err).not.toMatch(/\n\s+at /);
    expect(r.err.match(/doesNotExist/g)).toHaveLength(1); // not once per photo
    expect(r.out).not.toMatch(/Rendering/);
    expect(await readdir(dir)).not.toContain('out');
  });

  describe('validate', () => {
    const doc = (d: unknown) => JSON.stringify(d);

    it('says ok for each valid document (a look, a version 2 chain, a version 3 graph) and exits 0', async () => {
      const dir = await workspace();
      await writeFile(join(dir, 'look.json'), doc({ version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }, { filter: 'vignette', params: {} }] }));
      await writeFile(join(dir, 'graph.json'), doc({ version: 3, inputs: { photo: {} }, nodes: [{ id: 'small', kind: 'resize', from: 'photo', longSide: 20 }] }));
      const r = await run(['validate', join(dir, 'edit.json'), join(dir, 'look.json'), join(dir, 'graph.json')]);
      expect(r.err).toBe('');
      expect(r.code).toBe(0);
      expect(r.out.split('\n')).toEqual([`${join(dir, 'edit.json')}: ok`, `${join(dir, 'look.json')}: ok`, `${join(dir, 'graph.json')}: ok`]);
    });

    it('accepts a document that names a built-in look LUT', async () => {
      const dir = await workspace();
      await writeFile(join(dir, 'lut.json'), doc({ version: 2, steps: [{ filter: 'applyLut', params: { look: { ref: 'look:golden' } } }] }));
      expect(await run(['validate', join(dir, 'lut.json')])).toMatchObject({ code: 0, err: '' });
      await writeFile(join(dir, 'nolut.json'), doc({ version: 2, steps: [{ filter: 'applyLut', params: { look: { ref: 'my-own.cube' } } }] }));
      expect(await run(['validate', join(dir, 'nolut.json')])).toMatchObject({ code: 1, err: expect.stringMatching(/unknown LUT "my-own\.cube"/) });
    });

    it('agrees with render on numbers outside a parameter\'s range: they are clamped, so the document is valid', async () => {
      const dir = await workspace();
      await writeFile(join(dir, 'range.json'), doc({ version: 2, steps: [{ filter: 'exposure', params: { ev: 99 } }] }));
      expect(await run(['validate', join(dir, 'range.json')])).toMatchObject({ code: 0, out: `${join(dir, 'range.json')}: ok` });
    });

    it('names the problem for an unknown filter, an unknown parameter and a wrong type, and exits 1', async () => {
      const dir = await workspace();
      await writeFile(join(dir, 'unknown.json'), doc({ version: 2, steps: [{ filter: 'doesNotExist', params: {} }] }));
      await writeFile(join(dir, 'param.json'), doc({ version: 2, steps: [{ filter: 'exposure', params: { nope: 1 } }] }));
      await writeFile(join(dir, 'type.json'), doc({ version: 2, steps: [{ filter: 'exposure', params: { ev: 'bright' } }] }));
      for (const [file, what] of [['unknown.json', /doesNotExist/], ['param.json', /unknown parameter "nope"/], ['type.json', /parameter "ev".*"bright"/]] as const) {
        const r = await run(['validate', join(dir, file)]);
        expect(r.code).toBe(1);
        expect(r.out).toBe('');
        expect(r.err).toMatch(what);
        expect(r.err.startsWith(`${join(dir, file)}: `)).toBe(true);
        expect(r.err).not.toMatch(/\n\s+at /); // no stack trace
      }
    });

    it('says what is wrong with a file that is missing or is not JSON, and still checks the rest', async () => {
      const dir = await workspace();
      await writeFile(join(dir, 'broken.json'), '{ "version": 2, ');
      const r = await run(['validate', join(dir, 'missing.json'), join(dir, 'broken.json'), join(dir, 'edit.json')]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/missing\.json: cannot read/);
      expect(r.err).toMatch(/broken\.json: .*JSON/i);
      expect(r.out).toBe(`${join(dir, 'edit.json')}: ok`); // the valid one is still reported
    });

    it('refuses a document that is not an object, and an empty one', async () => {
      const dir = await workspace();
      await writeFile(join(dir, 'array.json'), '[]');
      await writeFile(join(dir, 'empty.json'), '{}');
      expect((await run(['validate', join(dir, 'array.json')])).code).toBe(1);
      expect((await run(['validate', join(dir, 'empty.json')])).code).toBe(1);
    });

    it('is a usage error (2) without a file, and a folder of photos is not a document', async () => {
      expect(await run(['validate'])).toMatchObject({ code: 2, err: expect.stringMatching(/give at least one edit document/) });
      const dir = await workspace();
      // Photos never matter: a folder of images is not a document.
      expect((await run(['validate', join(dir, 'in')])).code).toBe(1);
      expect(await readdir(dir)).not.toContain('rullino-out');
    });

    it('is listed in --help', async () => {
      expect((await run(['--help'])).out).toMatch(/rullino validate/);
    });
  });

  it('prints what render could not use in a file (an unsupported colour profile) and still renders it (#181)', async () => {
    const dir = await workspace();
    const icc = new Uint8Array(await readFile(fileURLToPath(new URL('../../core/test/icc/ITULab.icc', import.meta.url))));
    const jpeg = (await writeMetadata(encodeJpeg({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(150) }), { icc })).bytes;
    await writeFile(join(dir, 'in', 'lab.jpg'), jpeg);
    const r = await run(['render', '--edit', join(dir, 'edit.json'), join(dir, 'in', 'lab.jpg'), '-o', join(dir, 'out'), '--backend', 'cpu']);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/rullino: .*not supported.*read as sRGB/);
    expect(await readdir(join(dir, 'out'))).toEqual(['lab.png']);
  });
});
