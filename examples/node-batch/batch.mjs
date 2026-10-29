// Renders one edit document onto every photo in a folder with @rullino/node: the server half of
// "describe the edit once as JSON, preview it in the browser, render the files on the server".
// usage: node batch.mjs <edit.json> <input folder> <output folder>
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createRenderer } from '@rullino/node';

const [editFile, inputDir, outputDir] = process.argv.slice(2);
if (!outputDir) {
  console.error('usage: node batch.mjs <edit.json> <input folder> <output folder>');
  process.exit(2);
}

const edit = JSON.parse(await readFile(editFile, 'utf8')); // from the playground's Code button, serializeChain() or lookEdit()
const renderer = await createRenderer(); // Dawn (GPU) if the webgpu package is installed, else the CPU
console.log(`Rendering on ${renderer.backend === 'gpu' ? 'the GPU (Dawn)' : `the CPU (${renderer.reason})`}`);

await mkdir(outputDir, { recursive: true });
const photos = (await readdir(inputDir)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const started = performance.now();
for (const file of photos) {
  const { bytes, format } = await renderer.render(await readFile(join(inputDir, file)), edit);
  const target = join(outputDir, `${basename(file, extname(file))}.${format === 'jpeg' ? 'jpg' : format}`);
  await writeFile(target, bytes);
  console.log(`${file} -> ${target}`);
}
console.log(`${photos.length} photos in ${((performance.now() - started) / 1000).toFixed(1)} s`);
