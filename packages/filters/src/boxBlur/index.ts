import { defineFilter, type PassDef } from '@rullino/core';
import { convolve1d } from '../convolution';
import { convolve1dFast } from '../fast';

const pass = (name: string, input: string, axis: string): PassDef => ({
  name,
  inputs: [input],
  wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  var acc = vec4f(0.0);
  for (var k = -p.radius; k <= p.radius; k++) { acc += load_${input}(xy + ${axis}); }
  return acc / f32(2 * p.radius + 1);
}`,
});

/** Separable box (mean) blur over a (2r + 1)² square. */
export const boxBlur = defineFilter({
  id: 'boxBlur',
  label: 'Box blur',
  description: 'Blurs by averaging every pixel in a square around each pixel.',
  tryThis: 'Compare it with Gaussian blur at a large radius: the box leaves a more even, slightly blocky blur.',
  category: 'classic',
  kind: 'multipass',
  params: {
    radius: { type: 'int', min: 0, max: 50, default: 3, unit: 'px', label: 'Radius (px)', description: 'Half the side of the square, in pixels; 0 changes nothing.' },
  },
  passes: [pass('h', 'input', 'vec2i(k, 0)'), pass('v', 'h', 'vec2i(0, k)')],
  cpu: (src, { radius }) => {
    const w = new Array(2 * radius + 1).fill(1 / (2 * radius + 1));
    return convolve1d(convolve1d(src, w, 'x'), w, 'y');
  },
  fast: (src, { radius }) => {
    const w = new Array(2 * radius + 1).fill(1 / (2 * radius + 1));
    return convolve1dFast(convolve1dFast(src, w, 'x'), w, 'y');
  },
  tolerance: { abs: 1e-4, rel: 2 ** -9 },
});
