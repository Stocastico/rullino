import { defineFilter, linearToOklab, oklabToLinear } from '@rullino/core';
import { OKLAB_TOLERANCE } from '../shared';

/** Rotates the OKLab hue (the a/b plane) by `degrees`; lightness and chroma stay put. */
export const hue = defineFilter({
  id: 'hue',
  label: 'Hue',
  description: 'Rotates all colours around the colour wheel, so reds turn to greens, blues to oranges, and so on.',
  tryThis: 'Rotate by 180° for complementary colours, or by a few degrees to fix a colour cast.',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'straight',
  params: {
    degrees: { type: 'float', min: -180, max: 180, step: 1, default: 0, label: 'Rotation (°)', description: 'How far to rotate the hues; ±180° is the opposite colour.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  let lab = rl_linear_to_oklab(c.rgb);
  let t = radians(p.degrees);
  let ab = vec2f(lab.y * cos(t) - lab.z * sin(t), lab.y * sin(t) + lab.z * cos(t));
  return vec4f(rl_oklab_to_linear(vec3f(lab.x, ab)), c.a);
}`,
  pixel: ([r, g, b, a], { degrees }) => {
    const [L, A, B] = linearToOklab(r, g, b);
    const t = (degrees * Math.PI) / 180;
    return [...oklabToLinear(L, A * Math.cos(t) - B * Math.sin(t), A * Math.sin(t) + B * Math.cos(t)), a];
  },
  tolerance: OKLAB_TOLERANCE,
});
