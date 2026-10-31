import { defineFilter } from '@rullino/core';
import { equalizeBuffers, equalizeCpu, equalizePasses } from '../equalization';
import { OKLAB_TOLERANCE } from '../shared';

const MAX_TILES = 16;

/**
 * CLAHE (contrast-limited adaptive histogram equalisation) of OKLab lightness: each tile of a
 * tiles × tiles grid is equalised with its own histogram, clipped at `clipLimit` × the mean bin
 * (the excess spread evenly, which limits noise amplification), and pixels blend the mappings of
 * the four nearest tiles bilinearly so there are no seams. Hue and chroma are kept.
 */
export const clahe = defineFilter({
  id: 'clahe',
  label: 'CLAHE (local contrast)',
  description: 'Boosts local contrast by balancing the histogram tile by tile, bringing out detail in flat or hazy areas.',
  tryThis: 'Raise the clip limit until textures pop, then pull Amount back until it looks natural.',
  category: 'adjust',
  kind: 'multipass',
  params: {
    tiles: { type: 'int', min: 1, max: MAX_TILES, default: 8, label: 'Tiles per side', description: 'How many tiles the image is cut into on each side. More tiles means more local, and a stronger effect on small areas.' },
    clipLimit: { type: 'float', min: 1, max: 20, step: 0.1, default: 3, label: 'Clip limit', description: 'How much contrast a tile may gain. Low values are gentle; high values bring out detail but also noise.' },
    amount: { type: 'float', min: 0, max: 1, step: 0.01, default: 1, label: 'Amount', description: 'Blend between the original (0) and the full effect (1).' },
  },
  buffers: equalizeBuffers(MAX_TILES),
  // Read through the global uniform: the shared helpers have no `p` in scope.
  passes: equalizePasses('params.tiles', 'params.clipLimit'),
  reach: 'global', // needs the histogram of the whole image
  cpu: (src, { tiles, clipLimit, amount }) => equalizeCpu(src, tiles, clipLimit, amount),
  tolerance: OKLAB_TOLERANCE,
});
