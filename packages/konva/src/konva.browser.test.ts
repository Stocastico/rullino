import { createRenderer, type Renderer } from '@rullino/web';
import Konva from 'konva';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachEdit } from './index';

/** A 400 x 300 source: a horizontal grey ramp, opaque. */
function source(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  [c.width, c.height] = [400, 300];
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 400, 0);
  grad.addColorStop(0, '#202020');
  grad.addColorStop(1, '#c0c0c0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 400, 300);
  return c;
}

const stages: Konva.Stage[] = [];
const renderers: Renderer[] = [];
afterEach(() => {
  for (const s of stages.splice(0)) s.destroy();
  for (const r of renderers.splice(0)) r.destroy();
  vi.restoreAllMocks();
});

/** A stage with one Konva.Image of the source, shown at `w` x `h` CSS pixels, pixel ratio 1. */
async function setup(w = 200, h = 150) {
  const container = document.createElement('div');
  document.body.append(container);
  const stage = new Konva.Stage({ container, width: 400, height: 300 });
  stages.push(stage);
  const layer = new Konva.Layer();
  stage.add(layer);
  const original = source();
  const node = new Konva.Image({ image: original, width: w, height: h });
  layer.add(node);
  const renderer = await createRenderer();
  renderers.push(renderer);
  return { stage, layer, node, original, renderer };
}

const brighter = (ev: number) => ({ version: 2, steps: [{ filter: 'exposure', params: { ev } }] });
/** Red channel of the shown image at its centre. */
const centreRed = (node: Konva.Image) => {
  const img = node.image() as HTMLCanvasElement;
  return img.getContext('2d')!.getImageData(img.width >> 1, img.height >> 1, 1, 1).data[0]!;
};

describe('attachEdit', () => {
  it('renders the edit at the size on screen and swaps the image in, redrawing the layer', async () => {
    const { node, layer, original, renderer } = await setup(200, 150);
    const draw = vi.spyOn(layer, 'batchDraw');
    const edit = await attachEdit(node, { renderer, pixelRatio: 1 });
    await edit.set({ ...brighter(1), output: { longSide: 50 } }); // output is for export only
    const shown = node.image() as HTMLCanvasElement;
    expect(shown).not.toBe(original);
    expect([shown.width, shown.height]).toEqual([200, 150]); // the on-screen size, not the source's 400 x 300
    const before = original.getContext('2d')!.getImageData(200, 150, 1, 1).data[0]!;
    expect(centreRed(node)).toBeGreaterThan(before + 20);
    expect(draw).toHaveBeenCalled();
  });

  it('follows the node: a larger node gets a larger preview, never beyond the source', async () => {
    const { node, renderer } = await setup(200, 150);
    const edit = await attachEdit(node, { renderer, pixelRatio: 1 });
    node.size({ width: 1000, height: 750 });
    await edit.set(brighter(0.5));
    expect([(node.image() as HTMLCanvasElement).width, (node.image() as HTMLCanvasElement).height]).toEqual([400, 300]);
  });

  it('renders only the latest of quick successive edits', async () => {
    const { node, renderer } = await setup();
    const edit = await attachEdit(node, { renderer, pixelRatio: 1 });
    const pixels = vi.spyOn(renderer, 'pixels');
    await Promise.all([edit.set(brighter(0.5)), edit.set(brighter(1)), edit.set(brighter(1.5)), edit.set(brighter(-2))]);
    expect(pixels.mock.calls.length).toBeLessThanOrEqual(2); // the first, then only the last
    const last = centreRed(node);
    await edit.set(brighter(-2));
    expect(centreRed(node)).toBe(last);
  });

  it('exports at full resolution as the document says, and detach() restores the original', async () => {
    const { node, original, renderer } = await setup();
    const edit = await attachEdit(node, { renderer, pixelRatio: 1 });
    await edit.set(brighter(1));
    const blob = await edit.export({ ...brighter(1), output: { format: 'png' } });
    const bmp = await createImageBitmap(blob);
    expect([bmp.width, bmp.height]).toEqual([400, 300]);
    edit.detach();
    expect(node.image()).toBe(original);
  });

  it('needs an image to edit', async () => {
    const { renderer } = await setup();
    await expect(attachEdit(new Konva.Image({ image: undefined }), { renderer })).rejects.toThrow(/image/);
  });
});
