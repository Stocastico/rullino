import type { Adapter } from './adapter';
import { CHAIN_IDS, type ChainId, type Variant } from './chains';
import { testImage } from './image';
import { meanAbsDiff, summarise, type Summary } from './stats';
import type { Tables } from './tables';

export interface BenchOptions {
  /** Image sizes, [width, height]. */
  readonly sizes: readonly (readonly [number, number])[];
  /** Number of timed changes per chain (after the first run). */
  readonly runs: number;
  /** The first adapter is the reference the others are compared with (rullino). */
  readonly adapters: readonly Adapter[];
  readonly tables: Tables;
  /** The source image at a size; default `testImage`. */
  readonly image?: ((width: number, height: number) => Uint8ClampedArray) | undefined;
  readonly now?: (() => number) | undefined;
  /** Bytes in use (JS heap, WASM memory...), measured after each adapter's chains at a size. */
  readonly memory?: (() => Promise<number | undefined>) | undefined;
  readonly log?: ((message: string) => void) | undefined;
}

export interface BenchRow {
  readonly adapter: string;
  readonly label: string;
  readonly version: string;
  readonly backend: string;
  readonly size: string;
  readonly chain?: ChainId;
  readonly note?: string;
  readonly initMs?: number;
  readonly loadMs?: number;
  /** The first run of the chain at this size: shader compilation, warm-up and readback included. */
  readonly firstMs?: number;
  /** Re-running after a one-parameter change, readback included. */
  readonly change?: Summary;
  /** Mean |Δ| of the colour channels against the reference adapter's first run, 8-bit units. */
  readonly diffVsReference?: number;
  readonly memoryBytes?: number;
  readonly error?: string;
}

export interface BenchResults {
  readonly rows: BenchRow[];
}

/** About 250 000 pixels, evenly spread: enough for the comparison, small enough to keep per chain. */
function sample(rgba: ArrayLike<number>): Uint8Array {
  const pixels = rgba.length / 4;
  const stride = Math.max(1, Math.floor(pixels / 250_000));
  const out = new Uint8Array(Math.ceil(pixels / stride) * 4);
  for (let p = 0, o = 0; p < pixels; p += stride, o += 4) for (let c = 0; c < 4; c++) out[o + c] = rgba[p * 4 + c]!;
  return out;
}

export async function runBench(options: BenchOptions): Promise<BenchResults> {
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? (() => {});
  const rows: BenchRow[] = [];
  const time = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
    const t0 = now();
    const value = await f();
    return [value, now() - t0];
  };

  for (const [width, height] of options.sizes) {
    const size = `${width}x${height}`;
    const source = (options.image ?? testImage)(width, height);
    const reference = new Map<ChainId, Uint8Array>();
    for (const [index, a] of options.adapters.entries()) {
      const base = { adapter: a.id, label: a.label, version: a.version, backend: a.backend, size };
      log(`${a.label} at ${size}…`);
      try {
        const [, initMs] = await time(() => a.init(options.tables));
        const [, loadMs] = await time(() => a.load(source, width, height));
        const done: BenchRow[] = [];
        for (const chain of CHAIN_IDS) {
          const [first, firstMs] = await time(() => a.run(chain, 0));
          const sampled = sample(first);
          if (index === 0) reference.set(chain, sampled);
          const ref = reference.get(chain);
          const changes: number[] = [];
          for (let i = 0; i < options.runs; i++) changes.push((await time(() => a.run(chain, ((i + 1) % 2) as Variant)))[1]);
          const change = summarise(changes);
          log(`  ${chain}: first ${firstMs.toFixed(0)} ms, change ${change.median.toFixed(0)} ms`);
          done.push({ ...base, chain, note: a.notes[chain], initMs, loadMs, firstMs, change, ...(ref ? { diffVsReference: meanAbsDiff(sampled, ref) } : {}) });
        }
        // A probe that fails (an API the browser lacks) loses the figure, not the timings.
        const memoryBytes = await options.memory?.().catch(() => undefined);
        rows.push(...done.map((r) => (memoryBytes === undefined ? r : { ...r, memoryBytes })));
      } catch (e) {
        log(`  failed: ${(e as Error).message}`);
        rows.push({ ...base, error: (e as Error).message });
      } finally {
        await a.dispose();
      }
    }
  }
  return { rows };
}
