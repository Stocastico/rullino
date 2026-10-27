import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The header shows the version being demoed and the matching install line (prereleases are on
// the `next` dist-tag), filled in at build time from the core package.
const { version } = JSON.parse(readFileSync(new URL('../../packages/core/package.json', import.meta.url), 'utf8')) as { version: string };
const tag = version.includes('-') ? '@next' : '';

export default defineConfig({
  // Relative base so the build works from any path (e.g. GitHub Pages project site).
  base: './',
  plugins: [
    {
      name: 'rullino-version',
      transformIndexHtml: (html) =>
        html.replaceAll('%RULLINO_VERSION%', `v${version}`).replaceAll('%RULLINO_INSTALL%', `npm install @rullino/core${tag} @rullino/filters${tag}`),
    },
  ],
});
