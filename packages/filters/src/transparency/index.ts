import { defineFilter } from '@rullino/core';

/**
 * Fades pixels out: premultiplied colour and alpha are both scaled by (1 - amount), so the
 * straight colour is kept. With a mask it is the cut-out tool: paint the area to remove.
 */
export const transparency = defineFilter({
  id: 'transparency',
  label: 'Transparency',
  tryThis: 'Add a mask (try a gradient) and watch the checkerboard appear where it applies.',
  description: 'Makes the image (or, with a mask, part of it) transparent. Export as PNG to keep the alpha.',
  category: 'adjust',
  kind: 'pointwise',
  alpha: 'premultiplied',
  params: {
    amount: { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Amount', description: 'How transparent the result is: 0 leaves it opaque, 1 makes it fully see-through.' },
  },
  wgsl: /* wgsl */ `
fn apply(c: vec4f, p: Params) -> vec4f {
  return c * (1.0 - p.amount);
}`,
  pixel: ([r, g, b, a], { amount }) => [r * (1 - amount), g * (1 - amount), b * (1 - amount), a * (1 - amount)],
  tolerance: { abs: 1e-6, rel: 2 ** -10 },
});
