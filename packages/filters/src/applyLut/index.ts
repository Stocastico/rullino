import { applyLutCpu, createImage, defineFilter, identityLut, linearToOklab, linearToSrgb, srgbToLinear } from '@rullino/core';
import { gamutMapOklab } from '@rullino/core/internal';
import { sampleLutInto, toLinear, toSrgb } from '../fast';

/**
 * Applies a 3D LUT (.cube / HaldCLUT) to the straight, sRGB-encoded colour, as LUT files expect,
 * then blends with the original by `intensity` in the same units. Input above 1 is clamped to the
 * LUT's edge; a colour with a negative channel (outside sRGB, RFC #181) is first brought into sRGB
 * by the CSS Color 4 gamut mapping in OKLCh, since a LUT is defined on sRGB's cube. Intensity 0
 * returns the input untouched.
 */
export const applyLut = defineFilter({
  id: 'applyLut',
  label: 'LUT',
  description: 'Applies a colour look stored in a 3D LUT file (.cube or Hald CLUT), the format colour graders and presets use.',
  tryThis: 'Load a .cube file, then use Intensity to mix it with the original.',
  category: 'look',
  kind: 'multipass',
  params: {
    look: { type: 'lut', default: identityLut(2), label: 'LUT file', description: 'The LUT file to apply (.cube or a Hald CLUT image).' },
    intensity: { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Intensity', description: 'Blend between the original (0) and the full look (1).' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn gm_in_gamut(c: vec3f) -> bool {
  return all(c >= vec3f(0.0)) && all(c <= vec3f(1.0));
}

// The CSS Color 4 gamut mapping into sRGB (core's gamutMapOklab): binary search on OKLCh chroma.
fn gm_map(lab: vec3f) -> vec3f {
  if (lab.x >= 1.0) { return vec3f(1.0); }
  if (lab.x <= 0.0) { return vec3f(0.0); }
  let origin = rl_oklab_to_linear(lab);
  if (gm_in_gamut(origin)) { return origin; }
  var clipped = clamp(origin, vec3f(0.0), vec3f(1.0));
  if (length(rl_linear_to_oklab(clipped) - lab) < 0.02) { return clipped; }
  let C = length(lab.yz);
  let ca = lab.y / C;
  let cb = lab.z / C;
  var lo = 0.0;
  var hi = C;
  var min_in_gamut = true;
  for (var i = 0; i < 24; i++) {
    if (hi - lo <= 0.0001) { break; }
    let chroma = (lo + hi) * 0.5;
    let current = vec3f(lab.x, chroma * ca, chroma * cb);
    let d = rl_oklab_to_linear(current);
    if (min_in_gamut && gm_in_gamut(d)) {
      lo = chroma;
      continue;
    }
    clipped = clamp(d, vec3f(0.0), vec3f(1.0));
    let e = length(rl_linear_to_oklab(clipped) - current);
    if (e < 0.02) {
      if (0.02 - e < 0.0001) { return clipped; }
      min_in_gamut = false;
      lo = chroma;
    } else {
      hi = chroma;
    }
  }
  return clipped;
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let c = rl_unpremultiply(load_input(xy));
  let e = rl_linear_to_srgb(c.rgb);
  var looked = e;
  if (any(c.rgb < vec3f(0.0))) {
    looked = rl_linear_to_srgb(gm_map(rl_linear_to_oklab(c.rgb)));
  }
  let o = e + (lut_look(looked) - e) * p.intensity;
  return rl_premultiply(vec4f(rl_srgb_to_linear(o), c.a));
}`,
    },
  ],
  reach: () => 0, // one pixel in, one pixel out
  perPixel: true,
  cpu: (src, { look, intensity }) => {
    const out = createImage(src.width, src.height);
    const s = src.data;
    for (let i = 0; i < s.length; i += 4) {
      const a = s[i + 3]!;
      if (a <= 0) continue; // colour of a transparent pixel is 0
      const lin = [s[i]! / a, s[i + 1]! / a, s[i + 2]! / a];
      const e = lin.map(linearToSrgb);
      const m = lin.some((v) => v < 0) ? gamutMapOklab('srgb', linearToOklab(lin[0]!, lin[1]!, lin[2]!)).map(linearToSrgb) : e;
      const l = applyLutCpu(look, m[0]!, m[1]!, m[2]!);
      for (let c = 0; c < 3; c++) out.data[i + c] = srgbToLinear(e[c]! + (l[c]! - e[c]!) * intensity) * a;
      out.data[i + 3] = a;
    }
    return out;
  },
  fast: (src, { look, intensity }) => {
    const out = createImage(src.width, src.height);
    const s = src.data;
    const d = out.data;
    const l = new Float64Array(3);
    for (let i = 0; i < s.length; i += 4) {
      const a = s[i + 3]!;
      if (a <= 0) continue;
      const lr = s[i]! / a;
      const lg = s[i + 1]! / a;
      const lb = s[i + 2]! / a;
      const r = toSrgb(lr);
      const g = toSrgb(lg);
      const b = toSrgb(lb);
      if (lr < 0 || lg < 0 || lb < 0) {
        const m = gamutMapOklab('srgb', linearToOklab(lr, lg, lb));
        sampleLutInto(look, toSrgb(m[0]!), toSrgb(m[1]!), toSrgb(m[2]!), l);
      } else sampleLutInto(look, r, g, b, l);
      d[i] = toLinear(r + (l[0]! - r) * intensity) * a;
      d[i + 1] = toLinear(g + (l[1]! - g) * intensity) * a;
      d[i + 2] = toLinear(b + (l[2]! - b) * intensity) * a;
      d[i + 3] = a;
    }
    return out;
  },
  // The gamut mapping of colours outside sRGB is a binary search with hard decisions: in f32 a pixel
  // now and then ends one step further (6e-4 on 1 of 4292 channels of the wide-gamut parity image).
  tolerance: { abs: 2e-4, rel: 2e-3, outliers: 0.001 },
});
