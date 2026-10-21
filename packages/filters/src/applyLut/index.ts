import { applyLutCpu, createImage, defineFilter, identityLut, linearToSrgb, srgbToLinear } from '@rullino/core';

/**
 * Applies a 3D LUT (.cube / HaldCLUT) to the straight, sRGB-encoded colour, as LUT files expect,
 * then blends with the original by `intensity` in the same units. Input outside [0, 1] is clamped
 * to the LUT's edge (except at intensity 0, which returns the input untouched).
 */
export const applyLut = defineFilter({
  id: 'applyLut',
  label: 'LUT',
  category: 'look',
  kind: 'multipass',
  params: {
    look: { type: 'lut', default: identityLut(2), label: 'LUT file' },
    intensity: { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Intensity' },
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
  tolerance: { abs: 2e-4, rel: 2e-3 },
});
