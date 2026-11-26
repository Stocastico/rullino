import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { editExif, PERSONAL_EXIF, walkExif } from './exif';
import { readExif, readMetadata } from './index';

const dir = fileURLToPath(new URL('../test/metadata/', import.meta.url));
const read = (name: string) => new Uint8Array(readFileSync(dir + name));
const exifs = await Promise.all(['photo.jpg', 'photo.png', 'photo.webp'].map(async (f) => [f, (await readMetadata(read(f))).exif!] as const));

/** Whether `needle` (ASCII, or UTF-16LE with `wide`) appears anywhere in `bytes`. */
function contains(bytes: Uint8Array, needle: string, wide = false): boolean {
  const n = wide ? [...needle].flatMap((c) => [c.charCodeAt(0), 0]) : [...needle].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + n.length <= bytes.length; i++) {
    for (let k = 0; k < n.length; k++) if (bytes[i + k] !== n[k]) continue outer;
    return true;
  }
  return false;
}
const key = (e: { ifd: string; tag: number }) => `${e.ifd}:${e.tag.toString(16)}`;

describe.each(exifs)('editExif on %s', (_, exif) => {
  const before = readExif(exif);

  it('without edits, a copy of the same bytes', () => {
    const out = editExif(exif, {});
    expect(out).not.toBe(exif);
    expect(Array.from(out)).toEqual(Array.from(exif));
  });

  it('orientation and size: patched where they lie, nothing else changes', () => {
    const out = editExif(exif, { orientation: 1, size: { width: 1000, height: 750 } });
    expect(out.length).toBe(exif.length);
    const after = readExif(out);
    const value = (ifd: string, tag: number) => after.find((e) => e.ifd === ifd && e.tag === tag)?.value;
    expect(value('ifd0', 0x0112)).toBe(1);
    expect([value('exif', 0xa002), value('exif', 0xa003)]).toEqual([1000, 750]);
    const unchanged = (e: { ifd: string; tag: number }) => !['ifd0:112', 'exif:a002', 'exif:a003'].includes(key(e));
    expect(after.filter(unchanged)).toEqual(before.filter(unchanged));
  });

  it('dropping the thumbnail removes IFD1 and zeroes the thumbnail image', () => {
    const thumbOffset = before.find((e) => e.ifd === 'ifd1' && e.tag === 0x0201)!.value as number;
    const thumbLength = before.find((e) => e.ifd === 'ifd1' && e.tag === 0x0202)!.value as number;
    expect(exif.subarray(thumbOffset, thumbOffset + 2)).toEqual(Uint8Array.from([0xff, 0xd8]));
    const out = editExif(exif, { dropThumbnail: true });
    const after = readExif(out);
    expect(after.some((e) => e.ifd === 'ifd1')).toBe(false);
    expect(walkExif(out).ifds.some((d) => d.name === 'ifd1')).toBe(false); // IFD0 no longer points to it
    expect(out.subarray(thumbOffset, thumbOffset + thumbLength).every((b) => b === 0)).toBe(true);
    expect(after).toEqual(before.filter((e) => e.ifd !== 'ifd1'));
  });

  it('removing GPS: no GPS pointer, no GPS IFD, its values zeroed, the rest unchanged', () => {
    const out = editExif(exif, { remove: { gps: true } });
    const after = readExif(out);
    expect(after.some((e) => e.ifd === 'gps')).toBe(false);
    expect(after.some((e) => e.ifd === 'ifd0' && e.tag === 0x8825)).toBe(false);
    expect(after).toEqual(before.filter((e) => e.ifd !== 'gps' && !(e.ifd === 'ifd0' && e.tag === 0x8825)));
    // The GPS IFD and the values it pointed to (latitude, longitude, altitude rationals) are zeros now.
    const { ifds } = walkExif(exif);
    const gps = ifds.find((d) => d.name === 'gps')!;
    expect(gps.entries.length).toBeGreaterThan(3);
    expect(out.subarray(gps.at, gps.at + 2 + 12 * gps.entries.length + 4).every((v) => v === 0)).toBe(true);
    for (const e of gps.entries) if (e.size > 4) expect(out.subarray(e.at, e.at + e.size).every((v) => v === 0)).toBe(true);
  });

  it('removing personal fields: none of their tags, and none of their text anywhere in the bytes', () => {
    for (const s of ['Jane Photographer', 'Jane Doe', 'SN-123456', 'LSN-987', 'private note', '0123456789abcdef']) expect([s, contains(exif, s)]).toEqual([s, true]);
    expect(contains(exif, 'Jane P', true)).toBe(true); // XPAuthor is UTF-16
    const out = editExif(exif, { remove: { personal: true } });
    for (const s of ['Jane Photographer', 'Jane Doe', 'SN-123456', 'LSN-987', 'private note', '0123456789abcdef']) expect([s, contains(out, s)]).toEqual([s, false]);
    expect(contains(out, 'Jane P', true)).toBe(false);
    const after = readExif(out);
    const personal = (e: { ifd: string; tag: number }) => PERSONAL_EXIF[e.ifd as 'ifd0']?.includes(e.tag) ?? false;
    expect(after.some(personal)).toBe(false);
    expect(after).toEqual(before.filter((e) => !personal(e)));
    expect(contains(out, 'RullinoCam') && contains(out, 'CC0')).toBe(true); // camera and copyright stay
    // No 12-byte record of a removed entry is left behind the shortened table: a value of up to
    // 4 bytes (a short serial number) lies inside its record.
    for (const ifd of walkExif(exif).ifds)
      for (const e of ifd.entries.filter((r) => PERSONAL_EXIF[ifd.name]?.includes(r.tag))) {
        const record = Array.from(exif.subarray(e.entry, e.entry + 12)).map((v) => String.fromCharCode(v)).join('');
        expect(contains(out, record)).toBe(false);
      }
  });

  it('everything at once still reads back, with only the expected entries', () => {
    const out = editExif(exif, { orientation: 1, size: { width: 9, height: 7 }, dropThumbnail: true, remove: { gps: true, personal: true } });
    const after = readExif(out);
    expect(after.map(key).sort()).toEqual(
      before
        .filter((e) => e.ifd !== 'gps' && e.ifd !== 'ifd1' && !(e.ifd === 'ifd0' && e.tag === 0x8825) && !(PERSONAL_EXIF[e.ifd as 'ifd0']?.includes(e.tag) ?? false))
        .map(key)
        .sort(),
    );
  });
});

describe('editExif', () => {
  it('a value that does not fit its field is removed rather than truncated', () => {
    const [, exif] = exifs[0]!;
    const type = readExif(exif).find((e) => e.ifd === 'exif' && e.tag === 0xa002)!.type;
    const out = editExif(exif, { size: { width: 70_000, height: 5 } });
    const after = readExif(out);
    if (type === 3) expect(after.some((e) => e.ifd === 'exif' && e.tag === 0xa002)).toBe(false);
    else expect(after.find((e) => e.ifd === 'exif' && e.tag === 0xa002)!.value).toBe(70_000);
    expect(after.find((e) => e.ifd === 'exif' && e.tag === 0xa003)!.value).toBe(5);
  });
});
