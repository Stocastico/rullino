import { describe, expect, it } from 'vitest';
import worker, { type KV } from '../../short-links/src/worker';
import { expand, shorten } from './short-links';

// The playground's side of the short links (#208), against the real Worker behind a fake fetch.

const URL_ = 'https://rullino-links.example.workers.dev';
const ORIGIN = 'https://stefanomasneri.com';

function workerFetch(): typeof fetch {
  const store = new Map<string, string>();
  const kv: KV = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
  const env = { LINKS: kv, ALLOWED_ORIGINS: ORIGIN };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('origin', ORIGIN); // what the browser adds
    return worker.fetch(new Request(request, { headers }), env);
  }) as typeof fetch;
}

const state = { chain: { version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [{ filter: 'exposure', params: { ev: 1.5 } }] }] }, sample: 'meadow' };

describe('short links in the playground', () => {
  it('shortens a share state to an id and expands it back', async () => {
    const fetch = workerFetch();
    const id = await shorten(state, { url: URL_, fetch });
    expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(await expand(id!, { url: URL_, fetch })).toEqual(state);
  });

  it('gives no id (the caller falls back to the long link) when there is no Worker, it fails, refuses or is slow', async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch;
    expect(await shorten(state, { url: '', fetch: counting })).toBeUndefined();
    expect(calls).toBe(0);
    expect(await shorten(state, { url: URL_, fetch: (async () => Promise.reject(new TypeError('offline'))) as typeof fetch })).toBeUndefined();
    expect(await shorten(state, { url: URL_, fetch: (async () => new Response('{"error":"quota"}', { status: 503 })) as typeof fetch })).toBeUndefined();
    expect(await shorten(state, { url: URL_, fetch: (async () => new Response('{"id":"../x"}', { status: 201 })) as typeof fetch })).toBeUndefined();
    const never = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as typeof fetch;
    const t0 = Date.now();
    expect(await shorten(state, { url: URL_, fetch: never, timeoutMs: 50 })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('says so when a short link does not exist or the service cannot be reached', async () => {
    await expect(expand('AAAAAAAAAA', { url: URL_, fetch: workerFetch() })).rejects.toThrow(/this short link does not exist/);
    await expect(expand('AAAAAAAAAA', { url: '', fetch: workerFetch() })).rejects.toThrow(/short links are not available/);
    await expect(expand('AAAAAAAAAA', { url: URL_, fetch: (async () => Promise.reject(new TypeError('offline'))) as typeof fetch })).rejects.toThrow(/could not reach the short-link service/);
    await expect(expand('../etc', { url: URL_, fetch: workerFetch() })).rejects.toThrow(/not a short link/);
  });
});
