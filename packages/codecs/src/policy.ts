// What an exported image carries of its source's metadata (#180): the maintainer's default is to keep
// everything (a photo keeps what the camera wrote), with an option to strip it all or just GPS and
// personal fields. Whatever is kept is made true of the export: orientation 1 (the pixels are
// already turned), the export's size, no thumbnail (it would show the unedited, uncropped original).

import { editExif } from './exif';
import { readIptc, writeIptc } from './iptc';
import { readMetadata, writeMetadata, type ImageMetadata } from './metadata';
import { CodecError } from './types';
import { editXmp } from './xmp';

export type MetadataPolicy = 'keep' | 'strip' | { readonly strip: readonly ('gps' | 'personal')[] };

export interface ExportMetadataOptions {
  /** Default 'keep'. */
  readonly metadata?: MetadataPolicy;
  /** The exported image's size, written to EXIF's pixel dimensions. */
  readonly width: number;
  readonly height: number;
  /** The edit document (JSON text) to embed as XMP `rullino:edit` (not with 'strip'). */
  readonly edit?: string;
  /**
   * The ICC profile that describes the export's samples (RFC #181). Absent: the source's profile is
   * kept, as it describes pixels rullino did not convert. Bytes: the output was converted to this
   * colour space (Display P3, Adobe RGB…), whose profile replaces the source's, even with 'strip' (it
   * says how to read the pixels). `null`: the output is plain sRGB (a wide source was converted), so no
   * profile is written. Either way EXIF's ColorSpace says sRGB (1) or uncalibrated (0xFFFF).
   */
  readonly icc?: Uint8Array | null;
}

/** IPTC datasets that name or reach a person: By-line, By-line Title, Contact, Writer/Editor. */
const PERSONAL_IPTC = [80, 85, 118, 122];
/** PNG text keywords that name a person. */
const PERSONAL_TEXT = /^(author|artist)$/i;

/** The policy's parts, checked. */
function parts(policy: MetadataPolicy): { strip: boolean; gps: boolean; personal: boolean } {
  if (policy === 'keep') return { strip: false, gps: false, personal: false };
  if (policy === 'strip') return { strip: true, gps: true, personal: true };
  if (policy && typeof policy === 'object' && Array.isArray(policy.strip)) {
    for (const s of policy.strip) if (s !== 'gps' && s !== 'personal') throw new CodecError('metadata', `unknown metadata to strip: ${String(s)} (gps, personal)`);
    return { strip: false, gps: policy.strip.includes('gps'), personal: policy.strip.includes('personal') };
  }
  throw new CodecError('metadata', `unknown metadata policy ${JSON.stringify(policy)} ('keep', 'strip' or { strip: ['gps', 'personal'] })`);
}

/** `f()`, or undefined when it throws a CodecError (the block is dropped). */
const orDrop = <T>(f: () => T): T | undefined => {
  try {
    return f();
  } catch (e) {
    if (e instanceof CodecError) return undefined;
    throw e;
  }
};

/**
 * The metadata an export of an image with `input`'s metadata should carry. An ICC profile always
 * stays: the source's (it says how to read pixel values rullino did not convert) or, when the output
 * was converted, `options.icc`. With 'strip' nothing
 * else stays (no edit either). Otherwise EXIF gets orientation 1, the export's size and no thumbnail;
 * GPS and personal fields go from EXIF, XMP, IPTC and PNG's text as the policy says; the edit is
 * embedded in XMP. A block that cannot be read is dropped rather than copied unchecked.
 */
export function exportMetadata(input: ImageMetadata, options: ExportMetadataOptions): ImageMetadata {
  const p = parts(options.metadata ?? 'keep');
  const out: { -readonly [K in keyof ImageMetadata]: ImageMetadata[K] } = {};
  if (options.icc) out.icc = options.icc;
  else if (options.icc === undefined && input.icc) out.icc = input.icc;
  if (p.strip) return out;
  const remove = { gps: p.gps, personal: p.personal };
  if (input.exif) {
    const exif = orDrop(() => editExif(input.exif!, { orientation: 1, size: { width: options.width, height: options.height }, dropThumbnail: true, remove, ...(options.icc === undefined ? {} : { colorSpace: options.icc === null ? 1 : 0xffff }) }));
    if (exif) out.exif = exif;
  }
  const xmp = input.xmp !== undefined ? orDrop(() => editXmp(input.xmp, { remove, orientation: 1, ...(options.edit !== undefined ? { edit: options.edit } : {}) })) : undefined;
  if (xmp) out.xmp = xmp;
  else if (options.edit !== undefined) out.xmp = editXmp(undefined, { edit: options.edit });
  if (input.iptc) {
    const iptc = orDrop(() => (p.personal ? writeIptc(readIptc(input.iptc!).filter((d) => !(d.record === 2 && PERSONAL_IPTC.includes(d.dataset)))) : (readIptc(input.iptc!), input.iptc!)));
    if (iptc?.length) out.iptc = iptc;
  }
  if (input.text) {
    const text = p.personal ? input.text.filter((t) => !PERSONAL_TEXT.test(t.keyword)) : input.text;
    if (text.length) out.text = text;
  }
  return out;
}

/**
 * An encoded export (JPEG, PNG or WebP) with the metadata it should carry: the source file's (when
 * given and readable), through `exportMetadata`, written by `writeMetadata`. Returns `encoded` itself
 * when there is nothing to write.
 */
export async function carryMetadata(source: Uint8Array | undefined, encoded: Uint8Array, options: ExportMetadataOptions): Promise<Uint8Array> {
  let input: ImageMetadata = {};
  if (source) {
    try {
      input = await readMetadata(source);
    } catch (e) {
      if (!(e instanceof CodecError)) throw e;
    }
  }
  const meta = exportMetadata(input, options);
  if (Object.keys(meta).length === 0) return encoded;
  return (await writeMetadata(encoded, meta)).bytes;
}
