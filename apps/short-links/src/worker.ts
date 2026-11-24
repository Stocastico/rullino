// Short links for edit documents (#208): one Cloudflare Worker on the free tier. The playground's
// Share button POSTs its share state (an edit document and the name of a sample image, never an image:
// the user's photo never leaves their machine) and gets an id; `GET /<id>` gives the state back.
// Stored in Workers KV under the first 10 characters of the base64url SHA-256 of the canonical JSON,
// so the same document always gets the same link and nothing can be overwritten. Fragment links
// (`#s=…`) keep working without this Worker; the playground falls back to them when it does not answer.
//
// Free-tier limits (1 000 KV writes / 100 000 reads a day) are kept by: a size cap, a structural check
// of what is stored, no write when the document is already there, and a best-effort rate limit per IP
// in each Worker instance. Past the daily quota the write fails and the client falls back.
// No listing endpoint, no logs of payloads.

/** The part of Workers KV this Worker uses. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  readonly LINKS: KV;
  /** Comma-separated origins allowed to create links (wrangler.toml `[vars]`). */
  readonly ALLOWED_ORIGINS: string;
}

/** Largest share state accepted, in bytes of JSON. */
export const MAX_BYTES = 64 * 1024;
const ID = /^\/([A-Za-z0-9_-]{10})$/;
const POSTS_PER_MINUTE = 30;
const MAX_SAMPLE = 64;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * Whether `x` has the shape of the playground's share state: `{ chain, sample? }` where `chain` is an
 * edit document of version 1 or 2 (`steps` array) or 3 (`inputs` object, `nodes` array). Only the
 * shape: the playground checks filters and parameters with `parseEdit` when it opens the link, so
 * this Worker need not be redeployed when filters change.
 */
export function checkState(x: unknown): boolean {
  if (!isObject(x) || !isObject(x.chain)) return false;
  if (Object.keys(x).some((k) => k !== 'chain' && k !== 'sample')) return false;
  if (x.sample !== undefined && !(typeof x.sample === 'string' && x.sample.length <= MAX_SAMPLE)) return false;
  const c = x.chain;
  if (c.version === 1 || c.version === 2) return Array.isArray(c.steps);
  if (c.version === 3) return isObject(c.inputs) && Array.isArray(c.nodes);
  return false;
}

/** The link id of a canonical JSON text: the first 10 characters of its SHA-256 in base64url (60 bits). */
export async function idFor(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of digest) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 10);
}

// Best effort: each Worker instance counts the POSTs of each IP over the current minute.
const recent = new Map<string, { minute: number; count: number }>();
function tooMany(ip: string, now = Date.now()): boolean {
  const minute = Math.floor(now / 60_000);
  const r = recent.get(ip);
  if (!r || r.minute !== minute) {
    if (recent.size > 10_000) recent.clear();
    recent.set(ip, { minute, count: 1 });
    return false;
  }
  r.count++;
  return r.count > POSTS_PER_MINUTE;
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function allowedOrigin(request: Request, env: Env): string | undefined {
  const origin = request.headers.get('origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return origin && allowed.includes(origin) ? origin : undefined;
}

async function create(request: Request, env: Env): Promise<Response> {
  const origin = allowedOrigin(request, env);
  if (!origin) return json({ error: 'origin not allowed' }, 403);
  const cors = { 'access-control-allow-origin': origin, vary: 'origin' };
  if (tooMany(request.headers.get('cf-connecting-ip') ?? 'unknown')) return json({ error: 'too many links; try again in a minute' }, 429, cors);
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BYTES) return json({ error: `larger than ${MAX_BYTES} bytes` }, 413, cors);
  let state: unknown;
  try {
    state = JSON.parse(body);
  } catch {
    return json({ error: 'not JSON' }, 400, cors);
  }
  if (!checkState(state)) return json({ error: 'not a share state ({ chain: edit document, sample? })' }, 400, cors);
  const canonical = JSON.stringify(state);
  const id = await idFor(canonical);
  const existing = await env.LINKS.get(id);
  if (existing === null) await env.LINKS.put(id, canonical);
  else if (existing !== canonical) return json({ error: 'id collision' }, 409, cors); // 60 bits: not expected at this scale
  return json({ id }, 201, cors);
}

async function read(id: string, env: Env): Promise<Response> {
  const text = await env.LINKS.get(id);
  if (text === null) return json({ error: 'no such link' }, 404, { 'access-control-allow-origin': '*' });
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/') {
      if (request.method === 'POST') return create(request, env);
      if (request.method === 'OPTIONS') {
        const origin = allowedOrigin(request, env);
        if (!origin) return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, GET', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' },
        });
      }
      return json({ error: 'no such link' }, 404); // no listing
    }
    const id = ID.exec(pathname)?.[1];
    if (!id) return json({ error: 'no such link' }, 404);
    if (request.method === 'GET' || request.method === 'HEAD') return read(id, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' } });
    return json({ error: 'method not allowed' }, 405);
  },
};
