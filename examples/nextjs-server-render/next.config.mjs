// @rullino/node loads Dawn (webgpu), sharp and its own worker file at run time: keep all three out of the
// server bundle and let Node resolve them from node_modules.
export default {
  serverExternalPackages: ['@rullino/node', 'webgpu', 'sharp'],
};
