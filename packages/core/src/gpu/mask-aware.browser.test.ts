import { afterAll, describe, expect, it } from 'vitest';
import { compareImages } from '../compare';
import { defineFilter } from '../define';
import { fromFloat16Array, toFloat16Array } from '../half';
import { createImage } from '../image';
import { maskImage, type Mask } from '../mask';
import { runChainCpu } from '../pipeline/chain';
import { Pipeline } from '../pipeline/pipeline';
import { createGpuContext } from './context';
import { runFilter } from './run';
import { readImage, uploadImage } from './texture';

const ctx = await createGpuContext();
afterAll(() => ctx.device.destroy());

// Inside the mask: the average of the left and right neighbours; uses the mask as a texture input.
const smear = defineFilter({
  id: 'smear',
  label: 'Smear',
  category: 'classic',
  kind: 'multipass',
  usesMask: true,
  params: {},
  passes: [
    {
      name: 'out',
      inputs: ['input', 'mask'],
      wgsl: `fn run(xy: vec2i, p: Params) -> vec4f {
  let m = load_mask(xy).r;
  return mix(load_input(xy), 0.5 * (load_input(xy - vec2i(1, 0)) + load_input(xy + vec2i(1, 0))), m);
}`,
    },
  ],
  cpu: (src, _, mask) => {
    const out = createImage(src.width, src.height);
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++)
        for (let c = 0; c < 4; c++) {
          const at = (xx: number) => src.data[(y * src.width + Math.min(src.width - 1, Math.max(0, xx))) * 4 + c]!;
          const m = mask![y * src.width + x]!;
          out.data[(y * src.width + x) * 4 + c] = at(x) + (0.5 * (at(x - 1) + at(x + 1)) - at(x)) * m;
        }
    return out;
  },
  tolerance: { abs: 2e-4, rel: 2 ** -10 },
});

const [w, h] = [37, 21];
let seed = 5;
const src = createImage(w, h, fromFloat16Array(toFloat16Array(Float32Array.from({ length: w * h * 4 }, () => (seed = (seed * 16807) % 2147483647) / 2147483647))));
const mask: Mask = { kind: 'radial', center: [0.4, 0.5], radius: [0.3, 0.3], feather: 0.7 };

describe('mask-aware filters', () => {
  it('runFilter feeds the rendered mask to the passes', async () => {
    const out = await readImage(ctx, runFilter(ctx, smear, uploadImage(ctx, src), {}, mask));
    const res = compareImages(out, smear.cpu(src, {}, maskImage(mask, w, h)), smear.tolerance);
    expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
  });

  it('runs in a Pipeline (then blends with the mask like any masked step) and matches the CPU chain', async () => {
    const steps = [{ filter: smear, mask }];
    const pipe = new Pipeline(ctx);
    pipe.setSource(uploadImage(ctx, src));
    const res = compareImages(await readImage(ctx, pipe.run(steps)), runChainCpu(steps, src), { abs: 4e-4, rel: 2 ** -9 });
    expect(res.worst ?? null, JSON.stringify(res.worst)).toBeNull();
    expect(() => pipe.run([{ filter: smear }])).toThrow(/needs a mask/);
    pipe.destroy();
  });

  it('fails clearly without a mask', () => {
    expect(() => runFilter(ctx, smear, uploadImage(ctx, src))).toThrow(/needs a mask/);
    expect(() => runChainCpu([{ filter: smear }], src)).toThrow(/needs a mask/);
  });
});
