'use client';
// Preview in the browser with @rullino/web (WebGPU, else a CPU worker), then send the very same edit
// document and the original file to the server for the full-resolution render.
import { useEffect, useRef, useState } from 'react';
import { makeEdit } from '../edit';

export default function Editor() {
  const canvas = useRef(null);
  const state = useRef({}); // renderer, source pixels, scale: not UI state
  const [values, setValues] = useState({ ev: 0, blur: 0 });
  const [status, setStatus] = useState('Loading…');
  const [server, setServer] = useState(null);

  // Start the renderer and decode the photo once (a 640 px copy is what the preview works on).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { createRenderer } = await import('@rullino/web');
      const photo = new Image();
      photo.src = '/photo.jpg';
      await photo.decode();
      const ctx = canvas.current.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(photo, 0, 0, 640, 480);
      const renderer = await createRenderer();
      if (cancelled) return renderer.destroy?.();
      state.current = { renderer, ctx, source: ctx.getImageData(0, 0, 640, 480), scale: 640 / photo.naturalWidth };
      setStatus(renderer.backend === 'gpu' ? 'Preview on the GPU (WebGPU)' : `Preview on the CPU in a worker (${renderer.reason})`);
      window.example = { state: state.current }; // for the smoke test
    })();
    return () => { cancelled = true; };
  }, []);

  // Preview: the edit at the preview's scale. Re-runs on every slider move; the renderer is cheap to call.
  useEffect(() => {
    const { renderer, ctx, source, scale } = state.current;
    if (!renderer) return;
    renderer.pixels(source, makeEdit(values), { scale }).then((pixels) => {
      ctx.putImageData(pixels, 0, 0);
      window.example.previews = (window.example.previews ?? 0) + 1;
    });
  }, [values, status]);

  async function renderOnServer() {
    setServer({ busy: true });
    const form = new FormData();
    form.set('photo', await (await fetch('/photo.jpg')).blob()); // the original, not the 640 px copy
    form.set('edit', JSON.stringify(makeEdit(values)));
    const res = await fetch('/api/render', { method: 'POST', body: form });
    if (!res.ok) return setServer({ error: (await res.json()).error });
    const blob = await res.blob();
    setServer({ url: URL.createObjectURL(blob), kb: Math.round(blob.size / 1024), backend: res.headers.get('x-rullino-backend'), ms: res.headers.get('x-rullino-ms') });
  }

  const slider = (name, label, min, max, step) => (
    <label style={{ display: 'grid', gap: 2 }}>
      {label}
      <input type="range" name={name} min={min} max={max} step={step} value={values[name]} onChange={(e) => setValues({ ...values, [name]: Number(e.target.value) })} />
    </label>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <canvas ref={canvas} width="640" height="480" style={{ border: '1px solid #ccc', maxWidth: '100%', height: 'auto' }} />
      <div style={{ display: 'grid', gap: 10, minWidth: 220, alignContent: 'start' }}>
        {slider('ev', 'Exposure', -2, 2, 0.05)}
        {slider('blur', 'Blur', 0, 20, 0.5)}
        <output id="status">{status}</output>
        <button type="button" onClick={renderOnServer} disabled={server?.busy}>Render on the server</button>
        {server?.error && <output id="error">{server.error}</output>}
        {server?.url && (
          <figure style={{ margin: 0 }}>
            <img id="result" src={server.url} alt="Server render" style={{ maxWidth: 320 }} />
            <figcaption id="server-status">Server: {server.backend}, {server.ms} ms, {server.kb} KB</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
