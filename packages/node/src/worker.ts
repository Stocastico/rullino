// A worker thread of the CPU renderer (see threads.ts): runs one band of a segment of a chain and
// writes the rows it owns into the shared output.
import { parentPort } from 'node:worker_threads';
import { activeSteps, createImage, parseChain, type Step } from '@rullino/core';
import { runChainBandRows, twoPhaseStat } from '@rullino/core/internal';
import { filters } from '@rullino/filters';
import type { BandJob, WorkerReply } from './threads';

const port = parentPort;
if (!port) throw new Error('worker.js is a worker thread of @rullino/node, not a module to import');
const send = (m: WorkerReply) => port.postMessage(m);

/** The steps of the last render this worker saw: all its bands parse the document once. */
let cached: { key: number; steps: readonly Step[] } | undefined;

port.on('message', (job: BandJob) => {
  try {
    if (cached?.key !== job.key) {
      const { steps } = parseChain(job.edit, { filters, resolveLut: (ref: string) => job.luts[ref] });
      cached = { key: job.key, steps: activeSteps(steps) };
    }
    const { width, height, band } = job;
    const rows = createImage(width, band.to - band.from, new Float32Array(job.src, band.from * width * 16, (band.to - band.from) * width * 4));
    const options = { scale: job.scale, fast: true };
    const out = runChainBandRows(cached.steps.slice(job.from, job.to), rows, band, height, options, { ...(job.stat && { stat: job.stat }) });
    if (job.dst) new Float32Array(job.dst, band.y0 * width * 16, (band.y1 - band.y0) * width * 4).set(out.data);
    // The statistic of the next (two-phase) step over the rows this band owns, which are `out`.
    const stat = job.statFor ? twoPhaseStat(cached.steps[job.to]!, out, { y0: band.y0, fullHeight: height }, options) : undefined;
    send({ type: 'done', ...(stat && { stat }) });
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
});

send({ type: 'ready' });
