# @rullino/codecs

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Stocastico/rullino/blob/main/LICENSE)

Image decoders for [rullino](https://github.com/Stocastico/rullino) in pure TypeScript, with no dependencies: the same file decodes to the same pixels in every browser, in Node, Deno and Bun. Browsers and native libraries decode the same file differently, so "the browser preview and the server render match" starts from the same input only when the decoder is the same.

> Work in progress for rullino 0.9 ([#179](https://github.com/Stocastico/rullino/issues/179)): PNG, JPEG and TIFF decoding and encoding (PNG encoding is in `@rullino/core`), a `decode` that takes decoders for the other formats, and metadata (EXIF, XMP, IPTC, ICC) read, edited and written. 0.x: the API may change between minor versions.

```ts
import { decodeJpeg, decodePng, CodecError } from '@rullino/codecs';

declare const bytes: Uint8Array; // the file's bytes

try {
  const image = await decodePng(bytes); // or decodeJpeg(bytes), decodeTiff(bytes)
  // image.width, image.height, image.bitDepth (8, 16 or 32 = float), image.data: RGBA, straight alpha,
  // image.icc: the embedded ICC profile (if any)
} catch (e) {
  if (e instanceof CodecError) console.error(e.message); // malformed, truncated or too large
  else throw e;
}
```

## Any format: `decode`

```ts
import { decode, detectFormat, type Decoder } from '@rullino/codecs';

declare const bytes: Uint8Array;
declare const myAvifDecoder: Decoder; // e.g. a WASM build: (bytes, { maxPixels }) => DecodedImage

detectFormat(bytes); // 'png' | 'jpeg' | 'tiff' | 'hdr' | 'exr' | 'webp' | 'avif' | 'heic' | 'jxl' | 'gif' | 'bmp' | undefined
const image = await decode(bytes, { decoders: { avif: myAvifDecoder } }); // image.format says which
```

`decode` reads the format from the file's first bytes and uses the built-in decoder for PNG, JPEG, TIFF, Radiance and OpenEXR, or the one you pass in `decoders` (which can also replace a built-in one). There is no decoder of our own for AVIF, HEIC, JPEG XL, WebP, GIF or BMP: without one in `decoders` they are a `CodecError` that says so. What a decoder returns is checked like a built-in result (size, `maxPixels`, sample type and count), so a wrong one fails here, not later in a renderer.

## PNG

Every colour type and bit depth of the specification (grey, RGB, palette, grey + alpha, RGBA at 1, 2, 4, 8 and 16 bits), `tRNS` transparency, Adam7 interlacing, all five filters, `iCCP` profiles. Bit depths up to 8 and palettes come back as 8-bit RGBA, 16-bit files as 16-bit RGBA (`Uint16Array`); grey is replicated into R, G and B, and images without alpha get an opaque one. Samples are returned as stored: colour management is up to the caller (`icc`).

The decoder is strict: a bad CRC, a missing `IEND`, an unknown critical chunk, short image data or a palette index past the palette is a `CodecError`, never a partial image. The size in the header is checked against `maxPixels` (default 2^28 pixels) before anything is allocated, and inflating stops at the size the header implies, so a small file cannot make the decoder allocate more than the image it describes.

Tested on the whole [PngSuite](http://www.schaik.com/pngsuite/) against libspng (through sharp), and fuzzed (mutated files with valid checksums and recompressed image data; 20 000 runs on every pull request). Inflating uses the runtime's `DecompressionStream`.

## JPEG

Baseline, extended sequential and progressive Huffman-coded JPEG with 8-bit samples: any sampling factors (4:4:4, 4:2:2, 4:2:0, 4:4:0, 4:1:1…), restart intervals, grey, YCbCr, RGB, CMYK and YCCK, ICC profiles split over APP2 segments. Output is 8-bit RGBA.

The decoding follows libjpeg-turbo step for step: its integer IDCT ("islow"), its "fancy" triangle upsampling of the chroma, its fixed-point YCbCr tables and its choice of colour space from the JFIF / Adobe markers. Grey, YCbCr and RGB files therefore decode to exactly the bytes libjpeg-turbo gives, which is what Chrome, Firefox, sharp and Pillow use: the tests compare every fixture and six real camera photos with sharp and require equality, not a tolerance. (Coefficients no 8-bit encoder writes follow libjpeg's C code; its SIMD builds differ there.) CMYK and YCCK come out through the naive formula R = (255 − C)(255 − K) / 255, an approximation without colour management; their profile is in `icc`.

Arithmetic coding, lossless and hierarchical JPEG, 12-bit samples and height-in-DNL files are refused with a `CodecError`, as are truncated files, a missing EOI and restart markers out of sequence. Bytes between a scan and the next marker are skipped, as libjpeg does. EXIF orientation is not applied: the pixels are returned as stored.

## JPEG encoding

```ts
import { encodeJpeg } from '@rullino/codecs';

declare const pixels: { width: number; height: number; data: Uint8Array }; // 8-bit RGBA

const file = encodeJpeg(pixels, { quality: 0.9, subsampling: '4:2:0' }); // Uint8Array
```

Baseline JPEG in YCbCr, with 4:4:4, 4:2:2 or 4:2:0 subsampling (default 4:2:0), libjpeg's Annex K quantisation tables scaled by `quality` (0–1, libjpeg's quality / 100; default 0.9) and the standard Huffman tables, plus an optional ICC profile (`icc`). Alpha is dropped: flatten transparent images first. The encoder is libjpeg-turbo's C encoder step for step (colour conversion, edge padding, downsampling, integer forward DCT, quantisation, the dummy blocks at the edges), so the file is the one libjpeg-turbo writes for the same settings: the tests compare 72 files written by Pillow, byte for byte, and check that what it writes reads back alike through libjpeg-turbo and `decodeJpeg`. Optimised Huffman tables and progressive output are not offered yet.

## TIFF

The first image of a TIFF file: strips or tiles, chunky or planar samples, no compression, LZW, Deflate or PackBits, the horizontal and floating-point predictors, 1 / 2 / 4 / 8 / 16-bit integer and 32-bit float samples, grey (black or white is zero), RGB, palette and CMYK, associated (premultiplied) or unassociated alpha, both byte orders, an ICC profile. Up to 8 bits and palettes come back as 8-bit RGBA, 16-bit samples as 16-bit, float samples as `Float32Array` with the values as stored (HDR values above 1 are kept). Associated alpha is divided out. CMYK goes through the same naive formula as JPEG. A tile may cover at most four times the image or 1 MP (and `maxPixels`), so a file cannot make the decoder allocate more than its image warrants. JPEG-in-TIFF, CCITT fax, BigTIFF and signed or 16-bit float samples are refused with a `CodecError`.

Tested on 36 files written by libtiff (through Pillow), ImageMagick and tifffile from known sources (every combination above): the decoded pixels must be the sources exactly. Fuzzed like the other decoders, including changes aimed at the IFD's types, counts and offsets.

## HDR: Radiance and OpenEXR

`decodeHdr` reads Radiance RGBE files (`.hdr`): new and old run-length coding or flat pixels, every orientation of the standard size line (`-Y h +X w` and its flips), `PRIMARIES` reported as `primaries`; XYZE files and the transposed size lines are refused. `decodeExr` reads OpenEXR scanline files: half, float and uint channels, compressions none, RLE, ZIPS, ZIP and PIZ (PXR24, B44 and DWA are refused by name), `R G B (A)` or `Y`, the `chromaticities` attribute as `primaries`; tiled, deep and multi-part files are refused.

Both give `bitDepth: 32` float RGBA with `linear: true`: scene-referred light, not encoded with a transfer curve, values far above 1 kept. OpenEXR stores colour premultiplied, so it is divided by alpha (straight alpha like everywhere else; colour under zero alpha is 0), grey is replicated and a missing alpha is 1. A `linear` image's colour is in its `primaries` (Rec. 709 / sRGB when there are none): `manageSource` in `@rullino/core` brings it into rullino's working space.

Tested on files written by OpenCV (Radiance) and OpenEXR (through imagecodecs: every lossless compression, half and float, RGBA / RGB / grey, odd sizes, a ramp over the whole half range that reaches PIZ's 16-bit wavelet path and Huffman codes longer than 14 bits): the decoded pixels must be the written ones bit for bit. Fuzzed like the other decoders.

## Ultra HDR (gain maps)

`readUltraHdr(bytes)` takes an Ultra HDR JPEG apart (an SDR JPEG with a second JPEG, the gain map, appended after it and indexed by an MPF segment) into `{ primary, gainMap, metadata }`, two complete JPEG files you decode with `decodeJpeg` and the map's parameters (`gainMapMin`, `gainMapMax`, `gamma`, offsets, headrooms, per channel, log2) from its ISO 21496-1 block or its Adobe `hdrgm` XMP; it returns `undefined` for a file that is no Ultra HDR file. `writeUltraHdr({ primary, gainMap, metadata })` makes one from an SDR JPEG (its EXIF, ICC profile and XMP kept, the Container directory joining its XMP packet) and a gain map JPEG: `encodeJpeg(…, { grey: true })` makes a one-channel map. The layouts follow Google's libultrahdr, which Android and Chrome read; the index was checked with Pillow and exiftool. The maths that turns the pair into HDR light and back is `applyGainMap` / `makeGainMap` in `@rullino/core`.

## TIFF encoding

```ts
import { encodeTiff } from '@rullino/codecs';

declare const image: { width: number; height: number; bitDepth: 16; data: Uint16Array }; // RGBA

const file = await encodeTiff(image, { compression: 'deflate' }); // or 'lzw', 'none'
```

RGB or RGBA (unassociated alpha, written only when some pixel is not opaque unless `alpha` says otherwise) at 8 or 16 bits or 32-bit float, in strips, uncompressed, Deflate (default) or LZW, with the horizontal predictor for integers and the floating-point one for floats when compressed, and an optional ICC profile. Every combination is read back exactly by libtiff (through sharp) and `decodeTiff` in the tests.

## Metadata

```ts
import { carryMetadata, exportMetadata, readMetadata, readXmpEdit, writeMetadata } from '@rullino/codecs';

declare const original: Uint8Array; // the photo's file
declare const exported: Uint8Array; // the edited image, encoded (JPEG, PNG or WebP)

const meta = await readMetadata(original); // { exif?, xmp?, iptc?, icc?, text? }
const clean = exportMetadata(meta, { metadata: { strip: ['gps', 'personal'] }, width: 1600, height: 1200, edit: '{"version":3}' });
const { bytes } = await writeMetadata(exported, clean); // or, in one call:
const same = await carryMetadata(original, exported, { metadata: 'keep', width: 1600, height: 1200 });
readXmpEdit(clean.xmp!); // the edit document embedded as rullino:edit
```

`readMetadata` reads EXIF, XMP, IPTC and the ICC profile from JPEG (APP1, APP13, APP2), PNG (eXIf, iTXt, iCCP, ImageMagick's raw profiles, and the other text chunks), WebP (EXIF, XMP, ICCP chunks) and TIFF (XMP, IPTC, ICC; TIFF's own EXIF is not read yet). `writeMetadata` replaces a JPEG's, PNG's or WebP's metadata with the given blocks without touching the image data; a block too large for its JPEG segment is dropped and named in `dropped`, never truncated.

`exportMetadata` is the policy `@rullino/web` and `@rullino/node` apply on `render`: `'keep'` (the default: everything, GPS included), `'strip'` (only the colour profile, which says how to read the pixels), or `{ strip: ['gps', 'personal'] }`. Whatever is kept is made true of the export: orientation 1, the export's size, no thumbnail (it would show the unedited, uncropped original). GPS is the GPS IFD and XMP's `exif:GPS…`; personal fields are those that name or identify a person or a device (`PERSONAL_EXIF`: artist, owner, serial numbers, comments, MakerNote; XMP's creator, serial numbers and owner; IPTC's by-line, contact and writer; PNG's Author and Artist), while camera, copyright and location names stay. EXIF is edited **in place** (`editExif`): removed entries leave their directory and their values are zeroed, nothing moves, so the offsets of what is kept, a MakerNote's included, stay valid. XMP is edited by namespace with the rest of the packet left byte for byte (`editXmp`). A block that cannot be read is dropped, never copied unchecked.

The fixtures were written by exiftool (camera, orientation, personal fields, GPS, thumbnail, XMP, IPTC and ICC in every format), with exiftool's reading as the reference; the stripped results are checked byte by byte (the removed names appear nowhere), and the written files pass `exiftool -validate`.
