import { createImage, defineFilter } from '@rullino/core';

/** Normalised distance from the centre: 0 there, about 1 in the corners. */
function distance(x: number, y: number, w: number, h: number, roundness: number) {
  const side = Math.max(w, h);
  const sx = 1 + (w / side - 1) * roundness;
  const sy = 1 + (h / side - 1) * roundness;
  const qx = ((x + 0.5 - w / 2) / (w / 2)) * sx;
  const qy = ((y + 0.5 - h / 2) / (h / 2)) * sy;
  return Math.hypot(qx, qy) / Math.hypot(sx, sy);
}

/**
 * Darkens (amount < 0, multiplying linear light, to black at -1) or lightens (amount > 0, towards
 * white) the edges. The effect starts at `midpoint` (normalised distance, corners = 1) and ramps
 * up over `feather` with a smoothstep. Roundness 0 follows the image's shape, 1 is a circle.
 */
export const vignette = defineFilter({
  id: 'vignette',
  label: 'Vignette',
  description: 'Darkens or lightens the edges of the picture to draw the eye to the centre.',
  tryThis: 'Make the amount slightly negative and the feather wide for a natural lens falloff.',
  category: 'look',
  kind: 'multipass',
  params: {
    amount: { type: 'float', min: -1, max: 1, step: 0.01, default: -0.4, label: 'Amount', description: 'Negative darkens the edges, positive lightens them.' },
    midpoint: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.4, label: 'Midpoint', description: 'How far from the centre the effect starts (the corners are 1).' },
    feather: { type: 'float', min: 0.05, max: 1, step: 0.01, default: 0.5, label: 'Feather', description: 'How gradually the effect fades in; larger is softer.' },
    roundness: { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Roundness', description: '0 follows the shape of the picture; 1 makes the vignette a circle.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  let wh = vec2f(size());
  let s = 1.0 + (wh / max(wh.x, wh.y) - 1.0) * p.roundness;
  let q = (vec2f(xy) + 0.5 - wh / 2.0) / (wh / 2.0) * s;
  let t = clamp((length(q) / length(s) - p.midpoint) / p.feather, 0.0, 1.0);
  let k = t * t * (3.0 - 2.0 * t) * p.amount;
  if (k < 0.0) { return vec4f(c.rgb * (1.0 + k), c.a); }
  return vec4f(c.rgb + (vec3f(c.a) - c.rgb) * k, c.a);
}`,
    },
  ],
  cpu: (src, { amount, midpoint, feather, roundness }) => {
    const { width: w, height: h } = src;
    const out = createImage(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = Math.min(1, Math.max(0, (distance(x, y, w, h, roundness) - midpoint) / feather));
        const k = t * t * (3 - 2 * t) * amount;
        const i = (y * w + x) * 4;
        const a = src.data[i + 3]!;
        for (let c = 0; c < 3; c++) {
          const v = src.data[i + c]!;
          out.data[i + c] = k < 0 ? v * (1 + k) : v + (a - v) * k;
        }
        out.data[i + 3] = a;
      }
    }
    return out;
  },
  tolerance: { abs: 1e-4, rel: 2 ** -9 },
});
