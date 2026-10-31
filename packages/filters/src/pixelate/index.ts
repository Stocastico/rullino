import { createImage, defineFilter, type PassDef } from '@rullino/core';

const pass = (name: string, input: string, axis: 'x' | 'y'): PassDef => ({
  name,
  inputs: [input],
  wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let start = (xy.${axis} / p.size) * p.size;
  let end = min(start + p.size, size().${axis});
  var acc = vec4f(0.0);
  for (var k = start; k < end; k++) {
    acc += load_${input}(${axis === 'x' ? 'vec2i(k, xy.y)' : 'vec2i(xy.x, k)'});
  }
  return acc / f32(end - start);
}`,
});

/**
 * Mosaic: every `size` × `size` cell (anchored at the top-left corner) becomes the mean of its
 * premultiplied pixels; partial cells at the edges average what is inside the image. Separable:
 * a row mean, then a column mean of those.
 */
export const pixelate = defineFilter({
  id: 'pixelate',
  label: 'Pixelate',
  description: 'Replaces the picture with big square pixels, each the average of the area under it.',
  tryThis: 'Pixelate a small masked area to hide a face or a licence plate.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    size: { type: 'int', min: 1, max: 128, default: 12, unit: 'px', label: 'Cell size (px)', description: 'Width of each square in pixels.' },
  },
  passes: [pass('h', 'input', 'x'), pass('v', 'h', 'y')],
  reach: 'global', // depends on the position in the full image: banded once it receives the frame (#128)
  cpu: (src, { size }) => {
    const { width: w, height: h } = src;
    const out = createImage(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [x0, y0] = [Math.floor(x / size) * size, Math.floor(y / size) * size];
        const [x1, y1] = [Math.min(x0 + size, w), Math.min(y0 + size, h)];
        const n = (x1 - x0) * (y1 - y0);
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) acc += src.data[(j * w + i) * 4 + c]!;
          out.data[(y * w + x) * 4 + c] = acc / n;
        }
      }
    return out;
  },
  tolerance: { abs: 1e-3, rel: 2 ** -9 },
});
