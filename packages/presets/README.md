# @rullino/presets

[![rullino playground: a photo with a look applied](https://raw.githubusercontent.com/Stocastico/rullino/main/docs/playground.jpg)](https://stefanomasneri.com/rullino/)

**[Try it in the playground](https://stefanomasneri.com/rullino/)**

Photo looks for [rullino](https://github.com/Stocastico/rullino): each look is a recipe of ordinary filters (a colour grade baked once into a 3D LUT, plus vignette and grain), so there are no third-party LUT licences and a look is just a list of chain steps you can edit.

> Pre-alpha (0.x): the API may change between minor versions.

**[API reference](https://stefanomasneri.com/rullino/docs/modules/_rullino_presets.html)** (generated from the sources)

```sh
npm install @rullino/core @rullino/filters @rullino/presets
```

```ts
import { createImage, runChainCpu } from '@rullino/core';
import { lookSteps, looks } from '@rullino/presets';

console.log(looks.map((look) => `${look.id}: ${look.description}`));

const steps = lookSteps(looks[0]!, { intensity: 0.8 }); // 0 = no effect, 1 = as designed
const out = runChainCpu(steps, createImage(16, 16));
console.log(out.width);
```

`lookLut(look)` returns the baked 33³ LUT, and `bakeLut` bakes any chain of pointwise filters into one. A baked grade clamps HDR values to [0, 1] and differs from the live chain by less than 1/255 on average.

## License

MIT.
