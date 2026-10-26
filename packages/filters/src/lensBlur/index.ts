import { createImage, defineFilter, sampleImage, type LinearImage } from '@rullino/core';

const TAP_COUNT = 48;
const GOLDEN_ANGLE = 2.399963229728653;
/** Disc samples (Vogel spiral): equal area per tap, same numbers on CPU and GPU. */
const TAPS = Array.from({ length: TAP_COUNT }, (_, k) => {
  const r = Math.sqrt((k + 0.5) / TAP_COUNT);
  return [Number((r * Math.cos(k * GOLDEN_ANGLE)).toFixed(7)), Number((r * Math.sin(k * GOLDEN_ANGLE)).toFixed(7))] as const;
});
/** The circle of confusion reaches its full radius this far (in depth units) beyond the sharp range. */
const FALLOFF = 0.5;

/** The circle of confusion (px) at depth `d` (confidence `a` of the depth map). */
const coc = (d: number, a: number, focus: number, range: number, radius: number) => radius * Math.min(1, Math.max(0, (Math.abs(d - focus) - range) / FALLOFF)) * a;

/** Bilinear read at pixel-index coordinates (pixel centres on integers), edges clamped, one channel. */
function bilinear(src: LinearImage, x: number, y: number, c: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const [fx, fy] = [x - x0, y - y0];
  const at = (px: number, py: number) => src.data[(Math.min(src.height - 1, Math.max(0, py)) * src.width + Math.min(src.width - 1, Math.max(0, px))) * 4 + c]!;
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/**
 * Lens blur from a depth map (`depth`: grey, 1 = near, 0 = far, e.g. from a depth estimator):
 * every pixel is blurred by a disc whose radius grows with its distance from the `focus` depth
 * (outside the sharp `range`), up to `radius` px. Gathering: a pixel averages 48 disc samples,
 * each weighted by whether the sample's own blur reaches back to the pixel, so an in-focus
 * foreground does not bleed into the blurred background. Without a depth map (the default empty
 * image) or where it is transparent, nothing is blurred. Light is averaged premultiplied, alpha
 * included.
 */
export const lensBlur = defineFilter({
  id: 'lensBlur',
  label: 'Lens blur (depth)',
  tryThis: 'Estimate the depth first, then move Focus to choose what stays sharp.',
  description: 'Blurs by distance from the focus depth. Press Estimate depth (the first use downloads a 27 MB model), then move the focus.',
  category: 'stylize',
  kind: 'multipass',
  params: {
    depth: { type: 'image', default: createImage(1, 1), label: 'Depth map', description: 'The depth map made by Estimate depth; there is nothing to set by hand.' },
    focus: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Focus depth', description: 'Which depth stays sharp: 1 is the nearest part of the picture, 0 the farthest.' },
    range: { type: 'float', min: 0, max: 0.5, step: 0.01, default: 0.1, label: 'Sharp range', description: 'How much depth around the focus also stays sharp.' },
    radius: { type: 'float', min: 0, max: 40, step: 0.5, default: 12, unit: 'px', label: 'Blur radius (px)', description: 'The largest blur, in pixels, for areas far from the focus.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
var<private> LB_TAPS: array<vec2f, ${TAP_COUNT}> = array<vec2f, ${TAP_COUNT}>(${TAPS.map(([x, y]) => `vec2f(${x}, ${y})`).join(', ')});

fn lb_coc(xy: vec2f) -> f32 {
  let d = image_depth((xy + 0.5) / vec2f(size()));
  return params.radius * clamp((abs(d.r - params.focus) - params.range) / ${FALLOFF}, 0.0, 1.0) * d.a;
}

fn lb_load(xy: vec2f) -> vec4f {
  let p0 = vec2i(floor(xy));
  let f = xy - floor(xy);
  return mix(mix(load_input(p0), load_input(p0 + vec2i(1, 0)), f.x), mix(load_input(p0 + vec2i(0, 1)), load_input(p0 + vec2i(1, 1)), f.x), f.y);
}

fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  let here = vec2f(xy);
  let cp = lb_coc(here);
  if (cp < 1e-4) { return c; }
  var acc = vec4f(0.0);
  var wsum = 0.0;
  for (var k = 0; k < ${TAP_COUNT}; k++) {
    let off = LB_TAPS[k] * cp;
    let q = here + off;
    let w = clamp(lb_coc(q) - length(off) + 1.0, 0.0, 1.0);
    acc += lb_load(q) * w;
    wsum += w;
  }
  if (wsum < 1e-4) { return c; }
  return acc / wsum;
}`,
    },
  ],
  cpu: (src, { depth, focus, range, radius }) => {
    const out = createImage(src.width, src.height);
    const size = [src.width, src.height] as const;
    const cocAt = (x: number, y: number) => {
      const d = sampleImage(depth, (x + 0.5) / size[0], (y + 0.5) / size[1]);
      return coc(d[0], d[3], focus, range, radius);
    };
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        const cp = cocAt(x, y);
        const acc = [0, 0, 0, 0];
        let wsum = 0;
        if (cp >= 1e-4)
          for (const [tx, ty] of TAPS) {
            const [ox, oy] = [tx * cp, ty * cp];
            const w = Math.min(1, Math.max(0, cocAt(x + ox, y + oy) - Math.hypot(ox, oy) + 1));
            for (let c = 0; c < 4; c++) acc[c]! += bilinear(src, x + ox, y + oy, c) * w;
            wsum += w;
          }
        for (let c = 0; c < 4; c++) out.data[i + c] = wsum < 1e-4 ? src.data[i + c]! : acc[c]! / wsum;
      }
    return out;
  },
  tolerance: { abs: 3e-4, rel: 1e-3 },
});
