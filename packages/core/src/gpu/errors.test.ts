import { describe, expect, it } from 'vitest';
import { GpuError, ShaderCompileError, toGpuError } from './errors';

describe('GpuError', () => {
  it('maps the WebGPU error classes to a kind and keeps the message', () => {
    class GPUValidationError {
      constructor(readonly message: string) {}
    }
    class GPUOutOfMemoryError {
      constructor(readonly message: string) {}
    }
    class GPUInternalError {
      constructor(readonly message: string) {}
    }
    Object.assign(globalThis, { GPUValidationError, GPUOutOfMemoryError, GPUInternalError });
    expect(toGpuError(new GPUValidationError('bad bind group') as never)).toMatchObject({ name: 'GpuError', kind: 'validation', message: 'bad bind group' });
    expect(toGpuError(new GPUOutOfMemoryError('no memory') as never).kind).toBe('out-of-memory');
    expect(toGpuError(new GPUInternalError('oops') as never).kind).toBe('internal');
    expect(toGpuError(new GPUValidationError('x') as never)).toBeInstanceOf(GpuError);
  });
});

describe('ShaderCompileError', () => {
  const source = ['fn run() {', '  let x = 1.0;', '  return y;', '}'].join('\n');

  it('names the shader and lists each error with its line, column and source text', () => {
    const e = new ShaderCompileError(
      'rullino.pass:blur#3:h',
      [
        { type: 'warning', line: 2, column: 7, message: 'unused variable' },
        { type: 'error', line: 3, column: 10, message: "unresolved value 'y'" },
      ],
      source,
    );
    expect(e).toBeInstanceOf(GpuError);
    expect(e.name).toBe('ShaderCompileError');
    expect(e.kind).toBe('shader');
    expect(e.label).toBe('rullino.pass:blur#3:h');
    expect(e.message).toContain('rullino.pass:blur#3:h');
    expect(e.message).toContain("3:10 error: unresolved value 'y'");
    expect(e.message).toContain('  return y;');
    expect(e.message).not.toContain('unused variable'); // warnings are kept in `messages` only
    expect(e.messages).toHaveLength(2);
  });

  it('still says something useful without messages or source', () => {
    expect(new ShaderCompileError('k', [], undefined).message).toContain('"k" failed to compile');
  });
});
