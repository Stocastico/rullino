import { createImage, defineFilter, sampleImage } from '@rullino/core';

const EMPTY = createImage(1, 1);

/**
 * Lays an image over the input, stretched to its size (bilinear, premultiplied "over"). With the
 * default empty image it does nothing. The image comes from elsewhere (object removal puts its
 * result here); the step's mask decides where it shows.
 */
export const patch = defineFilter({
  id: 'patch',
  label: 'Remove object',
  tryThis: 'Paint over a small object first, then press Fill with AI.',
  description: 'Select what to remove with the brush, wand or Object tool, then press Fill with AI (the first use downloads a 28 MB model).',
  category: 'classic',
  kind: 'multipass',
  params: {
    patch: { type: 'image', default: EMPTY, label: 'Image', description: 'The fill made by the Fill with AI button; there is nothing to set by hand.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  let o = image_patch((vec2f(xy) + 0.5) / vec2f(size()));
  return o + c * (1.0 - o.a);
}`,
    },
  ],
  reach: 'global', // depends on the position in the full image: banded once it receives the frame (#128)
  cpu: (src, { patch: img }) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const o = sampleImage(img, (x + 0.5) / src.width, (y + 0.5) / src.height);
        const i = (y * src.width + x) * 4;
        for (let c = 0; c < 4; c++) out.data[i + c] = o[c]! + src.data[i + c]! * (1 - o[3]);
      }
    return out;
  },
  tolerance: { abs: 2e-4, rel: 2e-3 },
});
