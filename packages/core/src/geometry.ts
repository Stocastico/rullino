import { createImage, type LinearImage } from './image';
import type { Vec2 } from './mask';

// Geometry is a frame put on the source before the filter chain (crop, quarter turns, flips,
// straighten, perspective), Lightroom style. Everything is normalised, so one Geometry means the
// same at preview, display and export resolution. All of it composes into one 3x3 homography from
// output pixel coordinates to source pixel coordinates (continuous: pixel i spans [i, i + 1]),
// followed by bilinear resampling of premultiplied linear values; areas outside the source are
// transparent. The WGSL twin is in gpu/geometry.ts.

export interface Geometry {
  /** Quarter turns, clockwise. Applied first, with the flips: together they are the orientation. */
  readonly rotate: 0 | 90 | 180 | 270;
  /** Mirror the oriented image left-right / top-bottom. */
  readonly flipH: boolean;
  readonly flipV: boolean;
  /**
   * Four points (top-left, top-right, bottom-right, bottom-left), normalised to the oriented
   * image, that become the corners of the frame: keystone / perspective correction.
   */
  readonly perspective?: readonly [Vec2, Vec2, Vec2, Vec2];
  /** Degrees in [-45, 45]; positive turns the content clockwise about the centre. */
  readonly straighten: number;
  /** The kept rectangle, normalised to the oriented frame. */
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export const IDENTITY_GEOMETRY: Geometry = { rotate: 0, flipH: false, flipV: false, straighten: 0, crop: { x: 0, y: 0, width: 1, height: 1 } };

type Mat3 = [number, number, number, number, number, number, number, number, number];

const mul = (a: Mat3, b: Mat3): Mat3 => {
  const out = new Array<number>(9) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return out;
};
const affine = (a: number, b: number, c: number, d: number, e: number, f: number): Mat3 => [a, b, c, d, e, f, 0, 0, 1];

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Homography mapping the corners of [0, w] x [0, h] (tl, tr, br, bl) onto `to`. */
function rectToQuad(w: number, h: number, to: readonly Vec2[]): Mat3 {
  const from: Vec2[] = [[0, 0], [w, 0], [w, h], [0, h]];
  // Solve the 8x8 system for h11..h32 (h33 = 1) by Gaussian elimination with partial pivoting.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r]![c]! / A[c]![c]!;
      for (let j = c; j < 9; j++) A[r]![j]! -= k * A[c]![j]!;
    }
  }
  const s = A.map((row, i) => row[8]! / row[i]!);
  return [s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, s[6]!, s[7]!, 1];
}

export function validateGeometry(g: Geometry): void {
  const fail = (msg: string) => {
    throw new Error(`geometry: ${msg}`);
  };
  if (![0, 90, 180, 270].includes(g.rotate)) fail('rotate must be 0, 90, 180 or 270');
  if (!(Math.abs(g.straighten) <= 45)) fail('straighten must be in [-45, 45] degrees');
  const { x, y, width, height } = g.crop;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 + 1e-9 || y + height > 1 + 1e-9) {
    fail('crop must be a non-empty rectangle inside [0, 1]²');
  }
  if (g.perspective) {
    const q = g.perspective;
    if (!q.every((p) => p.every(Number.isFinite))) fail('perspective points must be finite');
    const turns = q.map((_, i) => cross(q[i]!, q[(i + 1) % 4]!, q[(i + 2) % 4]!));
    if (!(turns.every((t) => t > 0) || turns.every((t) => t < 0))) fail('perspective corners must form a convex quadrilateral');
  }
}

export interface GeometryFrame {
  /** Output size in pixels. */
  readonly width: number;
  readonly height: number;
  /** Output pixel coordinates -> source pixel coordinates, row-major homogeneous 3x3. */
  readonly matrix: Mat3;
  toSource(x: number, y: number): [number, number];
}

/** The output size and output -> source mapping of `g` on a w x h source. */
export function geometryFrame(g: Geometry, w: number, h: number): GeometryFrame {
  validateGeometry(g);
  const turned = g.rotate === 90 || g.rotate === 270;
  const [W, H] = turned ? [h, w] : [w, h];
  // Orientation: oriented coordinates -> source coordinates (flips act on what is seen).
  const flip = affine(g.flipH ? -1 : 1, 0, g.flipH ? W : 0, 0, g.flipV ? -1 : 1, g.flipV ? H : 0);
  const unrotate = {
    0: affine(1, 0, 0, 0, 1, 0),
    90: affine(0, 1, 0, -1, 0, h),
    180: affine(-1, 0, w, 0, -1, h),
    270: affine(0, -1, w, 1, 0, 0),
  }[g.rotate];
  const orientation = mul(unrotate, flip);
  // Perspective: frame -> oriented coordinates.
  const perspective = g.perspective ? rectToQuad(W, H, g.perspective.map(([u, v]) => [u * W, v * H] as Vec2)) : affine(1, 0, 0, 0, 1, 0);
  // Straighten: content turned clockwise, so frame points come from a counter-clockwise turn.
  const t = (g.straighten * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  const straighten = mul(mul(affine(1, 0, W / 2, 0, 1, H / 2), affine(c, s, 0, -s, c, 0)), affine(1, 0, -W / 2, 0, 1, -H / 2));
  const crop = affine(1, 0, g.crop.x * W, 0, 1, g.crop.y * H);
  const matrix = mul(mul(mul(orientation, perspective), straighten), crop);
  return {
    width: Math.max(1, Math.round(g.crop.width * W)),
    height: Math.max(1, Math.round(g.crop.height * H)),
    matrix,
    toSource(x, y) {
      const m = matrix;
      const z = m[6] * x + m[7] * y + m[8];
      return [(m[0] * x + m[1] * y + m[2]) / z, (m[3] * x + m[4] * y + m[5]) / z];
    },
  };
}

/** CPU reference: resample `src` through the geometry (bilinear, transparent outside). */
export function applyGeometryCpu(src: LinearImage, g: Geometry): LinearImage {
  const frame = geometryFrame(g, src.width, src.height);
  const out = createImage(frame.width, frame.height);
  const texel = (x: number, y: number, c: number) => (x < 0 || y < 0 || x >= src.width || y >= src.height ? 0 : src.data[(y * src.width + x) * 4 + c]!);
  for (let y = 0; y < frame.height; y++)
    for (let x = 0; x < frame.width; x++) {
      const [sx, sy] = frame.toSource(x + 0.5, y + 0.5);
      const px = sx - 0.5;
      const py = sy - 0.5;
      const x0 = Math.floor(px);
      const y0 = Math.floor(py);
      const fx = px - x0;
      const fy = py - y0;
      for (let c = 0; c < 4; c++) {
        const top = texel(x0, y0, c) + (texel(x0 + 1, y0, c) - texel(x0, y0, c)) * fx;
        const bottom = texel(x0, y0 + 1, c) + (texel(x0 + 1, y0 + 1, c) - texel(x0, y0 + 1, c)) * fx;
        out.data[(y * frame.width + x) * 4 + c] = top + (bottom - top) * fy;
      }
    }
  return out;
}

/** Whether `g` leaves every image as it is (so resampling can be skipped). */
export function isIdentityGeometry(g: Geometry): boolean {
  const q = g.perspective;
  const square = !q || [[0, 0], [1, 0], [1, 1], [0, 1]].every(([u, v], i) => q[i]![0] === u && q[i]![1] === v);
  const c = g.crop;
  return g.rotate === 0 && !g.flipH && !g.flipV && g.straighten === 0 && square && c.x === 0 && c.y === 0 && c.width === 1 && c.height === 1;
}
