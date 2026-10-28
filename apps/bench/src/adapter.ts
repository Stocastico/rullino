import type { ChainId, Variant } from './chains';
import type { Tables } from './tables';

/**
 * One library under test. Input and output are RGBA8 straight sRGB in memory for everyone, so
 * every timing includes getting the pixels back (a GPU readback, a WASM copy).
 */
export interface Adapter {
  readonly id: string;
  readonly label: string;
  /** Library version (from its package.json at build time). */
  readonly version: string;
  /** Where it runs: 'WebGPU', 'WebGL2', 'WASM', 'JS worker'... */
  readonly backend: string;
  /** How each chain maps onto the library, and what it cannot do (an honest "closest equivalent"). */
  readonly notes: Record<ChainId, string>;
  /** Load the library (WASM instantiation, GPU context). Timed as "init". */
  init(tables: Tables): Promise<void>;
  /** Hand it the source image (upload, copy into WASM memory). Timed as "load". */
  load(rgba: Uint8ClampedArray, width: number, height: number): Promise<void>;
  /** Render a chain variant on the loaded image; resolves with the result's RGBA8 pixels. */
  run(chain: ChainId, variant: Variant): Promise<ArrayLike<number>>;
  /** Releases everything (GPU devices, WASM images). */
  dispose(): Promise<void> | void;
}
