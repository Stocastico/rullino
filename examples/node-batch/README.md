# Node batch render

Renders one [edit document](../../packages/core/edit.schema.json) onto every photo in a folder with `@rullino/node`: about 25 lines in `batch.mjs`.

```sh
npm install
node batch.mjs edit.json /path/to/photos out
```

- `edit.json` is plain JSON: the same document the browser previews. Copy one from the playground's **Code** button, or write it with `serializeChain` / `lookEdit`. Its `output` decides the format, quality and long side (here JPEG, 1600 px).
- `createRenderer()` renders on the GPU through Dawn when the `webgpu` package is installed, otherwise on the CPU; the script prints which. On a Linux server without a GPU, Dawn needs a Vulkan driver: `apt install mesa-vulkan-drivers`.
- `sharp` reads the files (EXIF orientation applied) and writes JPEG / WebP. PNG output and RGBA input need neither.

CI runs this script against the packed packages (`pnpm test:pack`, on the CPU) and checks the files it writes.
