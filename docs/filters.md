# Filter reference

51 filters. Generated from the filters' schemas (`packages/filters`): do not edit by hand; `npx vitest run packages/filters -u` rewrites it. Every filter has a WGSL (GPU) and a TypeScript (CPU) implementation, and the tests check that they agree. Pixel lengths are given for the full-resolution image and scale with previews.

## Adjust (18)

### Exposure (`exposure`)

Pointwise, premultiplied alpha.

Makes the whole picture lighter or darker, like opening or closing the lens by whole stops of light.

**Try this:** Raise it until the sky starts to lose detail, then lower it a little.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `ev` | EV | number | −5 … 5 (step 0.05) | 0 | Stops of light: +1 doubles the brightness, −1 halves it. |

### Contrast (`contrast`)

Pointwise, straight alpha.

Spreads tones apart (more contrast) or squeezes them together (less), around mid grey.

**Try this:** Add some, then look at the histogram: the tones spread towards both ends.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 | Negative flattens the picture, positive makes darks darker and lights lighter. |

### Brightness (`brightness`)

Pointwise, straight alpha.

Makes the picture lighter or darker while keeping the colours as they are (unlike Exposure, it works on perceived lightness).

**Try this:** Push it up and compare with Exposure: brightness leaves hue and colourfulness alone.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 | Negative darkens, positive lightens; 0 changes nothing. |

### Black point (`blackPoint`)

Pointwise, straight alpha.

Sets how dark the darkest tones are: raising the black point deepens shadows, lowering it lifts them into a faded look.

**Try this:** Lower it slightly for a matte, filmic shadow, or raise it to make blacks richer.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | −0.2 … 0.2 (step 0.005) | 0 | Positive values crush the shadows towards black; negative values lift them. |

### Shadows / highlights (`shadowsHighlights`)

Pointwise, straight alpha.

Recovers detail in dark and bright areas by lightening shadows or darkening highlights.

**Try this:** Lift the shadows of a backlit portrait, then pull the highlights down a little to recover the sky.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `shadows` | Shadows | number | −1 … 1 (step 0.01) | 0 | Positive lightens dark areas, negative deepens them. |
| `highlights` | Highlights | number | −1 … 1 (step 0.01) | 0 | Negative darkens bright areas, positive brightens them. |

### Curves (`curves`)

Pointwise, straight alpha.

Redraws the tone response with a curve: drag points to lift or lower any range of tones, overall or per colour channel.

**Try this:** Pull the middle of the RGB curve up for a brighter mood, or drag the ends in for a faded look.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `rgb` | RGB | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) | The curve for all channels together: brightness and contrast. |
| `red` | Red | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) | Applied to red only, after the RGB curve. |
| `green` | Green | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) | Applied to green only, after the RGB curve. |
| `blue` | Blue | tone curve | 2 to 16 points in [0, 1] | (0, 0) (1, 1) | Applied to blue only, after the RGB curve. |

### Levels (`levels`)

Pointwise, straight alpha.

Maps a range of input tones to a range of output tones: set the black and white points, then adjust the midtones.

**Try this:** Move Input black and Input white towards the edges of the histogram, then use the midtone gamma to set the mood.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `inBlack` | Input black | number | 0 … 1 (step 0.005) | 0 | Input tones at or below this become black. |
| `inWhite` | Input white | number | 0 … 1 (step 0.005) | 1 | Input tones at or above this become white. |
| `gamma` | Gamma (midtones) | number | 0.1 … 10 (step 0.01) | 1 | Above 1 lightens the midtones, below 1 darkens them. |
| `outBlack` | Output black | number | 0 … 1 (step 0.005) | 0 | Black is raised to this level: a higher value gives a faded look. |
| `outWhite` | Output white | number | 0 … 1 (step 0.005) | 1 | White is lowered to this level. |

### Equalise histogram (`equalize`)

Multipass (3 passes).

Spreads the tones evenly across the brightness range, which stretches contrast on flat images.

**Try this:** Try it on a dull, hazy photo, then lower Amount until it stops looking harsh.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 | Blend between the original (0) and the fully equalised picture (1). |

### CLAHE (local contrast) (`clahe`)

Multipass (3 passes).

Boosts local contrast by balancing the histogram tile by tile, bringing out detail in flat or hazy areas.

**Try this:** Raise the clip limit until textures pop, then pull Amount back until it looks natural.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `tiles` | Tiles per side | integer | 1 … 16 | 8 | How many tiles the image is cut into on each side. More tiles means more local, and a stronger effect on small areas. |
| `clipLimit` | Clip limit | number | 1 … 20 (step 0.1) | 3 | How much contrast a tile may gain. Low values are gentle; high values bring out detail but also noise. |
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 | Blend between the original (0) and the full effect (1). |

### Gamma (`gamma`)

Pointwise, straight alpha.

Brightens or darkens the midtones without moving pure black or pure white.

**Try this:** Drag it below 1 to darken the middle and above 1 to lighten it, and watch the ends stay put.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `gamma` | Gamma | number | 0.2 … 5 (step 0.01) | 1 | Above 1 lightens the midtones, below 1 darkens them; 1 changes nothing. |

### Saturation (`saturation`)

Pointwise, straight alpha.

Makes colours stronger or weaker, all by the same amount.

**Try this:** Take it to the minimum for a grey picture, then bring it back to just under natural.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 | -1 removes all colour, +1 doubles the colourfulness; 0 changes nothing. |

### Vibrance (`vibrance`)

Pointwise, straight alpha.

Boosts muted colours more than ones that are already strong.

**Try this:** Compare with Saturation on a muted photo: vibrance lifts the dull colours while strong ones barely change.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | 0 | Positive boosts the dull colours most, negative mutes them; 0 changes nothing. |

### Hue (`hue`)

Pointwise, straight alpha.

Rotates all colours around the colour wheel, so reds turn to greens, blues to oranges, and so on.

**Try this:** Rotate by 180° for complementary colours, or by a few degrees to fix a colour cast.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `degrees` | Rotation (°) | number | −180 … 180 (step 1) | 0 | How far to rotate the hues; ±180° is the opposite colour. |

### Colour mixer (`colorMixer`)

Pointwise, straight alpha.

Adjusts hue, saturation and lightness separately for eight colour ranges, so you can change the sky without touching the skin.

**Try this:** Darken Blue and raise its saturation for a deeper sky, then shift Orange slightly to warm the skin.

| Parameter | Label | Type | Range / options | Default | Group | Notes |
|---|---|---|---|---|---|---|
| `redHue` | Red (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of red tones. |
| `redSat` | Red | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful red tones are. |
| `redLum` | Red | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark red tones are. |
| `orangeHue` | Orange (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of orange tones. |
| `orangeSat` | Orange | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful orange tones are. |
| `orangeLum` | Orange | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark orange tones are. |
| `yellowHue` | Yellow (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of yellow tones. |
| `yellowSat` | Yellow | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful yellow tones are. |
| `yellowLum` | Yellow | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark yellow tones are. |
| `greenHue` | Green (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of green tones. |
| `greenSat` | Green | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful green tones are. |
| `greenLum` | Green | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark green tones are. |
| `aquaHue` | Aqua (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of aqua tones. |
| `aquaSat` | Aqua | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful aqua tones are. |
| `aquaLum` | Aqua | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark aqua tones are. |
| `blueHue` | Blue (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of blue tones. |
| `blueSat` | Blue | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful blue tones are. |
| `blueLum` | Blue | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark blue tones are. |
| `purpleHue` | Purple (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of purple tones. |
| `purpleSat` | Purple | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful purple tones are. |
| `purpleLum` | Purple | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark purple tones are. |
| `magentaHue` | Magenta (°) | number | −30 … 30 (step 1) | 0 | Hue | Rotates the hue of magenta tones. |
| `magentaSat` | Magenta | number | −1 … 1 (step 0.01) | 0 | Saturation | How colourful magenta tones are. |
| `magentaLum` | Magenta | number | −1 … 1 (step 0.01) | 0 | Luminance | How light or dark magenta tones are. |

### Colour grading (`colorGrading`)

Pointwise, straight alpha.

Tints shadows, midtones and highlights separately, the way split toning and three-way colour wheels do.

**Try this:** Give the shadows a teal tint and the highlights an orange one at low strength.

| Parameter | Label | Type | Range / options | Default | Group | Notes |
|---|---|---|---|---|---|---|
| `shadows` | Colour | colour | sRGB colour | #337399 | Shadows | The colour added to the dark tones. |
| `shadowsStrength` | Strength | number | 0 … 1 (step 0.01) | 0 | Shadows | How strongly the shadows are tinted; 0 turns it off. |
| `midtones` | Colour | colour | sRGB colour | #bf9973 | Midtones | The colour added to the middle tones. |
| `midtonesStrength` | Strength | number | 0 … 1 (step 0.01) | 0 | Midtones | How strongly the midtones are tinted; 0 turns it off. |
| `highlights` | Colour | colour | sRGB colour | #ffb359 | Highlights | The colour added to the bright tones. |
| `highlightsStrength` | Strength | number | 0 … 1 (step 0.01) | 0 | Highlights | How strongly the highlights are tinted; 0 turns it off. |
| `balance` | Balance | number | −1 … 1 (step 0.01) | 0 |  | Moves the boundary between shadows and highlights: negative widens the shadows, positive widens the highlights. |

### Channel mixer (`channelMixer`)

Pointwise, premultiplied alpha.

Builds each output colour channel from a weighted mix of the input channels, on linear light.

**Try this:** Feed some red into the blue output for a surreal colour swap, or set the red output to 0.3 / 0.6 / 0.1 for a classic black-and-white look.

| Parameter | Label | Type | Range / options | Default | Group | Notes |
|---|---|---|---|---|---|---|
| `rr` | From red | number | −2 … 2 (step 0.01) | 1 | Red output | How much of the input red goes into the red output. |
| `rg` | From green | number | −2 … 2 (step 0.01) | 0 | Red output | How much of the input green goes into the red output. |
| `rb` | From blue | number | −2 … 2 (step 0.01) | 0 | Red output | How much of the input blue goes into the red output. |
| `gr` | From red | number | −2 … 2 (step 0.01) | 0 | Green output | How much of the input red goes into the green output. |
| `gg` | From green | number | −2 … 2 (step 0.01) | 1 | Green output | How much of the input green goes into the green output. |
| `gb` | From blue | number | −2 … 2 (step 0.01) | 0 | Green output | How much of the input blue goes into the green output. |
| `br` | From red | number | −2 … 2 (step 0.01) | 0 | Blue output | How much of the input red goes into the blue output. |
| `bg` | From green | number | −2 … 2 (step 0.01) | 0 | Blue output | How much of the input green goes into the blue output. |
| `bb` | From blue | number | −2 … 2 (step 0.01) | 1 | Blue output | How much of the input blue goes into the blue output. |

### White balance (`whiteBalance`)

Pointwise, premultiplied alpha.

Corrects the colour of the light so that neutral things look neutral: cooler or warmer, greener or more magenta.

**Try this:** Drag Temperature until something that should be white or grey looks neutral.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `temperature` | Temperature | number | −1 … 1 (step 0.01) | 0 | Negative makes the picture cooler (bluer), positive warmer (more orange). |
| `tint` | Tint | number | −1 … 1 (step 0.01) | 0 | Negative adds green, positive adds magenta. |

### Transparency (`transparency`)

Pointwise, premultiplied alpha.

Makes the image (or, with a mask, part of it) transparent. Export as PNG to keep the alpha.

**Try this:** Add a mask (try a gradient) and watch the checkerboard appear where it applies.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 | How transparent the result is: 0 leaves it opaque, 1 makes it fully see-through. |

## Look (4)

### LUT (`applyLut`)

Multipass (1 pass).

Applies a colour look stored in a 3D LUT file (.cube or Hald CLUT), the format colour graders and presets use.

**Try this:** Load a .cube file, then use Intensity to mix it with the original.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `look` | LUT file | 3D LUT | `.cube` or HaldCLUT file | none | The LUT file to apply (.cube or a Hald CLUT image). |
| `intensity` | Intensity | number | 0 … 1 (step 0.01) | 1 | Blend between the original (0) and the full look (1). |

### Vignette (`vignette`)

Multipass (1 pass).

Darkens or lightens the edges of the picture to draw the eye to the centre.

**Try this:** Make the amount slightly negative and the feather wide for a natural lens falloff.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | −1 … 1 (step 0.01) | −0.4 | Negative darkens the edges, positive lightens them. |
| `midpoint` | Midpoint | number | 0 … 1 (step 0.01) | 0.4 | How far from the centre the effect starts (the corners are 1). |
| `feather` | Feather | number | 0.05 … 1 (step 0.01) | 0.5 | How gradually the effect fades in; larger is softer. |
| `roundness` | Roundness | number | 0 … 1 (step 0.01) | 0 | 0 follows the shape of the picture; 1 makes the vignette a circle. |

### Grain (`grain`)

Multipass (1 pass).

Adds film-like grain, strongest in the midtones and gentler in deep shadows and bright highlights.

**Try this:** Raise the size a little, then pull the amount back until you only feel it.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | 0 … 1 (step 0.01) | 0.3 | How strong the grain is. |
| `size` | Size (px) | number | 1 … 8 (step 0.1), in pixels of the full-resolution image | 1.5 | Size of the grain in pixels. |
| `seed` | Seed | integer | 0 … 999 | 0 | Changes the grain pattern without changing its look. |

### Gradient map (`gradientMap`)

Pointwise, straight alpha.

Recolours the picture by brightness: darks get one colour, lights another, optionally with a third in between (duotone and tritone).

**Try this:** Pick a deep blue for shadows and a warm yellow for highlights, then turn on the midtone colour.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `shadows` | Shadows | colour | sRGB colour | #140a40 | Colour for the darkest tones. |
| `highlights` | Highlights | colour | sRGB colour | #ffd98c | Colour for the brightest tones. |
| `tritone` | Midtone colour | on / off |  | off | Add a third colour between the other two. |
| `midtones` | Midtones | colour | sRGB colour | #cc4059 | Colour for the middle tones; used only when the midtone colour is on. |
| `midpoint` | Midpoint | number | 0.05 … 0.95 (step 0.01) | 0.5 | Which brightness gets the midtone colour; used only when the midtone colour is on. |
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 | Blend between the original (0) and the full recolouring (1). |

## Classic (19)

### Grayscale (`grayscale`)

Pointwise, premultiplied alpha.

Removes colour, keeping only brightness.

**Try this:** Compare Luminance, Average and Max on a picture with a strong red or blue.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `method` | Method | choice | `luminance` Luminance (Rec. 709), `average` Average, `max` Max | `luminance` | How brightness is computed. Luminance weighs colours like the eye does, Average takes the mean, Max takes the brightest channel. |
| `amount` | Amount | number | 0 … 1 (step 0.01) | 1 | Blend between the original colour (0) and full grayscale (1). |

### Invert (`invert`)

Pointwise, straight alpha.

Swaps every colour for its opposite, like a photographic negative.

**Try this:** Apply it twice and the original comes back.
No parameters.

### Threshold (`threshold`)

Pointwise, straight alpha.

Turns the picture into pure black and white: pixels brighter than the level become white.

**Try this:** Slide the level and watch the picture become a stencil.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `level` | Level | number | 0 … 1 (step 0.01) | 0.5 | The brightness cut-off. Higher values leave less white. |
| `invert` | Invert | on / off |  | off | Swap black and white. |

### Otsu threshold (`otsu`)

Multipass (3 passes).

Turns the picture into black and white, choosing the best cut-off automatically from the histogram.

**Try this:** Try it on a clear subject against a plain background.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `invert` | Invert | on / off |  | off | Swap black and white. |

### Adaptive threshold (`adaptiveThreshold`)

Multipass (4 passes).

Turns the picture into black and white by comparing each pixel with the average of its surroundings, so it copes with uneven lighting.

**Try this:** Try it on a photographed page with a shadow across it, where a plain Threshold fails.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `sigma` | Neighbourhood σ (px) | number | 0.5 … 50 (step 0.1), in pixels of the full-resolution image | 8 | How far around each pixel the local average reaches. Larger values suit bigger shapes. |
| `offset` | Offset C | number | −0.5 … 0.5 (step 0.005) | 0.02 | A pixel turns white when it is brighter than its local average minus this value. Raise it for more white; lower it to remove speckles. |
| `invert` | Invert | on / off |  | off | Swap black and white. |

### Posterize (`posterize`)

Pointwise, straight alpha.

Reduces each colour channel to a few levels, giving flat poster-like areas.

**Try this:** Go down to 3 or 4 levels for graphic blocks of colour.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `levels` | Levels | integer | 2 … 32 | 4 | How many levels each channel keeps. 2 is the most extreme. |

### Gaussian blur (`gaussianBlur`)

Multipass (2 passes).

Blurs with a bell-shaped weighting, the most natural-looking blur.

**Try this:** Add a mask to blur only part of the picture, such as the background.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `sigma` | Sigma (px) | number | 0 … 50 (step 0.1), in pixels of the full-resolution image | 2 | The spread of the blur in pixels; 0 changes nothing. |

### Box blur (`boxBlur`)

Multipass (2 passes).

Blurs by averaging every pixel in a square around each pixel.

**Try this:** Compare it with Gaussian blur at a large radius: the box leaves a more even, slightly blocky blur.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `radius` | Radius (px) | integer | 0 … 50, in pixels of the full-resolution image | 3 | Half the side of the square, in pixels; 0 changes nothing. |

### Sharpen (`sharpen`)

Multipass (1 pass).

Makes edges crisper by emphasising the difference between each pixel and its four neighbours.

**Try this:** Zoom to 100% and raise it until edges stand out, then back off before halos appear.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | 0 … 3 (step 0.01) | 0.5 | Strength of the sharpening; 0 changes nothing. |

### Unsharp mask (`unsharpMask`)

Multipass (3 passes).

Sharpens by subtracting a blurred copy, the classic photographic method; the radius sets which detail is boosted.

**Try this:** Use a small radius for fine detail and a large one for a broad local-contrast boost.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Amount | number | 0 … 5 (step 0.01) | 1 | How strongly the detail is boosted; 0 changes nothing. |
| `sigma` | Radius σ (px) | number | 0.3 … 50 (step 0.1), in pixels of the full-resolution image | 2 | Size of the blur that is subtracted, in pixels. Small boosts fine texture, large boosts broader contrast. |

### Custom kernel (`convolve`)

Multipass (1 pass).

Applies your own 5×5 kernel: each output pixel is a weighted sum of its neighbours. A 3×3 kernel goes in the centre.

**Try this:** Put 1 in the centre and 0 elsewhere for no change, then try 5 in the centre with -1 on the four cells next to it for a sharpen.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `kernel` | Kernel | 5×5 matrix | 25 values | 25 values | The weights. The centre cell is the pixel itself. |
| `normalize` | Normalise by sum | on / off |  | on | Divide by the sum of the weights, so a blur keeps the overall brightness. |
| `bias` | Bias | number | −1 … 1 (step 0.01) | 0 | Added to the result, useful for kernels whose weights add up to zero (edge detectors). |

### Canny edges (`canny`)

Multipass (7 passes).

Finds thin, connected edges: smooths the picture, measures the gradient, thins it to one pixel, then keeps strong edges and the weak ones attached to them.

**Try this:** Lower the high threshold until the outline of the main subject appears, then raise the low threshold to cut the noise.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `sigma` | Smoothing σ (px) | number | 0 … 10 (step 0.1), in pixels of the full-resolution image | 1.4 | Blur applied first, in pixels. More smoothing ignores fine texture. |
| `low` | Low threshold | number | 0 … 1 (step 0.005) | 0.05 | Gradients below this are never edges; between low and high they count only when connected to a strong edge. |
| `high` | High threshold | number | 0 … 1 (step 0.005) | 0.15 | Gradients above this are always edges. |
| `iterations` | Hysteresis iterations | integer | 0 … 256 | 64 | How many rounds are used to follow weak edges. Enough rounds give the full result; more only costs time. |

### Morphology (`morphology`)

Multipass (3 passes).

Grows or shrinks bright shapes, or opens and closes gaps, with a small shape moved over the picture.

**Try this:** Erode removes small bright specks; Dilate widens bright shapes; Close fills small dark holes.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `operation` | Operation | choice | `erode` Erode, `dilate` Dilate, `open` Open, `close` Close, `gradient` Gradient, `tophat` Top-hat, `blackhat` Black-hat | `dilate` | Erode shrinks bright areas, Dilate grows them. Open and Close combine the two to remove specks or fill holes. Gradient outlines shapes; Top-hat and Black-hat keep small bright or dark details. |
| `shape` | Structuring element | choice | `square` Square, `disk` Disk, `cross` Cross | `disk` | The shape moved over the picture: a square, a round disk or a cross. |
| `radius` | Radius (px) | integer | 1 … 15, in pixels of the full-resolution image | 2 | Size of that shape in pixels. |

### Median (`median`)

Multipass (1 pass).

Replaces each pixel by the median of its neighbours, which removes speckle noise while keeping edges.

**Try this:** Use radius 1 on a noisy shot, and radius 3 for a painterly, flattened look.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `radius` | Radius (px) | integer | 1 … 3, in pixels of the full-resolution image | 1 | Size of the neighbourhood in pixels. |

### Bilateral (`bilateral`)

Multipass (2 passes).

Smooths flat areas while keeping edges sharp, by averaging only with neighbours of a similar colour.

**Try this:** Raise the spatial sigma on a portrait for smooth skin, and keep the colour sigma low so edges stay crisp.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `sigmaSpace` | Spatial sigma (px) | number | 0.5 … 20 (step 0.1), in pixels of the full-resolution image | 3 | How far the smoothing reaches, in pixels. |
| `sigmaRange` | Colour sigma (ΔE) | number | 0.01 … 0.5 (step 0.005) | 0.08 | How different in colour a neighbour may be and still be averaged in. Low keeps edges; high approaches a plain blur. |

### Remove (inpaint) (`inpaint`)

Multipass (8 passes), needs a mask.

Paint a mask over what to remove; it is rebuilt from the surrounding pixels. For wider areas, raise the reach to at least half their width.

**Try this:** Paint a thin scratch or a wire, and watch it disappear; use a larger reach for wider areas.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `sigma` | Reach (px) | number | 1 … 100 (step 0.5), in pixels of the full-resolution image | 12 | How far into the surroundings the fill reaches, in pixels. Use at least half the width of the area you remove. |
| `iterations` | Smoothing iterations | integer | 0 … 400 | 30 | Smoothing rounds applied to the fill. More is smoother but slower. |

### Remove object (`patch`)

Multipass (1 pass).

Select what to remove with the brush, wand or Object tool, then press Fill with AI (the first use downloads a 28 MB model).

**Try this:** Paint over a small object first, then press Fill with AI.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `patch` | Image | image | an image set by the app, not serialisable | none | The fill made by the Fill with AI button; there is nothing to set by hand. |

### Gradient (`gradient`)

Multipass (1 pass).

Shows how fast brightness changes at each pixel: edges light up, flat areas go dark.

**Try this:** Switch Output to Horizontal, then Vertical, to see which edges each direction picks up.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `method` | Operator | choice | `sobel` Sobel, `scharr` Scharr, `prewitt` Prewitt | `sobel` | The kernel used. Sobel is the usual choice, Scharr is more accurate for diagonals, Prewitt is the simplest. |
| `output` | Output | choice | `magnitude` Magnitude, `horizontal` Horizontal, `vertical` Vertical | `magnitude` | Magnitude shows edge strength in any direction; Horizontal and Vertical show signed change on mid grey. |
| `strength` | Strength | number | 0 … 10 (step 0.01) | 1 | Scales the result; raise it to see faint edges. |

### Laplacian (`laplacian`)

Multipass (1 pass).

Measures how much each pixel differs from its neighbours, which highlights edges and fine detail.

**Try this:** Use Magnitude to see edges as bright lines, or Signed to see which side of an edge is brighter.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `connectivity` | Neighbours | choice | `four` 4 neighbours, `eight` 8 neighbours | `four` | Which neighbours are compared: the 4 direct ones, or all 8 around the pixel. |
| `output` | Output | choice | `signed` Signed, `magnitude` Magnitude | `signed` | Signed keeps the direction of change on mid grey; Magnitude shows its size only. |
| `strength` | Strength | number | 0 … 10 (step 0.01) | 1 | Scales the result; raise it to see faint detail. |

## Stylize (10)

### ASCII art (`ascii`)

Multipass (1 pass).

Redraws the picture as small text-like glyphs, from empty cells in the darks to solid ones in the lights.

**Try this:** Raise the cell size to 16 or more to see the individual glyphs.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `cell` | Cell size (px) | integer | 4 … 32, in pixels of the full-resolution image | 8 | Width of each glyph cell in pixels. |
| `color` | Glyph colour | choice | `fixed` Ink colour, `source` Image colours | `fixed` | Use one ink colour on one paper colour, or take each glyph's colour from the picture. |
| `ink` | Ink | colour | sRGB colour | #d9ffd9 | Colour of the glyphs when using the ink colour. |
| `paper` | Paper | colour | sRGB colour | #0a120d | Colour of the background. |
| `invert` | Dark = dense | on / off |  | off | Off: bright areas get the dense glyphs. On: dark areas get them instead, which suits dark ink on light paper. |

### Pixelate (`pixelate`)

Multipass (2 passes).

Replaces the picture with big square pixels, each the average of the area under it.

**Try this:** Pixelate a small masked area to hide a face or a licence plate.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `size` | Cell size (px) | integer | 1 … 128, in pixels of the full-resolution image | 12 | Width of each square in pixels. |

### Halftone (`halftone`)

Multipass (1 pass).

Prints the picture as dots whose size follows the tone, like a newspaper or a screen print.

**Try this:** Switch the inks to CMY and make the dots bigger to see the colour screens.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `size` | Dot spacing (px) | number | 2 … 64 (step 0.5), in pixels of the full-resolution image | 8 | Distance between dots in pixels. |
| `angle` | Angle (°) | number | 0 … 90 (step 1) | 45 | Rotation of the dot grid; 45° is the classic print angle. |
| `mode` | Inks | choice | `mono` Mono, `cmy` CMY | `mono` | Mono prints black dots from the brightness; CMY prints three colour screens at different angles. |
| `shape` | Dot shape | choice | `circle` Round, `square` Square, `ring` Ring | `circle` | Round, square or ring-shaped dots. |
| `grid` | Grid | choice | `square` Square grid, `hex` Hex grid | `square` | Dots in a square grid or a honeycomb (hex) grid. |

### Dither (`dither`)

Multipass (1 pass).

Reduces the picture to a few tones and uses a pattern of dots to fake the in-between ones, as in old newspapers and retro screens.

**Try this:** Set Levels to 2 and compare Bayer 8×8 with White noise, then chain a Gradient map for a palette.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `levels` | Levels | integer | 2 … 16 | 2 | How many tones are kept per channel. 2 is pure black and white. |
| `matrix` | Pattern | choice | `bayer2` Bayer 2×2, `bayer4` Bayer 4×4, `bayer8` Bayer 8×8, `white` White noise, `gradient` R2 (evenly spread) | `bayer4` | The pattern that decides where each dot goes: ordered Bayer grids, random white noise, or the evenly spread R2 pattern. |
| `seed` | Noise seed | integer | 0 … 999 | 0 | Changes the random pattern; only used by White noise. |
| `mode` | Colours | choice | `mono` Mono, `color` Colour | `mono` | Mono dithers the brightness only; Colour dithers each colour channel. |
| `scale` | Cell size (px) | integer | 1 … 16, in pixels of the full-resolution image | 1 | Size of each pattern cell in pixels; larger gives a chunkier look. |

### Emboss (`emboss`)

Multipass (1 pass).

Turns edges into a relief, as if the picture were stamped into metal and lit from one side.

**Try this:** Rotate the light angle and watch the raised and sunken edges swap sides.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `angle` | Light angle (°) | number | 0 … 360 (step 1) | 135 | Direction of the light, counter-clockwise from the right. Edges facing the light rise. |
| `strength` | Strength | number | 0 … 4 (step 0.01) | 1 | How deep the relief looks. |
| `distance` | Distance (px) | integer | 1 … 10, in pixels of the full-resolution image | 1 | How far apart the compared pixels are, in pixels. Larger gives a thicker relief. |
| `mode` | Surface | choice | `grey` Grey, `color` Colour | `grey` | Grey shows the relief on mid grey; Colour adds it to the picture's colours. |

### Sketch (`sketch`)

Multipass (4 passes).

Turns the picture into a pencil-like drawing by comparing each pixel with a blurred copy of the picture.

**Try this:** Make the line width larger for bold strokes, then raise the darkness for a deeper drawing.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `sigma` | Line width σ (px) | number | 0.5 … 20 (step 0.1), in pixels of the full-resolution image | 3 | Thickness of the lines in pixels. |
| `darkness` | Darkness | number | 0.5 … 4 (step 0.01) | 1.5 | How dark the lines get; higher looks more like heavy pencil. |

### Bloom (`bloom`)

Multipass (4 passes).

Adds a soft glow around the bright parts of the picture, as if light were bleeding in the lens.

**Try this:** Lower the threshold until only the lights glow, then widen the radius for a dreamy look.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `threshold` | Threshold | number | 0 … 2 (step 0.01) | 0.7 | Only light brighter than this glows (in linear light, so 1 is white). |
| `sigma` | Radius σ (px) | number | 0.5 … 60 (step 0.5), in pixels of the full-resolution image | 12 | How far the glow spreads, in pixels. |
| `intensity` | Intensity | number | 0 … 2 (step 0.01) | 0.6 | How strong the glow is when added back. |

### Chromatic aberration (`chromaticAberration`)

Multipass (1 pass).

Splits the colour channels toward the corners, like the colour fringes of a cheap lens.

**Try this:** Keep it small for a subtle lens feel, or go to the maximum for a glitchy look.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `amount` | Shift at the corners (px) | number | −20 … 20 (step 0.1), in pixels of the full-resolution image | 4 | How far red and blue move apart at the corners, in pixels; zero in the centre. Negative reverses the direction. |

### Kuwahara (painterly) (`kuwahara`)

Multipass (2 passes).

Smooths the picture into flat patches while keeping edges sharp, which looks like a painting.

**Try this:** Raise the radius until fine texture turns into brush strokes.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `radius` | Radius (px) | integer | 1 … 10, in pixels of the full-resolution image | 4 | Size of the brush patches in pixels. |
| `sharpness` | Sharpness | number | 1 … 16 (step 0.5) | 8 | How strongly each pixel follows the smoothest nearby patch; higher keeps edges crisper. |

### Lens blur (depth) (`lensBlur`)

Multipass (1 pass).

Blurs by distance from the focus depth. Press Estimate depth (the first use downloads a 27 MB model), then move the focus.

**Try this:** Estimate the depth first, then move Focus to choose what stays sharp.

| Parameter | Label | Type | Range / options | Default | Notes |
|---|---|---|---|---|---|
| `depth` | Depth map | image | an image set by the app, not serialisable | none | The depth map made by Estimate depth; there is nothing to set by hand. |
| `focus` | Focus depth | number | 0 … 1 (step 0.01) | 0.5 | Which depth stays sharp: 1 is the nearest part of the picture, 0 the farthest. |
| `range` | Sharp range | number | 0 … 0.5 (step 0.01) | 0.1 | How much depth around the focus also stays sharp. |
| `radius` | Blur radius (px) | number | 0 … 40 (step 0.5), in pixels of the full-resolution image | 12 | The largest blur, in pixels, for areas far from the focus. |
