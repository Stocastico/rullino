import { createImage, type PointwiseFilter } from '@rullino/core';

const params = {
  ev: { type: 'float', min: -5, max: 5, step: 0.05, default: 0, label: 'Exposure (EV)' },
} as const;

/** Exposure in stops: scales linear light by 2^ev. Alpha is untouched (premultiplied RGB scales directly). */
export const exposure: PointwiseFilter<typeof params> = {
  id: 'exposure',
  kind: 'pointwise',
  params,
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return vec4f(c.rgb * exp2(p.ev), c.a);
}`,
  cpu(src, { ev }) {
    const k = 2 ** ev;
    const out = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      out.data[i] = src.data[i]! * k;
      out.data[i + 1] = src.data[i + 1]! * k;
      out.data[i + 2] = src.data[i + 2]! * k;
      out.data[i + 3] = src.data[i + 3]!;
    }
    return out;
  },
  // Output is rounded to half precision (relative step 2^-11); allow one ulp plus exp2 slack.
  tolerance: { abs: 1e-7, rel: 2 ** -10 },
};
