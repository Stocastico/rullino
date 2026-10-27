import type { Lut } from '@rullino/core';

/** A linear image as it crosses the worker boundary (its buffer is transferred). */
export interface ImageMessage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
}

/** Main thread -> worker: render `edit` on `image`. LUT names are resolved on the main thread. */
export interface RenderRequest {
  readonly id: number;
  readonly image: ImageMessage;
  readonly edit: unknown;
  readonly luts: Readonly<Record<string, Lut>>;
  readonly scale: number | undefined;
}

/** Worker -> main thread: the result, or the error's message. */
export type RenderResponse = { readonly id: number; readonly image: ImageMessage } | { readonly id: number; readonly error: string };
