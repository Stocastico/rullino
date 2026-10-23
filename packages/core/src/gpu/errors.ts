// GPU errors the library can attribute, as ordinary Error subclasses. WebGPU reports most mistakes
// asynchronously (a failed pipeline simply produces an all-zero image), so these reach the
// `onError` callback of `createGpuContext`, or `console.error` when there is none.

export type GpuErrorKind = 'validation' | 'out-of-memory' | 'internal' | 'shader';

export class GpuError extends Error {
  override name = 'GpuError';
  constructor(
    message: string,
    readonly kind: GpuErrorKind,
  ) {
    super(message);
  }
}

/** One message of the WGSL compiler. */
export interface ShaderMessage {
  readonly type: 'error' | 'warning' | 'info';
  /** 1-based. */
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export class ShaderCompileError extends GpuError {
  override name = 'ShaderCompileError';
  constructor(
    /** The shader's key: filter id, object key and pass name (`rullino.pass:gaussianBlur#3:h`). */
    readonly label: string,
    /** Every compiler message, warnings included. */
    readonly messages: readonly ShaderMessage[],
    source: string | undefined,
  ) {
    const lines = source?.split('\n') ?? [];
    const errors = messages.filter((m) => m.type === 'error');
    const detail = errors.map((m) => `  ${m.line}:${m.column} error: ${m.message}${lines[m.line - 1] === undefined ? '' : `\n  ${lines[m.line - 1]}`}`).join('\n');
    super(`shader "${label}" failed to compile${detail ? `:\n${detail}` : ''}`, 'shader');
  }
}

/** A WebGPU error object as a {@link GpuError}. */
export function toGpuError(e: GPUError): GpuError {
  const is = (name: 'GPUValidationError' | 'GPUOutOfMemoryError' | 'GPUInternalError') => typeof globalThis[name] === 'function' && e instanceof globalThis[name];
  return new GpuError(e.message, is('GPUOutOfMemoryError') ? 'out-of-memory' : is('GPUInternalError') ? 'internal' : 'validation');
}
