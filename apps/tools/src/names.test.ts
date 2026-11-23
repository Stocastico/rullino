import { describe, expect, it } from 'vitest';
import { outputName } from './names';

describe('outputName', () => {
  it('keeps the name and gives it the extension of the format', () => {
    const taken = new Set<string>();
    expect(outputName('IMG_0001.HEIC', 'jpeg', taken)).toBe('IMG_0001.jpg');
    expect(outputName('beach.png', 'webp', taken)).toBe('beach.webp');
    expect(outputName('no-extension', 'png', taken)).toBe('no-extension.png');
  });

  it('never gives two photos the same name', () => {
    const taken = new Set<string>();
    expect(outputName('a.jpg', 'jpeg', taken)).toBe('a.jpg');
    expect(outputName('a.png', 'jpeg', taken)).toBe('a-2.jpg');
    expect(outputName('a.jpeg', 'jpeg', taken)).toBe('a-3.jpg');
    expect(outputName('A.jpg', 'jpeg', taken)).toBe('A-4.jpg'); // a.jpg, a-2.jpg and a-3.jpg are taken without case (macOS, Windows)
  });
});
