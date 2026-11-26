#!/usr/bin/env python3
"""Writes the HDR fixtures of @rullino/codecs (#182) into this directory.

- *.hdr: Radiance RGBE files. Those named cv-* are written by OpenCV (new RLE scanlines); the
  others are written here, byte by byte, for what OpenCV does not write: flat and old-style
  scanlines, other orientations, header lines (EXPOSURE, PRIMARIES, comments). The reference of
  cv-* is OpenCV's own reading of the file; of the hand-written ones, the same RGBE -> float
  formula (float = mantissa * 2^(exponent - 136), as OpenCV and stb_image do).
- *.exr: OpenEXR files written by imagecodecs (OpenEXR 3): every compression, half and float,
  RGBA / RGB / grey, odd sizes. The reference is the array that was written (lossless
  compressions), as float32.
- *.f32: the expected pixels, RGBA float32 little endian, rows top to bottom.
- manifest.json: size and what each fixture is.

Needs numpy, opencv-python-headless and imagecodecs. Run from anywhere.
"""
import json, math, os, struct
import cv2, imagecodecs, numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
manifest = {}
rng = np.random.default_rng(182)

def image(w, h, alpha=True):
    """Smooth ramps, flat runs, noise, a very bright spot, exact zeros: what RLE and wavelets must cope with."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = x / max(w - 1, 1) * 4
    g = y / max(h - 1, 1) * 0.5
    b = np.full((h, w), 0.25, np.float32)
    lo, hi = w // 3, 2 * (w // 3)
    if hi > lo:
        b[:, lo:hi] = rng.random((h, hi - lo))
    r[h // 2 :, : max(w // 4, 1)] = 0
    img = np.stack([r, g, b], -1)
    img[min(2, h - 1), min(3, w - 1)] = [900.0, 30.0, 0.5]
    if alpha:
        a = np.clip(1 - 0.5 * x / max(w - 1, 1), 0, 1)
        img = np.concatenate([img, a[..., None]], -1)
    return img.astype(np.float32)

def save(name, data, w, h, ref, info):
    with open(os.path.join(HERE, name), 'wb') as f:
        f.write(data)
    stem = name.rsplit('.', 1)[0]
    rgba = ref
    if rgba.ndim == 2:
        rgba = np.repeat(rgba[..., None], 3, -1)
    if rgba.shape[-1] == 3:
        rgba = np.concatenate([rgba, np.ones(rgba.shape[:2] + (1,), np.float32)], -1)
    assert rgba.shape == (h, w, 4), (name, rgba.shape)
    with open(os.path.join(HERE, stem + '.f32'), 'wb') as f:
        f.write(rgba.astype('<f4').tobytes())
    manifest[name] = {'width': w, 'height': h, 'reference': stem + '.f32', **info}

# ---- OpenEXR -------------------------------------------------------------------------------
def exr_compression(b):
    i = 8
    while b[i] != 0:
        j = b.index(b'\0', i)
        name = b[i:j].decode()
        j2 = b.index(b'\0', j + 1)
        size = struct.unpack('<i', b[j2 + 1 : j2 + 5])[0]
        if name == 'compression':
            return b[j2 + 5]
        i = j2 + 5 + size

CODES = {'none': 0, 'rle': 1, 'zips': 2, 'zip': 3, 'piz': 4, 'pxr24': 5, 'b44': 6, 'dwaa': 8}
for comp in CODES:
    for dt in (np.float16, np.float32):
        img = image(37, 53).astype(dt)
        data = imagecodecs.exr_encode(img, compression=comp)
        assert exr_compression(data) == CODES[comp], comp
        save(f'rgba-{comp}-{np.dtype(dt).name}.exr', data, 37, 53, img.astype(np.float32), {'format': 'exr', 'compression': CODES[comp], 'lossless': comp in ('none', 'rle', 'zips', 'zip', 'piz')})

for comp in ('none', 'zip', 'piz'):
    for name, w, h in (('one', 1, 1), ('wide', 300, 3), ('tall', 5, 70), ('block', 64, 64)):
        img = image(w, h).astype(np.float16)
        data = imagecodecs.exr_encode(img, compression=comp)
        save(f'{name}-{comp}-half.exr', data, w, h, img.astype(np.float32), {'format': 'exr', 'compression': CODES[comp], 'lossless': True})
    rgb = image(40, 35, alpha=False).astype(np.float32)
    save(f'rgb-{comp}-float.exr', imagecodecs.exr_encode(rgb, compression=comp), 40, 35, rgb, {'format': 'exr', 'compression': CODES[comp], 'lossless': True})
    grey = image(20, 20, alpha=False)[..., 0].astype(np.float16)
    save(f'grey-{comp}-half.exr', imagecodecs.exr_encode(grey, compression=comp), 20, 20, grey.astype(np.float32), {'format': 'exr', 'compression': CODES[comp], 'lossless': True})

# ---- Radiance ------------------------------------------------------------------------------
def rgbe(rgb):
    """float RGB -> 4 bytes, as Radiance's float2colr (the exponent from frexp of the largest component)."""
    m = max(rgb)
    if m < 1e-32:
        return bytes(4)
    f, e = math.frexp(m)
    s = f * 256.0 / m
    return bytes([int(rgb[0] * s), int(rgb[1] * s), int(rgb[2] * s), e + 128])

def unrgbe(b):
    if b[3] == 0:
        return (0.0, 0.0, 0.0)
    v = math.ldexp(1.0, b[3] - 136)
    return (b[0] * v, b[1] * v, b[2] * v)

def rle_channel(vals):
    out = bytearray()
    i = 0
    n = len(vals)
    while i < n:
        run = 1
        while i + run < n and run < 127 and vals[i + run] == vals[i]:
            run += 1
        if run >= 3:
            out += bytes([128 + run, vals[i]])
            i += run
        else:
            j = i
            lit = bytearray()
            while j < n and len(lit) < 128 and not (j + 2 < n and vals[j] == vals[j + 1] == vals[j + 2]):
                lit.append(vals[j])
                j += 1
            if not lit:
                lit.append(vals[j]); j += 1
            out += bytes([len(lit)]) + bytes(lit)
            i = j
    return bytes(out)

def write_hdr(name, pixels, w, h, header=b'', resolution=None, mode='flat'):
    """pixels: h rows of w (r, g, b) float tuples, rows in the order they are stored."""
    body = bytearray()
    for row in pixels:
        enc = [rgbe(p) for p in row]
        if mode == 'flat':
            for e in enc:
                body += e
        elif mode == 'rle':
            body += bytes([2, 2, w >> 8, w & 255])
            for c in range(4):
                body += rle_channel([e[c] for e in enc])
        elif mode == 'old':  # old-style runs: (1, 1, 1, n) repeats the previous pixel n << shift times, shift += 8 per code
            i = 0
            while i < w:
                run = 1
                while i + run < w and enc[i + run] == enc[i]:
                    run += 1
                body += enc[i]
                rest = run - 1
                while rest > 0:
                    body += bytes([1, 1, 1, rest & 255])
                    rest >>= 8
                i += run
    res = (resolution or f'-Y {h} +X {w}').encode()
    data = b'#?RADIANCE\n' + header + b'FORMAT=32-bit_rle_rgbe\n\n' + res + b'\n' + bytes(body)
    return data

def hdr_ref(rows):
    return np.array([[unrgbe(rgbe(p)) for p in row] for row in rows], np.float32)

# OpenCV-written (new RLE), read back by OpenCV: the reference.
for name, w, h in (('cv-40x20', 40, 20), ('cv-9x5', 9, 5), ('cv-300x4', 300, 4)):
    rgb = image(w, h, alpha=False)
    bgr = rgb[..., ::-1].copy()
    path = os.path.join(HERE, name + '.hdr')
    cv2.imwrite(path, bgr)
    back = cv2.imread(path, cv2.IMREAD_ANYCOLOR | cv2.IMREAD_ANYDEPTH)[..., ::-1].astype(np.float32)
    save(name + '.hdr', open(path, 'rb').read(), w, h, back, {'format': 'hdr', 'reader': 'opencv'})

# Hand-written variants (reference: the RGBE -> float formula).
base = image(40, 20, alpha=False)
rows = [[tuple(float(v) for v in base[y, x]) for x in range(40)] for y in range(20)]
ref = hdr_ref(rows)
save('flat-40x20.hdr', write_hdr('', rows, 40, 20, mode='flat'), 40, 20, ref, {'format': 'hdr', 'reader': 'formula'})
save('rle-40x20.hdr', write_hdr('', rows, 40, 20, mode='rle'), 40, 20, ref, {'format': 'hdr', 'reader': 'formula'})
small = [row[:5] for row in rows[:7]]
save('flat-5x7.hdr', write_hdr('', small, 5, 7, mode='flat'), 5, 7, hdr_ref(small), {'format': 'hdr', 'reader': 'formula'})
flip = write_hdr('', rows[::-1], 40, 20, mode='rle', resolution='+Y 20 +X 40')
save('flipv-40x20.hdr', flip, 40, 20, ref, {'format': 'hdr', 'reader': 'formula'})
mirror = write_hdr('', [r[::-1] for r in rows], 40, 20, mode='rle', resolution='-Y 20 -X 40')
save('fliph-40x20.hdr', mirror, 40, 20, ref, {'format': 'hdr', 'reader': 'formula'})
# Old-style run lengths, with a run longer than 255 (two repeat codes), and widths around the new-style limit.
wide_rows = [[(0.5, 0.25, 2.0)] * 300 + [(1.0, 2.0, 3.0)] * 5 + [(0.0, 0.0, 0.0)] * 295 for _ in range(3)]
save('old-runs-600x3.hdr', write_hdr('', wide_rows, 600, 3, mode='old'), 600, 3, hdr_ref(wide_rows), {'format': 'hdr', 'reader': 'formula'})
for w in (8,):
    rows_w = [row[:w] for row in rows[:4]]
    save(f'rle-{w}x4.hdr', write_hdr('', rows_w, w, 4, mode='rle'), w, 4, hdr_ref(rows_w), {'format': 'hdr', 'reader': 'formula'})
head = write_hdr('', rows, 40, 20, header=b'# a comment\nEXPOSURE=1.5\nSOFTWARE=rullino test\nPRIMARIES= 0.640 0.330 0.300 0.600 0.150 0.060 0.3127 0.3290\n', mode='rle')
save('header-40x20.hdr', head, 40, 20, ref, {'format': 'hdr', 'reader': 'formula', 'primaries': [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, 0.3127, 0.329]})

with open(os.path.join(HERE, 'manifest.json'), 'w') as f:
    json.dump(manifest, f, indent=1, sort_keys=True)
print(len(manifest), 'fixtures')
