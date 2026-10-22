// Pointer dragging for on-image handles: capture the pointer on the handle, report moves in
// coordinates normalised to `frame` (the overlay SVG), and clean up on release or cancel.

/**
 * Captures the pointer so a fast drag keeps reporting moves outside the handle. Synthetic pointers
 * (tests) cannot be captured; the drag then works while events reach the handle.
 */
export function capture(node: Element, pointerId: number): void {
  try {
    node.setPointerCapture(pointerId);
  } catch {
    // not an active pointer (synthetic event)
  }
}

export type DragMove = (u: number, v: number, event: PointerEvent) => void;

/**
 * Makes `node` draggable. `start` runs on pointerdown and returns the move handler for this drag
 * (or nothing to ignore it). Coordinates are not clamped.
 */
export function makeDraggable(node: Element, frame: Element, start: (u: number, v: number, event: PointerEvent) => DragMove | void): void {
  const uv = (e: PointerEvent): [number, number] => {
    const r = frame.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  node.addEventListener('pointerdown', (event) => {
    const e = event as PointerEvent;
    const move = start(...uv(e), e);
    if (!move) return;
    e.preventDefault();
    e.stopPropagation();
    capture(node, e.pointerId);
    const onMove = (ev: Event) => move(...uv(ev as PointerEvent), ev as PointerEvent);
    const stop = () => {
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', stop);
      node.removeEventListener('pointercancel', stop);
    };
    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);
  });
}
