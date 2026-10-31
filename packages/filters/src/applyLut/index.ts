import { applyLutCpu, createImage, defineFilter, identityLut, linearToSrgb, srgbToLinear } from '@rullino/core';
import { sampleLutInto, toLinear, toSrgb } from '../fast';

/**
 * Applies a 3D LUT (.cube / HaldCLUT) to the straight, sRGB-encoded colour, as LUT files expect,
 * then blends with the original by `intensity` in the same units. Input outside [0, 1] is clamped
 * to the LUT's edge (except at intensity 0, which returns the input untouched).
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
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = rl_unpremultiply(load_input(xy));
  let e = rl_linear_to_srgb(c.rgb);
  let o = e + (lut_look(e) - e) * p.intensity;
  return rl_premultiply(vec4f(rl_srgb_to_linear(o), c.a));
}`,
    },
  ],
  reach: () => 0, // one pixel in, one pixel out
  cpu: (src, { look, intensity }) => {
    const out = createImage(src.width, src.height);
    const s = src.data;
    for (let i = 0; i < s.length; i += 4) {
      const a = s[i + 3]!;
      if (a <= 0) continue; // colour of a transparent pixel is 0
      const e = [s[i]!, s[i + 1]!, s[i + 2]!].map((v) => linearToSrgb(v / a));
      const l = applyLutCpu(look, e[0]!, e[1]!, e[2]!);
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
      const r = toSrgb(s[i]! / a);
      const g = toSrgb(s[i + 1]! / a);
      const b = toSrgb(s[i + 2]! / a);
      sampleLutInto(look, r, g, b, l);
      d[i] = toLinear(r + (l[0]! - r) * intensity) * a;
      d[i + 1] = toLinear(g + (l[1]! - g) * intensity) * a;
      d[i + 2] = toLinear(b + (l[2]! - b) * intensity) * a;
      d[i + 3] = a;
    }
    return out;
  },
  tolerance: { abs: 2e-4, rel: 2e-3 },
});
