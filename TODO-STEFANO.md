# TODO Stefano

Things only the maintainer can do before going public. Delete the file when it is empty (it is a working list, not documentation). Written 4 Nov 2026; the plan behind it is "Before going public" in [PLAN.md](./PLAN.md).

## 1. Test on real hardware (the "within the published tolerance" claim)

The tolerances are verified on software GPUs and one RTX 40 (Windows, Chrome). Needed: one run per machine/browser below. **Nothing to install**: open **https://stefanomasneri.com/rullino/check/** (live after the PR with the page is merged and the Pages deploy has run), press the three buttons in order (device is described on load; "Run the parity check", about a minute; "Run the speed check"), then **Copy the report** (or **Download as a file** if copying fails) and paste it as a comment on a new issue "Parity on real GPUs", with the machine's name and macOS version. Claude then decides per filter, as for the RTX.

- [ ] **Mac M1**: Chrome, Safari, Firefox (three runs; WebGPU in Safari needs a recent macOS, in Firefox a recent version).
- [ ] **Mac Intel (10 years old)**: Safari and Chrome. It may have no WebGPU at all (old macOS / old GPU): then the page says "WebGPU: NOT AVAILABLE", and that *is* the result; still press "Run the speed check" (the CPU numbers at 12 MP matter most here) and copy the report.
- [ ] **Windows laptop**: Firefox, and Chrome if its GPU is not the RTX.
- [ ] A **phone** (iOS Safari, Android Chrome): same page; the speed check at 12 MP may be heavy, stop it if the page gets stuck and say so.
- [ ] **The playground itself** on each of the above (https://stefanomasneri.com/rullino/): load a sample, add 3 effects (a curve, a blur, a look), try Compare, Export. Is the status "On the GPU" or "On the CPU (reason)"? Anything black, slow or broken? A share link or the **Code** button's JSON goes with each problem.
- [ ] Optional, only on a machine that has Node 22 and pnpm: `pnpm report:parity` gives the same numbers as the page (the page is the easy way).

For each failure write down: machine, OS and browser versions, what you did, a screenshot.

## 2. GitHub settings (only you can)

- [ ] Repository description, website (`https://stefanomasneri.com/rullino/`), topics (`webgpu`, `image-processing`, `photo-editing`, `wgsl`, `typescript`, `lut`, `konva`), a social preview image (Settings > General; the playground screenshot at 1280x640 works).
- [ ] Enable **Discussions** (Settings > General > Features) for questions, so issues stay for bugs.
- [ ] Create the labels `good first issue` and `help wanted` and put them on two or three small real issues (Claude can write the issues).
- [ ] Branch protection on `main`: required check `test` (see CLAUDE.md Decisions).

## 3. npm (manual parts)

- [ ] Trusted Publisher is set per package (CHANGELOG, "Releasing" step 1). Check the 7 packages once.
- [ ] For each package on npmjs.com the page shows the **README of the published version**, so a README fix only appears after a new release. After 0.7.0 look at each package page once.
- [ ] Optional: enable 2FA "authorization and publishing" on the account and the org (npm > Organization settings), and add a second maintainer to the `@rullino` org so the packages do not depend on one account.

## 4. Release 0.7.0

- [ ] Merge the PR "Docs for integrators + fixes" (Claude opens it).
- [ ] Merge the release PR (`node scripts/set-version.mjs 0.7.0` and the CHANGELOG section; Claude prepares it when you say go).
- [ ] From your machine: `git fetch && git tag v0.7.0 origin/main && git push origin v0.7.0`, then watch the `release` workflow.
- [ ] Check on npm that all 7 packages show 0.7.0 and the READMEs render (badges, links).
- [ ] In a clean folder: `npm init -y && npm i @rullino/web` and run the getting-started snippet.

## 5. Before the launch post

- [x] **konvaFilter** and the Filerobot example are done (in `main`; they reach npm with 0.7.0).
- [ ] Open the **Filerobot issue** (custom filters in the Filters tab) on https://github.com/scaleflex/filerobot-image-editor/issues, after 0.7.0 is on npm (the example needs it). Draft, to adapt in your own words:

  > **Title:** Let apps add filters to the Filters tab
  >
  > Filters are looked up by name in `Konva.Filters` (`filterStrToClass`), so an app can already register its own Konva filter and load it through `loadableDesignState: { filter: 'MyLook' }` or set it with `updateStateFnRef`. What it cannot do is show it in the Filters tab: the list is the hard-coded `AVAILABLE_FILTERS`. Would you accept a config option such as `[TOOLS.FILTERS]: { filters: [{ label, filterFn }] }` merged into that list? It is a small change, and it lets apps offer their own looks (for example LUT-based ones) next to the built-in ones. I can send a PR.
  >
  > Working example (colour looks as Konva filters, loaded by name and switched at run time): https://github.com/Stocastico/rullino/tree/main/examples/filerobot-looks

  The motivation and what was read are in [docs/design/filerobot.md](./docs/design/filerobot.md). Offer a PR only if you want to maintain it: a first contribution to someone else's repository speaks for you.
- [ ] Record a 20-30 s screen capture of the playground (split view, Compare with a step, film strip, Code button).
- [ ] Ask Claude for: `docs/benchmarks.md` (from the #77 comments), the launch post draft (Show HN, r/webdev, r/javascript), the list of 3-5 teams on Konva or Fabric to write to.
- [ ] Reply policy: issues within 48 h for the first month (PLAN, Phase 3).
