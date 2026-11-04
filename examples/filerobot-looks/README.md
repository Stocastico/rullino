# Filerobot Image Editor with rullino looks

[Filerobot Image Editor](https://github.com/scaleflex/filerobot-image-editor) (MIT, React + Konva) with colour looks from rullino: Noir and Teal & orange from the built-in looks, and a "Punchy" grade written as three steps. One file (`main.js`, about 40 lines, no JSX).

```sh
npm install
npm run dev
```

(Needs `@rullino/konva` 0.7.0 or later, the first version with `konvaFilter`.)

- Filerobot applies **Konva filters, looked up by name** in `Konva.Filters`, and saves a design as a state that names its filter (`filter: 'RullinoNoir'`). `konvaFilter(doc)` from `@rullino/konva` turns an [edit document](../../docs/edit-document.md) into such a filter, so registering one is a line: `Konva.Filters.RullinoNoir = konvaFilter(doc)`.
- The editor starts with Noir because its `loadableDesignState` says `filter: 'RullinoNoir'`. The buttons above it switch looks while it runs with `updateStateFnRef.current({ filter })`.
- Filerobot's own Filters tab lists only its built-in filters: its list is hard-coded, and there is no option to add to it yet. That is why the buttons are outside the editor (see [the spike](../../docs/design/filerobot.md)).
- Only **colour** edits work as a Konva filter (exposure, curves, saturation, LUTs, looks): Konva filters are synchronous, so `konvaFilter` bakes the document into a colour LUT and refuses blurs, vignettes, masks and crops. About 45 ms per megapixel; Filerobot runs the filter again at the saving size, which is why the example sets `savingPixelRatio: 1`.
- `konva` is pinned to the version Filerobot depends on (9.3.18): the filter must be registered in the same copy of Konva that Filerobot uses.

CI builds this example against the packed packages and switches looks in it (`pnpm test:pack`). Photo: see `NOTICE.md`.
