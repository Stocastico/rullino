# Filerobot spike: can rullino be its filter engine?

Status: spike, 4 Nov 2026 (PLAN §6c, niche 1). Built the same day: `konvaFilter` in `@rullino/konva` (#155) and `examples/filerobot-looks`, which loads a rullino look by name from Filerobot's `loadableDesignState` and switches looks while the editor runs through `updateStateFnRef` (found in `useLoadMainSource.js`: it dispatches into the design state, so a filter function can be set from outside). Still open: the upstream request for custom filters in the Filters tab, which the maintainer opens.

## Why Filerobot

[Filerobot Image Editor](https://github.com/scaleflex/filerobot-image-editor) (Scaleflex, MIT) is the free, embeddable editor most web apps pick: `react-filerobot-image-editor` had **88 498 npm downloads in the last week** (4 Nov 2026), the vanilla `filerobot-image-editor` 6 830; for comparison Pintura (paid) 20 159, `@rullino/core` 1 540. It is built on Konva, which `@rullino/konva` already targets. Its colour tools are weak: Konva's built-in filters (Brighten, Contrast, HSV, Blur) and ~40 Instagram-style presets written as brightness / contrast / saturation sums on 8-bit pixels.

## What was read

`react-filerobot-image-editor@5.0.0-beta.159` (latest, June 2026; peer deps React 19, react-konva 19, styled-components; depends on `konva` 9.3.18), unpacked and read from `lib/`:

- **Finetunes** (Finetune tab) and the **filter** (Filters tab) are Konva filters, `(imageData) => void`, set on the image node and applied by `node.cache()`. The design state stores them **by name**: `finetunes: ['Brighten', …]` resolves through `Konva.Filters[name] || CustomFinetunes[name]` (`utils/finetunesStrsToClasses.js`), `filter: 'Clarendon'` through `CustomFilters[name] || Konva.Filters[name]` (`utils/filterStrToClass.js`).
- **The Filters tab's list is hard-coded**: `AVAILABLE_FILTERS` in `components/tools/Filters/Filters.constants.js` (label + filter function). The Finetune tab's tools are fixed React components. The config (`index.d.ts`) has `tabsIds`, `defaultTabId`, per-tool options, `loadableDesignState`, `onModify`, `onBeforeSave`, `getCurrentImgDataFnRef`, but **no way to add a tab, a tool or a filter to the list**.
- **Saving** (`hooks/useTransformedImgData.js`) clones the stage, sets `Konva.pixelRatio` to the saving ratio, calls `cache()` (filters run again, synchronously, at the output size) and reads `toCanvas()` / `toDataURL()`.

So anything rullino adds has to be a **synchronous** Konva filter, and the UI cannot list it without a change in Filerobot.

## What fits without touching Filerobot

1. **A synchronous Konva filter backed by the CPU fast path**: `konvaFilter(doc)` in `@rullino/konva` returning `(imageData) => void` (decode 8-bit sRGB, `applyEdit` on the CPU with `fast`, encode back). Registered as `Konva.Filters.RullinoNoir = konvaFilter(lookEdit(noir))`, Filerobot applies it when a design state names it (`loadableDesignState: { filter: 'RullinoNoir' }`) and when it saves. It works for **any Konva app** too (`node.filters([...])`, 4.1 M weekly downloads for `konva`), which `attachEdit` (async, swaps the image) does not cover.
   - Colour-only edits (looks, grades) can be baked once with `bakeLut` and applied as one trilinear lookup per pixel: the cheapest possible sync path.
   - Cost: it blocks the main thread. The fast path measured 0.35–0.43 s for 1 MP chains in a cloud container (PLAN §6b, #74); a baked LUT is a fraction of that. Preview in Filerobot runs at the shown size (well under 1 MP); the save runs at full size (seconds for a 12 MP photo with a heavy chain). Not measured on Filerobot itself yet.
   - Limits: geometry stays Filerobot's (crop / rotate / flip are its own adjustments); neighbourhood steps work but scale with the shown size (rullino's `scale` would have to follow `Konva.pixelRatio`, which the filter cannot see: px params would differ between preview and save). Restrict it to colour (pointwise / `perPixel`) steps at first.
2. **Rullino before or after Filerobot**: the app renders an edit document on the image Filerobot saves (`onSave` / `getCurrentImgDataFnRef`), or on the source before loading it. No integration needed, and no preview inside Filerobot: weak.

## What needs Filerobot to change

A config option for custom filters (e.g. `[TOOLS.FILTERS]: { filters: [{ label, filterFn }] }` merged into `AVAILABLE_FILTERS`), and ideally async filters or a custom tab. Small for the first (a list merge), large for the others. It is Scaleflex's call; an issue or PR on their repository speaks for the maintainer, so it is not opened from here.

## Proposal

- Build `konvaFilter(doc)` in `@rullino/konva` (colour steps only, `bakeLut` when the whole document is colour-only), with a Filerobot example that registers two or three rullino looks and loads one through `loadableDesignState`; measure preview and save times at 1 and 12 MP.
- The maintainer opens the upstream issue ("custom filters in the Filters tab") with that example as the motivation.
- Not yet: a fork or a wrapper of Filerobot's UI.
