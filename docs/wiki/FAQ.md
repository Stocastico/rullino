# FAQ

**Does my photo get uploaded?** No. Everything runs in your browser or on your machine. ML models are downloaded once from Hugging Face and run locally.

**Do I need WebGPU?** No. Without it the same edit renders on the CPU in a Web Worker: seconds instead of milliseconds at 12 MP ([benchmarks](https://github.com/Stocastico/rullino/blob/main/docs/benchmarks.md)).

**Are browser and server results identical?** Within a published tolerance per filter, not bit for bit: GPUs keep intermediates in float16, and some filters make hard decisions. See the [parity table](https://github.com/Stocastico/rullino/blob/main/docs/parity.md).

**Can I read RAW / HEIC / 16-bit files?** Not yet: input is 8-bit sRGB today. RAW (DNG first), 16-bit and HDR are on the [[Roadmap]] (0.9, 0.10).

**Layers, text, collages?** Planned for 0.11 (edit document v3).

**Can I use it commercially?** Yes, MIT. Models keep their own (permissive) licences: [THIRD_PARTY_NOTICES.md](https://github.com/Stocastico/rullino/blob/main/THIRD_PARTY_NOTICES.md).

**How do I render from a shell?** `npx rullino render --look <id> photos/ -o out/` (from 0.8 on npm; `rullino looks` lists the looks).

**Something renders black or wrong.** [Troubleshooting](https://github.com/Stocastico/rullino/blob/main/docs/troubleshooting.md), then an issue with the browser, GPU and the playground's share link.
