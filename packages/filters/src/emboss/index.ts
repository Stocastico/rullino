import { createImage, defineFilter, linearToSrgb, luminance, srgbToLinear, type LinearImage } from '@rullino/core';
import { clampLoad } from '../convolution';

/** sRGB-encoded luminance of the straight colour at (x, y), clamped to the edge; 0 if transparent. */
function lum(img: LinearImage, x: number, y: number): number {
  const a = clampLoad(img, x, y, 3);
  if (a <= 0) return 0;
  return linearToSrgb(luminance(clampLoad(img, x, y, 0) / a, clampLoad(img, x, y, 1) / a, clampLoad(img, x, y, 2) / a));
}

/**
 * Relief: the luminance gradient (central differences `distance` px apart, sRGB-encoded) projected
 * on the direction of the light, `angle` degrees counter-clockwise from the right. Edges facing the
 * light rise, the others sink. Grey mode shows the relief on mid grey, colour mode adds it to the
 * colours. Alpha is kept.
 */
export const emboss = defineFilter({
  id: 'emboss',
  label: 'Emboss',
  description: 'Turns edges into a relief, as if the picture were stamped into metal and lit from one side.',
  tryThis: 'Rotate the light angle and watch the raised and sunken edges swap sides.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    angle: { type: 'float', min: 0, max: 360, step: 1, default: 135, label: 'Light angle (°)', description: 'Direction of the light, counter-clockwise from the right. Edges facing the light rise.' },
    strength: { type: 'float', min: 0, max: 4, step: 0.01, default: 1, label: 'Strength', description: 'How deep the relief looks.' },
    distance: { type: 'int', min: 1, max: 10, default: 1, unit: 'px', label: 'Distance (px)', description: 'How far apart the compared pixels are, in pixels. Larger gives a thicker relief.' },
    mode: { type: 'enum', options: { grey: 'Grey', color: 'Colour' }, default: 'grey', label: 'Surface', description: 'Grey shows the relief on mid grey; Colour adds it to the picture\'s colours.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn lum_at(xy: vec2i) -> f32 {
  let s = load_input(xy);
  if (s.a <= 0.0) {
    return 0.0;
  }
  return rl_linear_to_srgb(vec3f(rl_luminance(s.rgb / s.a))).x;
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let d = p.distance;
  let g = vec2f(lum_at(xy + vec2i(d, 0)) - lum_at(xy - vec2i(d, 0)), lum_at(xy + vec2i(0, d)) - lum_at(xy - vec2i(0, d))) * 0.5;
  let t = radians(p.angle);
  let relief = p.strength * dot(g, vec2f(cos(t), -sin(t)));
  let s = load_input(xy);
  var e = vec3f(0.5 + relief);
  if (p.mode == 1u && s.a > 0.0) {
    e = rl_linear_to_srgb(s.rgb / s.a) + relief;
  }
  return vec4f(rl_srgb_to_linear(clamp(e, vec3f(0.0), vec3f(1.0))) * s.a, s.a);
}`,
    },
  ],
  cpu: (src, { angle, strength, distance: d, mode }) => {
    const out = createImage(src.width, src.height);
    const t = (angle * Math.PI) / 180;
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const gx = (lum(src, x + d, y) - lum(src, x - d, y)) * 0.5;
        const gy = (lum(src, x, y + d) - lum(src, x, y - d)) * 0.5;
        const relief = strength * (gx * Math.cos(t) - gy * Math.sin(t));
        const i = (y * src.width + x) * 4;
        const a = src.data[i + 3]!;
        const e = mode === 'color' && a > 0 ? [0, 1, 2].map((c) => linearToSrgb(src.data[i + c]! / a) + relief) : [0.5 + relief, 0.5 + relief, 0.5 + relief];
        out.data.set([...e.map((v) => srgbToLinear(Math.min(1, Math.max(0, v))) * a), a], i);
      }
    return out;
  },
  tolerance: { abs: 2e-3, rel: 2e-3 },
});
