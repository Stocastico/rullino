import { createImage, defineFilter } from '@rullino/core';

/** Exposure in stops: scales linear light by 2^ev. Works on premultiplied colour directly. */
export const exposure = defineFilter({
  id: 'exposure',
  label: 'Exposure',
  description: 'Makes the whole picture lighter or darker, like opening or closing the lens by whole stops of light.',
  tryThis: 'Raise it until the sky starts to lose detail, then lower it a little.',
  preview: { ev: 1 },
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    ev: { type: 'float', min: -5, max: 5, step: 0.05, default: 0, label: 'EV', description: 'Stops of light: +1 doubles the brightness, −1 halves it.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return vec4f(c.rgb * exp2(p.ev), c.a);
}`,
  pixel: ([r, g, b, a], { ev }) => {
    const k = 2 ** ev;
    return [r * k, g * k, b * k, a];
  },
  fast: (src, { ev }) => {
    const k = 2 ** ev;
    const s = src.data;
    const out = createImage(src.width, src.height);
    const d = out.data;
    for (let i = 0; i < s.length; i += 4) {
      d[i] = s[i]! * k;
      d[i + 1] = s[i + 1]! * k;
      d[i + 2] = s[i + 2]! * k;
      d[i + 3] = s[i + 3]!;
    }
    return out;
  },
  // Output is rounded to half precision (relative step 2^-11); allow one ulp plus exp2 slack.
  tolerance: { abs: 1e-7, rel: 2 ** -10 },
});
