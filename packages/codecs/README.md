# @rullino/codecs

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/Stocastico/rullino/blob/main/LICENSE)

Image decoders for [rullino](https://github.com/Stocastico/rullino) in pure TypeScript, with no dependencies: the same file decodes to the same pixels in every browser, in Node, Deno and Bun. Browsers and native libraries decode the same file differently, so "the browser preview and the server render match" starts from the same input only when the decoder is the same.

> Work in progress for rullino 0.9 ([#179](https://github.com/Stocastico/rullino/issues/179)): PNG decoding is done; JPEG decode and encode and TIFF come next. 0.x: the API may change between minor versions.

```ts
import { decodePng, CodecError } from '@rullino/codecs';

declare const bytes: Uint8Array; // the file's bytes

try {
  const image = await decodePng(bytes);
  // image.width, image.height, image.bitDepth (8 or 16), image.data: RGBA, straight alpha,
  // image.icc: the embedded ICC profile (if any)
} catch (e) {
  if (e instanceof CodecError) console.error(e.message); // malformed, truncated or too large
  else throw e;
}
```

## PNG

Every colour type and bit depth of the specification (grey, RGB, palette, grey + alpha, RGBA at 1, 2, 4, 8 and 16 bits), `tRNS` transparency, Adam7 interlacing, all five filters, `iCCP` profiles. Bit depths up to 8 and palettes come back as 8-bit RGBA, 16-bit files as 16-bit RGBA (`Uint16Array`); grey is replicated into R, G and B, and images without alpha get an opaque one. Samples are returned as stored: colour management is up to the caller (`icc`).

The decoder is strict: a bad CRC, a missing `IEND`, an unknown critical chunk, short image data or a palette index past the palette is a `CodecError`, never a partial image. The size in the header is checked against `maxPixels` (default 2^28 pixels) before anything is allocated, and inflating stops at the size the header implies, so a small file cannot make the decoder allocate more than the image it describes.

Tested on the whole [PngSuite](http://www.schaik.com/pngsuite/) against libspng (through sharp), and fuzzed (mutated files with valid checksums and recompressed image data; 20 000 runs on every pull request). Inflating uses the runtime's `DecompressionStream`.
