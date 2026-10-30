import { createImage, defineFilter } from '@rullino/core';
import { clampLoad } from '../convolution';
import { padEdge } from '../fast';

/** The k-th smallest of a[0..n) (Hoare's quickselect); reorders a. */
function kth(a: Float32Array, n: number, k: number): number {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = a[(lo + hi) >> 1]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i]! < pivot) i++;
      while (a[j]! > pivot) j--;
      if (i <= j) {
        const t = a[i]!;
        a[i] = a[j]!;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return a[k]!;
}

const MAX_RADIUS = 3;
const MAX_TAPS = (2 * MAX_RADIUS + 1) ** 2;

/**
 * Median of 9 with a fixed exchange network (Paeth / Devillard's opt_med9): 19 min/max pairs on
 * vec4, no loops and no dynamic indexing, which the generic counting loop needs. The result is
 * still one of the inputs per channel, so it stays exact.
 */
const MED9 = [[1, 2], [4, 5], [7, 8], [0, 1], [3, 4], [6, 7], [1, 2], [4, 5], [7, 8], [0, 3], [5, 8], [4, 7], [3, 6], [1, 4], [2, 5], [4, 7], [4, 2], [6, 4], [4, 2]]
  .map(([a, b], k) => `  let lo${k} = min(m${a}, m${b});\n  m${b} = max(m${a}, m${b});\n  m${a} = lo${k};`);

/**
 * Per-channel median over a (2r + 1)² window (clamp to edge), alpha included: removes isolated
 * specks and keeps edges. The result is always one of the window's values, so GPU and CPU agree
 * exactly. On the GPU the median is found by counting (for each candidate, how many values are
 * smaller or equal), vectorised over the four channels: no sort, no data-dependent branches.
 */
export const median = defineFilter({
  id: 'median',
  label: 'Median',
  description: 'Replaces each pixel by the median of its neighbours, which removes speckle noise while keeping edges.',
  tryThis: 'Use radius 1 on a noisy shot, and radius 3 for a painterly, flattened look.',
  category: 'classic',
  kind: 'multipass',
  params: {
    radius: { type: 'int', min: 1, max: MAX_RADIUS, default: 1, unit: 'px', label: 'Radius (px)', description: 'Size of the neighbourhood in pixels.' },
  },
  passes: [
    {
      name: 'out',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn median9(xy: vec2i) -> vec4f {
${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => `  var m${i} = load_input(xy + vec2i(${(i % 3) - 1}, ${Math.floor(i / 3) - 1}));`).join('\n')}
${MED9.join('\n')}
  return m4;
}

fn run(xy: vec2i, p: Params) -> vec4f {
  if (p.radius == 1) { return median9(xy); }
  var v: array<vec4f, ${MAX_TAPS}>;
  let r = p.radius;
  var n = 0;
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      v[n] = load_input(xy + vec2i(dx, dy));
      n++;
    }
  }
  let k = vec4f(f32(n / 2));
  var result = v[0];
  for (var i = 0; i < n; i++) {
    var less = vec4f(0.0);
    var leq = vec4f(0.0);
    for (var j = 0; j < n; j++) {
      less += select(vec4f(0.0), vec4f(1.0), v[j] < v[i]);
      leq += select(vec4f(0.0), vec4f(1.0), v[j] <= v[i]);
    }
    // v[i] is the median of a channel when fewer than k values are below it and more than k
    // are at or below it (ties give the same value whichever index wins).
    result = select(result, v[i], (less <= k) & (k < leq));
  }
  return result;
}`,
    },
  ],
  cpu: (src, { radius }) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++)
        for (let c = 0; c < 4; c++) {
          const values: number[] = [];
          for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) values.push(clampLoad(src, x + dx, y + dy, c));
          values.sort((a, b) => a - b);
          out.data[(y * src.width + x) * 4 + c] = values[values.length >> 1]!;
        }
    return out;
  },
  fast: (src, { radius: r }) => {
    const { width: w, height: h } = src;
    const side = 2 * r + 1;
    const n = side * side;
    const pad = padEdge(src, r);
    const pw = w + 2 * r;
    const out = createImage(w, h);
    const win = new Float32Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let m = 0;
          for (let dy = 0; dy < side; dy++) {
            let j = ((y + dy) * pw + x) * 4 + c;
            for (let dx = 0; dx < side; dx++, j += 4) win[m++] = pad[j]!;
          }
          out.data[(y * w + x) * 4 + c] = kth(win, n, n >> 1);
        }
    return out;
  },
  tolerance: { abs: 0, rel: 0 },
});
