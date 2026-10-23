import { defineFilter } from '@rullino/core';
import { greyLike, lumAt, LUM_AT_WGSL } from '../edges';

// 3×3 operators as [smooth weights across, derivative weights along]; the derivative taps are -1 / +1
// and each operator is divided by (sum of smooth weights × 2) so that a ramp of slope s per pixel reads s.
const OPERATORS = { sobel: [1, 2, 1], scharr: [3, 10, 3], prewitt: [1, 1, 1] } as const;
const OPERATOR_IDS = Object.keys(OPERATORS) as (keyof typeof OPERATORS)[];

/**
 * Edge operator on the luminance gradient (sRGB-encoded units, like Canny): Sobel, Scharr or Prewitt.
 * Horizontal / vertical show the signed derivative on mid grey (brighter to the right / downwards
 * is above 0.5), magnitude shows √(gx² + gy²) on black. Both are slopes per pixel times `strength`.
 * Alpha is kept.
 */
export const gradient = defineFilter({
  id: 'gradient',
  label: 'Gradient',
  category: 'classic',
  kind: 'multipass',
  params: {
    method: { type: 'enum', options: { sobel: 'Sobel', scharr: 'Scharr', prewitt: 'Prewitt' }, default: 'sobel', label: 'Operator' },
    output: { type: 'enum', options: { magnitude: 'Magnitude', horizontal: 'Horizontal', vertical: 'Vertical' }, default: 'magnitude', label: 'Output' },
    strength: { type: 'float', min: 0, max: 10, step: 0.01, default: 1, label: 'Strength' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `${LUM_AT_WGSL}
fn run(xy: vec2i, p: Params) -> vec4f {
  var w = vec3f(1.0, 2.0, 1.0);
  if (p.method == 1u) {
    w = vec3f(3.0, 10.0, 3.0);
  } else if (p.method == 2u) {
    w = vec3f(1.0, 1.0, 1.0);
  }
  let norm = 2.0 * (w.x + w.y + w.z);
  var gx = 0.0;
  var gy = 0.0;
  for (var k = -1; k <= 1; k++) {
    let wk = select(select(w.x, w.y, k == 0), w.z, k == 1);
    gx += wk * (lum_at(xy + vec2i(1, k)) - lum_at(xy + vec2i(-1, k)));
    gy += wk * (lum_at(xy + vec2i(k, 1)) - lum_at(xy + vec2i(k, -1)));
  }
  gx /= norm;
  gy /= norm;
  if (p.output == 1u) {
    return grey_out(xy, 0.5 + p.strength * gx);
  }
  if (p.output == 2u) {
    return grey_out(xy, 0.5 + p.strength * gy);
  }
  return grey_out(xy, p.strength * sqrt(gx * gx + gy * gy));
}`,
    },
  ],
  cpu: (src, { method, output, strength }) => {
    const w = OPERATORS[OPERATOR_IDS.includes(method as keyof typeof OPERATORS) ? (method as keyof typeof OPERATORS) : 'sobel'];
    const norm = 2 * (w[0] + w[1] + w[2]);
    return greyLike(src, (x, y) => {
      let gx = 0;
      let gy = 0;
      for (let k = -1; k <= 1; k++) {
        const wk = w[k + 1]!;
        gx += wk * (lumAt(src, x + 1, y + k) - lumAt(src, x - 1, y + k));
        gy += wk * (lumAt(src, x + k, y + 1) - lumAt(src, x + k, y - 1));
      }
      gx /= norm;
      gy /= norm;
      if (output === 'horizontal') return 0.5 + strength * gx;
      if (output === 'vertical') return 0.5 + strength * gy;
      return strength * Math.sqrt(gx * gx + gy * gy);
    });
  },
  tolerance: { abs: 5e-4, rel: 1e-3 },
});
