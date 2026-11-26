// The edit document a photo exported by rullino carries in its XMP (rullino:edit, #180), so the
// playground can offer to load it. @rullino/codecs is loaded on first use, outside the main chunk.

/** The document a photo carries, parsed; undefined for a photo without one or a file that is not an image. */
export async function recipeOf(file: Blob): Promise<unknown | undefined> {
  const { readMetadata, readXmpEdit } = await import('@rullino/codecs');
  try {
    const { xmp } = await readMetadata(new Uint8Array(await file.arrayBuffer()));
    const text = xmp === undefined ? undefined : readXmpEdit(xmp);
    return text === undefined ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}
