// @rullino/web starts its CPU worker with new URL('./worker.js', import.meta.url): Vite's dev server
// must not pre-bundle it (or @rullino/konva, which imports it), or the worker file is not found.
export default { optimizeDeps: { exclude: ['@rullino/konva', '@rullino/web'] } };
