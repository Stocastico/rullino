import { createImage } from '@rullino/core';
import { describe, expect, it, vi } from 'vitest';

// One Dawn instance per process (#223): every renderer asks it for its own adapter and device.
// Several instances in one process made Dawn crash or hang now and then (SIGABRT / SIGSEGV / SIGBUS
// in renderer.test.ts, see CLAUDE.md), and an app that makes a renderer per request would pay for one each time.
const created = vi.hoisted(() => ({ count: 0 }));
vi.mock('webgpu', async (importOriginal) => {
  const real = await importOriginal<typeof import('webgpu')>();
  return {
    ...real,
    create: (...args: Parameters<typeof real.create>) => {
      created.count++;
      return real.create(...args);
    },
  };
});
const { createRenderer } = await import('./renderer');

const edit = { version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }, { filter: 'gaussianBlur', params: { sigma: 1 } }] };
const DAWN = { timeout: 120_000 };

describe('Dawn instance', DAWN, () => {
  it('is created once, however many renderers there are', async () => {
    // One after another: the mocked module's count misses imports that race each other.
    const renderers = [];
    for (let i = 0; i < 3; i++) renderers.push(await createRenderer({ backend: 'gpu' }));
    try {
      expect(renderers.map((r) => r.backend)).toEqual(['gpu', 'gpu', 'gpu']);
      expect(created.count).toBe(1);
      // Each has a device of its own: destroying one leaves the others working.
      renderers[0]!.destroy();
      const out = await renderers[1]!.apply(createImage(9, 7, new Float32Array(9 * 7 * 4).fill(0.25)), edit);
      expect(out.data[0]).toBeGreaterThan(0.25);
    } finally {
      for (const r of renderers.slice(1)) r.destroy();
    }
  });

  it('survives renderers created, used and destroyed one after another', async () => {
    const src = createImage(33, 21, new Float32Array(33 * 21 * 4).fill(0.4));
    let first: Float32Array | undefined;
    for (let i = 0; i < 12; i++) {
      const r = await createRenderer({ backend: 'gpu' });
      const out = await r.apply(src, edit);
      first ??= out.data;
      expect(out.data).toEqual(first);
      r.destroy();
    }
    expect(created.count).toBe(1);
  });

  it('a renderer created while another is starting shares the instance too', async () => {
    const [a, b] = await Promise.all([createRenderer({ backend: 'gpu' }), createRenderer({ backend: 'gpu' })]);
    expect([a.backend, b.backend]).toEqual(['gpu', 'gpu']);
    a.destroy();
    b.destroy();
  });
});
