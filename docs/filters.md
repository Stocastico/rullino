# Filter reference

50 filters. Generated from the filters' schemas (`packages/filters`): do not edit by hand; `npx vitest run packages/filters -u` rewrites it. Every filter has a WGSL (GPU) and a TypeScript (CPU) implementation, and the tests check that they agree. Pixel lengths are given for the full-resolution image and scale with previews.

## Adjust (18)

### Exposure (`exposure`)

Pointwise, premultiplied alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `ev` | EV | number | −5 … 5 (step 0.05) | 0 |

### Contrast (`contrast`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 |

### Brightness (`brightness`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 |

### Black point (`blackPoint`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | −0.2 … 0.2 (step 0.005) | 0 |

### Shadows / highlights (`shadowsHighlights`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `shadows` | Shadows | number | −1 … 1 (step 0.01) | 0 |
| `highlights` | Highlights | number | −1 … 1 (step 0.01) | 0 |

### Curves (`curves`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `rgb` | RGB | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) |
| `red` | Red | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) |
| `green` | Green | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) |
| `blue` | Blue | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) |

### Levels (`levels`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `inBlack` | Input black | number | 0 … 1 (step 0.005) | 0 |
| `inWhite` | Input white | number | 0 … 1 (step 0.005) | 1 |
| `gamma` | Gamma (midtones) | number | 0.1 … 10 (step 0.01) | 1 |
| `outBlack` | Output black | number | 0 … 1 (step 0.005) | 0 |
| `outWhite` | Output white | number | 0 … 1 (step 0.005) | 1 |

### Equalise histogram (`equalize`)

Multipass (3 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 |

### CLAHE (local contrast) (`clahe`)

Multipass (3 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `tiles` | Tiles per side | integer | 1 … 16 | 8 |
| `clipLimit` | Clip limit | number | 1 … 20 (step 0.1) | 3 |
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 |

### Gamma (`gamma`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `gamma` | Gamma | number | 0.2 … 5 (step 0.01) | 1 |

### Saturation (`saturation`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 |

### Vibrance (`vibrance`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 |

### Hue (`hue`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `degrees` | Rotation (°) | number | −180 … 180 (step 1) | 0 |

### Colour mixer (`colorMixer`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default | Group |
|---|---|---|---|---|---|
| `redHue` | Red (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `redSat` | Red | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `redLum` | Red | number | −1 … 1 (step 0.01) | 0 | Luminance |
| `orangeHue` | Orange (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `orangeSat` | Orange | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `orangeLum` | Orange | number | −1 … 1 (step 0.01) | 0 | Luminance |
| `yellowHue` | Yellow (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `yellowSat` | Yellow | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `yellowLum` | Yellow | number | −1 … 1 (step 0.01) | 0 | Luminance |
| `greenHue` | Green (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `greenSat` | Green | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `greenLum` | Green | number | −1 … 1 (step 0.01) | 0 | Luminance |
| `aquaHue` | Aqua (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `aquaSat` | Aqua | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `aquaLum` | Aqua | number | −1 … 1 (step 0.01) | 0 | Luminance |
| `blueHue` | Blue (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `blueSat` | Blue | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `blueLum` | Blue | number | −1 … 1 (step 0.01) | 0 | Luminance |
| `purpleHue` | Purple (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `purpleSat` | Purple | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `purpleLum` | Purple | number | −1 … 1 (step 0.01) | 0 | Luminance |
| `magentaHue` | Magenta (°) | number | −30 … 30 (step 1) | 0 | Hue |
| `magentaSat` | Magenta | number | −1 … 1 (step 0.01) | 0 | Saturation |
| `magentaLum` | Magenta | number | −1 … 1 (step 0.01) | 0 | Luminance |

### Colour grading (`colorGrading`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default | Group |
|---|---|---|---|---|---|
| `shadows` | Colour | colour | sRGB colour | #337399 | Shadows |
| `shadowsStrength` | Strength | number | 0 … 1 (step 0.01) | 0 | Shadows |
| `midtones` | Colour | colour | sRGB colour | #bf9973 | Midtones |
| `midtonesStrength` | Strength | number | 0 … 1 (step 0.01) | 0 | Midtones |
| `highlights` | Colour | colour | sRGB colour | #ffb359 | Highlights |
| `highlightsStrength` | Strength | number | 0 … 1 (step 0.01) | 0 | Highlights |
| `balance` | Balance | number | −1 … 1 (step 0.01) | 0 |  |

### Channel mixer (`channelMixer`)

Pointwise, premultiplied alpha.

| Parameter | Label | Type | Range / options | Default | Group |
|---|---|---|---|---|---|
| `rr` | From red | number | −2 … 2 (step 0.01) | 1 | Red output |
| `rg` | From green | number | −2 … 2 (step 0.01) | 0 | Red output |
| `rb` | From blue | number | −2 … 2 (step 0.01) | 0 | Red output |
| `gr` | From red | number | −2 … 2 (step 0.01) | 0 | Green output |
| `gg` | From green | number | −2 … 2 (step 0.01) | 1 | Green output |
| `gb` | From blue | number | −2 … 2 (step 0.01) | 0 | Green output |
| `br` | From red | number | −2 … 2 (step 0.01) | 0 | Blue output |
| `bg` | From green | number | −2 … 2 (step 0.01) | 0 | Blue output |
| `bb` | From blue | number | −2 … 2 (step 0.01) | 1 | Blue output |

### White balance (`whiteBalance`)

Pointwise, premultiplied alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `temperature` | Temperature | number | −1 … 1 (step 0.01) | 0 |
| `tint` | Tint | number | −1 … 1 (step 0.01) | 0 |

### Transparency (`transparency`)

Pointwise, premultiplied alpha.

Makes the image (or, with a mask, part of it) transparent. Export as PNG to keep the alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 |

## Look (4)

### LUT (`applyLut`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `look` | LUT file | 3D LUT | `.cube` or HaldCLUT file | none |
| `intensity` | Intensity | number | 0 … 1 (step 0.01) | 1 |

### Vignette (`vignette`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | −0.4 |
| `midpoint` | Midpoint | number | 0 … 1 (step 0.01) | 0.4 |
| `feather` | Feather | number | 0.05 … 1 (step 0.01) | 0.5 |
| `roundness` | Roundness | number | 0 … 1 (step 0.01) | 0 |

### Grain (`grain`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 1 (step 0.01) | 0.3 |
| `size` | Size (px) | number | 1 … 8 (step 0.1), in pixels of the full-resolution image | 1.5 |
| `seed` | Seed | integer | 0 … 999 | 0 |

### Gradient map (`gradientMap`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `shadows` | Shadows | colour | sRGB colour | #140a40 |
| `highlights` | Highlights | colour | sRGB colour | #ffd98c |
| `tritone` | Midtone colour | on / off |  | off |
| `midtones` | Midtones | colour | sRGB colour | #cc4059 |
| `midpoint` | Midpoint | number | 0.05 … 0.95 (step 0.01) | 0.5 |
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 |

## Classic (19)

### Grayscale (`grayscale`)

Pointwise, premultiplied alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `method` | Method | choice | `luminance` Luminance (Rec. 709), `average` Average, `max` Max | `luminance` |
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 |

### Invert (`invert`)

Pointwise, straight alpha.
No parameters.

### Threshold (`threshold`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `level` | Level | number | 0 … 1 (step 0.01) | 0.5 |
| `invert` | Invert | on / off |  | off |

### Otsu threshold (`otsu`)

Multipass (3 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `invert` | Invert | on / off |  | off |

### Adaptive threshold (`adaptiveThreshold`)

Multipass (4 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `sigma` | Neighbourhood σ (px) | number | 0.5 … 50 (step 0.1), in pixels of the full-resolution image | 8 |
| `offset` | Offset C | number | −0.5 … 0.5 (step 0.005) | 0.02 |
| `invert` | Invert | on / off |  | off |

### Posterize (`posterize`)

Pointwise, straight alpha.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `levels` | Levels | integer | 2 … 32 | 4 |

### Gaussian blur (`gaussianBlur`)

Multipass (2 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `sigma` | Sigma (px) | number | 0 … 50 (step 0.1), in pixels of the full-resolution image | 2 |

### Box blur (`boxBlur`)

Multipass (2 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `radius` | Radius (px) | integer | 0 … 50, in pixels of the full-resolution image | 3 |

### Sharpen (`sharpen`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 3 (step 0.01) | 0.5 |

### Unsharp mask (`unsharpMask`)

Multipass (3 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Amount | number | 0 … 5 (step 0.01) | 1 |
| `sigma` | Radius σ (px) | number | 0.3 … 50 (step 0.1), in pixels of the full-resolution image | 2 |

### Custom kernel (`convolve`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `kernel` | Kernel | 5×5 matrix | 25 values | 25 values |
| `normalize` | Normalise by sum | on / off |  | on |
| `bias` | Bias | number | −1 … 1 (step 0.01) | 0 |

### Canny edges (`canny`)

Multipass (7 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `sigma` | Smoothing σ (px) | number | 0 … 10 (step 0.1), in pixels of the full-resolution image | 1.4 |
| `low` | Low threshold | number | 0 … 1 (step 0.005) | 0.05 |
| `high` | High threshold | number | 0 … 1 (step 0.005) | 0.15 |
| `iterations` | Hysteresis iterations | integer | 0 … 256 | 64 |

### Morphology (`morphology`)

Multipass (3 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `operation` | Operation | choice | `erode` Erode, `dilate` Dilate, `open` Open, `close` Close, `gradient` Gradient, `tophat` Top-hat, `blackhat` Black-hat | `dilate` |
| `shape` | Structuring element | choice | `square` Square, `disk` Disk, `cross` Cross | `disk` |
| `radius` | Radius (px) | integer | 1 … 15, in pixels of the full-resolution image | 2 |

### Median (`median`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `radius` | Radius (px) | integer | 1 … 3, in pixels of the full-resolution image | 1 |

### Bilateral (`bilateral`)

Multipass (2 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `sigmaSpace` | Spatial sigma (px) | number | 0.5 … 20 (step 0.1), in pixels of the full-resolution image | 3 |
| `sigmaRange` | Colour sigma (ΔE) | number | 0.01 … 0.5 (step 0.005) | 0.08 |

### Remove (inpaint) (`inpaint`)

Multipass (8 passes), needs a mask.

Paint a mask over what to remove; it is rebuilt from the surrounding pixels. For wider areas, raise the reach to at least half their width.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `sigma` | Reach (px) | number | 1 … 100 (step 0.5), in pixels of the full-resolution image | 12 |
| `iterations` | Smoothing iterations | integer | 0 … 400 | 30 |

### Remove object (`patch`)

Multipass (1 pass).

Select what to remove with the brush, wand or Object tool, then press Fill with AI (the first use downloads a 28 MB model).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `patch` | Image | image | an image set by the app, not serialisable | none |

### Gradient (`gradient`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `method` | Operator | choice | `sobel` Sobel, `scharr` Scharr, `prewitt` Prewitt | `sobel` |
| `output` | Output | choice | `magnitude` Magnitude, `horizontal` Horizontal, `vertical` Vertical | `magnitude` |
| `strength` | Strength | number | 0 … 10 (step 0.01) | 1 |

### Laplacian (`laplacian`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `connectivity` | Neighbours | choice | `four` 4 neighbours, `eight` 8 neighbours | `four` |
| `output` | Output | choice | `signed` Signed, `magnitude` Magnitude | `signed` |
| `strength` | Strength | number | 0 … 10 (step 0.01) | 1 |

## Stylize (9)

### Pixelate (`pixelate`)

Multipass (2 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `size` | Cell size (px) | integer | 1 … 128, in pixels of the full-resolution image | 12 |

### Halftone (`halftone`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `size` | Dot spacing (px) | number | 2 … 64 (step 0.5), in pixels of the full-resolution image | 8 |
| `angle` | Angle (°) | number | 0 … 90 (step 1) | 45 |
| `mode` | Inks | choice | `mono` Mono, `cmy` CMY | `mono` |

### Dither (`dither`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `levels` | Levels | integer | 2 … 16 | 2 |
| `matrix` | Pattern | choice | `bayer2` Bayer 2×2, `bayer4` Bayer 4×4, `bayer8` Bayer 8×8, `white` White noise, `gradient` R2 (evenly spread) | `bayer4` |
| `seed` | Noise seed | integer | 0 … 999 | 0 |
| `mode` | Colours | choice | `mono` Mono, `color` Colour | `mono` |
| `scale` | Cell size (px) | integer | 1 … 16, in pixels of the full-resolution image | 1 |

### Emboss (`emboss`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `angle` | Light angle (°) | number | 0 … 360 (step 1) | 135 |
| `strength` | Strength | number | 0 … 4 (step 0.01) | 1 |
| `distance` | Distance (px) | integer | 1 … 10, in pixels of the full-resolution image | 1 |
| `mode` | Surface | choice | `grey` Grey, `color` Colour | `grey` |

### Sketch (`sketch`)

Multipass (4 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `sigma` | Line width σ (px) | number | 0.5 … 20 (step 0.1), in pixels of the full-resolution image | 3 |
| `darkness` | Darkness | number | 0.5 … 4 (step 0.01) | 1.5 |

### Bloom (`bloom`)

Multipass (4 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `threshold` | Threshold | number | 0 … 2 (step 0.01) | 0.7 |
| `sigma` | Radius σ (px) | number | 0.5 … 60 (step 0.5), in pixels of the full-resolution image | 12 |
| `intensity` | Intensity | number | 0 … 2 (step 0.01) | 0.6 |

### Chromatic aberration (`chromaticAberration`)

Multipass (1 pass).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `amount` | Shift at the corners (px) | number | −20 … 20 (step 0.1), in pixels of the full-resolution image | 4 |

### Kuwahara (painterly) (`kuwahara`)

Multipass (2 passes).

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `radius` | Radius (px) | integer | 1 … 10, in pixels of the full-resolution image | 4 |
| `sharpness` | Sharpness | number | 1 … 16 (step 0.5) | 8 |

### Lens blur (depth) (`lensBlur`)

Multipass (1 pass).

Blurs by distance from the focus depth. Press Estimate depth (the first use downloads a 27 MB model), then move the focus.

| Parameter | Label | Type | Range / options | Default |
|---|---|---|---|---|
| `depth` | Depth map | image | an image set by the app, not serialisable | none |
| `focus` | Focus depth | number | 0 … 1 (step 0.01) | 0.5 |
| `range` | Sharp range | number | 0 … 0.5 (step 0.01) | 0.1 |
| `radius` | Blur radius (px) | number | 0 … 40 (step 0.5), in pixels of the full-resolution image | 12 |
