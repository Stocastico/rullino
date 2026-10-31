import { createImage, defineFilter, type LinearImage } from '@rullino/core';
import { clampLoad } from '../convolution';

const OPERATIONS = {
  erode: 'Erode',
  dilate: 'Dilate',
  open: 'Open',
  close: 'Close',
  gradient: 'Gradient',
  tophat: 'Top-hat',
  blackhat: 'Black-hat',
} as const;
type Operation = keyof typeof OPERATIONS;
const SHAPES = { square: 'Square', disk: 'Disk', cross: 'Cross' } as const;
type Shape = keyof typeof SHAPES;

/** Whether (dx, dy) belongs to the structuring element. The disk is the rasterised (r + 0.5) circle. */
const inside = (shape: Shape, dx: number, dy: number, r: number) =>
  shape === 'square' || (shape === 'disk' ? dx * dx + dy * dy <= (r + 0.5) * (r + 0.5) : dx === 0 || dy === 0);

/** Per-channel minimum (erode) or maximum (dilate) over the structuring element, clamp to edge. */
function morphCpu(src: LinearImage, max: boolean, shape: Shape, r: number): LinearImage {
  const out = createImage(src.width, src.height);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++)
      for (let c = 0; c < 4; c++) {
        let v = max ? -Infinity : Infinity;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) if (inside(shape, dx, dy, r)) v = (max ? Math.max : Math.min)(v, clampLoad(src, x + dx, y + dy, c));
        out.data[(y * src.width + x) * 4 + c] = v;
      }
  return out;
}

/** WGSL body of a morphological pass reading `load_<src>`; `useMax` is a WGSL bool expression. */
const morphWgsl = (src: string, useMax: string) => /* wgsl */ `
  let r = p.radius;
  let rr = (f32(r) + 0.5) * (f32(r) + 0.5);
  let hi = ${useMax};
  var v = load_${src}(xy);
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      var keep = true;
      if (p.shape == 1u) { keep = f32(dx * dx + dy * dy) <= rr; }
      if (p.shape == 2u) { keep = dx == 0 || dy == 0; }
      if (keep) {
        let s = load_${src}(xy + vec2i(dx, dy));
        v = select(min(v, s), max(v, s), hi);
      }
    }
  }
  return v;`;

/**
 * Grey-level morphology per channel (as OpenCV does on colour images), on premultiplied values,
 * alpha included. Open = erode then dilate, close = dilate then erode; gradient = dilate − erode,
 * top-hat = image − open, black-hat = close − image (these three keep the input's alpha).
 * Operation indices: erode 0, dilate 1, open 2, close 3, gradient 4, tophat 5, blackhat 6.
 */
export const morphology = defineFilter({
  id: 'morphology',
  label: 'Morphology',
  description: 'Grows or shrinks bright shapes, or opens and closes gaps, with a small shape moved over the picture.',
  tryThis: 'Erode removes small bright specks; Dilate widens bright shapes; Close fills small dark holes.',
  category: 'classic',
  kind: 'multipass',
  params: {
    operation: { type: 'enum', options: OPERATIONS, default: 'dilate', label: 'Operation', description: 'Erode shrinks bright areas, Dilate grows them. Open and Close combine the two to remove specks or fill holes. Gradient outlines shapes; Top-hat and Black-hat keep small bright or dark details.' },
    shape: { type: 'enum', options: SHAPES, default: 'disk', label: 'Structuring element', description: 'The shape moved over the picture: a square, a round disk or a cross.' },
    radius: { type: 'int', min: 1, max: 15, default: 2, unit: 'px', label: 'Radius (px)', description: 'Size of that shape in pixels.' },
  },
  passes: [
    // First operation: dilate for dilate / close / gradient / black-hat, erode otherwise.
    { name: 'first', inputs: ['input'], wgsl: `fn run(xy: vec2i, p: Params) -> vec4f {${morphWgsl('input', 'p.operation == 1u || p.operation == 3u || p.operation == 4u || p.operation == 6u')}\n}` },
    {
      // Second operation: on `first` for open / close / top-hat / black-hat, the erosion of the
      // input for gradient; unused (a copy of `first`) for erode / dilate.
      name: 'second',
      inputs: ['first', 'input'],
      wgsl: /* wgsl */ `
fn second_from_first(xy: vec2i, p: Params) -> vec4f {${morphWgsl('first', 'p.operation == 2u || p.operation == 5u')}
}

fn second_from_input(xy: vec2i, p: Params) -> vec4f {${morphWgsl('input', 'false')}
}

fn run(xy: vec2i, p: Params) -> vec4f {
  if (p.operation <= 1u) { return load_first(xy); }
  if (p.operation == 4u) { return second_from_input(xy, p); }
  return second_from_first(xy, p);
}`,
    },
    {
      name: 'out',
      inputs: ['input', 'first', 'second'],
      wgsl: /* wgsl */ `
fn run(xy: vec2i, p: Params) -> vec4f {
  let c = load_input(xy);
  switch p.operation {
    case 0u, 1u: { return load_first(xy); }
    case 2u, 3u: { return load_second(xy); }
    case 4u: { return vec4f((load_first(xy) - load_second(xy)).rgb, c.a); }
    case 5u: { return vec4f((c - load_second(xy)).rgb, c.a); }
    default: { return vec4f((load_second(xy) - c).rgb, c.a); }
  }
}`,
    },
  ],
  // Open, close, top-hat and black-hat run an erosion and a dilation one after the other.
  reach: ({ operation, radius }) => (['open', 'close', 'tophat', 'blackhat'].includes(operation) ? 2 * radius : radius),
  cpu: (src, { operation, shape, radius }) => {
    const op = operation as Operation;
    const erode = (img: LinearImage) => morphCpu(img, false, shape as Shape, radius);
    const dilate = (img: LinearImage) => morphCpu(img, true, shape as Shape, radius);
    const diff = (a: LinearImage, b: LinearImage) => {
      const out = createImage(src.width, src.height);
      for (let i = 0; i < out.data.length; i++) out.data[i] = i % 4 === 3 ? src.data[i]! : a.data[i]! - b.data[i]!;
      return out;
    };
    switch (op) {
      case 'erode':
        return erode(src);
      case 'dilate':
        return dilate(src);
      case 'open':
        return dilate(erode(src));
      case 'close':
        return erode(dilate(src));
      case 'gradient':
        return diff(dilate(src), erode(src));
      case 'tophat':
        return diff(src, dilate(erode(src)));
      case 'blackhat':
        return diff(erode(dilate(src)), src);
    }
  },
  // min / max are exact; the differences only round once to f16.
  tolerance: { abs: 1e-6, rel: 2 ** -10 },
});
