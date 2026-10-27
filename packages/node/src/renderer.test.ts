import { createImage, fromFloat16Array, IDENTITY_GEOMETRY, serializeChain, toFloat16Array, WebGpuUnavailableError } from '@rullino/core';
import { exposure, gaussianBlur } from '@rullino/filters';
import { lookEdit, looks, lookLutRef, lookSteps } from '@rullino/presets';
import { afterAll, describe, expect, it } from 'vitest';
import { createRenderer } from './renderer';

// The GPU tests run Dawn (the `webgpu` package) for real. Without a GPU, Linux needs a Vulkan
// driver: Mesa's lavapipe (`apt install mesa-vulkan-drivers`), as in CI. They never skip.

function photo(w: number, h: number) {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - w * 0.4, y - h * 0.6) * 0.5);
    data.set([v * v, v * 0.8, (x / w) * 0.9, 1], (y * w + x) * 4);
  }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

const pngSize = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20), bitDepth: png[24] };
};

const edit = () =>
  JSON.parse(JSON.stringify(serializeChain(
    [{ filter: exposure, params: { ev: 0.3 } }, ...lookSteps(looks[2]!, { intensity: 0.8, grain: false }), { filter: gaussianBlur, params: { sigma: 1.5 } }],
    { lutRef: lookLutRef, geometry: { ...IDENTITY_GEOMETRY, rotate: 90, crop: { x: 0, y: 0.1, width: 1, height: 0.8 } }, output: { longSide: 40 } },
  )));

describe('createRenderer', () => {
  const gpu = createRenderer({ backend: 'gpu' });
  const cpu = createRenderer({ backend: 'cpu' });
  afterAll(async () => {
    (await gpu).destroy();
    (await cpu).destroy();
  });

  it('runs the same edit on Dawn and on the CPU, within the summed tolerances', async () => {
    const [g, c] = await Promise.all([gpu, cpu]);
    expect([g.backend, c.backend]).toEqual(['gpu', 'cpu']);
    const src = photo(67, 45);
    const [a, b] = await Promise.all([g.apply(src, edit()), c.apply(src, edit())]);
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    let worst = 0;
    for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i]! - b.data[i]!));
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(4e-3);
  });

  it('renders 8-bit RGBA to PNG (8 or 16 bit) as the document says, looks included by name', async () => {
    const r = await gpu;
    const rgba = { data: new Uint8Array(30 * 20 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)), width: 30, height: 20 };
    const doc = { ...JSON.parse(JSON.stringify(lookEdit(looks[0]!))), output: { bitDepth: 16, longSide: 15 } };
    const out = await r.render(rgba, doc);
    expect(out.format).toBe('png');
    expect([...out.bytes.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    expect(pngSize(out.bytes)).toEqual({ width: 15, height: 10, bitDepth: 16 });
    expect([out.width, out.height]).toEqual([15, 10]);
    expect(pngSize((await r.render(rgba, { version: 2, steps: [] })).bytes).bitDepth).toBe(8);
  });

  it('validates the document before anything else', async () => {
    const rgba = { data: new Uint8Array(4 * 4 * 4), width: 4, height: 4 };
    await expect((await cpu).render(rgba, { version: 2, steps: [], output: { format: 'gif' } })).rejects.toThrow(/format must be png, jpeg or webp/);
  });

  it('rejects input that is not width × height RGBA bytes', async () => {
    await expect((await cpu).render({ data: new Uint8Array(10), width: 2, height: 2 }, { version: 2, steps: [] })).rejects.toThrow(/2x2/);
  });
});

describe('backend choice', () => {
  const noAdapter = { requestAdapter: async () => null } as unknown as GPU;

  it("'auto' falls back to the CPU and says why", async () => {
    const r = await createRenderer({ backend: 'auto', gpu: noAdapter });
    expect(r.backend).toBe('cpu');
    expect(r.reason).toMatch(/adapter/);
    r.destroy();
  });

  it("'gpu' fails instead of falling back", async () => {
    await expect(createRenderer({ backend: 'gpu', gpu: noAdapter })).rejects.toThrow(WebGpuUnavailableError);
  });

  it("'auto' uses Dawn when it is there", async () => {
    const r = await createRenderer();
    expect(r.backend).toBe('gpu');
    expect(r.reason).toBeUndefined();
    r.destroy();
  });
});
