import { defineFilter } from '@rullino/core';
import { greyLike, lumAt, LUM_AT_WGSL } from '../edges';

/**
 * Second derivative of the luminance (sRGB-encoded units): the sum of the neighbours minus the
 * centre, with the 4-neighbour cross (centre weight −4) or the 8-neighbour ring (weights halved,
 * so the centre is −4 as well). Zero on flat areas and ramps; blob centres and thin lines respond
 * with their sign. Signed shows it on mid grey, magnitude shows |L| on black; both times
 * `strength`. Alpha is kept.
 */
export const laplacian = defineFilter({
  id: 'laplacian',
  label: 'Laplacian',
  description: 'Measures how much each pixel differs from its neighbours, which highlights edges and fine detail.',
  tryThis: 'Use Magnitude to see edges as bright lines, or Signed to see which side of an edge is brighter.',
  category: 'classic',
  kind: 'multipass',
  params: {
    connectivity: { type: 'enum', options: { four: '4 neighbours', eight: '8 neighbours' }, default: 'four', label: 'Neighbours', description: 'Which neighbours are compared: the 4 direct ones, or all 8 around the pixel.' },
    output: { type: 'enum', options: { signed: 'Signed', magnitude: 'Magnitude' }, default: 'signed', label: 'Output', description: 'Signed keeps the direction of change on mid grey; Magnitude shows its size only.' },
    strength: { type: 'float', min: 0, max: 10, step: 0.01, default: 1, label: 'Strength', description: 'Scales the result; raise it to see faint detail.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `${LUM_AT_WGSL}
fn run(xy: vec2i, p: Params) -> vec4f {
  var sum = lum_at(xy + vec2i(1, 0)) + lum_at(xy + vec2i(-1, 0)) + lum_at(xy + vec2i(0, 1)) + lum_at(xy + vec2i(0, -1));
  if (p.connectivity == 1u) {
    let diagonals = lum_at(xy + vec2i(1, 1)) + lum_at(xy + vec2i(-1, 1)) + lum_at(xy + vec2i(1, -1)) + lum_at(xy + vec2i(-1, -1));
    sum = 0.5 * (sum + diagonals);
  }
  let l = p.strength * (sum - 4.0 * lum_at(xy));
  if (p.output == 1u) {
    return grey_out(xy, abs(l));
  }
  return grey_out(xy, 0.5 + l);
}`,
    },
  ],
  reach: () => 1, // four or eight neighbours
  cpu: (src, { connectivity, output, strength }) =>
    greyLike(src, (x, y) => {
      let sum = lumAt(src, x + 1, y) + lumAt(src, x - 1, y) + lumAt(src, x, y + 1) + lumAt(src, x, y - 1);
      if (connectivity === 'eight') sum = 0.5 * (sum + lumAt(src, x + 1, y + 1) + lumAt(src, x - 1, y + 1) + lumAt(src, x + 1, y - 1) + lumAt(src, x - 1, y - 1));
      const l = strength * (sum - 4 * lumAt(src, x, y));
      return output === 'magnitude' ? Math.abs(l) : 0.5 + l;
    }),
  tolerance: { abs: 5e-4, rel: 1e-3 },
});
