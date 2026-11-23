// File names of exported photos, shared by the tools.

export type WebFormat = 'jpeg' | 'webp' | 'png';

const EXTENSIONS: Record<WebFormat, string> = { jpeg: 'jpg', webp: 'webp', png: 'png' };

/**
 * The name of a photo's export: its own name with the format's extension, made unique among `taken`
 * (compared without case, as on macOS and Windows), which it updates.
 */
export function outputName(input: string, format: WebFormat, taken: Set<string>): string {
  const dot = input.lastIndexOf('.');
  const stem = dot > 0 ? input.slice(0, dot) : input;
  const ext = EXTENSIONS[format];
  for (let n = 1; ; n++) {
    const name = `${stem}${n === 1 ? '' : `-${n}`}.${ext}`;
    if (!taken.has(name.toLowerCase())) {
      taken.add(name.toLowerCase());
      return name;
    }
  }
}
