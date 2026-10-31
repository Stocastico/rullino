import { createImage, defineFilter, type LinearImage } from '@rullino/core';
import { clampLoad } from '../convolution';

/** Bilinear sample of channel c at continuous coordinates (pixel centres at i + 0.5), clamped to the edge. */
function sample(img: LinearImage, x: number, y: number, c: number): number {
  const [u, v] = [x - 0.5, y - 0.5];
  const [x0, y0] = [Math.floor(u), Math.floor(v)];
  const [fx, fy] = [u - x0, v - y0];
  const top = clampLoad(img, x0, y0, c) * (1 - fx) + clampLoad(img, x0 + 1, y0, c) * fx;
  const bottom = clampLoad(img, x0, y0 + 1, c) * (1 - fx) + clampLoad(img, x0 + 1, y0 + 1, c) * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Lateral chromatic aberration, as in a cheap lens: red is sampled radially outwards and blue
 * inwards (or the reverse for negative amounts), by `amount` px at the corners and proportionally
 * nearer the centre. Bilinear sampling of premultiplied values; green and alpha stay put.
 */
export const chromaticAberration = defineFilter({
  id: 'chromaticAberration',
  label: 'Chromatic aberration',
  description: 'Splits the colour channels toward the corners, like the colour fringes of a cheap lens.',
  tryThis: 'Keep it small for a subtle lens feel, or go to the maximum for a glitchy look.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    amount: { type: 'float', min: -20, max: 20, step: 0.1, default: 4, unit: 'px', label: 'Shift at the corners (px)', description: 'How far red and blue move apart at the corners, in pixels; zero in the centre. Negative reverses the direction.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn sample_at(q: vec2f) -> vec4f {
  let u = q - 0.5;
  let i = vec2i(floor(u));
  let f = u - floor(u);
  let top = mix(load_input(i), load_input(i + vec2i(1, 0)), f.x);
  let bottom = mix(load_input(i + vec2i(0, 1)), load_input(i + vec2i(1, 1)), f.x);
  return mix(top, bottom, f.y);
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let wh = vec2f(size());
  let centre = wh * 0.5;
  let s = p.amount / (0.5 * length(wh));
  let d = vec2f(xy) + 0.5 - centre;
  let c = load_input(xy);
  return vec4f(sample_at(centre + d * (1.0 + s)).r, c.g, sample_at(centre + d * (1.0 - s)).b, c.a);
}`,
    },
  ],
  reach: 'global', // depends on the position in the full image: banded once it receives the frame (#128)
  cpu: (src, { amount }) => {
    const { width: w, height: h } = src;
    const out = createImage(w, h, src.data.slice());
    const [cx, cy] = [w / 2, h / 2];
    const s = amount / (0.5 * Math.hypot(w, h));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [dx, dy] = [x + 0.5 - cx, y + 0.5 - cy];
        const i = (y * w + x) * 4;
        out.data[i] = sample(src, cx + dx * (1 + s), cy + dy * (1 + s), 0);
        out.data[i + 2] = sample(src, cx + dx * (1 - s), cy + dy * (1 - s), 2);
      }
    return out;
  },
  tolerance: { abs: 1e-3, rel: 2e-3 },
});
