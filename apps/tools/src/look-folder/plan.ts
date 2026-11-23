// What "Apply a look to a folder" renders: one edit document for every photo, from a built-in look
// at an intensity or from a document pasted by the user (made in the playground's Code dialog, say),
// with the page's output settings over the document's own.
import { migrateEdit, parseEdit, type EditDocument } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookEdit, looks, resolveLookLut } from '@rullino/presets';
import type { WebFormat } from '../names';

export interface LookFolderOptions {
  readonly source: { readonly look: string; readonly intensity: number } | { readonly document: string };
  readonly format: WebFormat;
  /** 0..1, JPEG and WebP only. */
  readonly quality?: number;
  /** Shrink to this long side (never enlarges); omitted keeps the document's own, if any. */
  readonly longSide?: number;
}

/** The document to render on every photo, checked. Throws a message meant for the person using the page. */
export function lookFolderEdit(o: LookFolderOptions): EditDocument {
  if (o.longSide !== undefined && !(Number.isInteger(o.longSide) && o.longSide > 0)) throw new RangeError(`the long side must be a whole number of pixels above 0, not ${o.longSide}`);
  let doc: EditDocument;
  if ('look' in o.source) {
    const { look: id, intensity } = o.source;
    const look = looks.find((l) => l.id === id);
    if (!look) throw new Error(`unknown look "${id}"`);
    doc = lookEdit(look, { intensity });
  } else {
    let json: unknown;
    try {
      json = JSON.parse(o.source.document);
    } catch (e) {
      throw new Error(`the pasted document is not JSON: ${(e as Error).message}`);
    }
    doc = migrateEdit(json);
  }
  const graph = parseEdit(doc, { filters, resolveLut: resolveLookLut });
  if (graph.inputs.length !== 1) throw new Error(`the document reads ${graph.inputs.length} photos (${graph.inputs.join(', ')}); this page gives it one`);
  const longSide = o.longSide ?? doc.output?.longSide;
  return {
    ...doc,
    output: {
      ...(doc.output?.node !== undefined && { node: doc.output.node }),
      ...(longSide !== undefined && { longSide }),
      format: o.format,
      ...(o.format !== 'png' && o.quality !== undefined && { quality: o.quality }),
    },
  };
}

const PHOTO = /\.(jpe?g|png|webp|avif|gif|bmp)$/i;

/** Whether a file from a folder is a photo the browser can decode (by type, else by extension). */
export const isPhoto = (f: { readonly name: string; readonly type: string }) => f.type.startsWith('image/') || PHOTO.test(f.name);
