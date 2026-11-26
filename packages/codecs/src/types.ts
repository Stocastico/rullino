/** Why a file could not be decoded (or encoded): a malformed, truncated, unsupported or too large input. */
export class CodecError extends Error {
  /** The format the codec was reading or writing. */
  readonly format: string;
  constructor(format: string, message: string, options?: { cause?: unknown }) {
    super(`${format}: ${message}`, options);
    this.name = 'CodecError';
    this.format = format;
  }
}

/** CIE 1931 xy chromaticities of a set of RGB primaries and its white point. */
export interface Chromaticities {
  readonly red: readonly [number, number];
  readonly green: readonly [number, number];
  readonly blue: readonly [number, number];
  readonly white: readonly [number, number];
}

/**
 * A decoded image: RGBA interleaved, straight (not premultiplied) alpha, the samples as the file
 * stores them (encoded with the file's transfer curve, usually sRGB; colour management is the
 * caller's, through `icc`). Grey is replicated into R, G and B; images without alpha get an opaque one.
 */
export type DecodedImage = {
  readonly width: number;
  readonly height: number;
  /** The ICC profile embedded in the file, if any, as its raw bytes. */
  readonly icc?: Uint8Array;
  /**
   * HDR formats (OpenEXR, Radiance): the samples are linear scene light, not encoded with a transfer
   * curve, and may be far above 1. Absent for the formats that store encoded values.
   */
  readonly linear?: true;
  /** CIE xy chromaticities of the colour values, when the file says (HDR formats); absent means Rec. 709 / sRGB. */
  readonly primaries?: Chromaticities;
} & (
  | { readonly bitDepth: 8; readonly data: Uint8Array }
  | { readonly bitDepth: 16; readonly data: Uint16Array }
  /** Floating point (TIFF), as stored: values may lie outside [0, 1] (HDR); alpha 1 is opaque. */
  | { readonly bitDepth: 32; readonly data: Float32Array }
);

export interface DecodeOptions {
  /**
   * The largest image accepted, in pixels (width × height), checked on the header before anything
   * is allocated. Default `DEFAULT_MAX_PIXELS` (2^28, 268 MP: 2 GB of 16-bit RGBA).
   */
  readonly maxPixels?: number;
}

export const DEFAULT_MAX_PIXELS = 2 ** 28;

/**
 * `bytes` as a plain Uint8Array view of the same memory. Node's Buffer is a Uint8Array whose slice()
 * returns a view instead of a copy: code that copies with slice() and then writes would write into the
 * caller's data. Every entry point of the package passes its input through this first.
 */
export const plain = (bytes: Uint8Array): Uint8Array => (Object.getPrototypeOf(bytes) === Uint8Array.prototype ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
