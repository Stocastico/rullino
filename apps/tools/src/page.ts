// Pieces every tool page uses: what to say about where the work ran, decoding a photo the browser
// can open, and handing results back as one file or a zip.
import { zipStore } from './zip';

/** "on this device's GPU" or "… CPU (why)", for a renderer's `backend` and `reason`. */
export function whereItRan(r: { readonly backend: 'gpu' | 'cpu'; readonly reason?: string | undefined }): string {
  return r.backend === 'gpu' ? 'on this device’s GPU' : `on this device’s CPU (${r.reason ?? 'no WebGPU'})`;
}

export interface OutputFile {
  readonly name: string;
  readonly data: Uint8Array;
}

/** One file as itself, several as a store-only zip named `zipName`. */
export function bundle(files: readonly OutputFile[], zipName: string): { readonly name: string; readonly blob: Blob } {
  if (files.length === 0) throw new Error('nothing to download');
  if (files.length === 1) return { name: files[0]!.name, blob: new Blob([files[0]!.data as BlobPart]) };
  return { name: zipName, blob: new Blob([zipStore(files) as BlobPart], { type: 'application/zip' }) };
}

/** A photo as 8-bit pixels. createImageBitmap applies the EXIF orientation, so portraits stay upright. */
export async function decodeFile(file: Blob): Promise<ImageData> {
  const bitmap = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0);
  bitmap.close();
  return g.getImageData(0, 0, canvas.width, canvas.height);
}

export const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** A download link (id `download`) for `files`, replacing the previous one in `into`. Revokes the old URL. */
export function downloadLink(into: HTMLElement, files: readonly OutputFile[], zipName: string, label?: string): HTMLAnchorElement {
  const { name, blob } = bundle(files, zipName);
  const old = into.querySelector<HTMLAnchorElement>('#download');
  if (old) {
    URL.revokeObjectURL(old.href);
    old.remove();
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.id = 'download';
  a.className = 'download';
  a.textContent = label ?? (files.length === 1 ? `Download ${name}` : `Download ${files.length} files (zip, ${kb(blob.size)})`);
  into.append(a);
  return a;
}

/** The pixels of an image as a canvas element, scaled down to fit `maxSide` (previews). */
export function previewCanvas(img: ImageData, maxSide = 360): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const full = new OffscreenCanvas(img.width, img.height);
  full.getContext('2d')!.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k));
  c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d')!.drawImage(full, 0, 0, c.width, c.height);
  return c;
}
