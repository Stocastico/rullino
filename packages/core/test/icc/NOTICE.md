# ICC fixtures

Written by `make-icc-fixtures.py` (run it to regenerate them and `reference.json`).

- `sRGB.icc`, `compatibleWithAdobeRGB1998.icc`, `Gray.icc`, `Gray-CIE_L.icc`, `ITULab.icc` come from Debian's `icc-profiles-free` (copyright Kai-Uwe Behrmann, Marti Maria, Photogamut, Graeme Gill, ColorSolutions); `LStar-RGB.icc` from the same package (copyright 2007 basICColor GmbH). All are under the zlib licence: "This software is provided 'as-is', without any express or implied warranty… Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely", provided the origin is not misrepresented and this notice is kept.
- The other `.icc` files are built byte by byte by the script and are free for any use.
- `reference.json` holds littleCMS 2's conversions of each profile (double precision, relative colorimetric).
