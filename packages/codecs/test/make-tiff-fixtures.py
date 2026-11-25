# Generates the TIFF fixtures in test/tiff/ (run from the repository root: python3 packages/codecs/test/make-tiff-fixtures.py).
# Sources are random images written as PNG (8 and 16 bit, which decodePng reads exactly) or raw
# float32; Pillow (libtiff 4.7), ImageMagick 6 and tifffile (with imagecodecs, for the float predictor:
# pip install tifffile imagecodecs) turn them into TIFFs of every kind the decoder reads. manifest.json maps each TIFF to its source and says how the decoded pixels relate to it.
import json
import os
import struct
import subprocess
import zlib

import numpy as np
from PIL import Image

root = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(root, 'tiff')
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    os.remove(os.path.join(out, f))
rng = np.random.default_rng(179)
W, H = 23, 17  # neither a multiple of a tile or strip size


def png(path, a):
    """A PNG of a uint8 / uint16 array (H×W, H×W×3 or H×W×4), filter 0."""
    depth = 16 if a.dtype == np.uint16 else 8
    colour = {2: 0, 3: 2, 4: 6}[a.ndim if a.ndim == 2 else a.ndim + a.shape[2] - 2] if False else (0 if a.ndim == 2 else {3: 2, 4: 6}[a.shape[2]])
    raw = b''.join(b'\0' + (row.astype('>u2').tobytes() if depth == 16 else row.tobytes()) for row in a)
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', a.shape[1], a.shape[0], depth, colour, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


sources = {
    'rgb8': rng.integers(0, 256, (H, W, 3), dtype=np.uint8),
    'rgba8': rng.integers(0, 256, (H, W, 4), dtype=np.uint8),
    'grey8': rng.integers(0, 256, (H, W), dtype=np.uint8),
    'rgb16': rng.integers(0, 65536, (H, W, 3), dtype=np.uint16),
    'rgba16': rng.integers(0, 65536, (H, W, 4), dtype=np.uint16),
    'grey16': rng.integers(0, 65536, (H, W), dtype=np.uint16),
}
for name, a in sources.items():
    png(os.path.join(out, f'{name}.png'), a)
bits = rng.integers(0, 2, (H, W), dtype=np.uint8) * 255
png(os.path.join(out, 'bilevel.png'), bits)
fgrey = rng.random((H, W), dtype=np.float32) * 2 - 0.25  # some values outside [0, 1], as HDR files have
frgb = rng.random((H, W, 3), dtype=np.float32) * 4
fgrey.tofile(os.path.join(out, 'fgrey.f32'))
frgb.tofile(os.path.join(out, 'frgb.f32'))

manifest = []


def add(name, source, **kind):
    manifest.append({'file': name, 'source': source, **kind})


def magick(name, source_file, *args, **kind):
    subprocess.run(['convert', os.path.join(out, source_file), *args, os.path.join(out, name)], check=True)
    add(name, kind.pop('source', source_file), **kind)


# Pillow (libtiff): compressions, strips, alpha, grey, bilevel, palette, CMYK, float.
rgb8 = Image.fromarray(sources['rgb8'])
for c in ['raw', 'tiff_lzw', 'tiff_adobe_deflate', 'packbits']:
    rgb8.save(os.path.join(out, f'rgb8-{c}.tif'), compression=c)
    add(f'rgb8-{c}.tif', 'rgb8.png')
Image.fromarray(sources['rgba8']).save(os.path.join(out, 'rgba8-unassociated.tif'), compression='tiff_lzw')
add('rgba8-unassociated.tif', 'rgba8.png')
Image.fromarray(sources['grey8']).save(os.path.join(out, 'grey8.tif'))
add('grey8.tif', 'grey8.png')
Image.fromarray(bits).convert('1').save(os.path.join(out, 'bilevel.tif'))
add('bilevel.tif', 'bilevel.png')
Image.fromarray(bits).convert('1').save(os.path.join(out, 'bilevel-packbits.tif'), compression='packbits')
add('bilevel-packbits.tif', 'bilevel.png')
pal = rgb8.quantize(64)
pal.save(os.path.join(out, 'palette8.tif'))
pal.convert('RGB').save(os.path.join(out, 'palette8.png'))
add('palette8.tif', 'palette8.png')
Image.fromarray(fgrey, 'F').save(os.path.join(out, 'fgrey.tif'))
add('fgrey.tif', 'fgrey.f32', float=True, channels=1)
Image.fromarray(fgrey, 'F').save(os.path.join(out, 'fgrey-deflate.tif'), compression='tiff_adobe_deflate')
add('fgrey-deflate.tif', 'fgrey.f32', float=True, channels=1)
cmyk = rng.integers(0, 256, (H, W, 4), dtype=np.uint8)
Image.fromarray(cmyk, 'CMYK').save(os.path.join(out, 'cmyk8.tif'))
cmyk.tofile(os.path.join(out, 'cmyk8.cmyk'))
add('cmyk8.tif', 'cmyk8.cmyk', cmyk=True)

# ImageMagick: predictors, byte order, tiles, planar, strips, 16 bit, associated alpha, min-is-white,
# 4-bit palette, float RGB.
magick('rgb8-lzw-predictor.tif', 'rgb8.png', '-compress', 'LZW', '-define', 'tiff:predictor=2')
magick('rgb8-deflate-predictor.tif', 'rgb8.png', '-compress', 'Zip', '-define', 'tiff:predictor=2')
magick('rgb8-tiles.tif', 'rgb8.png', '-compress', 'None', '-define', 'tiff:tile-geometry=16x16')
magick('rgb8-tiles-lzw.tif', 'rgb8.png', '-compress', 'LZW', '-define', 'tiff:tile-geometry=16x16')
magick('rgb8-planar.tif', 'rgb8.png', '-compress', 'None', '-interlace', 'plane')
magick('rgb8-planar-lzw.tif', 'rgb8.png', '-interlace', 'plane', '-compress', 'LZW', '-define', 'tiff:predictor=2')
magick('rgb8-strips.tif', 'rgb8.png', '-compress', 'None', '-define', 'tiff:rows-per-strip=3')
magick('rgb8-msb.tif', 'rgb8.png', '-endian', 'MSB', '-compress', 'LZW')
magick('rgb16.tif', 'rgb16.png', '-compress', 'None', '-depth', '16')
magick('rgb16-msb.tif', 'rgb16.png', '-compress', 'None', '-depth', '16', '-endian', 'MSB')
magick('rgb16-deflate-predictor.tif', 'rgb16.png', '-depth', '16', '-compress', 'Zip', '-define', 'tiff:predictor=2')
magick('rgb16-lzw-predictor-msb.tif', 'rgb16.png', '-depth', '16', '-compress', 'LZW', '-define', 'tiff:predictor=2', '-endian', 'MSB')
magick('rgb16-tiles-planar.tif', 'rgb16.png', '-compress', 'None', '-depth', '16', '-define', 'tiff:tile-geometry=16x16', '-interlace', 'plane')
magick('rgba16.tif', 'rgba16.png', '-depth', '16', '-compress', 'Zip')
magick('grey16.tif', 'grey16.png', '-compress', 'None', '-depth', '16')
magick('grey8-minisblack-lzw.tif', 'grey8.png', '-compress', 'LZW')
magick('grey8-miniswhite.tif', 'grey8.png', '-compress', 'None', '-define', 'tiff:photometric=min-is-white')
magick('rgba8-associated.tif', 'rgba8.png', '-define', 'tiff:alpha=associated')
magick('palette4.tif', 'palette8.png', '-colors', '16', '-depth', '4', '-type', 'Palette')
subprocess.run(['convert', os.path.join(out, 'palette4.tif'), os.path.join(out, 'palette4.png')], check=True)
manifest[-1]['source'] = 'palette4.png'
# Float RGB / RGBA through tifffile (ImageMagick here is a Q16 build: it would quantise and clip
# floats): no compression, deflate with the floating-point predictor, big-endian tiles.
import tifffile
frgba = np.concatenate([frgb, rng.random((H, W, 1), dtype=np.float32)], axis=2)
frgba.tofile(os.path.join(out, 'frgba.f32'))
tifffile.imwrite(os.path.join(out, 'frgb.tif'), frgb, photometric='rgb')
tifffile.imwrite(os.path.join(out, 'frgb-deflate-predictor.tif'), frgb, photometric='rgb', compression='zlib', predictor=3)
tifffile.imwrite(os.path.join(out, 'frgb-msb-tiles.tif'), frgb, photometric='rgb', byteorder='>', tile=(16, 16))
tifffile.imwrite(os.path.join(out, 'frgba-planar-predictor.tif'), np.moveaxis(frgba, 2, 0), photometric='rgb', planarconfig='separate', extrasamples=[2], compression='zlib', predictor=3)
tifffile.imwrite(os.path.join(out, 'rgb16-predictor-tiles.tif'), sources['rgb16'], photometric='rgb', compression='zlib', predictor=2, tile=(16, 16))
for name in ['frgb.tif', 'frgb-deflate-predictor.tif', 'frgb-msb-tiles.tif']:
    add(name, 'frgb.f32', float=True, channels=3)
add('frgba-planar-predictor.tif', 'frgba.f32', float=True, channels=4)
add('rgb16-predictor-tiles.tif', 'rgb16.png')

# ImageMagick stores the samples unchanged under min-is-white, so the file means the inverted image:
# the reference is what libtiff (through Pillow) reads, as for any reader.
Image.open(os.path.join(out, 'grey8-miniswhite.tif')).save(os.path.join(out, 'grey8-miniswhite.png'))
for m in manifest:
    if m['file'] == 'grey8-miniswhite.tif':
        m['source'] = 'grey8-miniswhite.png'

# Associated (premultiplied) alpha: the stored samples, the reference for un-premultiplying.
tifffile.imread(os.path.join(out, 'rgba8-associated.tif')).tofile(os.path.join(out, 'rgba8-associated.stored'))
for m in manifest:
    if m['file'] == 'rgba8-associated.tif':
        m['source'] = 'rgba8-associated.stored'
        m['associated'] = True

with open(os.path.join(out, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1)
print(len(manifest), 'TIFFs')
