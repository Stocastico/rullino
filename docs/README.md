# Documentation

**New here?** [Getting started](./getting-started.md) takes you from `npm install` to a rendered edit in the browser, in Node or on a Konva canvas. [Concepts](./concepts.md) explains, in one page, the ideas the rest assumes.

| Page | For |
|---|---|
| [Getting started](./getting-started.md) | Choosing a package and rendering your first edit |
| [Concepts](./concepts.md) | Edit documents, the two implementations of every filter, what "the same" means, colour, `scale` |
| [The edit document](./edit-document.md) | The JSON format: steps, parameters, masks, geometry, output, errors, versioning |
| [Troubleshooting](./troubleshooting.md) | CPU instead of GPU, workers that do not load, black images, preview and export differences, Node setup |
| [Filter reference](./filters.md) | All 51 filters with parameters, ranges and defaults (generated) |
| [Parity table](./parity.md) | How far GPU and CPU may differ, per filter (generated) |

**Guides by job**: [preview and export in the browser](./guides/preview-and-export.md) · [the same edit on the server](./guides/same-edit-on-the-server.md) · [looks and LUTs in your editor](./guides/looks-in-your-editor.md) · [remove an object on-device](./guides/remove-an-object.md) · [migrating from glfx.js and tui.image-editor](./guides/migrating-from-glfx-and-tui.md).

**Design notes** (proposals argued before they were built): [tiled CPU execution](./design/tiled-cpu.md), [Filerobot](./design/filerobot.md).

The API reference is generated from the sources: <https://stefanomasneri.com/rullino/docs/>. Package READMEs: [core](../packages/core/README.md), [filters](../packages/filters/README.md), [presets](../packages/presets/README.md), [ml](../packages/ml/README.md), [node](../packages/node/README.md), [web](../packages/web/README.md), [konva](../packages/konva/README.md).
