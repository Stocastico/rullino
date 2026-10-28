// The CPU backend's Web Worker: renders edit documents with the built-in filters' fast paths.
import { applyEdit } from '@rullino/core';
import { applyEditPixels } from '@rullino/core/internal';
import { filters } from '@rullino/filters';
import type { RenderRequest, RenderResponse } from './protocol';

// Typed by hand: the DOM and WebWorker libraries cannot be loaded together.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse, transfer?: Transferable[]): void;
};

scope.onmessage = async ({ data: { id, image, edit, luts, scale, pixels } }) => {
  try {
    const options = { filters, resolveLut: (ref: string) => luts[ref], scale };
    const out = await (pixels ? applyEditPixels : applyEdit)(image, edit, options);
    scope.postMessage({ id, image: out }, [out.data.buffer]);
  } catch (e) {
    scope.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
