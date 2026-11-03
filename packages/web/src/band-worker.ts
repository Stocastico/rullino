// A band worker of the CPU renderer (see threads.ts): runs one band of a segment of a chain.
import { activeSteps, createImage, parseChain, type Step } from '@rullino/core';
import { runChainBandRows } from '@rullino/core/internal';
import { filters } from '@rullino/filters';
import type { BandJob, BandReply } from './protocol';

// Typed by hand: the DOM and WebWorker libraries cannot be loaded together.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BandJob>) => void) | null;
  postMessage(message: BandReply, transfer?: Transferable[]): void;
};

/** The steps of the last render this worker saw: all its bands parse the document once. */
let cached: { key: number; steps: readonly Step[] } | undefined;

scope.onmessage = ({ data: job }) => {
  try {
    if (cached?.key !== job.key) {
      const { steps } = parseChain(job.edit, { filters, resolveLut: (ref: string) => job.luts[ref] });
      cached = { key: job.key, steps: activeSteps(steps) };
    }
    const { width, height, band } = job;
    const steps = cached.steps.slice(job.from, job.to);
    const options = { scale: job.scale, fast: true };
    if (job.src && job.dst) {
      // Shared path: read the band's rows (with halo) in the shared source, write ours in the shared output.
      const rows = createImage(width, band.to - band.from, new Float32Array(job.src, band.from * width * 16, (band.to - band.from) * width * 4));
      const out = runChainBandRows(steps, rows, band, height, options);
      new Float32Array(job.dst, band.y0 * width * 16, (band.y1 - band.y0) * width * 4).set(out.data);
      scope.postMessage({ type: 'done' });
    } else {
      const buffer = job.buffer!;
      const rows = createImage(width, band.to - band.from, new Float32Array(buffer, 0, job.length));
      const out = runChainBandRows(steps, rows, band, height, options);
      // The owned rows are never more than the rows given: write them over the start of the buffer and
      // send it back (the coordinator reuses it for another band). `set` copes with overlapping views.
      const length = (band.y1 - band.y0) * width * 4;
      new Float32Array(buffer, 0, length).set(out.data);
      scope.postMessage({ type: 'done', buffer, length }, [buffer]);
    }
  } catch (e) {
    scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

scope.postMessage({ type: 'ready' });
