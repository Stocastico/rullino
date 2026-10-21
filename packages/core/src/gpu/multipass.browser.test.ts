import { afterAll, expect, it } from 'vitest';
import { compareImages } from '../compare';
import { defineFilter } from '../define';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage, type LinearImage } from '../image';
import { createGpuContext } from './context';
import { runFilter } from './run';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

/** Box blur along one axis with clamp-to-edge, as the CPU twin of the passes below. */
function boxCpu(src: LinearImage, r: number, dx: number, dy: number): LinearImage {
  const out = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++)
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) {
          const sx = Math.min(src.width - 1, Math.max(0, x + k * dx));
          const sy = Math.min(src.height - 1, Math.max(0, y + k * dy));
          acc += src.data[(sy * src.width + sx) * 4 + c]!;
        }
        out.data[(y * src.width + x) * 4 + c] = acc / (2 * r + 1);
      }
  return out;
}

// High-pass: input minus a separable box blur. Exercises multi-input passes and edge clamping.
const highPass = defineFilter({
  id: 'highPass',
  label: 'High pass',
  category: 'classic',
  kind: 'multipass',
  params: {
    radius: { type: 'int', min: 0, max: 8, default: 2, unit: 'px', label: 'Radius' },
    gain: { type: 'float', min: 0, max: 4, step: 0.1, default: 1.5, label: 'Gain' },
  },
  passes: [
    {
      name: 'h',
      inputs: ['input'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  var acc = vec4f(0.0);
  for (var k = -p.radius; k <= p.radius; k++) { acc += load_input(xy + vec2i(k, 0)); }
  return acc / f32(2 * p.radius + 1);
}`,
    },
    {
      name: 'v',
      inputs: ['h'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  var acc = vec4f(0.0);
  for (var k = -p.radius; k <= p.radius; k++) { acc += load_h(xy + vec2i(0, k)); }
  return acc / f32(2 * p.radius + 1);
}`,
    },
    {
      name: 'out',
      inputs: ['input', 'v'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  return vec4f((c.rgb - load_v(xy).rgb) * p.gain, c.a);
}`,
    },
  ],
  cpu: (src, { radius, gain }) => {
    const blur = boxCpu(boxCpu(src, radius, 1, 0), radius, 0, 1);
    const out = createImage(src.width, src.height);
    for (let i = 0; i < src.data.length; i += 4) {
      for (let c = 0; c < 3; c++) out.data[i + c] = (src.data[i + c]! - blur.data[i + c]!) * gain;
      out.data[i + 3] = src.data[i + 3]!;
    }
    return out;
  },
  tolerance: { abs: 2e-3, rel: 2 ** -9 },
});

const data = new Float32Array(37 * 19 * 4);
let seed = 5;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < data.length; i++) data[i] = rand();
const src = createImage(37, 19, fromFloat16Array(toFloat16Array(data)));

it.each([0, 1, 3, 8])('multipass high-pass at radius %i matches the CPU reference (edges clamped)', async (radius) => {
  const out = await readImage(ctx, runFilter(ctx, highPass, uploadImage(ctx, src), { radius }));
  const res = compareImages(out, highPass.cpu(src, { radius }), highPass.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});

// Iterative dilation: a repeated pass whose first input is its own previous output.
const grow = defineFilter({
  id: 'grow',
  label: 'Grow',
  category: 'classic',
  kind: 'multipass',
  params: { steps: { type: 'int', min: 0, max: 20, default: 3, label: 'Steps' } },
  passes: [
    { name: 'seed', inputs: ['input'], wgsl: 'fn run(xy: vec2i, p: Params) -> vec4f { return load_input(xy); }' },
    {
      name: 'grow',
      inputs: ['seed'],
      repeat: 'steps',
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  var m = vec4f(0.0);
  for (var j = -1; j <= 1; j++) { for (var i = -1; i <= 1; i++) { m = max(m, load_seed(xy + vec2i(i, j))); } }
  return m;
}`,
    },
  ],
  cpu: (img, { steps }) => {
    let cur = img;
    for (let s = 0; s < steps; s++) {
      const next = createImage(cur.width, cur.height);
      for (let y = 0; y < cur.height; y++)
        for (let x = 0; x < cur.width; x++)
          for (let c = 0; c < 4; c++) {
            let m = 0;
            for (let j = -1; j <= 1; j++)
              for (let i = -1; i <= 1; i++) {
                const sx = Math.min(cur.width - 1, Math.max(0, x + i));
                const sy = Math.min(cur.height - 1, Math.max(0, y + j));
                m = Math.max(m, cur.data[(sy * cur.width + sx) * 4 + c]!);
              }
            next.data[(y * cur.width + x) * 4 + c] = m;
          }
      cur = next;
    }
    return cur;
  },
  tolerance: { abs: 0, rel: 0 },
});

it.each([0, 1, 4, 9])('repeated pass runs %i times (ping-pong)', async (steps) => {
  const dot = createImage(21, 21);
  dot.data.set([1, 0.5, 0.25, 1], (10 * 21 + 10) * 4);
  const out = await readImage(ctx, runFilter(ctx, grow, uploadImage(ctx, dot), { steps }));
  const res = compareImages(out, grow.cpu(dot, { steps }), grow.tolerance);
  expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
});
