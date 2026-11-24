import { describe, expect, it } from 'vitest';
import worker, { checkState, idFor, MAX_BYTES, type Env, type KV } from './worker';

// The short-link Worker (#208) driven through its fetch handler with an in-memory KV.

function memoryKv(): KV & { puts: number; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    store,
    puts: 0,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      kv.puts++;
      store.set(k, v);
    },
  };
  return kv;
}

const ORIGIN = 'https://stefanomasneri.com';
const env = (kv = memoryKv()): Env & { LINKS: ReturnType<typeof memoryKv> } => ({ LINKS: kv, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` });
const state = { chain: { version: 3, inputs: { main: {} }, nodes: [{ id: 'edit', from: 'main', steps: [{ filter: 'exposure', params: { ev: 1.5 } }] }] }, sample: 'meadow' };
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('https://links.example/', { method: 'POST', body, headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.1', ...headers } });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`https://links.example${path}`, { headers });

describe('POST /', () => {
  it('stores a share state under the hash of its canonical JSON and returns the id', async () => {
    const e = env();
    const r = await worker.fetch(post(JSON.stringify(state)), e);
    expect(r.status).toBe(201);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const { id } = (await r.json()) as { id: string };
    expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(id).toBe(await idFor(JSON.stringify(state)));
    expect(JSON.parse(e.LINKS.store.get(id)!)).toEqual(state);
  });

  it('gives the same id to the same document, whatever its spacing, and does not write it twice', async () => {
    const e = env();
    const a = (await (await worker.fetch(post(JSON.stringify(state)), e)).json()) as { id: string };
    const b = (await (await worker.fetch(post(JSON.stringify(state, null, 2)), e)).json()) as { id: string };
    expect(b.id).toBe(a.id);
    expect(e.LINKS.puts).toBe(1);
  });

  it('refuses what is not a share state, too large, from another origin, or too often', async () => {
    const e = env();
    expect((await worker.fetch(post('not json'), e)).status).toBe(400);
    expect((await worker.fetch(post(JSON.stringify({ chain: { version: 9, steps: [] } })), e)).status).toBe(400);
    expect((await worker.fetch(post('x'.repeat(MAX_BYTES + 1)), e)).status).toBe(413);
    expect((await worker.fetch(post(JSON.stringify(state), { origin: 'https://evil.example' }), e)).status).toBe(403);
    expect(e.LINKS.puts).toBe(0);
    const burst = env();
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) codes.push((await worker.fetch(post(JSON.stringify({ ...state, sample: `s${i}` }), { 'cf-connecting-ip': '198.51.100.7' }), burst)).status);
    expect(codes.filter((c) => c === 201).length).toBeLessThanOrEqual(30);
    expect(codes).toContain(429);
  });

  it('answers the CORS preflight for allowed origins only', async () => {
    const ok = await worker.fetch(new Request('https://links.example/', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), env());
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    const no = await worker.fetch(new Request('https://links.example/', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env());
    expect(no.status).toBe(403);
  });
});

describe('GET /:id', () => {
  it('returns the stored state, cacheable for ever, to any origin', async () => {
    const e = env();
    const { id } = (await (await worker.fetch(post(JSON.stringify(state)), e)).json()) as { id: string };
    const r = await worker.fetch(get(`/${id}`, { origin: 'https://anywhere.example' }), e);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('immutable');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(await r.json()).toEqual(state);
  });

  it('is 404 for an unknown id or a path that is not one, and 405 for other methods', async () => {
    expect((await worker.fetch(get('/AAAAAAAAAA'), env())).status).toBe(404);
    expect((await worker.fetch(get('/not/an/id'), env())).status).toBe(404);
    expect((await worker.fetch(get('/'), env())).status).toBe(404); // no listing
    expect((await worker.fetch(new Request('https://links.example/AAAAAAAAAA', { method: 'DELETE' }), env())).status).toBe(405);
  });
});

describe('checkState', () => {
  it('takes the playground’s share state: a document of version 1 to 3 and an optional sample name', () => {
    expect(checkState(state)).toBe(true);
    expect(checkState({ chain: { version: 2, steps: [] } })).toBe(true);
    expect(checkState({ chain: { version: 1, steps: [] }, sample: 'ramps' })).toBe(true);
  });

  it('refuses anything else', () => {
    for (const bad of [null, [], 'x', {}, { chain: {} }, { chain: { version: 3, nodes: 'x', inputs: {} } }, { chain: { version: 2 } }, { chain: { version: 2, steps: [] }, sample: 5 }, { chain: { version: 2, steps: [] }, sample: 'x'.repeat(65) }, { chain: { version: 2, steps: [] }, image: 'data:…' }])
      expect(checkState(bad), JSON.stringify(bad)).toBe(false);
  });
});
