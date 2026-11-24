# Short links

A Cloudflare Worker on the free tier that turns the playground's share links into short ones (#208).
It is the one piece of rullino that runs off the user's machine, and it is optional: without it, or
when it does not answer, share links carry the whole edit in the URL fragment, as they always did.

**What is stored:** the edit document and the name of the sample image it was made on, as JSON (at
most 64 KB), under an id derived from its content: the same edit always gets the same link, and a link
never changes. **Never an image:** the user's photo does not leave their machine. No request logs, no
listing of links.

- `POST /` with `{ "chain": <edit document>, "sample"?: "<name>" }` → `201 { "id" }`. Only from the
  origins in `wrangler.toml`; about 30 a minute per IP; documents larger than 64 KB or of another shape
  are refused.
- `GET /<id>` → the JSON, cacheable for ever, from any origin.

Free-tier limits: 1 000 new links and 100 000 reads a day. Past them the playground falls back to the
long link.

**Live at** `https://rullino-links.stocastico.workers.dev` (deployed 24 Nov 2026; the playground's
`SHORT_LINKS_URL` in `apps/playground/src/short-links.ts`).

**Deploy:** Actions → *Short links* → *Run workflow* (needs the `CLOUDFLARE_API_TOKEN` secret). A
redeploy keeps the address and the stored links; a new address must also go into `SHORT_LINKS_URL`.
The playground's e2e test never calls the real Worker: it answers its requests with a fake store, then
blocks them to check the fallback to long links.
**Tests:** `npx vitest run apps/short-links` (the Worker with an in-memory KV, in Node) and
`apps/playground/src/short-links.test.ts` (the playground against it).
