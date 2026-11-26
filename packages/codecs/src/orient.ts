// EXIF orientation as an exact permutation of the pixels (RFC #181): what a decoder that applies the
// tag does (libvips, browsers), so a file decoded here is turned the same way, in every runtime.

import { decode, type DecodeAnyOptions, type ImageFormat } from './decode';
import { readExif } from './exif';
import { readMetadata } from './metadata';
import { CodecError, type DecodedImage } from './types';

/** IFD0's Orientation of an EXIF blob: 1 to 8, or 1 when it is missing, unknown or the blob is broken. */
export function exifOrientation(exif: Uint8Array | undefined): number {
  if (!exif) return 1;
  try {
    const v = readExif(exif).find((e) => e.ifd === 'ifd0' && e.tag === 0x0112)?.value;
    return typeof v === 'number' && v >= 1 && v <= 8 ? v : 1;
  } catch (e) {
    if (e instanceof CodecError) return 1;
    throw e;
  }
}

/**
 * The image turned and flipped as EXIF orientation `o` (1 to 8) says the stored pixels must be shown:
 * 2 mirror, 3 rotate 180°, 4 flip, 5 transpose, 6 rotate 90° clockwise, 7 transverse, 8 rotate 90°
 * counter-clockwise. 1 and anything else return the image itself; otherwise a new image (4 samples per
 * pixel, any bit depth), the input untouched.
 */
export function orient(img: DecodedImage, o: number): DecodedImage {
  if (!(o >= 2 && o <= 8) || !Number.isInteger(o)) return img;
  const { width: w, height: h } = img;
  const swap = o >= 5;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const src = img.data;
  const out = new (src.constructor as new (n: number) => typeof src)(src.length);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const [sx, sy] =
        o === 2 ? [w - 1 - x, y]
        : o === 3 ? [w - 1 - x, h - 1 - y]
        : o === 4 ? [x, h - 1 - y]
        : o === 5 ? [y, x]
        : o === 6 ? [y, h - 1 - x]
        : o === 7 ? [w - 1 - y, h - 1 - x]
        : [w - 1 - y, x];
      const from = (sy! * w + sx!) * 4;
      const to = (y * ow + x) * 4;
      out[to] = src[from]!;
      out[to + 1] = src[from + 1]!;
      out[to + 2] = src[from + 2]!;
      out[to + 3] = src[from + 3]!;
    }
  return { ...img, width: ow, height: oh, data: out } as DecodedImage;
}

/** `decode`, then `orient` by the file's EXIF orientation (PNG and TIFF as well as JPEG); reports the orientation applied. */
export async function decodeOriented(input: Uint8Array, options: DecodeAnyOptions = {}): Promise<DecodedImage & { readonly format: ImageFormat; readonly orientation: number }> {
  const img = await decode(input, options);
  let orientation = 1;
  try {
    orientation = exifOrientation((await readMetadata(input)).exif);
  } catch (e) {
    if (!(e instanceof CodecError)) throw e;
  }
  return { ...orient(img, orientation), format: img.format, orientation };
}
