# RFC: edit document v3 — a graph of named inputs and nodes

> **Status: proposal (20 Nov 2026)**, issue [#174](https://github.com/Stocastico/rullino/issues/174), part of 0.8 ([#166](https://github.com/Stocastico/rullino/issues/166)). Nothing here is built until the maintainer accepts it; the open questions are in §9. The executor is [#175](https://github.com/Stocastico/rullino/issues/175).

## 1. Problem

A v2 document is one chain of steps on one image:

```json
{ "version": 2, "geometry": { "rotate": 90 }, "steps": [{ "filter": "exposure", "params": { "ev": 0.3 } }], "output": { "format": "jpeg" } }
```

Nothing that combines pictures can be written down: a watermark (0.13), a merge of brackets or a focus stack (0.12), the same photo graded two ways and mixed, a frame around a photo. Every one of them is two or more images or two or more chains meeting in one place. They need a document that is a small graph, and an executor that renders graphs on every backend with the guarantees chains have today (GPU ↔ CPU within tolerance, banded = whole, incremental recompute).

## 2. Goals and non-goals

Goals:

- **v2 is the one-node case of v3**, and a v2 document renders the same pixels through the v3 path, bit for bit. Every share link and stored document keeps working.
- **Small and closed**: a handful of node kinds, each specified like a filter (CPU reference, WGSL, tolerance), so the conformance suite of 1.0 can cover all of them.
- **Readable by people**: a v3 document is still something you can write by hand.
- **Extensible**: later node kinds (merge, align, overlay, plugin nodes) add to the list without changing the shape.

Non-goals (now): layers with transforms and blend modes (after 1.0, #207), text, loops or conditionals, nodes whose output size is not known before rendering.

## 3. The shape

```json
{
  "version": 3,
  "inputs": { "photo": {} },
  "nodes": [
    { "id": "colour", "from": "photo", "geometry": { "crop": { "x": 0.1, "y": 0, "width": 0.8, "height": 1 } },
      "steps": [{ "filter": "exposure", "params": { "ev": 0.3 } }] },
    { "id": "mono", "from": "colour", "steps": [{ "filter": "grayscale", "params": {} }] },
    { "id": "out", "kind": "mix", "from": ["colour", "mono"], "amount": 0.6 }
  ],
  "output": { "node": "out", "format": "jpeg", "quality": 0.9 }
}
```

- **`inputs`**: the images the document needs, by name (`[a-z][a-z0-9-]*`). The value is an object for future hints (an expected colour profile, RAW develop defaults); today it is `{}`. A renderer is given one image per input; a single image binds to a document with exactly one input.
- **`nodes`**: a list. Each has an `id` (same rules as input names, one namespace with the inputs, no duplicates), a `kind` (default `"chain"`) and `from`: one name or a list of names, each an input or **an earlier node**. Referring only to earlier entries makes every document acyclic by construction and gives readers the order of work; a node may feed several others (a graph, not a tree).
- **`output`**: v2's output settings plus `node`, the node to render (default: the last one). Nodes that the output does not depend on are not rendered (and a parse warning lists them, so typos show).

## 4. Node kinds

| Kind | `from` | Fields | Result |
|---|---|---|---|
| `chain` (default) | one | `steps` (v2 steps, masks included), `geometry` (v2) | geometry on the input, then the steps: exactly what a v2 document does |
| `mix` | two | `amount` (0..1, default 0.5), `mask` (a v2 mask, optional) | `a + (b − a) · amount · mask`, premultiplied linear RGBA (the existing masked-step blend) |

That is all for 0.8: `mix` is the smallest node with two inputs, so the executor is built and tested on a real graph from the start, and it is useful alone (a grade at partial strength, a selective black and white, the before / after of a look). Planned kinds, each its own RFC or issue: `merge` (exposure fusion, HDR, focus stack; #193), `align` (#194), `overlay` (image or solid with position, scale, opacity; 0.13), plugin kinds named with their package (#196).

**Sizes.** A chain node's size is its input's after geometry. A `mix` node takes the size of its first input; the second is resampled to it (bilinear in linear light, the geometry shader's sampling) when it differs. So the output size is known from the inputs before anything renders, which banded and tiled execution need.

**Scale.** `scale` (the resolution of an input relative to its original, for previews) is given per input; pixel-unit params of a chain node use the scale of the input it descends from. Two inputs at different scales reaching one `mix` are allowed: each chain upstream already rendered at its own scale.

## 5. From v2 to v3

`migrateChain` (v1 → v2 today) gains v2 → v3, a pure transformation:

```jsonc
{ "version": 3, "inputs": { "main": {} }, "nodes": [{ "id": "edit", "from": "main", "geometry": …, "steps": … }], "output": … }
```

The golden test: every document in the repository (docs examples, looks, test fixtures, a corpus of random seeded chains with masks and geometry) renders **bit-identically** through `applyEdit` before and after migration, on the CPU and on the GPU.

## 6. API (proposal)

- `parseEdit(doc, options)` → a parsed graph (`EditGraph`: inputs, nodes with parsed steps, output). Accepts v1, v2, v3.
- `parseChain` stays for v1 / v2 and for v3 documents that are a single chain node on a single input; on a real graph it throws `parseChain: this document is a graph (3 nodes); use parseEdit`.
- `applyEdit(source | { [input]: source }, doc, options)`: a single source binds to a one-input document, a record binds by name; a missing or extra input is an error naming it. `options.scale` becomes a number (every input) or a record per input.
- `serializeChain(steps, options)` keeps producing a document for one chain; `serializeEdit(graph)` writes any graph. Which version `serializeChain` writes is open question 3.
- `edit.schema.json` describes v1, v2 and v3 (`oneOf` on `version`); an unknown `kind` fails `parseEdit` with its name and the list of known kinds.

## 7. Execution

- **CPU reference** (`runGraphCpu`): nodes in list order, each a chain (`runChainCpu`) or a `mix` (a pointwise CPU reference), results kept while a later node still needs them, dropped after their last use.
- **GPU**: one `Pipeline` per chain node (its stages and cache unchanged), `mix` as a two-input pass reusing `blendMask`'s shader. The cache key of a node is its kind, its own fields and the keys of what it reads, so changing one node recomputes that node and the nodes that depend on it, nothing else.
- **Banded CPU** (`@rullino/web` and `@rullino/node` workers): a `mix` is per pixel (reach 0), so bands cross it unchanged; a chain node is planned with `planSegments` as today. Fan-out (one node read by two) keeps its result whole until both readers are done.
- **Tiled GPU** (#176) works per node the same way.

## 8. Tests (written before the code)

- Migration golden (§5), CPU and GPU.
- Parser: round trip `parseEdit(serializeEdit(g))`; rejections with their message: unknown kind, unknown or later `from`, duplicate id, an input name used as a node id, a `mix` with one input, an output node that does not exist. Property-based over random graphs (fast-check, #177).
- Parity: random seeded graphs (chains, masks, mixes, fan-out) GPU ↔ CPU within the summed tolerances of their filters.
- Banded = whole for graphs, bit for bit, one row of reach less must fail.
- Incremental recompute: changing a node's param re-runs the passes of that node and its descendants only (counted passes on the GPU).
- Inputs: two inputs at different sizes and scales; a missing input; a record with an extra input.

## 9. Open questions for the maintainer

1. **Order**: nodes may only read earlier entries (proposal: simpler to read and to validate), or any order with a cycle check?
2. **`mix` in 0.8**: ship it as the first multi-input kind (proposal), or keep 0.8 to single-chain graphs and add `mix` later?
3. **What `serializeChain` writes**: v3 always (proposal: one current format, as `docs/edit-document.md` promises), or v2 for single-chain edits so that 0.7 readers can still open new share links?
4. **Names**: `inputs` / `nodes` / `from` / `kind`, or other words (`sources`, `ops`, `in`)? Cheap to change now, expensive after 1.0.
