// The few file commands package scripts need, in Node so they run on Windows too (cmd has no rm, cp or cat):
//   node scripts/fs.mjs rm <path>...      remove files or folders, recursively, ignoring missing ones
//   node scripts/fs.mjs cp <from> <to>    copy a file
//   node scripts/fs.mjs cat <file>        print a file
import { copyFileSync, readFileSync, rmSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
if (command === 'rm' && args.length > 0) {
  for (const path of args) rmSync(path, { recursive: true, force: true });
} else if (command === 'cp' && args.length === 2) {
  copyFileSync(args[0], args[1]);
} else if (command === 'cat' && args.length === 1) {
  process.stdout.write(readFileSync(args[0]));
} else {
  console.error('usage: node scripts/fs.mjs rm <path>... | cp <from> <to> | cat <file>');
  process.exit(2);
}
