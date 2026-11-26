# Generates the metadata fixtures in test/metadata/ (run from the repository root:
# python3 packages/codecs/test/make-metadata-fixtures.py; needs exiftool, Pillow and sharp's ICC file
# is not needed: the profile is Pillow's built-in sRGB). Each format gets the same metadata, written by
# exiftool: EXIF with camera, date, orientation 6, personal fields (artist, owner, serial numbers, user
# comment), a GPS position and a thumbnail; XMP (creator, title, rating, GPS, city); IPTC (by-line,
# caption, keywords, city); an ICC profile. exiftool's own reading of every file is saved as
# <file>.json, the reference for the parser's tests (the tests need neither exiftool nor Pillow).
import json
import os
import subprocess

from PIL import Image, ImageCms

root = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(root, 'metadata')
os.makedirs(out, exist_ok=True)
for f in os.listdir(out):
    os.remove(os.path.join(out, f))

src = Image.open(os.path.join(root, '../../../apps/playground/public/samples/river.jpg')).convert('RGB').crop((600, 300, 664, 348))  # 64 × 48
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
with open(os.path.join(out, 'srgb.icc'), 'wb') as f:
    f.write(icc)
thumb = os.path.join(out, 'thumb.jpg')
src.resize((16, 12)).save(thumb, quality=80)

src.save(os.path.join(out, 'photo.jpg'), quality=90)
src.save(os.path.join(out, 'photo.png'))
src.save(os.path.join(out, 'photo.webp'), lossless=True)
src.save(os.path.join(out, 'photo.tif'))

tags = [
    '-ExifImageWidth=64', '-ExifImageHeight=48', '-Make=RullinoCam', '-Model=Test Model 1', '-Orientation#=6', '-DateTimeOriginal=2026:11:25 09:30:00', '-Software=fixture',
    '-Artist=Jane Photographer', '-Copyright=CC0', '-OwnerName=Jane Doe', '-SerialNumber=SN-123456', '-LensSerialNumber=LSN-987',
    '-ImageUniqueID=0123456789abcdef0123456789abcdef', '-UserComment=private note', '-XPAuthor=Jane P',
    '-GPSLatitude=45.4642', '-GPSLatitudeRef=N', '-GPSLongitude=9.19', '-GPSLongitudeRef=E', '-GPSAltitude=120', '-GPSAltitudeRef=0',
    '-XMP-dc:Creator=Jane Photographer', '-XMP-dc:Title=River', '-XMP-xmp:Rating=4', '-XMP-exif:GPSLatitude=45.4642 N',
    '-XMP-exif:GPSLongitude=9.19 E', '-XMP-photoshop:City=Milano', '-XMP-aux:SerialNumber=SN-123456',
    '-IPTC:By-line=Jane Photographer', '-IPTC:Caption-Abstract=A river', '-IPTC:Keywords=river', '-IPTC:Keywords=water', '-IPTC:City=Milano',
    f'-ICC_Profile<={os.path.join(out, "srgb.icc")}',
]
for name in ['photo.jpg', 'photo.png', 'photo.webp', 'photo.tif']:
    path = os.path.join(out, name)
    extra = [f'-ThumbnailImage<={thumb}'] if name != 'photo.tif' else []
    subprocess.run(['exiftool', '-q', '-overwrite_original', *tags, *extra, path], check=True)
    meta = json.loads(subprocess.run(['exiftool', '-j', '-n', '-G1', '-struct', path], check=True, capture_output=True).stdout)[0]
    meta.pop('SourceFile', None)
    for k in [k for k in meta if k.startswith('System:') or k.startswith('ExifTool:') or k.startswith('File:')]:
        meta.pop(k)
    with open(os.path.join(out, f'{name}.json'), 'w') as f:
        json.dump(meta, f, indent=1, sort_keys=True)
os.remove(thumb)
print(sorted(os.listdir(out)))
