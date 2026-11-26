#!/usr/bin/env python3
"""Writes the ICC fixtures of core's colour management tests (RFC #181) into this directory.

- Real profiles from Debian's icc-profiles-free (zlib licence, see NOTICE.md): sRGB, "compatible
  with Adobe RGB (1998)", L*-RGB, the grey profiles, a Lab abstract profile (unsupported).
- Profiles built here, byte by byte: Display P3 (v4, para type 3), Rec. 2020 (v2, a 1024-entry
  table), ProPhoto-like (v2, gamma 1.8, no chad), one profile per para type 0-4, a gamma 1 profile.
- reference.json: for each profile, a grid of device values and what littleCMS 2 (through ctypes,
  in double precision, relative colorimetric, no black point compensation) makes of them, as XYZ
  (D50, the PCS) and as linear sRGB (a gamma 1 profile on sRGB's primaries: unbounded, so colours
  outside sRGB come out negative or above 1).

Needs liblcms2 (apt install liblcms2-2) and icc-profiles-free. Run from anywhere.
"""
import ctypes, json, math, os, shutil, struct

HERE = os.path.dirname(os.path.abspath(__file__))
FREE = '/usr/share/color/icc'

lcms = ctypes.CDLL('liblcms2.so.2')
lcms.cmsOpenProfileFromMem.restype = ctypes.c_void_p
lcms.cmsOpenProfileFromMem.argtypes = [ctypes.c_char_p, ctypes.c_uint32]
lcms.cmsCreateTransform.restype = ctypes.c_void_p
lcms.cmsCreateTransform.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32]
lcms.cmsDoTransform.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32]
lcms.cmsCreateXYZProfile.restype = ctypes.c_void_p

def fmt(space, channels):  # FLOAT_SH(1) | COLORSPACE_SH | CHANNELS_SH | BYTES_SH(0) = double
    return (1 << 22) | (space << 16) | (channels << 3)
PT_GRAY, PT_RGB, PT_XYZ = 3, 4, 9

# --- writing profiles -------------------------------------------------------------------------
def s15(v):
    return struct.pack('>i', round(v * 65536))

def xyz_tag(x, y, z):
    return b'XYZ ' + b'\0' * 4 + s15(x) + s15(y) + s15(z)

def curv_gamma(g):
    return b'curv' + b'\0' * 4 + struct.pack('>I', 1) + struct.pack('>H', round(g * 256)) + b'\0\0'

def curv_table(values):
    return b'curv' + b'\0' * 4 + struct.pack('>I', len(values)) + b''.join(struct.pack('>H', round(min(1, max(0, v)) * 65535)) for v in values) + (b'\0\0' if len(values) % 2 else b'')

def para(kind, *params):
    return b'para' + b'\0' * 4 + struct.pack('>H', kind) + b'\0\0' + b''.join(s15(p) for p in params)

def desc_v2(text):
    t = text.encode('ascii') + b'\0'
    return b'desc' + b'\0' * 4 + struct.pack('>I', len(t)) + t + b'\0' * 4 + b'\0' * 4 + b'\0' * 2 + b'\0' + b'\0' * 67

def mluc(text):
    t = text.encode('utf-16-be')
    return b'mluc' + b'\0' * 4 + struct.pack('>II', 1, 12) + b'enUS' + struct.pack('>II', len(t), 28) + t

def sf32(m):
    return b'sf32' + b'\0' * 4 + b''.join(s15(v) for v in m)

def profile(version, tags, space=b'RGB '):
    # tags: list of (signature, data); data padded to 4 bytes, offsets after the tag table.
    table = b''
    body = b''
    offset = 128 + 4 + 12 * len(tags)
    for sig, data in tags:
        table += sig + struct.pack('>II', offset + len(body), len(data))
        body += data + b'\0' * (-len(data) % 4)
    size = offset + len(body)
    header = struct.pack('>I', size) + b'none' + version + b'mntr' + space + b'XYZ ' + b'\0' * 12 + b'acsp' + b'APPL' + b'\0' * 4 + b'\0' * 4 + b'\0' * 4 + b'\0' * 8 + struct.pack('>I', 1)
    header += s15(0.9642) + s15(1.0) + s15(0.8249) + b'none' + b'\0' * 16 + b'\0' * 28
    assert len(header) == 128, len(header)
    return header + struct.pack('>I', len(tags)) + table + body

D50 = (0.9642, 1.0, 0.8249)
BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]]

def mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]

def inv(m):
    a, b, c = m[0]; d, e, f = m[1]; g, h, i = m[2]
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
            [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
            [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]]

def xy_to_xyz(x, y):
    return [x / y, 1.0, (1 - x - y) / y]

def colorants(primaries, white):
    """The D50-adapted (Bradford) colorant matrix of a set of primaries (columns: r, g, b)."""
    P = [[0.0] * 3 for _ in range(3)]
    cols = [xy_to_xyz(*p) for p in primaries]
    for j in range(3):
        for i in range(3):
            P[i][j] = cols[j][i]
    W = xy_to_xyz(*white)
    S = [sum(inv(P)[i][k] * W[k] for k in range(3)) for i in range(3)]
    M = [[P[i][j] * S[j] for j in range(3)] for i in range(3)]
    if white == (0.3457, 0.3585):
        return M, None
    src = [sum(BRADFORD[i][k] * W[k] for k in range(3)) for i in range(3)]
    dst = [sum(BRADFORD[i][k] * D50[k] for k in range(3)) for i in range(3)]
    A = mul(inv(BRADFORD), mul([[dst[0] / src[0], 0, 0], [0, dst[1] / src[1], 0], [0, 0, dst[2] / src[2]]], BRADFORD))
    return mul(A, M), A

def rgb_profile(version, name, primaries, white, curves, v4=False):
    M, chad = colorants(primaries, white)
    tags = [(b'desc', mluc(name) if v4 else desc_v2(name)), (b'cprt', mluc('No copyright, use freely') if v4 else b'text\0\0\0\0No copyright, use freely\0'), (b'wtpt', xyz_tag(*D50))]
    if chad is not None:
        tags.append((b'chad', sf32([v for row in chad for v in row])))
    tags += [(b'rXYZ', xyz_tag(M[0][0], M[1][0], M[2][0])), (b'gXYZ', xyz_tag(M[0][1], M[1][1], M[2][1])), (b'bXYZ', xyz_tag(M[0][2], M[1][2], M[2][2]))]
    r, g, b = curves if isinstance(curves, tuple) else (curves, curves, curves)
    tags += [(b'rTRC', r), (b'gTRC', g), (b'bTRC', b)]
    return profile(version, tags)

SRGB_PRIMARIES = ((0.64, 0.33), (0.30, 0.60), (0.15, 0.06))
P3_PRIMARIES = ((0.680, 0.320), (0.265, 0.690), (0.150, 0.060))
REC2020_PRIMARIES = ((0.708, 0.292), (0.170, 0.797), (0.131, 0.046))
PROPHOTO_PRIMARIES = ((0.7347, 0.2653), (0.1596, 0.8404), (0.0366, 0.0001))
D65 = (0.3127, 0.3290)
D50xy = (0.3457, 0.3585)
SRGB_PARA = para(3, 2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045)
V2 = b'\x02\x40\x00\x00'
V4 = b'\x04\x30\x00\x00'

def bt2020(v):
    a, b = 1.09929682680944, 0.018053968510807
    return v / 4.5 if v < 4.5 * b else ((v + a - 1) / a) ** (1 / 0.45)

BUILT = {
    'display-p3-v4.icc': rgb_profile(V4, 'Display P3 (test)', P3_PRIMARIES, D65, SRGB_PARA, v4=True),
    'rec2020-table-v2.icc': rgb_profile(V2, 'Rec. 2020 (test)', REC2020_PRIMARIES, D65, curv_table([bt2020(i / 1023) for i in range(1024)])),
    'prophoto-gamma-v2.icc': rgb_profile(V2, 'ProPhoto-like (test)', PROPHOTO_PRIMARIES, D50xy, curv_gamma(1.8)),
    'linear-srgb-v4.icc': rgb_profile(V4, 'Linear sRGB (test)', SRGB_PRIMARIES, D65, b'curv' + b'\0' * 8, v4=True),
    'para-types-v4.icc': rgb_profile(V4, 'para 0-2 (test)', SRGB_PRIMARIES, D65, (para(0, 2.2), para(1, 2.0, 1.1, -0.1), para(2, 2.4, 0.9, 0.05, 0.02)), v4=True),
    'para-types34-v4.icc': rgb_profile(V4, 'para 3-4 (test)', P3_PRIMARIES, D65, (SRGB_PARA, para(4, 2.2, 0.95, 0.05, 0.1, 0.03, 0.01, 0.02), para(3, 1.8, 1.0, 0.0, 0.5, 0.1)), v4=True),
    'gray-gamma18-v2.icc': profile(V2, [(b'desc', desc_v2('Gray 1.8 (test)')), (b'cprt', b'text\0\0\0\0none\0'), (b'wtpt', xyz_tag(*D50)), (b'kTRC', curv_gamma(1.8))], space=b'GRAY'),
}
COPIED = ['sRGB.icc', 'compatibleWithAdobeRGB1998.icc', 'LStar-RGB.icc', 'Gray.icc', 'Gray-CIE_L.icc', 'ITULab.icc']

def lcms_profile(data):
    return lcms.cmsOpenProfileFromMem(data, len(data))

def run(src_bytes, channels, out_profile, out_space, values):
    src = lcms_profile(src_bytes)
    t = lcms.cmsCreateTransform(src, fmt(PT_GRAY if channels == 1 else PT_RGB, channels), out_profile, fmt(out_space, 3), 1, 0)
    assert t, 'no transform'
    n = len(values)
    inp = (ctypes.c_double * (n * channels))(*[v for p in values for v in p])
    out = (ctypes.c_double * (n * 3))()
    lcms.cmsDoTransform(t, inp, out, n)
    return [[out[3 * i + k] for k in range(3)] for i in range(n)]

def main():
    for name in COPIED:
        shutil.copyfile(os.path.join(FREE, name), os.path.join(HERE, name))
    for name, data in BUILT.items():
        with open(os.path.join(HERE, name), 'wb') as f:
            f.write(data)
    xyz = lcms.cmsCreateXYZProfile()
    linear = lcms_profile(BUILT['linear-srgb-v4.icc'])
    steps = [0, 0.001, 0.02, 0.04045, 0.1, 0.25, 0.5, 0.75, 0.9, 1]
    rgb = [[r, g, b] for r in steps for g in steps[::3] for b in steps[::2]] + [[0.3, 0.6, 0.9], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
    grey = [[v] for v in [i / 32 for i in range(33)]]
    ref = {}
    for name in COPIED + list(BUILT):
        data = open(os.path.join(HERE, name), 'rb').read()
        space = data[16:20]
        if space not in (b'RGB ', b'GRAY'):
            continue
        values = grey if space == b'GRAY' else rgb
        ch = 1 if space == b'GRAY' else 3
        ref[name] = {'input': values, 'xyz': run(data, ch, xyz, PT_XYZ, values), 'linearSrgb': run(data, ch, linear, PT_RGB, values)}
    with open(os.path.join(HERE, 'reference.json'), 'w') as f:
        json.dump(ref, f, separators=(',', ':'))

main()
