// The sRGB path, pinned (RFC #181, §8): colour management must leave an sRGB document on an 8-bit
// sRGB image exactly as it was. The hashes below were written before colour management existed; a
// change to any of them is a change of what existing documents render, and needs a reason.
import { applyEdit, encodeSrgb16, type Rgba8Image } from '@rullino/core';
import { exportSamples } from '@rullino/core/internal';
import { filters } from '@rullino/filters';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lookEdit, looks, resolveLookLut } from './looks';

/** A 37 × 23 picture: ramps, saturated colours, a little noise, partial alpha in one corner. */
function picture(): Rgba8Image {
  const width = 37;
  const height = 23;
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 24) % 9;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const t = x / (width - 1);
      const band = Math.floor((y / height) * 4);
      const rgb = band === 0 ? [t, t, t] : band === 1 ? [t, 1 - t, 0.2] : band === 2 ? [1, 0.1 + 0.5 * t, 0] : [0.1, 0.3 + 0.4 * t, 1 - t * 0.5];
      rgb.forEach((v, k) => (data[i + k] = Math.round(v * 247) + noise()));
      data[i + 3] = x < 5 && y < 5 ? 40 + 40 * x : 255;
    }
  return { data, width, height };
}

const hash = (bytes: ArrayBufferView) => createHash('sha256').update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex').slice(0, 16);

/** What an export of this document writes: the linear result, its 8-bit and 16-bit samples, a JPEG's flattened samples. */
async function render(doc: unknown) {
  const out = await applyEdit(picture(), doc, { filters, resolveLut: resolveLookLut });
  return {
    linear: hash(out.data),
    srgb8: hash(exportSamples(out)),
    srgb16: hash(encodeSrgb16(out)),
    jpeg: hash(exportSamples(out, { format: 'jpeg' })),
  };
}

const usable = filters.filter((f) => f.id !== 'applyLut' && !('usesMask' in f && f.usesMask) && !Object.values(f.params).some((p) => (p as { type: string }).type === 'image'));

describe('the sRGB path, bit for bit', () => {
  it.each(looks.map((l) => [l.id, l] as const))('look %s', async (_, look) => {
    expect(await render(lookEdit(look))).toMatchSnapshot();
  });

  it.each(usable.map((f) => [f.id, f] as const))('filter %s at its preview params', async (id, f) => {
    expect(await render({ version: 2, steps: [{ filter: id, params: f.preview ?? {} }] })).toMatchSnapshot();
  });

  it('a chain that leaves the gamut (saturation, then exposure above white) clips as it always has', async () => {
    const doc = { version: 2, steps: [{ filter: 'saturation', params: { amount: 1 } }, { filter: 'vibrance', params: { amount: 1 } }, { filter: 'exposure', params: { ev: 1.5 } }] };
    expect(await render(doc)).toMatchSnapshot();
  });
});
