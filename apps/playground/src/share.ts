// Share links: the editing state as JSON, deflated and base64url-encoded into the URL fragment
// (the fragment never reaches a server). CompressionStream is built into browsers and Node.

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeState(state: unknown): Promise<string> {
  const bytes = await pipe(new TextEncoder().encode(JSON.stringify(state)), new CompressionStream('deflate-raw'));
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function decodeState(text: string): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('share link: not base64url');
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw'))));
}
