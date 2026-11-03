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
    const out = runChainBandRows(steps, createImage(width, band.to - band.from, job.rows), band, height, options);
    // The result may be a view into a larger buffer (rows dropped after the last step): send just its rows.
    const data = out.data.byteLength === out.data.buffer.byteLength ? out.data : out.data.slice();
    scope.postMessage({ type: 'done', rows: data }, [data.buffer]);
  } catch (e) {
    scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

scope.postMessage({ type: 'ready' });
