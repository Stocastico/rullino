import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parseChain } from '@rullino/core';
import { filters } from '@rullino/filters';
import { lookEdit, looks, resolveLookLut } from '@rullino/presets';
import { createRenderer } from './renderer';

/** Where the CLI writes: injected so tests read what a user would see. */
export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const USAGE = `rullino: render an edit document onto photos (the server half of the playground's "Copy as code")

usage:
  rullino render (--edit <edit.json> | --look <id>) <photo or folder>... [options]
  rullino looks                      list the built-in looks

options:
  -o, --out <folder>     where the files go (default: ./rullino-out)
      --format <f>       png, jpeg or webp (default: the document's output, else png)
      --quality <0-1>    JPEG / WebP quality
      --long-side <px>   shrink so the long side is at most this (never enlarges)
      --backend <b>      auto (default), gpu or cpu
      --threads <n>      CPU worker threads: a number or "auto" (default 1)
  -h, --help

Folders are read without descending into sub-folders; only .jpg .jpeg .png .webp .avif .tif .tiff files are used.
JPEG / WebP and reading photos need the optional "sharp" package; the GPU needs "webgpu".`;

const IMAGE = /\.(jpe?g|png|webp|avif|tiff?)$/i;

class UsageError extends Error {}

const parse = (args: string[]) =>
  parseArgs({
    args,
    allowPositionals: true,
    options: {
      edit: { type: 'string' },
      look: { type: 'string' },
      out: { type: 'string', short: 'o' },
      format: { type: 'string' },
      quality: { type: 'string' },
      'long-side': { type: 'string' },
      backend: { type: 'string' },
      threads: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

/** Runs the CLI; the return value is the process exit code (0 ok, 1 a render failed, 2 bad usage). */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    const { values, positionals } = parse(argv);
    const [command, ...inputs] = positionals;
    if (values.help || command === undefined) {
      io.out(USAGE);
      return values.help ? 0 : 2;
    }
    if (command === 'looks') {
      for (const look of looks) io.out(look.id);
      return 0;
    }
    if (command !== 'render') throw new UsageError(`unknown command "${command}"`);
    return await render(values, inputs, io);
  } catch (e) {
    if (e instanceof UsageError || (e as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')) {
      io.err(`rullino: ${(e as Error).message}\nTry "rullino --help".`);
      return 2;
    }
    io.err(`rullino: ${(e as Error).message}`);
    return 1;
  }
}

function number(name: string, text: string | undefined, min: number, max: number): number | undefined {
  if (text === undefined) return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max) throw new UsageError(`--${name} must be a number from ${min} to ${max}, got "${text}"`);
  return n;
}

async function render(values: ReturnType<typeof parse>['values'], inputs: string[], io: CliIo): Promise<number> {
  if ((values.edit === undefined) === (values.look === undefined)) throw new UsageError('give the edit with --edit <file.json> or --look <id> (see "rullino looks"), one of them');
  const backend = values.backend ?? 'auto';
  if (backend !== 'auto' && backend !== 'gpu' && backend !== 'cpu') throw new UsageError(`--backend must be auto, gpu or cpu, got "${backend}"`);
  const threads = values.threads === undefined ? 1 : values.threads === 'auto' ? 'auto' : number('threads', values.threads, 1, 64)!;

  // The edit: a file, or a look by name; command-line output settings go on top of the document's.
  let edit: Record<string, unknown>;
  if (values.look !== undefined) {
    const look = looks.find((l) => l.id === values.look);
    if (!look) throw new UsageError(`no look "${values.look}" (see "rullino looks")`);
    edit = { ...lookEdit(look) };
  } else {
    try {
      edit = JSON.parse(await readFile(values.edit!, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`cannot read the edit document ${values.edit}: ${(e as Error).message}`);
    }
  }
  const quality = number('quality', values.quality, 0, 1);
  const longSide = number('long-side', values['long-side'], 1, 1e6);
  if (values.format !== undefined && !['png', 'jpeg', 'webp'].includes(values.format)) throw new UsageError(`--format must be png, jpeg or webp, got "${values.format}"`);
  edit = {
    ...edit,
    output: {
      ...(edit.output as object | undefined),
      ...(values.format !== undefined ? { format: values.format } : {}),
      ...(quality !== undefined ? { quality } : {}),
      ...(longSide !== undefined ? { longSide } : {}),
    },
  };
  if (Object.keys(edit.output as object).length === 0) delete edit.output;
  // Fail on a bad document once, before any file is read.
  parseChain(edit, { filters, resolveLut: resolveLookLut });

  const photos: string[] = [];
  for (const input of inputs) {
    const info = await stat(input).catch(() => undefined);
    if (!info) throw new UsageError(`${input}: no such file or folder`);
    if (info.isDirectory()) photos.push(...(await readdir(input)).filter((f) => IMAGE.test(f)).sort().map((f) => join(input, f)));
    else photos.push(input);
  }
  if (photos.length === 0) throw new UsageError('no input photos (give files or a folder with images in it)');

  const outDir = values.out ?? 'rullino-out';
  const renderer = await createRenderer({ backend, threads });
  try {
    io.out(`Rendering on ${renderer.backend === 'gpu' ? 'the GPU (Dawn)' : `the CPU${renderer.reason ? ` (${renderer.reason})` : ''}`}`);
    await mkdir(outDir, { recursive: true });
    const started = performance.now();
    const targets = new Map<string, string>(); // target path -> the photo that claimed it
    let failed = 0;
    let done = 0;
    for (const photo of photos) {
      try {
        const rendered = await renderer.render(await readFile(photo), edit);
        const target = join(outDir, `${basename(photo, extname(photo))}.${rendered.format === 'jpeg' ? 'jpg' : rendered.format}`);
        const resolved = resolve(target);
        if (photos.some((p) => resolve(p) === resolved)) throw new Error(`would overwrite the input ${target}: pick another folder with -o`);
        const other = targets.get(resolved);
        if (other) throw new Error(`${target} was already written for ${other}: two photos have the same name`);
        targets.set(resolved, photo);
        await writeFile(target, rendered.bytes);
        io.out(`${photo} -> ${target}`);
        done++;
      } catch (e) {
        failed++;
        io.err(`${photo}: ${(e as Error).message}`);
      }
    }
    io.out(`${done} photo${done === 1 ? '' : 's'} in ${((performance.now() - started) / 1000).toFixed(1)} s${failed ? `, ${failed} failed` : ''}`);
    return failed ? 1 : 0;
  } finally {
    renderer.destroy();
  }
}
