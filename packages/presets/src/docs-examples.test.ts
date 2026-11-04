import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyEdit, createImage, parseChain } from '@rullino/core';
import { filters } from '@rullino/filters';
import { describe, expect, it } from 'vitest';
import { resolveLookLut } from './looks';


// Every ```json block of the edit-document reference is a complete document: it must parse, and render.
const doc = fileURLToPath(new URL('../../../docs/edit-document.md', import.meta.url));
const blocks = [...readFileSync(doc, 'utf8').matchAll(/^```json\n([\s\S]*?)^```$/gm)].map((m) => m[1]!);

describe('docs/edit-document.md', () => {
  it('has examples', () => expect(blocks.length).toBeGreaterThanOrEqual(5));
  blocks.forEach((json, i) => {
    it(`example ${i + 1} parses and renders`, async () => {
      const edit = JSON.parse(json);
      parseChain(edit, { filters, resolveLut: resolveLookLut });
      const image = createImage(8, 6);
      for (let p = 0; p < 48; p++) image.data.set([0.2, 0.4, 0.6, 1], p * 4);
      const out = await applyEdit(image, edit, { filters, resolveLut: resolveLookLut });
      expect(out.width).toBeGreaterThan(0);
    });
  });
});
