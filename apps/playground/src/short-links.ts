// Short links (#208): the share state stored by the short-link Worker (apps/short-links), so a link
// is `#l=<id>` instead of the whole document in `#s=…`. Only documents and the name of a sample image
// go there, never an image. When the Worker is not configured, down, over its free quota or slow, the
// Share button falls back to the long link, which works without it.

/** The deployed Worker (apps/short-links); empty would mean long links only. */
export const SHORT_LINKS_URL = 'https://rullino-links.stocastico.workers.dev';

const ID = /^[A-Za-z0-9_-]{10}$/;

interface Options {
  readonly url?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** The short-link id of a share state, or undefined if no short link can be made now (use the long one). */
export async function shorten(state: unknown, { url = SHORT_LINKS_URL, fetch: f = globalThis.fetch, timeoutMs = 3000 }: Options = {}): Promise<string | undefined> {
  if (!url) return undefined;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const r = await f(`${url}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state), signal: abort.signal });
    if (r.status !== 201) return undefined;
    const { id } = (await r.json()) as { id?: unknown };
    return typeof id === 'string' && ID.test(id) ? id : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The share state behind a short-link id. Throws a message meant for the person who opened the link. */
export async function expand(id: string, { url = SHORT_LINKS_URL, fetch: f = globalThis.fetch }: Options = {}): Promise<unknown> {
  if (!ID.test(id)) throw new Error('not a short link');
  if (!url) throw new Error('short links are not available in this build');
  let r: Response;
  try {
    r = await f(`${url}/${id}`);
  } catch {
    throw new Error('could not reach the short-link service; try again later');
  }
  if (r.status === 404) throw new Error('this short link does not exist');
  if (!r.ok) throw new Error(`the short-link service answered ${r.status}`);
  return r.json();
}
