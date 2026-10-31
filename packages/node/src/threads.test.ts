import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createImage, fromFloat16Array, serializeChain, toFloat16Array, type LinearImage, type Mask, type Step } from '@rullino/core';
import { equalize, exposure, gaussianBlur, grain, halftone, kuwahara, pixelate, sharpen, unsharpMask, vignette } from '@rullino/filters';
import { lookEdit, looks } from '@rullino/presets';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRenderer, type RendererOptions } from './renderer';
import { resolveThreads } from './threads';

// Worker threads run the worker script, which Node cannot load from TypeScript sources: build it
// from them with Vite first, the way `pnpm bench:cpu` bundles its bench. The result must be the
// single-threaded one bit for bit, so everything is compared with strict equality.

let dir: string;
let workerUrl: URL;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rullino-threads-'));
  await build({
    logLevel: 'warn',
    configFile: false,
    build: { emptyOutDir: true, ssr: fileURLToPath(new URL('./worker.ts', import.meta.url)), outDir: dir, minify: false, rollupOptions: { output: { entryFileNames: 'worker.mjs' } } },
    ssr: { noExternal: true },
  });
  workerUrl = pathToFileURL(join(dir, 'worker.mjs'));
}, 120_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Threads for every image size, in as many bands as asked: the pool is created and used from the first pixel. */
const FORCE = { createAtPixels: 0, useAtPixels: 0, forceBands: true };
const renderers: { destroy(): void }[] = [];
async function renderer(o: RendererOptions = {}) {
  const r = await createRenderer({ backend: 'cpu', ...o });
  renderers.push(r);
  return r;
}
afterAll(() => renderers.forEach((r) => r.destroy()));

function photo(w: number, h: number): LinearImage {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = 0.5 + 0.5 * Math.sin(Math.hypot(x - w * 0.4, y - h * 0.6) * 0.3);
      const a = (x + y) % 41 === 0 ? 0.5 : 1;
      data.set([v * v * a, v * 0.8 * a, (x / w) * 0.9 * a, a], (y * w + x) * 4);
    }
  return createImage(w, h, fromFloat16Array(toFloat16Array(data)));
}

const radial: Mask = { kind: 'radial', center: [0.4, 0.6], radius: [0.3, 0.25], feather: 0.4 };
const doc = (steps: Step[], extra: Parameters<typeof serializeChain>[1] = {}) => JSON.parse(JSON.stringify(serializeChain(steps, extra)));
const edits: Record<string, unknown> = {
  'pointwise': doc([{ filter: exposure, params: { ev: 0.4 } }]),
  'blur and unsharp': doc([{ filter: gaussianBlur, params: { sigma: 3 } }, { filter: unsharpMask, params: { amount: 0.8, sigma: 2 } }]),
  'position-dependent': doc([{ filter: vignette }, { filter: grain, params: { amount: 0.5 } }, { filter: halftone, params: { size: 6 } }, { filter: pixelate, params: { size: 5 } }]),
  'masked': doc([{ filter: gaussianBlur, params: { sigma: 2 }, mask: radial }, { filter: exposure, params: { ev: -0.5 }, mask: { kind: 'linear', from: [0.1, 0.1], to: [0.9, 0.8] } }]),
  'a step that needs the whole image in the middle': doc([{ filter: gaussianBlur, params: { sigma: 2 } }, { filter: equalize }, { filter: sharpen }, { filter: exposure, params: { ev: 0.2 } }]),
  'disabled steps': doc([{ filter: exposure, enabled: false }, { filter: gaussianBlur, params: { sigma: 2 } }, { filter: sharpen, enabled: false }]),
  'long side': doc([{ filter: gaussianBlur, params: { sigma: 2 } }], { output: { longSide: 100 } }),
  ...Object.fromEntries(looks.map((l) => [`look ${l.id}`, JSON.parse(JSON.stringify(lookEdit(l)))])),
};
const same = (a: LinearImage, b: LinearImage, label: string) => {
  expect([a.width, a.height], label).toEqual([b.width, b.height]);
  for (let i = 0; i < a.data.length; i++) if (!Object.is(a.data[i], b.data[i])) expect.fail(`${label}: value ${i} is ${a.data[i]} on threads, ${b.data[i]} on one thread`);
};

describe('threads: option', () => {
  it('resolves to a number of threads: 1 by default, auto = the cores up to 8', () => {
    expect(resolveThreads(undefined)).toBe(1);
    expect(resolveThreads(3)).toBe(3);
    expect(resolveThreads(1000)).toBe(64);
    expect(resolveThreads('auto')).toBeGreaterThanOrEqual(1);
    expect(resolveThreads('auto')).toBeLessThanOrEqual(8);
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => resolveThreads(bad)).toThrow(RangeError);
  });

  it('is reported by the renderer, and ignored with custom filters (functions cannot go to a worker)', async () => {
    expect((await renderer()).threads).toBe(1);
    expect((await renderer({ threads: 3, pool: { workerUrl } })).threads).toBe(3);
    expect((await renderer({ threads: 3, filters: [exposure], pool: { workerUrl } })).threads).toBe(1);
  });
});

describe('threads: the result equals the single-threaded one, bit for bit', () => {
  it.each(Object.entries(edits))('%s', async (name, edit) => {
    const [one, many] = [await renderer(), await renderer({ threads: 3, pool: { workerUrl, ...FORCE } })];
    for (const [w, h] of [[160, 120], [97, 61]] as const) {
      const src = photo(w, h);
      same(await many.apply(src, edit), await one.apply(src, edit), `${name} ${w}x${h}`);
    }
  }, 60_000);

  it('with scale, with 8-bit input, and the output is ordinary memory', async () => {
    const [one, many] = [await renderer(), await renderer({ threads: 4, pool: { workerUrl, ...FORCE } })];
    const edit = edits['blur and unsharp'];
    same(await many.apply(photo(120, 90), edit, { scale: 0.5 }), await one.apply(photo(120, 90), edit, { scale: 0.5 }), 'scale 0.5');
    const rgba = { data: new Uint8Array(70 * 50 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 13) % 256)), width: 70, height: 50 };
    same(await many.apply(rgba, edit), await one.apply(rgba, edit), '8-bit input');
    expect((await many.apply(photo(40, 30), edit)).data.buffer).toBeInstanceOf(ArrayBuffer);
  }, 60_000);

  it('with more threads than rows, one row, and rows fewer than the halo', async () => {
    const [one, many] = [await renderer(), await renderer({ threads: 8, pool: { workerUrl, ...FORCE } })];
    for (const [w, h] of [[40, 3], [64, 1], [30, 7]] as const) same(await many.apply(photo(w, h), edits['blur and unsharp']), await one.apply(photo(w, h), edits['blur and unsharp']), `${w}x${h}`);
  }, 60_000);

  it('renders and encodes a file the way the single-threaded renderer does', async () => {
    const [one, many] = [await renderer(), await renderer({ threads: 3, pool: { workerUrl, ...FORCE } })];
    const rgba = { data: new Uint8Array(90 * 60 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)), width: 90, height: 60 };
    const edit = { ...(edits['position-dependent'] as object), output: { bitDepth: 16 } };
    expect(Array.from((await many.render(rgba, edit)).bytes)).toEqual(Array.from((await one.render(rgba, edit)).bytes));
  }, 60_000);
});

describe('threads: when they are used', () => {
  it('does not touch the workers for an image below the thresholds (the worker file need not exist)', async () => {
    const r = await renderer({ threads: 3, pool: { workerUrl: new URL('file:///nowhere/worker.mjs') } }); // default thresholds: 2 MP / 0.5 MP
    const out = await r.apply(photo(64, 48), edits['blur and unsharp']);
    same(out, await (await renderer()).apply(photo(64, 48), edits['blur and unsharp']), 'small image');
  });

  it('does not touch them for a chain that needs the whole image', async () => {
    const r = await renderer({ threads: 3, pool: { workerUrl: new URL('file:///nowhere/worker.mjs'), ...FORCE } });
    const out = await r.apply(photo(64, 48), doc([{ filter: equalize }]));
    same(out, await (await renderer()).apply(photo(64, 48), doc([{ filter: equalize }])), 'global only');
  });
});

describe('threads: failures', () => {
  const script = (name: string, body: string) => {
    const file = join(dir, name);
    writeFileSync(file, `import { parentPort } from 'node:worker_threads';\n${body}\n`);
    return pathToFileURL(file);
  };

  it('a worker file that is not there rejects the render with a message, and destroy still works', async () => {
    const r = await renderer({ threads: 2, pool: { workerUrl: new URL('file:///nowhere/worker.mjs'), ...FORCE } });
    await expect(r.apply(photo(40, 30), edits['blur and unsharp'])).rejects.toThrow(/could not start the worker threads/);
    await expect(r.apply(photo(40, 30), edits['blur and unsharp'])).rejects.toThrow(/could not start the worker threads/); // tried afresh, not stuck
    expect(() => r.destroy()).not.toThrow();
  });

  it('a worker that answers with an error rejects with its message', async () => {
    const bad = script('bad.mjs', "parentPort.postMessage({ type: 'ready' });\nparentPort.on('message', () => parentPort.postMessage({ type: 'error', message: 'boom in a worker' }));");
    const r = await renderer({ threads: 2, pool: { workerUrl: bad, ...FORCE } });
    await expect(r.apply(photo(40, 30), edits['blur and unsharp'])).rejects.toThrow('boom in a worker');
  });

  it('a worker whose first message is not ready is refused', async () => {
    const odd = script('odd.mjs', "parentPort.postMessage({ type: 'done' });");
    const r = await renderer({ threads: 2, pool: { workerUrl: odd, ...FORCE } });
    await expect(r.apply(photo(40, 30), edits['blur and unsharp'])).rejects.toThrow(/could not start the worker threads \(unexpected reply\)/);
  });

  it('destroy() while the threads are still starting stops them and fails the render', async () => {
    const slowStart = script('slow-start.mjs', "setTimeout(() => parentPort.postMessage({ type: 'ready' }), 300);");
    const r = await renderer({ threads: 2, pool: { workerUrl: slowStart, ...FORCE } });
    const running = r.apply(photo(40, 30), edits['blur and unsharp']);
    const outcome = running.then(() => 'finished', (e: Error) => e.message);
    await new Promise((resolve) => setTimeout(resolve, 50));
    r.destroy();
    expect(await outcome).toMatch(/destroyed/);
  });

  it('a worker that crashes rejects the render', async () => {
    const crash = script('crash.mjs', "parentPort.postMessage({ type: 'ready' });\nparentPort.on('message', () => { throw new Error('worker crashed'); });");
    const r = await renderer({ threads: 2, pool: { workerUrl: crash, ...FORCE } });
    await expect(r.apply(photo(40, 30), edits['blur and unsharp'])).rejects.toThrow(/worker crashed/);
  });

  it('a bad document is reported before any worker is used', async () => {
    const r = await renderer({ threads: 2, pool: { workerUrl, ...FORCE } });
    await expect(r.apply(photo(40, 30), { version: 99, steps: [] })).rejects.toThrow();
  });

  it('destroy() during a render rejects it and leaves no thread behind', async () => {
    const r = await renderer({ threads: 3, pool: { workerUrl, ...FORCE } });
    const slow = doc([{ filter: kuwahara, params: { radius: 8 } }]);
    const running = r.apply(photo(900, 600), slow);
    const outcome = running.then(() => 'finished', (e: Error) => e.message);
    await new Promise((resolve) => setTimeout(resolve, 400));
    r.destroy();
    expect(await outcome).toMatch(/destroyed|exited/);
    await expect(r.apply(photo(40, 30), slow)).rejects.toThrow(/destroyed/);
  }, 60_000);
});

describe('threads: spare buffers', () => {
  it('renders of the same size one after the other (buffers reused) stay correct, and so do other sizes after them', async () => {
    const [one, many] = [await renderer(), await renderer({ threads: 3, pool: { workerUrl, ...FORCE } })];
    const order = ['blur and unsharp', 'masked', 'a step that needs the whole image in the middle', 'position-dependent', 'blur and unsharp', 'disabled steps'];
    for (const [i, name] of order.entries()) {
      const src = photo(i === 4 ? 97 : 120, i === 4 ? 61 : 80); // one render of another size in between
      same(await many.apply(src, edits[name]), await one.apply(src, edits[name]), `${i}: ${name}`);
    }
  }, 60_000);

  it('render() leaves its result in shared memory and still writes the same files; apply() hands out copies that later renders do not touch', async () => {
    const [one, many] = [await renderer(), await renderer({ threads: 3, pool: { workerUrl, ...FORCE } })];
    const rgba = { data: new Uint8Array(80 * 60 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 11) % 256)), width: 80, height: 60 };
    const first = await many.apply(rgba, edits['blur and unsharp']);
    const kept = Float32Array.from(first.data);
    for (const name of ['masked', 'position-dependent', 'blur and unsharp']) {
      expect(Array.from((await many.render(rgba, edits[name])).bytes)).toEqual(Array.from((await one.render(rgba, edits[name])).bytes));
      expect(Array.from((await many.render(rgba, { ...(edits[name] as object), output: { format: 'jpeg', quality: 0.9 } })).bytes)).toEqual(Array.from((await one.render(rgba, { ...(edits[name] as object), output: { format: 'jpeg', quality: 0.9 } })).bytes));
    }
    expect(Array.from(first.data)).toEqual(Array.from(kept)); // a result handed out is not a buffer the next render reuses
  }, 60_000);
});

describe('threads: concurrency', () => {
  it('renders started together finish in order and equal the sequential results', async () => {
    const [one, many] = [await renderer(), await renderer({ threads: 3, pool: { workerUrl, ...FORCE } })];
    const names = ['blur and unsharp', 'masked', 'position-dependent', 'a step that needs the whole image in the middle'];
    const srcs = [photo(120, 80), photo(97, 61), photo(150, 40), photo(64, 64)];
    const done: number[] = [];
    const together = await Promise.all(names.map((n, i) => many.apply(srcs[i]!, edits[n]).then((out) => (done.push(i), out))));
    expect(done).toEqual([0, 1, 2, 3]);
    for (const [i, n] of names.entries()) same(together[i]!, await one.apply(srcs[i]!, edits[n]), n);
  }, 60_000);

  it('render() calls of the same size started together: one result is not overwritten by the next render while it is encoded', async () => {
    const [one, many] = [await renderer(), await renderer({ threads: 3, pool: { workerUrl, ...FORCE } })];
    const rgba = { data: new Uint8Array(260 * 200 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 11) % 256)), width: 260, height: 200 };
    const names = ['blur and unsharp', 'masked', 'position-dependent', 'blur and unsharp'];
    const docs = names.map((n) => ({ ...(edits[n] as object), output: { bitDepth: 16 } }));
    const together = await Promise.all(docs.map((d) => many.render(rgba, d)));
    for (const [i, d] of docs.entries()) expect(Array.from(together[i]!.bytes), names[i]).toEqual(Array.from((await one.render(rgba, d)).bytes));
  }, 60_000);

  it('a render after a failed one starts a new pool', async () => {
    const r = await renderer({ threads: 2, pool: { workerUrl, ...FORCE } });
    const bad = r.apply(photo(40, 30), doc([{ filter: gaussianBlur, params: { sigma: 2 } }]));
    await bad; // starts the pool
    await expect(r.apply(photo(40, 30), { version: 99 })).rejects.toThrow();
    same(await r.apply(photo(40, 30), edits['blur and unsharp']), await (await renderer()).apply(photo(40, 30), edits['blur and unsharp']), 'after an error');
  }, 60_000);
});
