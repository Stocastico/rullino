// Publishes docs/wiki/*.md to the GitHub wiki (a separate git repository, <repo>.wiki.git).
// Run from a maintainer's machine: Claude cloud sessions cannot push to the wiki repository.
// The wiki must have been initialised once from the web UI (create any first page), otherwise the clone fails.
//   node scripts/publish-wiki.mjs            clone, copy, commit, push
//   node scripts/publish-wiki.mjs --dry-run  clone, copy, show the diff, do not push
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const source = join(repo, 'docs', 'wiki');
const remote = process.env.RULLINO_WIKI_REMOTE ?? 'https://github.com/Stocastico/rullino.wiki.git';
const dryRun = process.argv.includes('--dry-run');

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

const dir = mkdtempSync(join(tmpdir(), 'rullino-wiki-'));
try {
  git(['clone', '--depth', '1', remote, dir]);
  const pages = readdirSync(source).filter((f) => f.endsWith('.md'));
  for (const page of pages) copyFileSync(join(source, page), join(dir, page));
  git(['add', '--all', '.'], dir);
  const status = git(['status', '--porcelain'], dir);
  if (!status.trim()) {
    console.log('Wiki already up to date.');
  } else if (dryRun) {
    console.log(git(['diff', '--cached', '--stat'], dir));
    console.log('Dry run: nothing pushed.');
  } else {
    const head = git(['rev-parse', '--short', 'HEAD'], repo).trim();
    git(['commit', '-m', `Sync from docs/wiki at ${head}`], dir);
    git(['push', 'origin', 'HEAD'], dir);
    console.log(`Published ${pages.length} pages: ${pages.join(', ')}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
