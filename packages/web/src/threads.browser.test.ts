import { activeSteps, createImage, defaultParams, parseChain, runChainCpu, type LinearImage, type Step } from '@rullino/core';
import { filters } from '@rullino/filters';
import { afterEach, describe, expect, it } from 'vitest';
import { createThreadedExecutor, type ThreadedExecutor } from './threads';

// The band-worker pool driven directly from the page (the render worker drives it in the product,
// where the coverage of this process cannot see it): thresholds, buffer reuse, failures.

const FORCE = { createAtPixels: 0, useAtPixels: 0, forceBands: true } as const;
const byId = new Map(filters.map((f) => [f.id, f]));
const step = (id: string, params: Record<string, unknown> = {}): Step => ({ filter: byId.get(id)!, params: { ...defaultParams(byId.get(id)!.params), ...params } });
const doc = (...ids: [string, Record<string, unknown>?][]) => ({ version: 2, steps: ids.map(([filter, params]) => ({ filter, params: params ?? {} })) });

function picture(w: number, h: number): LinearImage {
  const img = createImage(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([((i * 7) % 13) / 13, ((i * 3) % 11) / 11, (i % 5) / 5, 1], i * 4);
  return img;
}
const same = (a: LinearImage, b: LinearImage) => {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  expect(a.data.findIndex((v, i) => !Object.is(v, b.data[i]))).toBe(-1);
};

const executors: ThreadedExecutor[] = [];
const make = (threads: number, pool = {}) => {
  const e = createThreadedExecutor(threads, pool);
  executors.push(e);
  return e;
};
afterEach(() => {
  for (const e of executors.splice(0)) e.destroy();
});

const run = (e: ThreadedExecutor, edit: ReturnType<typeof doc>, image: LinearImage, scale = 1) => {
  const { steps } = parseChain(edit, { filters });
  return e.run(edit, {}, activeSteps(steps), image, scale);
};
const whole = (edit: ReturnType<typeof doc>, image: LinearImage, scale = 1) => runChainCpu(activeSteps(parseChain(edit, { filters }).steps), image, { scale, fast: true });

describe('createThreadedExecutor', () => {
  const edit = doc(['gaussianBlur', { sigma: 2 }], ['vignette'], ['exposure', { ev: 0.3 }]);
  const src = picture(47, 53);

  it('the result equals the whole image, bit for bit', async () => {
    const out = await run(make(3, FORCE), edit, src);
    expect(out.bands).toBeGreaterThan(1);
    same(out.image, whole(edit, src));
  });

  it('runs equalize, clahe and otsu in two phases: the bands count their rows, the counts are added, the bands map their pixels', async () => {
    const mask = { kind: 'radial', center: [0.4, 0.5], radius: [0.3, 0.3], feather: 0.5 };
    const chains: Record<string, ReturnType<typeof doc>> = {
      'blur, equalize, sharpen': doc(['gaussianBlur', { sigma: 2 }], ['equalize'], ['sharpen']),
      'equalize alone': doc(['equalize']),
      'clahe alone': doc(['clahe', { tiles: 6 }]),
      'otsu alone': doc(['otsu']),
      'three in a row': doc(['equalize', { amount: 0.7 }], ['clahe'], ['otsu'], ['exposure', { ev: 0.3 }]),
      'masked': { version: 2, steps: [{ filter: 'gaussianBlur', params: { sigma: 1.5 } }, { filter: 'clahe', params: {}, mask }, { filter: 'exposure', params: { ev: -0.2 } }] } as never,
    };
    const e = make(2, FORCE); // one pool for all: starting workers is the slow part, especially with coverage on
    for (const [name, edit] of Object.entries(chains))
      for (const [scale, image] of [[1, src], [0.5, picture(33, 9)]] as const) {
        const out = await run(e, edit, image, scale);
        same(out.image, whole(edit, image, scale));
        expect(out.bands, `${name}: in bands`).toBeGreaterThan(1);
        expect(out.inlineMs, `${name}: nothing left on the calling thread`).toBe(0);
      }
  }, 60_000);

  it('a segment kept on the calling thread (its halo is as tall as the image) hands its statistic to the banded segment after it', async () => {
    // Without forceBands a blur this wide leaves one band, so it runs inline; equalize has no halo and is cut into bands.
    const mixed = doc(['gaussianBlur', { sigma: 14 }], ['equalize'], ['exposure', { ev: 0.1 }]);
    const wide = picture(120, 30);
    const out = await run(make(3, { createAtPixels: 0, useAtPixels: 0 }), mixed, wide);
    same(out.image, whole(mixed, wide));
    expect(out.bands).toBeGreaterThan(1);
    expect(out.inlineMs).toBeGreaterThan(0);
  });

  it('stays on the calling thread below the thresholds, and a pool that exists is used from useAtPixels', async () => {
    const e = make(2, { createAtPixels: 4000, useAtPixels: 1000, forceBands: true });
    expect((await run(e, edit, picture(20, 20))).bands).toBe(0); // 400 px
    expect((await run(e, edit, picture(70, 70))).bands).toBeGreaterThan(0); // 4900 px starts it
    expect((await run(e, edit, picture(40, 30))).bands).toBeGreaterThan(0); // 1200 px: the pool is there
  });

  it('no steps give the input back', async () => {
    const e = make(2, FORCE);
    const out = await e.run(doc(), {}, [], src, 1);
    same(out.image, src);
    expect(out.bands).toBe(0);
  });

  it('runs renders one at a time, in order', async () => {
    const e = make(2, FORCE);
    const a = picture(30, 40);
    const b = picture(41, 22);
    const [ra, rb] = await Promise.all([run(e, edit, a), run(e, doc(['sharpen']), b)]);
    same(ra.image, whole(edit, a));
    same(rb.image, whole(doc(['sharpen']), b));
  });

  it('reuses the band buffers: after the first bands, nothing new is allocated for the copies', async () => {
    // Every buffer sent to a band worker, and every buffer that came back: a sent buffer that never came
    // back is a fresh allocation (the copies are what pressed the garbage collector at 12 MP).
    const sent: ArrayBuffer[] = [];
    const received = new Set<ArrayBuffer>();
    const NativeWorker = Worker;
    const post = NativeWorker.prototype.postMessage;
    NativeWorker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
      const buffer = (message as { type?: string; buffer?: ArrayBuffer }).type === 'band' ? (message as { buffer?: ArrayBuffer }).buffer : undefined;
      if (buffer) sent.push(buffer);
      return (post as (...a: unknown[]) => void).call(this, message, ...rest);
    };
    const listen = NativeWorker.prototype.addEventListener;
    try {
      globalThis.Worker = class extends NativeWorker {
        constructor(...a: ConstructorParameters<typeof Worker>) {
          super(...a);
          listen.call(this, 'message', (e: Event) => {
            const buffer = (e as MessageEvent<{ buffer?: ArrayBuffer }>).data.buffer;
            if (buffer) received.add(buffer);
          });
        }
      } as typeof Worker;
      const e = make(2, FORCE);
      for (let i = 0; i < 3; i++) same((await run(e, edit, src)).image, whole(edit, src));
    } finally {
      globalThis.Worker = NativeWorker;
      NativeWorker.prototype.postMessage = post;
    }
    const fresh = sent.filter((b) => !received.has(b)).length;
    expect(sent.length, 'bands were sent').toBeGreaterThan(8);
    expect(fresh, `${fresh} of ${sent.length} sent buffers were new`).toBeLessThanOrEqual(4);
  });

  it('reports a worker that cannot be loaded, and tries again on the next render', async () => {
    const e = make(2, { ...FORCE, workerUrl: new URL('./nothing-here.js', import.meta.url) });
    for (let i = 0; i < 2; i++) await expect(run(e, edit, src)).rejects.toThrow(/could not start the band workers/);
  });

  it('reports a worker that is not a band worker', async () => {
    const script = URL.createObjectURL(new Blob(["postMessage({ type: 'error', message: 'boom' });"], { type: 'text/javascript' }));
    await expect(run(make(1, { ...FORCE, workerUrl: script }), edit, src)).rejects.toThrow(/boom/);
    const other = URL.createObjectURL(new Blob(["postMessage({ type: 'what' });"], { type: 'text/javascript' }));
    await expect(run(make(1, { ...FORCE, workerUrl: other }), edit, src)).rejects.toThrow(/unexpected reply/);
  });

  it('reports a URL the browser refuses, and a worker that crashes in a band', async () => {
    await expect(run(make(1, { ...FORCE, workerUrl: 'http://[' }), edit, src)).rejects.toThrow(/could not start the band workers/);
    const crashing = URL.createObjectURL(new Blob(["postMessage({ type: 'ready' }); onmessage = () => { throw new Error('crash'); };"], { type: 'text/javascript' }));
    await expect(run(make(1, { ...FORCE, workerUrl: crashing }), edit, src)).rejects.toThrow(/a band worker failed/);
  });

  it('an error inside a band rejects the render, and the next one works on a fresh pool', async () => {
    const e = make(2, FORCE);
    // A document the band workers cannot parse (they get the edit, not the steps): the filter is unknown to them.
    const broken = { ...doc(['gaussianBlur', { sigma: 2 }]), steps: [{ filter: 'gaussianBlur', params: { sigma: 'x' } }] };
    const { steps } = parseChain(edit, { filters });
    await expect(e.run(broken, {}, activeSteps(steps), src, 1)).rejects.toThrow();
    same((await run(e, edit, src)).image, whole(edit, src));
  });

  it('destroy() rejects what is running and what comes after', async () => {
    const e = make(2, FORCE);
    const slow = doc(['kuwahara', { radius: 4 }]);
    const running = run(e, slow, picture(300, 200));
    setTimeout(() => e.destroy(), 30);
    await expect(running).rejects.toThrow(/destroyed|failed/);
    await expect(run(e, edit, src)).rejects.toThrow(/destroyed/);
  });

  it('destroy() while the pool is starting stops the workers', async () => {
    const e = make(2, FORCE);
    const starting = run(e, edit, src);
    e.destroy();
    await expect(starting).rejects.toThrow(/destroyed/);
  });
});
