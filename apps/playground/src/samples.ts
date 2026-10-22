// Sample images: a few public-domain photos (public/samples, see NOTICE.md there) and test images
// generated in code (ramps, a colour chart, transparency) that the e2e smoke test relies on.

export interface Sample {
  readonly id: string;
  readonly label: string;
  readonly group: 'Photos' | 'Test images';
  make(): ImageBitmapSource | Promise<ImageBitmapSource>;
}

/** A photo served next to the page (relative URL: the build works from any base path). */
const photo = (file: string) => async (): Promise<Blob> => {
  const res = await fetch(new URL(`samples/${file}`, document.baseURI));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
  return res.blob();
};

const hue = (t: number): [number, number, number] => {
  const h = t * 6;
  const c = (k: number) => 255 * Math.max(0, Math.min(1, Math.abs(((h + k) % 6) - 3) - 1));
  return [c(0), c(4), c(2)];
};

/** A grey ramp over a hue sweep: shows tone curves and colour shifts at a glance. */
function ramps(): ImageData {
  const w = 768;
  const h = 384;
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1);
      let px: [number, number, number];
      if (y < h / 3) px = [t * 255, t * 255, t * 255];
      else if (y < (2 * h) / 3) px = hue(t);
      else {
        // Hue sweep fading to grey: low-chroma colours, where vibrance differs from saturation.
        const [r, g, b] = hue(t);
        const k = ((y - (2 * h) / 3) / (h / 3)) * 0.85;
        px = [r + (128 - r) * k, g + (128 - g) * k, b + (128 - b) * k];
      }
      img.data.set([...px, 255], (y * w + x) * 4);
    }
  }
  return img;
}

// Approximate sRGB values of the 24 ColorChecker Classic patches (published reference averages).
const CHECKER = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
];

/** Colour-checker-like chart: skin tones, primaries and a neutral row. */
function chart(): ImageData {
  const patch = 96;
  const gap = 12;
  const w = 6 * patch + 7 * gap;
  const h = 4 * patch + 5 * gap;
  const img = new ImageData(w, h);
  img.data.fill(20);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  CHECKER.forEach(([r, g, b], i) => {
    const x0 = gap + (i % 6) * (patch + gap);
    const y0 = gap + Math.floor(i / 6) * (patch + gap);
    for (let y = y0; y < y0 + patch; y++) for (let x = x0; x < x0 + patch; x++) img.data.set([r!, g!, b!, 255], (y * w + x) * 4);
  });
  return img;
}

/** Soft colour discs over transparency: checks that alpha is handled (premultiplied) correctly. */
function alpha(): ImageData {
  const w = 640;
  const h = 400;
  const img = new ImageData(w, h);
  const discs = [
    { x: 230, y: 200, r: 150, c: [230, 60, 50] },
    { x: 410, y: 200, r: 150, c: [40, 120, 230] },
    { x: 320, y: 120, r: 110, c: [250, 210, 60] },
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // "over" compositing of the discs, in 8-bit straight alpha for simplicity.
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const d of discs) {
        const t = Math.hypot(x - d.x, y - d.y) / d.r;
        const da = Math.max(0, Math.min(1, (1 - t) * 3)) * 0.85;
        const na = da + a * (1 - da);
        if (na > 0) {
          r = (d.c[0]! * da + r * a * (1 - da)) / na;
          g = (d.c[1]! * da + g * a * (1 - da)) / na;
          b = (d.c[2]! * da + b * a * (1 - da)) / na;
        }
        a = na;
      }
      img.data.set([r, g, b, a * 255], (y * w + x) * 4);
    }
  }
  return img;
}

export const samples: readonly Sample[] = [
  { id: 'river', label: 'River', group: 'Photos', make: photo('river.jpg') },
  { id: 'london-night', label: 'London at night', group: 'Photos', make: photo('london-night.jpg') },
  { id: 'still-life', label: 'Still life', group: 'Photos', make: photo('still-life.jpg') },
  { id: 'tiger-cubs', label: 'Tiger cubs', group: 'Photos', make: photo('tiger-cubs.jpg') },
  { id: 'skyscraper', label: 'Skyscraper (perspective)', group: 'Photos', make: photo('skyscraper.jpg') },
  { id: 'desert-road', label: 'Desert road', group: 'Photos', make: photo('desert-road.jpg') },
  { id: 'ramps', label: 'Ramps & hues', group: 'Test images', make: ramps },
  { id: 'chart', label: 'Colour chart', group: 'Test images', make: chart },
  { id: 'alpha', label: 'Transparency', group: 'Test images', make: alpha },
];
