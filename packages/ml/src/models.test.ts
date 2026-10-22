import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModel, SLIMSAM_77 } from './models';

afterEach(() => vi.unstubAllGlobals());

/** A response whose body arrives in chunks, with a Content-Length. */
const chunked = (chunks: number[][], withLength = true) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(new Uint8Array(ch));
        c.close();
      },
    }),
    { headers: withLength ? { 'content-length': String(chunks.flat().length) } : {} },
  );

function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => store.get(url)?.clone(),
    put: async (url: string, res: Response) => void store.set(url, res),
  };
  return { caches: { open: async () => cache }, store };
}

describe('fetchModel', () => {
  it('downloads with progress, caches, and reads the cache next time', async () => {
    const { caches, store } = fakeCaches();
    vi.stubGlobal('caches', caches);
    const fetch = vi.fn(async () => chunked([[1, 2], [3, 4, 5]]));
    const progress: number[][] = [];
    const bytes = await fetchModel('https://x/model.onnx', { fetch, onProgress: (done, total) => progress.push([done, total]) });
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5]);
    expect(progress).toEqual([[2, 5], [5, 5]]);
    expect(store.has('https://x/model.onnx')).toBe(true);
    const again = await fetchModel('https://x/model.onnx', { fetch });
    expect(Array.from(again)).toEqual([1, 2, 3, 4, 5]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('works without the Cache API and without a Content-Length; reports HTTP errors', async () => {
    vi.stubGlobal('caches', undefined);
    const progress: number[][] = [];
    const bytes = await fetchModel('https://x/a', { fetch: async () => chunked([[7], [8]], false), onProgress: (d, t) => progress.push([d, t]) });
    expect(Array.from(bytes)).toEqual([7, 8]);
    expect(progress.at(-1)).toEqual([2, 0]);
    await expect(fetchModel('https://x/b', { fetch: async () => new Response('', { status: 404 }) })).rejects.toThrow(/404/);
  });
});

describe('SLIMSAM_77', () => {
  it('points at a pinned revision of an Apache-2.0 model', () => {
    expect(SLIMSAM_77.licence).toBe('Apache-2.0');
    for (const v of Object.values(SLIMSAM_77.variants)) {
      for (const url of [v.encoder, v.decoder]) expect(url).toMatch(/^https:\/\/huggingface\.co\/Xenova\/slimsam-77-uniform\/resolve\/[0-9a-f]{40}\/onnx\/.+\.onnx$/);
    }
  });
});
