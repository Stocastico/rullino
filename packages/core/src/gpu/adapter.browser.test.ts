import { expect, it } from 'vitest';

// Environment guard. CI runners have no GPU, so Chromium must fall back to a software
// adapter (SwiftShader). If that ever stops working this must fail loudly: a parity
// test that skips without a GPU is indistinguishable from a deleted test.
it('WebGPU exposes a non-null adapter', async () => {
  expect(navigator.gpu, 'navigator.gpu is missing (flag or secure context?)').toBeDefined();
  const adapter = await navigator.gpu.requestAdapter();
  expect(adapter, 'requestAdapter() returned null').not.toBeNull();
  console.info('WebGPU adapter:', JSON.stringify(adapter!.info), adapter!.info.isFallbackAdapter ? '(fallback)' : '');
});
