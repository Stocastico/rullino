import type { Geometry } from '@rullino/core';

// On-image crop editing: the frame is shown uncropped, with the crop rectangle, darkened outside,
// four corner handles and a draggable body. Coordinates are the frame's display pixels
// (viewBox = frame size); the crop is normalised to the frame. Elements are built once and
// updated in place (replacing an element mid-drag would drop its pointer capture).

type Crop = Geometry['crop'];
const NS = 'http://www.w3.org/2000/svg';
const MIN = 0.02;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface CropOverlay {
  /** Shows the editor for `crop` on a w x h frame; `aspect` (width / height in pixels) constrains it. */
  show(crop: Crop, w: number, h: number, aspect: number | undefined): void;
  hide(): void;
}

/** The largest rectangle of the given pixel aspect inside `crop`, centred on it. */
export function fitAspect(crop: Crop, w: number, h: number, aspect: number): Crop {
  let width = crop.width;
  let height = (width * w) / (aspect * h);
  if (height > crop.height) {
    height = crop.height;
    width = (height * aspect * h) / w;
  }
  return { x: crop.x + (crop.width - width) / 2, y: crop.y + (crop.height - height) / 2, width, height };
}

export function createCropOverlay(svg: SVGSVGElement, onChange: (crop: Crop) => void): CropOverlay {
  let crop: Crop = { x: 0, y: 0, width: 1, height: 1 };
  let size: [number, number] = [1, 1];
  let aspect: number | undefined;
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string) => {
    const node = document.createElementNS(NS, tag);
    node.setAttribute('class', cls);
    return node;
  };
  const shade = el('path', 'crop-shade');
  const body = el('rect', 'crop-body');
  const corners = (['tl', 'tr', 'br', 'bl'] as const).map((name) => {
    const c = el('circle', 'mask-handle');
    c.dataset.handle = name;
    return [name, c] as const;
  });
  const update = () => {
    const [w, h] = size;
    const [x0, y0, x1, y1] = [crop.x * w, crop.y * h, (crop.x + crop.width) * w, (crop.y + crop.height) * h];
    shade.setAttribute('d', `M0 0H${w}V${h}H0Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`);
    body.setAttribute('x', String(x0));
    body.setAttribute('y', String(y0));
    body.setAttribute('width', String(x1 - x0));
    body.setAttribute('height', String(y1 - y0));
    const at = { tl: [x0, y0], tr: [x1, y0], br: [x1, y1], bl: [x0, y1] } as const;
    for (const [name, c] of corners) {
      c.setAttribute('cx', String(at[name][0]));
      c.setAttribute('cy', String(at[name][1]));
    }
  };

  const drag = (node: SVGElement, move: (u: number, v: number, start: { u: number; v: number; crop: Crop }) => Crop) => {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.setPointerCapture(e.pointerId);
      const r = svg.getBoundingClientRect();
      const uv = (ev: PointerEvent) => [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height] as const;
      const [u0, v0] = uv(e);
      const start = { u: u0, v: v0, crop };
      const onMove = (ev: PointerEvent) => {
        const [u, v] = uv(ev);
        crop = move(u, v, start);
        update();
        onChange(crop);
      };
      const stop = () => {
        node.removeEventListener('pointermove', onMove);
        node.removeEventListener('pointerup', stop);
        node.removeEventListener('pointercancel', stop);
      };
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', stop);
      node.addEventListener('pointercancel', stop);
    });
  };

  // Moving keeps the size and stays inside the frame.
  drag(body, (u, v, s) => ({
    ...s.crop,
    x: clamp(s.crop.x + u - s.u, 0, 1 - s.crop.width),
    y: clamp(s.crop.y + v - s.v, 0, 1 - s.crop.height),
  }));
  // A corner moves against the opposite one, which stays put.
  for (const [name, c] of corners) {
    drag(c, (u, v, s) => {
      const left = name === 'tl' || name === 'bl';
      const top = name === 'tl' || name === 'tr';
      const ax = left ? s.crop.x + s.crop.width : s.crop.x;
      const ay = top ? s.crop.y + s.crop.height : s.crop.y;
      let width = clamp(left ? ax - u : u - ax, MIN, left ? ax : 1 - ax);
      let height = clamp(top ? ay - v : v - ay, MIN, top ? ay : 1 - ay);
      if (aspect !== undefined) {
        const [w, h] = size;
        // Follow the larger movement, then shrink both to fit the room on that side.
        if ((width * w) / (height * h) > aspect) height = (width * w) / (aspect * h);
        else width = (height * aspect * h) / w;
        const k = Math.min(1, (left ? ax : 1 - ax) / width, (top ? ay : 1 - ay) / height);
        width *= k;
        height *= k;
      }
      // Clamped: the rescale above can land a hair below 0.
      return { x: Math.max(0, left ? ax - width : ax), y: Math.max(0, top ? ay - height : ay), width, height };
    });
  }

  return {
    show(next, w, h, nextAspect) {
      crop = next;
      size = [w, h];
      aspect = nextAspect;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.style.setProperty('--px', String(w / Math.max(1, svg.getBoundingClientRect().width || w)));
      if (!svg.contains(body)) svg.replaceChildren(shade, body, ...corners.map(([, c]) => c));
      update();
    },
    hide() {
      svg.replaceChildren();
    },
  };
}
