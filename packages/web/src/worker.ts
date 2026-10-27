// The CPU backend's Web Worker: renders edit documents with the built-in filters' fast paths.
import { applyEdit, createImage } from '@rullino/core';
import { filters } from '@rullino/filters';
import type { RenderRequest, RenderResponse } from './protocol';

// Typed by hand: the DOM and WebWorker libraries cannot be loaded together.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data: { id, image, edit, luts, scale } }) => {
  try {
    const out = await applyEdit(createImage(image.width, image.height, image.data), edit, { filters, resolveLut: (ref) => luts[ref], scale });
    scope.postMessage({ id, image: { width: out.width, height: out.height, data: out.data } }, [out.data.buffer]);
  } catch (e) {
    scope.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
