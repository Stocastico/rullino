// The CPU backend's Web Worker: renders edit documents with the built-in filters' fast paths, and,
// with `threads` above 1, hands the bands of the chain to a pool of band workers (threads.ts).
import { applyEdit, type ApplyEditOptions } from '@rullino/core';
import { applyEditPixels } from '@rullino/core/internal';
import { filters } from '@rullino/filters';
import type { RenderRequest, RenderResponse } from './protocol';
import { createThreadedExecutor, type ThreadedExecutor } from './threads';

// Typed by hand: the DOM and WebWorker libraries cannot be loaded together.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse, transfer?: Transferable[]): void;
};

// Made on the first request: `threads` and `pool` are the same for every request of a renderer.
let executor: ThreadedExecutor | undefined;

scope.onmessage = async ({ data: { id, image, edit, luts, scale, pixels, threads, pool } }) => {
  try {
    if (threads > 1 && typeof Worker !== 'undefined') executor ??= createThreadedExecutor(threads, pool);
    let bands = 0;
    let shared = false;
    const options: ApplyEditOptions = {
      filters,
      resolveLut: (ref: string) => luts[ref],
      scale,
      ...(executor && {
        cpu: async (steps, framed, c) => {
          const done = await executor!.run(edit, luts, steps, framed, c.scale);
          bands += done.bands;
          shared ||= done.shared;
          return done.image;
        },
      }),
    };
    const out = await (pixels ? applyEditPixels : applyEdit)(image, edit, options);
    scope.postMessage({ id, image: out, bands, shared }, [out.data.buffer]);
  } catch (e) {
    scope.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
