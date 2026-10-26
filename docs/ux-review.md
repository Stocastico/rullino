# Playground UX review (adversarial)

Written 2026-10-26 against `main` at `b85019f`. Method: the built playground in headless Chromium at 1440×900, 1100×700, 820×1100 and 390×844 (screenshots of the sample photo with an empty chain and with a three-step chain), the CSS, and a count of what the filter schemas say about themselves. Not verified: keyboard-only use, a screen reader, a real phone, a real GPU. Findings that rest on those are marked as such.

The goal under review: **a playground to play in, that also teaches** — examples of every effect, of how chains combine effects, so that using it is how you learn what the library can do.

Short verdict: the playground is a competent, plain tool. It is not yet a teaching tool, and the cause is mostly *content*, not layout: the library does not know how to explain itself.

## What works (keep)

- Everything renders on the GPU in real time, with a before / after split, undo / redo, share links, masks. The mechanics are good and tested.
- Dark neutral surround: right for judging photographs. Contrast is fine (muted text 6.5:1, body text 15:1 on the panel).
- The amber accent is film-like and used sparingly.
- Looks gallery with live thumbnails: the one place where the UI shows what something does *before* you commit to it. The rest of the UI should work like this.

## Findings, worst first

### 1. The first screen looks broken
The initial chain is one Exposure step at 0 EV: an identity. Before and after are the same picture, the split handle sits in the middle of an unchanged photo, the histogram is flat. A new visitor moves a slider before anything happens. *Evidence: `laptop-1100` screenshot.* The first thing the product should do is show an effect.

### 2. The chain — the product — is below the fold
At 1440×900 the sidebar spends its first 880 px on Image, Geometry (seven controls), a histogram and ten looks; the heading "CHAIN" is at y = 895. On a 1100×700 laptop it is off-screen. The thing that makes rullino different from a filter app (an ordered, editable list of effects) is the last thing in a long scroll. *Evidence: `desktop-chain`, `laptop-1100`.*

### 3. The library cannot teach yet: there is nothing to show
Counted from the schemas: **4 of 51 filters have a description; 0 of 149 parameters have any help text.** A parameter is a label and a slider. No UI redesign can teach "what is *Kuwahara radius*, when would I want it, what happens if I stack it after *Bilateral*" from that. This is the largest piece of work in the whole goal and it is writing, not code.

### 4. 51 filters behind a native dropdown
Adding a filter is a `<select>` with four `<optgroup>`s: no search, no preview, no description, alphabetical within category, and the names assume you already know the field ("Unsharp mask", "CLAHE", "Morphology"). A visitor cannot browse what is possible. The looks gallery proves the better pattern; filters never got it.

### 5. A pile of concepts, none of them introduced
Geometry (a frame *before* the chain), Looks (a macro that adds several steps), the chain, the per-step mask, the shared Selection, "Only in selection". Three overlapping ways to restrict an effect to an area. Nothing says that order matters (it does: *grain* before *halftone* is not *halftone* before *grain*), that Looks are just chains you can open, or that a mask belongs to a step. These are exactly the ideas the playground should teach, and they are only discoverable by accident.

### 6. No feedback on what a step does
The chain shows a list of titles. To learn what one step contributes you have to toggle it and watch the main image. There is no thumbnail per step, no solo / peek, no per-step before / after. For a tool about *chains* the intermediate results are invisible.

### 7. The status line is developer talk
"WebGPU · River 2048×1365 · 4 steps · 380.2 ms" — useful to us, noise to a newcomer, and it is the only text near the image. The histogram is unlabelled (output? input?). The split labels "before" and "after" sit on top of each other when the handle is near the middle.

### 8. Phones: the photo is not on the first screen
At 390 px the layout is the desktop sidebar stacked above the image: Image, Geometry, Histogram and the first rows of Looks fill the screen, the photo is several screens down. The header wraps the status text into a four-line column and crowds "Copy link" and "API docs". (Real-device behaviour not verified.)

### 9. No identity
System font at 14 px, grey tracked ALL-CAPS section labels, bordered dark panels: a well-made generic dark tool. The name *rullino* means **a roll of film**, and the product's central object — an ordered strip of steps, each transforming the picture — *is* a film strip. None of that is used. (The all-caps tracked labels are also the standard "generated UI" tell.)

### 10. Smaller things
- Custom focus styling is missing (browser default ring only); keyboard use not verified.
- No way to reset one step to defaults or one parameter to its default (not found; not verified exhaustively).
- Error and empty states: "Add a filter to start a chain." is the only guidance.
- Only a dark theme; fine for editing, noticeable next to the (light) API docs.

## Arguments against the goal, so the plan can survive them

- **"Play" and "teach" pull apart.** Guided lessons that block the canvas ruin playing; free play with no guidance teaches nothing. The only version that works keeps teaching *optional and adjacent*: the explanation sits next to the control you are touching and never takes the image away.
- **Teaching content has to be right.** 51 filter and 149 parameter texts written fast and wrong are worse than none. Plan for review, and for the texts to live next to the code (in the schema) so that changing a filter changes its explanation.
- **Two audiences.** A photographer playing and a developer evaluating a library want different things. The bridge is a single feature, *Copy as code*: the chain you built, as the TypeScript that reproduces it. It makes the playground the best documentation of the library.

## Proposal

**Idea to spend the boldness on: the chain as a film strip.** Each step is a frame showing the picture *after that step*; you read left to right (or top to bottom) how the photograph is built up, can open any frame, solo it, reorder by dragging. Everything else stays quiet and conventional. It uses the product's name, shows what a chain is without a word of text, and answers finding 6.

Layout, desktop:

```
┌ rullino      [Examples ▾] [Add effect ⌕]   Undo Redo   Copy link   Copy as code ┐
│ ┌───────────────────────────────────────────────┐ ┌ inspector ─────────────────┐ │
│ │                                               │ │ Halftone                   │ │
│ │            the photograph (before | after)    │ │ Turns tones into dots…     │ │
│ │                                               │ │ Dot spacing ──●──  8 px  ? │ │
│ └───────────────────────────────────────────────┘ │ …                          │ │
│ ▭ original ▸ ▭ grayscale ▸ ▭ halftone ▸ ▭ grain  │ Try: lower the spacing …   │ │
│   (film strip: a thumbnail after every step)      └────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Phone: the photo first; the strip under it; the inspector as a bottom sheet.

Changes, in dependency order:

1. **First-run and layout fixes** (small, no new content): open with an example chain that visibly does something, chain first in the sidebar (Geometry, histogram, looks collapsed under it), photo first on phones, a readable header on phones, histogram labelled, status line moved out of the way. Fixes findings 1, 2, 7, 8.
2. **Say what things are** (content + a schema field): `description` on every filter and parameter, plus a one-line *try this*. Shown as help beside the controls, in `docs/filters.md` and in the API docs from the same text. Fixes finding 3 and feeds everything below. *This is the real cost.*
3. **Effect browser**: searchable, with live thumbnails of every effect on *your* photo, one-line descriptions, "add"; `Ctrl+K` opens it from anywhere. Replaces the dropdown. Fixes finding 4.
4. **The film strip**: per-step thumbnails, solo / peek, drag to reorder, "what this step changed" on hover. Fixes findings 5 (order) and 6, and gives the product a face (finding 9).
5. **Examples**: a gallery of recipes (chains with a name, a result and an annotation per step: "1 Grayscale — keep tone only; 2 Halftone — dots whose size follows the tone…"). Opening one loads an ordinary, editable chain; share links already exist for this. Replaces the idea of a tutorial with *examples you can pull apart*, which is what a playground is for.
6. **Copy as code**: the TypeScript (and JSON) for the current chain, with the right imports. Links each step to its API / filter reference entry.
7. **Polish**: designed focus states, keyboard path through the strip, reduced motion, a light theme if wanted, one reset per parameter.

Rough size: 1 is one PR; 2 is one PR for the field plus several for the texts; 3, 4, 5, 6 one PR each. The playground's `main.ts` is already 1,100 lines: steps 3–4 need to move chain / strip code into modules first.

## Decisions needed

1. **Language of the interface and texts**: English only, or English and Italian? (Changes how the texts are stored from the start.)
2. **Audience priority**: playing photographers, or developers evaluating the library? Proposal: design for the curious person who might become a developer, with *Copy as code* as the bridge.
3. **The film-strip idea**: go with it, or keep a plain list and spend the effort on content?
4. **Order**: the one above, or content (step 2) first?
