import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
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
});
