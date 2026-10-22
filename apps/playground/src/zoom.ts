// Zoom and pan of the image stage: a CSS transform `translate(x, y) scale(zoom)` (origin top
// left) on the stage, inside a viewport that clips it. Zoom 1 is "fit". Every on-image editor maps
// pointers through getBoundingClientRect, which includes the transform, so they keep working.
// Ctrl / ⌘ + wheel or a trackpad pinch zooms; the wheel, Space + drag, the middle button or two
// fingers pan; two fingers also pinch-zoom.

export interface View {
  readonly zoom: number;
  /** Translation in CSS pixels. */
  readonly x: number;
  readonly y: number;
}

export const FIT: View = { zoom: 1, x: 0, y: 0 };
export const MAX_ZOOM = 32;

/** Keeps the stage covering its fit box: no empty space shows at the edges. */
export function clampView(v: View, w: number, h: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom));
  const clamp = (t: number, size: number) => Math.min(0, Math.max(size * (1 - zoom), t));
  return { zoom, x: clamp(v.x, w), y: clamp(v.y, h) };
}

/** Multiplies the zoom by `factor`, keeping stage point (px, py) (untransformed CSS px) where it is on screen. */
export function zoomAt(v: View, factor: number, px: number, py: number, w: number, h: number): View {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
  // Screen offset of the point stays the same: x + p * zoom.
  return clampView({ zoom, x: v.x + px * (v.zoom - zoom), y: v.y + py * (v.zoom - zoom) }, w, h);
}

export const panBy = (v: View, dx: number, dy: number, w: number, h: number): View => clampView({ ...v, x: v.x + dx, y: v.y + dy }, w, h);

export interface ZoomController {
  readonly view: View;
  set(view: View): void;
  /** Zooms about the centre of the visible part of the stage. */
  zoomBy(factor: number): void;
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && ['text', 'number', 'search'].includes(t.type)));

export function attachZoom(viewport: HTMLElement, stage: HTMLElement, onChange: (v: View) => void): ZoomController {
  let view = FIT;
  const size = () => [stage.offsetWidth, stage.offsetHeight] as const;
  const apply = (next: View) => {
    view = clampView(next, ...size());
    stage.style.transform = view.zoom === 1 ? '' : `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    stage.classList.toggle('zoomed', view.zoom > 1);
    onChange(view);
  };
  /** A client point in untransformed stage coordinates. */
  const local = (clientX: number, clientY: number): [number, number] => {
    const r = stage.getBoundingClientRect();
    return [(clientX - r.left) / view.zoom, (clientY - r.top) / view.zoom];
  };

  viewport.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinches arrive as ctrl + wheel with small deltas; mouse wheels as ±100.
        e.preventDefault();
        const delta = Math.max(-100, Math.min(100, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
        apply(zoomAt(view, Math.exp(-delta * 0.005), ...local(e.clientX, e.clientY), ...size()));
      } else if (view.zoom > 1) {
        e.preventDefault();
        apply(panBy(view, -e.deltaX, -e.deltaY, ...size()));
      }
    },
    { passive: false },
  );

  // Space + drag and middle-button drag pan; two touches pan and pinch. Listening in the capture
  // phase lets these gestures take over before the split handle, brush or crop handles see them.
  let space = false;
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || isTyping(e.target) || e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    space = true;
    stage.classList.add('panning');
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    space = false;
    stage.classList.remove('panning');
  });

  const touches = new Map<number, [number, number]>();
  let pan: { id: number; x: number; y: number } | undefined;
  let pinch: { distance: number; mid: [number, number]; view: View; local: [number, number] } | undefined;
  const pinchState = () => {
    const [a, b] = [...touches.values()] as [[number, number], [number, number]];
    return { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as [number, number] };
  };

  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (touches.size === 2) {
          const s = pinchState();
          pinch = { ...s, view, local: local(...s.mid) };
          e.stopPropagation();
          e.preventDefault();
        }
        return;
      }
      if (e.button === 1 || (space && e.button === 0)) {
        pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
        stage.setPointerCapture(e.pointerId);
        e.stopPropagation();
        e.preventDefault();
      }
    },
    { capture: true },
  );
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, [e.clientX, e.clientY]);
        if (pinch && touches.size === 2) {
          e.stopPropagation();
          const s = pinchState();
          const factor = s.distance / Math.max(1, pinch.distance);
          // Zoom about the starting midpoint, then follow the midpoint's movement.
          const zoomed = zoomAt(pinch.view, factor, ...pinch.local, ...size());
          apply(panBy(zoomed, s.mid[0] - pinch.mid[0], s.mid[1] - pinch.mid[1], ...size()));
        }
      } else if (pan?.id === e.pointerId) {
        e.stopPropagation();
        apply(panBy(view, e.clientX - pan.x, e.clientY - pan.y, ...size()));
        pan = { ...pan, x: e.clientX, y: e.clientY };
      }
    },
    { capture: true },
  );
  const end = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = undefined;
    if (pan?.id === e.pointerId) pan = undefined;
  };
  stage.addEventListener('pointerup', end, { capture: true });
  stage.addEventListener('pointercancel', end, { capture: true });
  // The stage changes size with the image, the geometry and the window: keep the view valid.
  new ResizeObserver(() => apply(view)).observe(stage);

  return {
    get view() {
      return view;
    },
    set: apply,
    zoomBy(factor) {
      // The centre of what is visible of the stage.
      const vr = viewport.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const cx = (Math.max(vr.left, sr.left) + Math.min(vr.right, sr.right)) / 2;
      const cy = (Math.max(vr.top, sr.top) + Math.min(vr.bottom, sr.bottom)) / 2;
      apply(zoomAt(view, factor, ...local(cx, cy), ...size()));
    },
  };
}

/** Keeps on-image handles a constant size on screen: `--px` = image pixels per screen pixel. */
export function updateHandleScale(svgs: readonly SVGSVGElement[]): void {
  for (const svg of svgs) {
    const w = svg.viewBox.baseVal?.width;
    const shown = svg.getBoundingClientRect().width;
    if (w && shown) svg.style.setProperty('--px', String(w / shown));
  }
}
