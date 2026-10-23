import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEPTH_ANYTHING_V2_SMALL, fetchModel, MIGAN, ModelIntegrityError, SLIMSAM_77, type ModelFile } from './models';

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
    delete: async (url: string) => store.delete(url),
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

const hex = async (bytes: number[]) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), (b) => b.toString(16).padStart(2, '0')).join('');
const file = async (bytes: number[], over: Partial<ModelFile> = {}): Promise<ModelFile> => ({ url: 'https://x/m.onnx', sha256: await hex(bytes), bytes: bytes.length, ...over });

describe('fetchModel integrity', () => {
  const BODY = [1, 2, 3, 4, 5];

  it('accepts a file whose size and sha256 match, and says nothing else', async () => {
    vi.stubGlobal('caches', undefined);
    const out = await fetchModel(await file(BODY), { fetch: async () => chunked([[1, 2], [3, 4, 5]]) });
    expect(Array.from(out)).toEqual(BODY);
  });

  it('rejects a wrong sha256, and caches nothing', async () => {
    const { caches, store } = fakeCaches();
    vi.stubGlobal('caches', caches);
    const bad = await file(BODY, { sha256: await hex([9, 9, 9]) });
    await expect(fetchModel(bad, { fetch: async () => chunked([BODY]) })).rejects.toThrow(ModelIntegrityError);
    await expect(fetchModel(bad, { fetch: async () => chunked([BODY]) })).rejects.toThrow(/sha256/);
    expect(store.size).toBe(0);
  });

  it('rejects a body of the wrong size, even before hashing it', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(fetchModel(await file(BODY, { bytes: 6 }), { fetch: async () => chunked([BODY]) })).rejects.toThrow(/5 bytes.*6|6 bytes.*5/);
    // More than announced: stop as soon as it is clear, not after downloading everything.
    await expect(fetchModel(await file([1, 2], { bytes: 2 }), { fetch: async () => chunked([[1, 2], [3, 4, 5]], false) })).rejects.toThrow(/more than 2 bytes/);
  });

  it('rejects a truncated download even for a bare URL (content-length says more than arrived)', async () => {
    vi.stubGlobal('caches', undefined);
    const truncated = () => new Response(new ReadableStream({ start: (c) => (c.enqueue(new Uint8Array([1, 2, 3])), c.close()) }), { headers: { 'content-length': '10' } });
    await expect(fetchModel('https://x/y', { fetch: async () => truncated() })).rejects.toThrow(ModelIntegrityError);
  });

  it('a corrupt cache entry is dropped and downloaded again', async () => {
    const { caches, store } = fakeCaches();
    vi.stubGlobal('caches', caches);
    const f = await file(BODY);
    store.set(f.url, new Response(new Uint8Array([1, 2, 3, 4, 6]))); // right size, wrong content
    const fetch = vi.fn(async () => chunked([BODY]));
    const out = await fetchModel(f, { fetch });
    expect(Array.from(out)).toEqual(BODY);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Array.from(new Uint8Array(await store.get(f.url)!.arrayBuffer()))).toEqual(BODY); // the good copy replaced it
  });

  it('a bare URL is downloaded unverified', async () => {
    vi.stubGlobal('caches', undefined);
    expect(Array.from(await fetchModel('https://x/anything', { fetch: async () => chunked([[4, 2]]) }))).toEqual([4, 2]);
  });
});

describe('model descriptors', () => {
  const files: [string, ModelFile][] = [
    ...Object.entries(SLIMSAM_77.variants).flatMap(([v, f]) => [[`SlimSAM ${v} encoder`, f.encoder], [`SlimSAM ${v} decoder`, f.decoder]] as [string, ModelFile][]),
    ['MI-GAN', MIGAN.model],
    ['Depth Anything V2 Small', DEPTH_ANYTHING_V2_SMALL.model],
  ];

  it.each(files)('%s is pinned to a revision, with a sha256 and a size', (_, f) => {
    expect(f.url).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\/.+\.onnx$/);
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.bytes).toBeGreaterThan(1e6);
  });

  it('the totals shown to the user are the sums of the files', () => {
    for (const v of Object.values(SLIMSAM_77.variants)) expect(v.bytes).toBe(v.encoder.bytes + v.decoder.bytes);
    expect(MIGAN.bytes).toBe(MIGAN.model.bytes);
    expect(DEPTH_ANYTHING_V2_SMALL.bytes).toBe(DEPTH_ANYTHING_V2_SMALL.model.bytes);
  });

  it('SlimSAM is an Apache-2.0 model', () => {
    expect(SLIMSAM_77.licence).toBe('Apache-2.0');
  });
});
