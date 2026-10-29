// "Copy as code": the current edit document, and the few lines that render it with each package.
// The snippets embed the document verbatim, so what runs in an app is exactly what the playground
// shows. code-export.test.ts runs the Node one as written.

export interface Snippet {
  readonly id: 'json' | 'web' | 'konva' | 'node';
  readonly label: string;
  /** The npm install line the snippet needs (empty for the bare document). */
  readonly install: string;
  readonly code: string;
}

export function codeSnippets(doc: unknown): Snippet[] {
  const json = JSON.stringify(doc, null, 2);
  const edit = `const edit = ${json};\n`;
  return [
    { id: 'json', label: 'Edit document', install: '', code: `${json}\n` },
    {
      id: 'web',
      label: 'Browser',
      install: 'npm install @rullino/web',
      code: `import { createRenderer } from '@rullino/web';

${edit}
const renderer = await createRenderer(); // WebGPU if available, else the CPU in a Web Worker

/** A File / Blob the browser can decode, or ImageData, rendered as the document's output says. */
export const render = (image) => renderer.render(image, edit);
`,
    },
    {
      id: 'konva',
      label: 'Konva',
      install: 'npm install @rullino/konva konva',
      code: `import { attachEdit } from '@rullino/konva';

${edit}
/** Shows the edit on a Konva.Image at its size on screen; returns the full-resolution export. */
export async function editNode(imageNode) {
  const editor = await attachEdit(imageNode);
  await editor.set(edit);
  return editor.export(edit);
}
`,
    },
    {
      id: 'node',
      label: 'Node',
      install: 'npm install @rullino/node webgpu sharp',
      code: `import { readFile, writeFile } from 'node:fs/promises';
import { createRenderer } from '@rullino/node';

${edit}
const renderer = await createRenderer(); // Dawn (webgpu) if available, else the CPU
const out = await renderer.render(await readFile('photo.jpg'), edit);
await writeFile('edited.' + out.format, out.bytes);
`,
    },
  ];
}
