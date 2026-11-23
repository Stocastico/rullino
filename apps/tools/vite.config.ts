import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// One page per tool, served at …/rullino/tools/ next to the playground; relative base so it works
// under any sub-path. The band workers of @rullino/web are ES modules.
export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['@rullino/web'] },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'web-export': fileURLToPath(new URL('./web-export/index.html', import.meta.url)),
        'look-folder': fileURLToPath(new URL('./look-folder/index.html', import.meta.url)),
        'lut-maker': fileURLToPath(new URL('./lut-maker/index.html', import.meta.url)),
      },
    },
  },
});
