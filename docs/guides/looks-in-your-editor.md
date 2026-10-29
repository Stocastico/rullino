# Looks in your editor

Goal: offer film-style looks (or your own `.cube` LUTs) in an existing editor, as edits that stay adjustable and can be rendered anywhere.

```sh
npm install @rullino/presets @rullino/filters @rullino/core
```

## 1. The looks

`looks` lists ten looks. Each one is a recipe of ordinary filters: a colour grade baked once into a 33³ LUT, plus vignette and grain. `intensity` scales all of it together (0 = no effect, 1 = as designed).

```ts
import { looks } from '@rullino/presets';

for (const look of looks) console.log(`${look.id}: ${look.label}: ${look.description}`);
```

## 2. As an edit document

`lookEdit` gives a complete document. The LUT travels by name (`look:<id>`), so the document is small JSON that fits in a link or a database row.

```ts
import { lookEdit, looks } from '@rullino/presets';

const pick = looks[0]!;
export const doc = lookEdit(pick, { intensity: 0.8 });
console.log(JSON.stringify(doc));
```

Renderers resolve `look:<id>` by default: `createRenderer()` of `@rullino/web` and `@rullino/node` render the document as it is.

## 3. Combined with your own steps

`lookSteps` gives the look as plain chain steps, so it combines with anything else. Pass `lutRef: lookLutRef` when you save the chain, and `resolveLut: resolveLookLut` when you read it back without a renderer.

```ts
import { applyEdit, parseChain, serializeChain, type LinearImage } from '@rullino/core';
import { exposure, filters } from '@rullino/filters';
import { lookLutRef, lookSteps, looks, resolveLookLut } from '@rullino/presets';

const steps = [{ filter: exposure, params: { ev: 0.3 } }, ...lookSteps(looks[0]!, { intensity: 0.8 })];
export const saved = JSON.stringify(serializeChain(steps, { lutRef: lookLutRef }));

export async function render(image: LinearImage): Promise<LinearImage> {
  return applyEdit(image, JSON.parse(saved), { filters, resolveLut: resolveLookLut });
}

export const restored = parseChain(JSON.parse(saved), { filters, resolveLut: resolveLookLut }).steps; // editable steps again
```

In an editor, show the look's steps as ordinary effects: the user can then change the grade's strength, the vignette or the grain separately. The playground's look gallery does exactly this.

## 4. Your own `.cube` or Hald LUT

The `applyLut` filter takes a LUT file; `parseCube` and `parseHald` read the formats colour graders export. A LUT cannot travel inside a document (a 33³ table is 430 KB), so give it a name and resolve that name when the document is read.

```ts
import { applyEdit, parseCube, serializeChain, type LinearImage, type Lut } from '@rullino/core';
import { applyLut, filters } from '@rullino/filters';

export async function renderWithMyLut(image: LinearImage, cubeText: string): Promise<LinearImage> {
  const lut = parseCube(cubeText);
  const luts = new Map<string, Lut>([['my-lut', lut]]);
  const doc = serializeChain([{ filter: applyLut, params: { look: lut, intensity: 0.7 } }], { lutRef: (l) => (l === lut ? 'my-lut' : undefined) });
  return applyEdit(image, doc, { filters, resolveLut: (ref) => luts.get(ref) });
}
```

`intensity` blends the LUT with the original in sRGB-encoded units, as `.cube` files expect. Whoever renders the document (a server, a worker) must be able to resolve `my-lut` too: pass the same `resolveLut` to `createRenderer`.

## Next

- [Preview and export in the browser](./preview-and-export.md), [the same edit on the server](./same-edit-on-the-server.md).
- [`@rullino/presets` README](../../packages/presets/README.md).
