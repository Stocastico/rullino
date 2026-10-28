import type { LinearImage } from '@rullino/core';
import { createRenderer, type Renderer } from '@rullino/web';
import type Konva from 'konva';

export interface AttachEditOptions {
  /** The renderer to use (shared between nodes); by default one is created and destroyed by `detach()`. */
  readonly renderer?: Renderer;
  /** Device pixels per CSS pixel of the preview; defaults to `window.devicePixelRatio`. */
  readonly pixelRatio?: number;
}

export interface AttachedEdit {
  /**
   * Shows `edit` (an edit document) on the node: rendered at the node's size on screen, capped at
   * the source's, then swapped in and the layer redrawn. Calls made while a render runs coalesce:
   * only the latest document is rendered next, and every returned promise resolves once it is shown.
   * The document's `output` is ignored here; it applies to `export()`.
   */
  set(edit: unknown): Promise<void>;
  /** Renders `edit` (default: the last one set) on the full-resolution original and encodes it as its `output` says. */
  export(edit?: unknown): Promise<Blob>;
  /** Puts the original image back on the node; the edit can no longer be used. */
  detach(): void;
}

/**
 * Edits a `Konva.Image` with rullino edit documents. The node keeps its size: a geometry that crops
 * or turns the image changes its proportions, so resize the node if it should follow.
 */
export async function attachEdit(node: Konva.Image, options: AttachEditOptions = {}): Promise<AttachedEdit> {
  const original = node.image();
  if (!original) throw new Error('attachEdit: the Konva.Image has no image to edit');
  const full = pixelsOf(original);
  const renderer = options.renderer ?? (await createRenderer());
  const own = !options.renderer;

  // The original shrunk (in linear light) to the size on screen, kept per size.
  let preview: { longSide: number; image: Promise<LinearImage> } | undefined;
  const previewFor = (longSide: number): Promise<LinearImage> => {
    if (preview?.longSide !== longSide) {
      const image = longSide >= Math.max(full.width, full.height)
        ? renderer.apply(full, { version: 2, steps: [] })
        : renderer.apply(full, { version: 2, steps: [], output: { longSide } });
      preview = { longSide, image };
    }
    return preview.image;
  };

  const canvas = document.createElement('canvas');
  let last: unknown;
  let pending: unknown;
  let running: Promise<void> | undefined;
  let detached = false;

  const show = async (edit: unknown) => {
    const scale = node.getAbsoluteScale();
    const ratio = options.pixelRatio ?? globalThis.devicePixelRatio ?? 1;
    const onScreen = Math.max(node.width() * Math.abs(scale.x), node.height() * Math.abs(scale.y)) * ratio;
    const src = await previewFor(Math.max(1, Math.min(Math.round(onScreen), Math.max(full.width, full.height))));
    const out = await renderer.pixels(src, withoutOutput(edit), { scale: src.width / full.width });
    if (detached) return;
    [canvas.width, canvas.height] = [out.width, out.height];
    canvas.getContext('2d')!.putImageData(out, 0, 0);
    node.image(canvas);
    node.getLayer()?.batchDraw();
  };

  // One render at a time; a call made meanwhile replaces any waiting document and joins its render.
  const loop = async () => {
    await null; // so that `running` is assigned before it can be cleared
    try {
      while (pending !== undefined) {
        const edit = pending;
        pending = undefined;
        await show(edit);
      }
    } finally {
      running = undefined; // synchronously with the last check: a later set() starts a new loop
    }
  };

  return {
    set(edit) {
      if (detached) return Promise.reject(new Error('attachEdit: detached'));
      last = edit;
      pending = edit;
      running ??= loop();
      return running;
    },
    export(edit = last) {
      return renderer.render(full, edit ?? { version: 2, steps: [] });
    },
    detach() {
      if (detached) return;
      detached = true;
      node.image(original);
      node.getLayer()?.batchDraw();
      if (own) renderer.destroy();
    },
  };
}

/** The document without its `output`, which only applies to exports. */
function withoutOutput(edit: unknown): unknown {
  if (!edit || typeof edit !== 'object' || !('output' in edit)) return edit;
  const { output: _, ...rest } = edit as Record<string, unknown>;
  return rest;
}

/** The image's full-resolution 8-bit pixels. */
function pixelsOf(image: CanvasImageSource): ImageData {
  const [w, h] = image instanceof HTMLImageElement ? [image.naturalWidth, image.naturalHeight]
    : image instanceof SVGImageElement ? [image.width.baseVal.value, image.height.baseVal.value]
    : image instanceof VideoFrame ? [image.displayWidth, image.displayHeight]
    : image instanceof HTMLVideoElement ? [image.videoWidth, image.videoHeight]
    : [image.width, image.height];
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d')!;
  g.drawImage(image, 0, 0);
  return g.getImageData(0, 0, w, h);
}
