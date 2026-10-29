import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeSnippets } from './code-export';

const doc = { version: 2, steps: [{ filter: 'exposure', params: { ev: 0.5 } }], output: { format: 'png' } };

describe('codeSnippets', () => {
  it('gives the document as JSON and as code for the browser, Konva and Node', () => {
    const snippets = codeSnippets(doc);
    expect(snippets.map((s) => s.id)).toEqual(['json', 'web', 'konva', 'node']);
    expect(JSON.parse(snippets[0]!.code)).toEqual(doc);
    for (const [id, pkg] of [['web', '@rullino/web'], ['konva', '@rullino/konva'], ['node', '@rullino/node']] as const) {
      const s = snippets.find((x) => x.id === id)!;
      expect(s.code).toContain(`from '${pkg}'`);
      expect(s.install).toContain(pkg);
      // The document is embedded verbatim: evaluating the literal gives it back.
      const literal = s.code.slice(s.code.indexOf('const edit = ') + 'const edit = '.length, s.code.indexOf(';\n', s.code.indexOf('const edit = ')));
      expect(JSON.parse(literal)).toEqual(doc);
    }
  });

  it('the Node snippet runs as written on @rullino/node and writes the file the document asks for', { timeout: 60_000 }, async () => {
    const node = codeSnippets(doc).find((s) => s.id === 'node')!.code;
    // Inside the playground (not its node_modules, which Vitest would not transform), so that
    // '@rullino/node' resolves through the playground's dependencies, as in an app.
    const dir = mkdtempSync(join(process.cwd(), 'apps/playground/.snippet-'));
    try {
      // The snippet's only placeholders are the two file names.
      const photo = join(process.cwd(), 'apps/playground/public/samples/river.jpg');
      const out = join(dir, 'edited');
      const file = join(dir, 'snippet.mjs');
      writeFileSync(file, node.replace("'photo.jpg'", JSON.stringify(photo)).replace("'edited.'", JSON.stringify(`${out}.`)));
      await import(/* @vite-ignore */ pathToFileURL(file).href);
      const png = readFileSync(`${out}.png`);
      expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
