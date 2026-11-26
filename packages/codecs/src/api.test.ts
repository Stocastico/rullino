import { describe, expect, it } from 'vitest';
import * as api from './index';

// The public API of @rullino/codecs: adding or removing an export is a deliberate change that shows up here.
describe('@rullino/codecs public API', () => {
  it('exports exactly these runtime names', () => {
    expect(Object.keys(api).sort()).toEqual(['CodecError', 'DEFAULT_MAX_PIXELS', 'PERSONAL_EXIF', 'RULLINO_NS', 'decode', 'decodeJpeg', 'decodePng', 'decodeTiff', 'detectFormat', 'editExif', 'editXmp', 'encodeJpeg', 'encodeTiff', 'exportMetadata', 'readExif', 'readIptc', 'readMetadata', 'readXmpEdit', 'writeIptc', 'writeMetadata']);
  });
});
