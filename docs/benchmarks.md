# Benchmarks

What rullino costs and where it loses, measured, with the machine and the code each number came from. Read the [limits](#limits-of-these-numbers) before quoting anything.

Reproduce with `pnpm bench:web` (the comparison page of [`apps/bench`](../apps/bench): same RGBA8 image in, RGBA8 back in memory for every library, GPU readbacks counted like WASM copies) and, for the CPU backend on worker threads, `pnpm bench:threads` (Node) and `pnpm bench:threads:web` (Chromium). CI only runs the comparison at 320×240 to keep every adapter alive; the numbers below are from a real machine, because software GPUs (SwiftShader) say nothing about hardware.

## The machine

Windows, Chrome 156, an NVIDIA Lovelace GPU (WebGPU on the real adapter, not the software fallback), 24 logical threads, 32 GB. One machine: no Apple silicon, AMD or Intel GPU, no Safari or Firefox, no phone. Libraries compared: PixiJS 8.22.0 with pixi-filters 6.1.5 (WebGL2), wasm-vips 0.0.19, Photon 0.3.3.

## GPU: a change of one parameter

Median of 10 changes on a synthetic image, result read back to memory, after `#99` (GPU-side decoding and pooled readbacks, code of **0.4.0**, 28 Oct). Lower is better.

| | rullino (WebGPU) | PixiJS (WebGL2) |
|---|---|---|
| load, 12 MP | 22 ms | 10 ms |
| load, 24 MP | 56 ms | 20 ms |
| change, 12 MP, three chains | 26 / 25 / 23 ms | 22 / 23 / 23 ms ¹ |
| change, 24 MP, three chains | 49 / 46 / 44 ms | 52 / 65 / 54 ms ¹ |
| first run (shaders compile), 12 MP | 361 / 140 / 48 ms | 257 / 61 / 67 ms |
| memory, 12 / 24 MP ² | 104 / 249 MB | 154 / 298 MB |

The chains are exposure + curves + 3D LUT, blur + unsharp mask, and levels + vignette + grain.

- **At 12 MP the two are even; at 24 MP rullino is a little faster** and computes the exact chain. Both are bound by reading the result back (about 22 ms is the floor even for the simplest chain), so faster filters would not show.
- **PixiJS loads about twice as fast** (it uploads 8-bit textures directly; rullino converts to float16 on the GPU). At 22 ms for 12 MP that is not worth chasing, but it is a loss.
- **The first run is about 100 ms slower** than PixiJS's: shader compilation, paid once per session.
- **No fusion claim.** Time is dominated by the readback, not by the passes, so these numbers cannot show a benefit from fusing pointwise steps.

¹ PixiJS has no exact equivalent for these chains and runs its closest approximation. Mean |Δ| from rullino's result, in 8-bit steps: 1.6 (exposure + curves + LUT), 1.3 (blur + unsharp), **22** (levels + vignette + grain: it has no vignette of this kind, so it does less work). Its latency also varied between runs (the first run measured 56 / 46 / 22 ms at 12 MP).
² `measureUserAgentSpecificMemory`: the page, workers and WASM, not GPU memory. Photon used 202 / 394 MB.

### Against the WASM libraries

First run, before `#99` (so rullino's numbers were slower than today's; the ranking did not change), change latency at 12 MP:

| chain | rullino WebGPU | wasm-vips | Photon |
|---|---|---|---|
| exposure + curves + LUT | 36 ms | 320 ms ¹ | 676 ms ² |
| blur + unsharp | 37 ms | 1806 ms | 1949 ms ² |
| levels + vignette + grain | 37 ms | 1260 ms | 51 ms ² |

¹ Without the 3D LUT step: libvips has none. ² Approximations: Photon has no curves, LUT, levels or vignette, and its noise functions trap in WASM (the bench skips its grain), so on the last chain it does almost nothing and the 51 ms is not a comparison. Where the maths are close, |Δ| against rullino is small (wasm-vips blur + unsharp: 0.8).

So against the WASM CPU libraries rullino on WebGPU is **roughly 9 to 50 times faster** where they do the same work (wasm-vips without its 3D LUT step is the 9; its blur + unsharp is 49).

## CPU: the backend without a GPU

This is the weak spot, and the reason for the worker pool. Time to render a whole chain at 12 MP (4000×3000), `@rullino/web` in Chromium, median of 2 rounds. One thread is a single worker; before 0.6.0 that was the only CPU mode (4–9 s per chain in the first comparison).

| chain | 1 thread | 2 threads | 4 threads |
|---|---|---|---|
| exposure + curves | 3.6 s | 1.9 s (1.90×) | 0.9 s (3.95×) |
| blur + unsharp | 6.9 s | 3.3 s (2.08×) | 1.9 s (3.55×) |
| levels + vignette + grain | 4.9 s | 2.4 s (2.03×) | 1.4 s (3.41×) |
| look (LUT, vignette, grain) | 3.4 s | 2.3 s (1.49×) | 1.2 s (2.89×) |
| Kuwahara r = 4 + sharpen | 14.9 s | 10.3 s (1.45×) | 5.8 s (2.55×) |
| blur + equalize + sharpen | 6.4 s | 5.6 s (1.16×) | 4.9 s (1.33×) |

(From `packages/web/bench/results.txt`: a 4-core Linux container, code of **0.6.0**; the equalize chain predates the two-phase work of the same release, which made it scale on the 24-core machine below.)

On the 24-thread Windows machine the equalize chain, with the two-phase global filters, 12 MP, 5 interleaved rounds, scaled almost linearly: 17.2 s on one thread, 9.1 s on 2 (1.89×), 4.5 s on 4 (3.86×), 2.7 s on 8 (6.48×). Node, one run of three rounds: 5.3 s on one thread, 0.93 s on 8. The one-thread time of that machine swings between 8.6 and 15.5 s from round to round (a hybrid CPU with efficiency cores is the guess), so read medians with their range. Details and the reasoning behind the defaults are in [the tiled CPU design](./design/tiled-cpu.md).

What this means in practice:

- **A CPU preview of a 12 MP photo takes seconds, not tens of milliseconds.** The browser fallback shows a reduced image and the Node renderer is meant to use the GPU through Dawn (0.3–1.4 s warm per 12 MP chain on a GPU-less runner with lavapipe, 12–14 s for the unoptimised reference).
- `@rullino/web` uses 4 workers by default on a machine reporting at least 4 cores (images above about 2 MP). `@rullino/node` stays at 1 thread: a server scales with processes (`threads` is opt-in).
- Not measured: laptops, phones, Apple silicon.

## Limits of these numbers

- **One GPU on one machine** (plus a container for the CPU scaling). A launch claim that "rullino is as fast as PixiJS" holds for this setup only; the [hardware check](https://stefanomasneri.com/rullino/check/) page exists so other machines can add theirs.
- **The comparison is approximate by nature.** The libraries cannot run the same maths; |Δ| makes "closest" measurable, and a library that skips a step visibly does less work. rullino is exact by definition of the benchmark.
- **Readback-bound**: the harness reads results back to memory for every library. An app that draws the GPU result straight to a canvas would see a different picture for the GPU libraries.
- **PixiJS timings varied** between runs (22 to 56 ms for the same chain at 12 MP).
- **Synthetic image** (not a photograph), 10 changes per chain.
- The first-run and load figures include the shader compilation and upload of that session only.
- The numbers date from 28 Oct (GPU) and 31 Oct – 3 Nov (CPU); the code they come from is named in each section. Re-run `pnpm bench:web` on a new release before quoting them.
