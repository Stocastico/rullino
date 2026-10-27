import type { BrowserCommand } from 'vitest/node';
import type * as Core from '@rullino/core';
import type * as Node from '../src/index';

// A Vitest browser command (vitest.config.ts): runs in Node, renders edit documents with
// @rullino/node on Dawn and sends the linear results back to the browser test that compares them
// with Chromium's WebGPU (browser-vs-node.browser.test.ts). Never falls back to the CPU.
// The config is loaded by plain Node, which cannot import the TS sources: the packages are loaded
// through the project's Vite server instead.
let renderer: Promise<Node.Renderer> | undefined;

type Wire = { width: number; height: number; data: number[] };

export const renderOnDawn: BrowserCommand<[documents: unknown[], image: Wire]> = async (ctx, documents, image) => {
  const vite = ctx.project.vite;
  const node = (await vite.ssrLoadModule('/packages/node/src/index.ts')) as typeof Node;
  const core = (await vite.ssrLoadModule('/packages/core/src/index.ts')) as typeof Core;
  const r = await (renderer ??= node.createRenderer({ backend: 'gpu' }));
  const source = core.createImage(image.width, image.height, Float32Array.from(image.data));
  const out: Wire[] = [];
  for (const doc of documents) {
    const result = await r.apply(source, doc);
    out.push({ width: result.width, height: result.height, data: Array.from(result.data) });
  }
  return out;
};
