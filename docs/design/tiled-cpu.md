# Tiled CPU execution across workers

Status: **proposal, not implemented** ([#128](https://github.com/Stocastico/rullino/issues/128)). Nothing in this document changes behaviour; it exists to be argued with before code is written.

## Why, and what would count as success

With the fast paths of round 2 (#125, #126, #129, #130) a typical 12 MP chain takes 2–5 s on the CPU, one core. An export is embarrassingly parallel in space, and cores are free: on 4 cores the best case is ~4×.

Ship only if, measured with `pnpm bench:cpu` and the 12 MP PLAN chains on the 4-core cloud container:

- 12 MP chains are ≥ 2.5× faster with 4 threads than with 1;
- images below ~2 MP are not slower than today (below the threshold the tiled path is not taken);
- the output is **bit-identical** to the single-threaded one, not merely within a tolerance (see "Tests").

If the numbers miss, the design is abandoned and the code removed; the planning layer (phase 1) is useful on its own as a statement of each filter's reach.

## The model

**Split the image into horizontal bands** (full width, a range of rows). Each worker runs the *whole chain* (or a segment of it, see below) on its band plus a halo of extra rows above and below, then returns only its own rows.

Why bands and not 2-D tiles:

- a band is a contiguous slice of the row-major buffer: no gather loops, `subarray` views, one copy at most;
- the halo is rows only, there is no left/right halo to stitch;
- with 12 MP (4000×3000) and 4–16 bands the halo is a few percent of the work. 2-D tiles only win when the halo is large, and then the answer is "do not tile" anyway.

**One scatter and one gather per segment, not per step.** Tiling each step on its own would copy the image in and out once per step. Instead the band carries the halo it needs for all the steps that follow: step *k* of *n* produces the rows `[y0 − H_k, y1 + H_k)` where `H_k = r_{k+1} + … + r_n` and `r_j` is the reach of step *j*, clipped to the image. The input band is `[y0 − H_0, y1 + H_0)`.

**Clamp-to-edge stays correct for free.** Every filter clamps reads at the border of the image it is given. A band's halo is clipped by the *image* border, so where a band's border is the image's border the clamp is the right one; everywhere else a read never goes past the halo because the halo is at least the reach. This is the whole correctness argument, and it is exactly what the tests below attack.

**Segments.** A step that needs the whole image first (a histogram, a global statistic) cannot be banded. It ends a segment: bands are gathered into the full image, the step runs on the full image (single-threaded, or later two-phase, see "Not in v1"), and the next segment is scattered again. A chain with no global step is one segment.

**Small images are not tiled.** If `total halo > ¼ of the band height`, or the image is below the size threshold, the segment runs whole. Canny at 64 iterations or inpaint at σ = 100 have reaches in the hundreds; on a 1 MP preview that is "do not tile", on 12 MP it is still worth it.

## What a filter must declare

Three additions, all optional for pointwise filters, **required** for multipass ones (a registry test fails otherwise, like `label`):

1. **`reach(params) → px`**: the largest distance (rows) from an output pixel to any input pixel it reads, from the *effective* params (resolved and scaled, as the filter sees them). Pointwise filters have reach 0 implicitly. `reach: 'global'` marks a filter that needs the whole image.

   | Filter | Reach |
   |---|---|
   | gaussianBlur, bloom, sketch, adaptiveThreshold, unsharp | `ceil(3σ)` (the weight radius) |
   | boxBlur, median, morphology, kuwahara, bilateral | radius (bilateral: `min(40, ceil(2σs))`) |
   | sharpen, emboss, gradient, laplacian | 1 |
   | convolve | 2 |
   | canny | `ceil(3σ) + 2 + iterations` (Sobel, non-maximum suppression, one pixel per hysteresis round) |
   | inpaint | `ceil(3σ) + iterations` |
   | pixelate, ascii, halftone, dither | the cell size (cells are anchored at the image origin, see below) |
   | chromaticAberration, lensBlur | the maximum displacement / blur radius |
   | equalize, clahe, otsu | `'global'` |

2. **A frame**: an optional fourth argument to `cpu` / `fast`, `{ x, y, width, height }`: "the image you get is the rectangle at (x, y) of a full image of this size". Filters that depend on position must use it:

   - `vignette` (distance normalised by the full width and height), `grain` (hash of absolute x, y), `dither` (Bayer index and hash of absolute x, y), `halftone` (grid anchored at the image origin and centre), `ascii` and `pixelate` (cells anchored at 0 and truncated by the *full* image's border: `pixelate` takes `min(x0 + size, w)`), `chromaticAberration` (radial from the full image's centre), `lensBlur` and `patch` (their depth / patch image is sampled at normalised coordinates of the full image);
   - masks: `maskValue(m, x, y, w, h)` already takes the full size; a band evaluates it with its offset. Mask-aware filters (`inpaint`, `patch`) receive the band's slice of the mask.

   A filter that ignores the frame is not an error to the type system. It is an error to the tests.

3. Nothing for filters with non-serialisable params (`image` params): in v1 they end a segment, because a worker cannot receive the function or the live object. (`lensBlur` and `patch` therefore run on the main thread in the worker backends, as custom filters already do.)

## Executors

The planning and the band arithmetic are pure functions in `@rullino/core` and run in a single thread:

```ts
planBands(steps, width, height, { scale, bands }) → Segment[]          // global steps and bands, with halos
runChainBand(steps, band, frame, { scale }) → LinearImage               // one band through a segment
runChainTiled(steps, src, options) → LinearImage                        // sequential reference executor
```

`runChainTiled` is both the oracle of the tests and the code the workers call. The workers add only data movement:

- **`@rullino/node`**: `worker_threads`. The source and the destination are `SharedArrayBuffer`s, so a worker reads its band straight from the source and writes its rows into the destination: no copy beyond the halo it works on. Pool created on first CPU render, sized to `os.availableParallelism()` capped at 8.
- **`@rullino/web`**: the existing module worker becomes a pool. Without cross-origin isolation there is no `SharedArrayBuffer`: each band is cloned to its worker (a 12 MP float image is 192 MB; ~200 MB in and ~200 MB out is ~0.1–0.3 s, to be measured in the spike), results come back as transferables and are copied into the output. With COOP/COEP (the page opts in) the shared path is used. Pool size `navigator.hardwareConcurrency − 1`, capped at 8.

Both take a `threads` option (`1` = today's behaviour, `'auto'`), **default `1` in the first release**, `'auto'` after a release of field use. Edit documents are parsed on the main thread (errors keep their messages); the workers receive the document and the LUTs already resolved, exactly as today.

A worker error rejects the render and tears the pool down (the next render builds a new one); `destroy()` terminates the workers; renders queue behind each other.

## Not in v1

- Two-phase global filters (per-band histograms merged on the main thread, then a banded apply): equalize, otsu, clahe would parallelise. Until then they cost a barrier.
- 2-D tiles.
- Tiling the GPU: not applicable.
- Sharing the filters' prose / registry between threads: each worker loads the filters it needs, as the current worker does.

## Plan

1. **Spike (a branch, thrown away).** Measure on this container: worker start-up with the filters bundle, `postMessage` clone of a 24 MB and a 192 MB buffer, `SharedArrayBuffer` throughput, and tiled-vs-whole for a pointwise chain and a blur chain with a hand-rolled pool. Decide go / no-go on the success numbers above before phase 1.
2. **Phase 1, core, no workers, no behaviour change.** `reach`, the frame argument, `planBands` / `runChainBand` / `runChainTiled`, frame support in the position-dependent filters, the registry rule, and the test suite below. This is most of the work and all of the risk.
3. **Phase 2, node executor** and a bench; **phase 3, web executor** with the copy and shared paths, `threads` documented; **phase 4**, docs and the `'auto'` default.

## Tests

The point of the design is that "tiled equals whole" can be checked without any worker, against an oracle that already exists (the single-threaded fast path), **bit for bit**: every band computes exactly the operations the whole image computes for those pixels, in the same order, so `toEqual` on the buffers is the right assertion. A tolerance here would hide the bugs this suite is for.

**Phase 1 (pure, run in the unit project):**

1. *Every filter, every case.* For every filter with a `cpu` and for every one with a `fast`, on the parity images and cases (`parityCases`, plus the special-values image), cut the image into bands by random but seeded partitions and compare `runChainTiled` to the whole image. Partitions include: one band; a band per row; more bands than rows; height 1; bands smaller than the reach; bands whose halo is clipped on one side or both; odd widths and heights.
2. *Reach is tight.* For every filter with a non-zero reach, run the same comparison with `reach − 1` and require it to **fail** on at least one case. A reach that is too small is a wrong result; a reach that is too large is wasted work, and nothing else would notice. A short, explicit list of exceptions (a last tap that is unobservable) is allowed and reviewed.
3. *Position.* Banded results of every position-dependent filter at several band offsets (including offsets that are not multiples of the cell size, of the Bayer matrix, of the hash block).
4. *Chains.* Seeded random chains of 2–6 steps drawn from all filters (pointwise, neighbourhood, positional, global, masked with linear / radial / raster masks, disabled steps), 200+ cases, compared with `runChainCpu(…, { fast: true })` on the whole image. Failures print the seed and the chain.
5. *Segmentation.* Global steps at the start, middle and end of a chain, two in a row, and a chain of only global steps; a step with a non-serialisable param.
6. *The planner.* Pure unit tests of `planBands`: halo sums, clipping, the "do not tile" rule, no band overlap in the rows each band owns, full coverage of the image.
7. *Registry rule.* Every multipass filter declares `reach` (a number function or `'global'`); a filter that does not fails the registry test. The position-dependent filters are listed and the test of point 3 must cover each of them by name, so a new one cannot be added without it.
8. *Mutations, by hand and written in the PR:* halo one row short, band owning one row too many, frame offset dropped, `'global'` treated as 0, clamp applied at a band border.

**Phase 2–3 (executors):**

9. Pool results are byte-identical to `threads: 1` on the sample photos and the chart, for the PLAN chains and for every look.
10. Failure: a filter that throws inside a worker rejects the render with its message and leaves the renderer usable (a later render succeeds on a fresh pool); `destroy()` during a render rejects it and leaves no worker running.
11. Concurrency: several renders started at once complete in order and equal the sequential results; `threads` larger than the number of rows; `threads: 1`; a source smaller than the size threshold takes the untiled path.
12. Browser: the worker pool and the single worker against each other in Chromium (copy path, and the shared path with COOP/COEP on in the test server); Node: `worker_threads` against single-threaded.
13. `pnpm test:pack`: the packed `@rullino/web` and `@rullino/node` render with `threads: 2` from the tarballs.
14. A bench in CI as a smoke test (does not assert timings, like `pnpm bench`) and real numbers in the PR description.

## Decisions I would like confirmed

1. Horizontal bands only (not 2-D tiles).
2. Bit-identical output is a requirement of the design, not a nicety.
3. A new optional argument (`frame`) on `cpu` / `fast` and a new filter field (`reach`) are public types: a deliberate API change, in 0.x.
4. `threads` defaults to `1` for the first release.
5. The spike decides go / no-go before phase 1 is written.
