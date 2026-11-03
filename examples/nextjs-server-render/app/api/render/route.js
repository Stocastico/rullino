// POST multipart/form-data { photo: file, edit: JSON } -> the rendered JPEG.
// The same edit document the browser previewed, rendered at full resolution with @rullino/node:
// on the GPU through Dawn if the `webgpu` package and a Vulkan driver are there, else on the CPU.
import { createRenderer } from '@rullino/node';

export const runtime = 'nodejs'; // Dawn and sharp are native modules

// One renderer for the whole server process (creating it loads Dawn). Keep the promise, not the value,
// so concurrent first requests share it.
let renderer;
const getRenderer = () => (renderer ??= createRenderer());

export async function POST(request) {
  const form = await request.formData();
  const photo = form.get('photo');
  if (!(photo instanceof Blob)) return Response.json({ error: 'photo is missing' }, { status: 400 });

  let edit;
  try {
    edit = JSON.parse(String(form.get('edit')));
  } catch {
    return Response.json({ error: 'edit is not JSON' }, { status: 400 });
  }

  const r = await getRenderer();
  const started = performance.now();
  try {
    // Unknown filters or parameters are rejected with a message that names them: that is a 400, not a crash.
    const { bytes, format } = await r.render(Buffer.from(await photo.arrayBuffer()), edit);
    return new Response(bytes, {
      headers: {
        'content-type': `image/${format}`,
        'x-rullino-backend': r.backend === 'gpu' ? 'gpu' : `cpu (${r.reason})`,
        'x-rullino-ms': String(Math.round(performance.now() - started)),
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
