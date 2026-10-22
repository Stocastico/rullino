// Helpers for the playground's browser tests: synthetic pointer gestures on elements.

let nextPointerId = 100;

export interface Gesture {
  move(clientX: number, clientY: number): void;
  up(): void;
}

/** Starts a pointer gesture on `target` at client coordinates; moves and release go to `target` too. */
export function press(target: Element, clientX: number, clientY: number, init: PointerEventInit = {}): Gesture {
  const pointerId = init.pointerId ?? nextPointerId++;
  const fire = (type: string, x: number, y: number) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, clientX: x, clientY: y, isPrimary: true, button: 0, ...init }));
  fire('pointerdown', clientX, clientY);
  let [lastX, lastY] = [clientX, clientY];
  return {
    move(x, y) {
      [lastX, lastY] = [x, y];
      fire('pointermove', x, y);
    },
    up() {
      fire('pointerup', lastX, lastY);
    },
  };
}

/** Client coordinates of the point (u, v), normalised to `el`'s box. */
export function at(el: Element, u: number, v: number): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + u * r.width, r.top + v * r.height];
}

/** A fresh SVG of w x h CSS pixels in the document. */
export function svgBox(w: number, h: number): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('style', `position: absolute; left: 0; top: 0; width: ${w}px; height: ${h}px; overflow: visible`);
  svg.setAttribute('preserveAspectRatio', 'none');
  document.body.append(svg);
  return svg;
}
