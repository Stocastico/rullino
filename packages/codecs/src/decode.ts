// One entry point for any file (#179): the format from its first bytes, the built-in decoder for PNG,
// JPEG and TIFF, and decoders the caller brings for the formats this package does not decode itself
// (AVIF, HEIC, JPEG XL, WebP, GIF, BMP), e.g. a WASM build. What an injected decoder returns is
// checked like a built-in result, so a wrong one fails here and not later in a renderer.

import { decodeHdr, isHdr } from './hdr';
import { decodeJpeg } from './jpeg';
import { decodePng } from './png';
import { decodeTiff } from './tiff';
import { CodecError, DEFAULT_MAX_PIXELS, plain, type DecodedImage, type DecodeOptions } from './types';

export type ImageFormat = 'png' | 'jpeg' | 'tiff' | 'webp' | 'avif' | 'heic' | 'jxl' | 'gif' | 'bmp' | 'hdr' | 'exr';

/** A decoder for one format: the file's bytes in, a `DecodedImage` out (or a rejection). */
export type Decoder = (bytes: Uint8Array, options: DecodeOptions) => Promise<DecodedImage> | DecodedImage;

export interface DecodeAnyOptions extends DecodeOptions {
  /** Decoders by format: for formats without a built-in one, or to replace a built-in one. */
  readonly decoders?: Partial<Record<ImageFormat, Decoder>>;
}

const BUILT_IN: Partial<Record<ImageFormat, Decoder>> = { png: decodePng, jpeg: decodeJpeg, tiff: decodeTiff, hdr: decodeHdr };

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const starts = (b: Uint8Array, sig: readonly number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** The format of a file from its first bytes, or undefined when it is none of `ImageFormat`. */
export function detectFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (starts(bytes, [0x49, 0x49, 0x2a, 0x00]) || starts(bytes, [0x4d, 0x4d, 0x00, 0x2a]) || starts(bytes, [0x49, 0x49, 0x2b, 0x00]) || starts(bytes, [0x4d, 0x4d, 0x00, 0x2b])) return 'tiff';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (starts(bytes, [0xff, 0x0a]) || starts(bytes, [0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a])) return 'jxl';
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'gif';
  if (bytes.length >= 14 && ascii(bytes, 0, 2) === 'BM') return 'bmp';
  if (isHdr(bytes)) return 'hdr';
  // ISO base media files (AVIF, HEIC): an ftyp box with a major brand and compatible brands.
  if (bytes.length >= 16 && ascii(bytes, 4, 4) === 'ftyp') {
    const size = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
    const end = Math.min(bytes.length, Math.max(16, size));
    const brands = [ascii(bytes, 8, 4)];
    for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(bytes, at, 4));
    if (brands[0] === 'avif' || brands[0] === 'avis') return 'avif';
    if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'].includes(brands[0]!)) return 'heic';
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (brands.some((b) => ['heic', 'heix', 'heim', 'heis'].includes(b))) return 'heic';
  }
  return undefined;
}

/** Checks what a decoder returned against the contract of `DecodedImage`. */
function check(img: DecodedImage, format: ImageFormat, maxPixels: number): DecodedImage {
  const fail = (message: string): never => {
    throw new CodecError(format, `the decoder returned ${message}`);
  };
  if (!img || typeof img !== 'object') fail('no image');
  const { width, height, bitDepth, data } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) fail(`an invalid size ${width}×${height}`);
  if (width * height > maxPixels) fail(`${width}×${height}, larger than maxPixels (${maxPixels})`);
  const type = bitDepth === 8 ? Uint8Array : bitDepth === 16 ? Uint16Array : bitDepth === 32 ? Float32Array : fail(`bit depth ${String(bitDepth)}`);
  if (!(data instanceof type)) fail(`a ${data?.constructor?.name ?? typeof data} for ${bitDepth}-bit samples`);
  if (data.length !== width * height * 4) fail(`${data.length} samples for ${width}×${height} RGBA`);
  if (img.icc !== undefined && !(img.icc instanceof Uint8Array)) fail('an icc that is not a Uint8Array');
  return img;
}

/**
 * Decodes a file of any format there is a decoder for: PNG, JPEG and TIFF built in, the others
 * through `decoders` (`{ avif: myAvifDecoder }`). Rejects with a `CodecError` for an unknown format,
 * a format without a decoder, or what the decoder refuses or returns wrongly.
 */
export async function decode(input: Uint8Array, options: DecodeAnyOptions = {}): Promise<DecodedImage & { readonly format: ImageFormat }> {
  const bytes = plain(input);
  const format = detectFormat(bytes);
  if (!format) throw new CodecError('image', 'unknown format (not PNG, JPEG, TIFF, WebP, AVIF, HEIC, JPEG XL, GIF or BMP)');
  const decoder = options.decoders?.[format] ?? BUILT_IN[format];
  if (!decoder) throw new CodecError(format, `no decoder for ${format}: pass one as decoders: { ${format}: … }`);
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  const img = await decoder(bytes, { maxPixels });
  return { ...check(img, format, maxPixels), format };
}
