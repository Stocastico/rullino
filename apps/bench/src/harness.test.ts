import { describe, expect, it } from 'vitest';
import type { Adapter } from './adapter';
import { CHAIN_IDS } from './chains';
import { runBench } from './harness';

const tables = { curve256: new Uint8Array(256), colorMap: new Uint8Array(4), colorMapSize: 1 };

/** A fake library: output = input + offset (per chain), each call advances a fake clock by `cost` ms. */
function fake(id: string, offset: number, clock: { t: number }, cost = 1, calls: string[] = []): Adapter {
  let img: Uint8ClampedArray | undefined;
  const tick = () => (clock.t += cost);
  return {
    id, label: id, version: '1', backend: 'test',
    notes: { 'exposure-curves-lut': 'a', 'blur-unsharp': 'b', 'levels-vignette-grain': 'c' },
    async init() { tick(); calls.push(`${id}:init`); },
    async load(rgba) { tick(); img = rgba; calls.push(`${id}:load:${rgba.length}`); },
    async run(chain, variant) { tick(); calls.push(`${id}:${chain}:${variant}`); return img!.map((v, i) => (i % 4 === 3 ? v : v + offset)); },
    dispose() { calls.push(`${id}:dispose`); },
  };
}

describe('runBench', () => {
  it('times init, load, the first run and alternating changes per adapter, size and chain', async () => {
    const clock = { t: 0 };
    const calls: string[] = [];
    const res = await runBench({ sizes: [[8, 4]], runs: 3, adapters: [fake('ref', 0, clock, 1, calls)], tables, now: () => clock.t });
    expect(res.rows).toHaveLength(3);
    const row = res.rows[0]!;
    expect(row).toMatchObject({ adapter: 'ref', size: '8x4', chain: 'exposure-curves-lut', initMs: 1, loadMs: 1, firstMs: 1, note: 'a' });
    expect(row.change).toEqual({ median: 1, min: 1, max: 1, runs: 3 });
    // First run on variant 0, then the changes alternate 1, 0, 1; disposed at the end of the size.
    expect(calls.slice(0, 6)).toEqual(['ref:init', 'ref:load:128', 'ref:exposure-curves-lut:0', 'ref:exposure-curves-lut:1', 'ref:exposure-curves-lut:0', 'ref:exposure-curves-lut:1']);
    expect(calls.at(-1)).toBe('ref:dispose');
    expect(res.rows.map((r) => r.chain)).toEqual([...CHAIN_IDS]);
  });

  it('compares every adapter with the first one (rullino) on the first run', async () => {
    const clock = { t: 0 };
    const res = await runBench({ sizes: [[8, 4]], runs: 1, adapters: [fake('ref', 0, clock), fake('other', 6, clock)], tables, now: () => clock.t });
    expect(res.rows.filter((r) => r.adapter === 'ref').every((r) => r.diffVsReference === 0)).toBe(true);
    expect(res.rows.filter((r) => r.adapter === 'other').every((r) => r.diffVsReference === 6)).toBe(true);
  });

  it('a failing library is reported and the others still run', async () => {
    const clock = { t: 0 };
    const broken = { ...fake('broken', 0, clock), init: async () => { throw new Error('no SharedArrayBuffer'); } };
    const res = await runBench({ sizes: [[8, 4]], runs: 1, adapters: [fake('ref', 0, clock), broken, fake('ok', 1, clock)], tables, now: () => clock.t });
    expect(res.rows.filter((r) => r.adapter === 'broken')).toEqual([expect.objectContaining({ error: 'no SharedArrayBuffer' })]);
    expect(res.rows.filter((r) => r.adapter === 'ok')).toHaveLength(3);
  });

  it('a memory probe that throws loses only the memory figure', async () => {
    const clock = { t: 0 };
    const res = await runBench({ sizes: [[8, 4]], runs: 1, adapters: [fake('ref', 0, clock)], tables, now: () => clock.t, memory: async () => { throw new Error('not available'); } });
    expect(res.rows).toHaveLength(3);
    expect(res.rows.every((r) => r.error === undefined && r.memoryBytes === undefined)).toBe(true);
  });

  it('records memory after each adapter and size when a probe is given, and reports progress', async () => {
    const clock = { t: 0 };
    const log: string[] = [];
    const res = await runBench({ sizes: [[8, 4], [4, 2]], runs: 1, adapters: [fake('ref', 0, clock)], tables, now: () => clock.t, memory: async () => 42e6, log: (m) => log.push(m) });
    expect(res.rows.map((r) => [r.size, r.memoryBytes])).toEqual([['8x4', 42e6], ['8x4', 42e6], ['8x4', 42e6], ['4x2', 42e6], ['4x2', 42e6], ['4x2', 42e6]]);
    expect(log.some((m) => m.includes('ref') && m.includes('8x4'))).toBe(true);
  });
});
