# Generates the JPEG fixtures in test/jpeg/ (run from the repository root: python3 packages/codecs/test/make-jpeg-fixtures.py).
# Pillow 12 (libjpeg-turbo) and ImageMagick 6 write them; the source is a crop of a CC0 sample photo
# (apps/playground/public/samples/river.jpg, see its NOTICE.md). The files are committed, so the tests
# need neither tool: this script only documents where they come from and makes them again.
import os
import subprocess
from PIL import Image

root = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(root, 'jpeg')
os.makedirs(out, exist_ok=True)
src = Image.open(os.path.join(root, '../../../apps/playground/public/samples/river.jpg')).convert('RGB')
crop = src.crop((700, 400, 761, 443))  # 61 × 43: no side a multiple of 8 or 16

def save(name, img, **kw):
    img.save(os.path.join(out, name), 'JPEG', **kw)

for sub, label in [(0, '444'), (1, '422'), (2, '420')]:
    save(f'baseline-{label}.jpg', crop, quality=85, subsampling=sub)
    save(f'progressive-{label}.jpg', crop, quality=85, subsampling=sub, progressive=True)
save('optimized-420.jpg', crop, quality=60, subsampling=2, optimize=True)
save('q100-444.jpg', crop, quality=100, subsampling=0)
save('q5-420.jpg', crop, quality=5, subsampling=2)
save('restart-blocks-420.jpg', crop, quality=85, subsampling=2, restart_marker_blocks=1)
save('restart-rows-444.jpg', crop, quality=85, subsampling=0, restart_marker_rows=1)
save('restart-progressive-420.jpg', crop, quality=85, subsampling=2, progressive=True, restart_marker_blocks=2)
save('grey.jpg', crop.convert('L'), quality=85)
save('grey-progressive.jpg', crop.convert('L'), quality=85, progressive=True)
save('rgb.jpg', crop, quality=85, subsampling=0, keep_rgb=True)  # Adobe transform 0, components 'R' 'G' 'B'
save('cmyk.jpg', crop.convert('CMYK'), quality=90)
# Tiny images: components one or two samples wide, where libjpeg upsamples by replication.
for w, h in [(1, 1), (2, 2), (3, 3), (1, 17), (17, 1), (2, 9), (9, 2)]:
    save(f'tiny-{w}x{h}-420.jpg', crop.resize((w, h)), quality=90, subsampling=2)
    save(f'tiny-{w}x{h}-422.jpg', crop.resize((w, h)), quality=90, subsampling=1)
# Sampling factors Pillow cannot write: 4:4:0 (1×2), 4:1:1 (4×1), 2×1 + 1×2 mixes, and a YCCK file.
crop.save('/tmp/rullino-crop.png')
def magick(name, *args):
    subprocess.run(['convert', '/tmp/rullino-crop.png', *args, os.path.join(out, name)], check=True)
magick('baseline-440.jpg', '-quality', '85', '-sampling-factor', '1x2')
magick('baseline-411.jpg', '-quality', '85', '-sampling-factor', '4x1')
magick('baseline-410.jpg', '-quality', '85', '-sampling-factor', '4x2')
magick('progressive-440.jpg', '-quality', '85', '-sampling-factor', '1x2', '-interlace', 'JPEG')
magick('ycck.jpg', '-colorspace', 'CMYK', '-quality', '90')
# Coloured noise: chroma that changes from sample to sample, so every upsampling rounding and the
# "two samples wide or less" rule show in the output (a smooth photo crop hides them).
import random
random.seed(179)
def noise(w, h):
    img = Image.new('RGB', (w, h))
    img.putdata([(random.randrange(256), random.randrange(256), random.randrange(256)) for _ in range(w * h)])
    return img
for sub, label in [(0, '444'), (1, '422'), (2, '420')]:
    save(f'noise-{label}.jpg', noise(37, 29), quality=95, subsampling=sub)
for w, h in [(2, 2), (3, 5), (4, 4), (5, 3)]:
    save(f'noise-{w}x{h}-420.jpg', noise(w, h), quality=95, subsampling=2)
    save(f'noise-{w}x{h}-422.jpg', noise(w, h), quality=95, subsampling=1)
noise(37, 29).save('/tmp/rullino-noise.png')
for name, factor in [('noise-440.jpg', '1x2'), ('noise-411.jpg', '4x1')]:
    subprocess.run(['convert', '/tmp/rullino-noise.png', '-quality', '95', '-sampling-factor', factor, os.path.join(out, name)], check=True)
# A 4-component file with Adobe transform 1: libjpeg reads any transform but 0 as YCCK.
data = bytearray(open(os.path.join(out, 'ycck.jpg'), 'rb').read())
at = data.find(b'Adobe')
data[at + 11] = 1
open(os.path.join(out, 'ycck-adobe1.jpg'), 'wb').write(data)
# The CMYK reference: libjpeg-turbo's samples through Pillow, as ink amounts (Pillow undoes Adobe's
# inversion), raw C M Y K bytes. sharp cannot give them: libvips converts CMYK through its profiles.
for name in ['cmyk', 'ycck', 'ycck-adobe1']:
    with open(os.path.join(out, f'{name}.cmyk'), 'wb') as f:
        f.write(Image.open(os.path.join(out, f'{name}.jpg')).tobytes())
