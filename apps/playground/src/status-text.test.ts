import { describe, expect, it } from 'vitest';
import { formatDuration, statusText } from './status-text';

const base = { backend: 'gpu', image: 'River 2048×1365', steps: 3, ms: 370 } as const;

describe('status text', () => {
  it('says where it rendered, in words, and how long it took', () => {
    expect(statusText(base)).toBe('On the GPU (WebGPU) · River 2048×1365 · 3 steps · 370 ms');
  });

  it('gives the reason when it fell back to the CPU', () => {
    expect(statusText({ ...base, backend: 'cpu', reason: 'no WebGPU adapter' })).toBe('On the CPU (no WebGPU adapter) · River 2048×1365 · 3 steps · 370 ms');
    expect(statusText({ ...base, backend: 'cpu' })).toContain('On the CPU (reference implementation)');
  });

  it('marks previews and the solo step, and singularises one step', () => {
    expect(statusText({ ...base, steps: 1, solo: true, preview: true })).toBe('On the GPU (WebGPU) · River 2048×1365 · 1 step · up to one step · preview · 370 ms');
  });

  it('shows seconds from one second on', () => {
    expect(formatDuration(0.04)).toBe('0 ms');
    expect(formatDuration(999.4)).toBe('999 ms');
    expect(formatDuration(1000)).toBe('1.00 s');
    expect(formatDuration(1234)).toBe('1.23 s');
  });
});
