import { defineConfig } from 'vite';

// Relative base: the page is served at …/rullino/check/ (next to the playground) or anywhere else.
// The band workers of @rullino/web are ES modules, so nothing else is needed.
export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['@rullino/web'] },
  worker: { format: 'es' },
});
