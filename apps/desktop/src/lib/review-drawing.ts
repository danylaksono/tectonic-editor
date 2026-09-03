/**
 * Freehand and shape marks on the PDF.
 *
 * A drawing is stored the same way every other annotation is: page-relative PDF
 * points, with the stroke's bounding box in the usual `anchor`. That is what
 * keeps the rest of the review system — page grouping, the comments panel,
 * selection, the editor gutter, the exported report — working on drawings
 * without knowing what a drawing is.
 *
 * Rendering is an SVG overlay in page coordinates, so nothing here touches
 * MuPDF: a drawing costs no WASM memory and no re-render of the page bitmap.
 */

export type ReviewDrawingTool =
  | "freehand"
  | "line"
  | "arrow"
  | "box"
  | "ellipse";

export interface ReviewPoint {
  x: number;
  y: number;
}

/** Stroke width in PDF points. Scales with zoom, like ink on the page. */
export const DEFAULT_STROKE_WIDTH = 2;

/** Points closer together than this add file size without adding shape. */
const MIN_POINT_DISTANCE = 1.5;

/** A stroke longer than this is a scribble, not a mark. The cap keeps one
 *  annotation from bloating a review file that other people have to pull. */
const MAX_STROKE_POINTS = 600;

/** Shapes are defined by where the drag began and where it ended. */
export function isTwoPointTool(tool: ReviewDrawingTool): boolean {
  return tool !== "freehand";
}

function distance(a: ReviewPoint, b: ReviewPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Thin a captured stroke down to the points that carry its shape, and cap its
 * length. Pointer events fire far denser than a curve needs, and every point
 * kept is JSON in a file that travels between reviewers.
 */
export function simplifyStroke(points: readonly ReviewPoint[]): ReviewPoint[] {
  if (points.length <= 2) return [...points];
  const kept: ReviewPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (distance(kept[kept.length - 1], points[i]) >= MIN_POINT_DISTANCE) {
      kept.push(points[i]);
    }
  }
  // The final point is where the pen lifted; dropping it would shorten the
  // stroke visibly.
  kept.push(points[points.length - 1]);
  if (kept.length <= MAX_STROKE_POINTS) return kept;

  // Too long even after thinning: keep every nth point, plus the endpoints.
  const stride = Math.ceil(kept.length / MAX_STROKE_POINTS);
  const thinned = kept.filter((_, index) => index % stride === 0);
  const last = kept[kept.length - 1];
  if (thinned[thinned.length - 1] !== last) thinned.push(last);
  return thinned;
}

/** Bounding box of a stroke, grown by the stroke width so the box contains the
 *  ink rather than its centre line. */
export function drawingBounds(
  points: readonly ReviewPoint[],
  strokeWidth = DEFAULT_STROKE_WIDTH,
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }
  const pad = strokeWidth / 2;
  return {
    x: left - pad,
    y: top - pad,
    width: Math.max(1, right - left + strokeWidth),
    height: Math.max(1, bottom - top + strokeWidth),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function polyline(points: readonly ReviewPoint[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`,
    )
    .join(" ");
}

/** Head length: proportional to the shaft, but never a spike on a long arrow
 *  or bigger than the arrow itself on a short one. */
function arrowHead(from: ReviewPoint, to: ReviewPoint): string {
  const shaft = distance(from, to);
  if (shaft < 1) return "";
  const length = Math.min(18, Math.max(6, shaft * 0.2));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  const wing = (offset: number) => ({
    x: to.x - length * Math.cos(angle + offset),
    y: to.y - length * Math.sin(angle + offset),
  });
  const a = wing(spread);
  const b = wing(-spread);
  return ` M${round(a.x)} ${round(a.y)} L${round(to.x)} ${round(to.y)} L${round(b.x)} ${round(b.y)}`;
}

function ellipsePath(a: ReviewPoint, b: ReviewPoint): string {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  if (rx < 0.5 || ry < 0.5) return polyline([a, b]);
  // Two arcs rather than <ellipse>, so every tool renders through one <path>.
  return (
    `M${round(cx - rx)} ${round(cy)} ` +
    `a${round(rx)} ${round(ry)} 0 1 0 ${round(rx * 2)} 0 ` +
    `a${round(rx)} ${round(ry)} 0 1 0 ${round(-rx * 2)} 0`
  );
}

function boxPath(a: ReviewPoint, b: ReviewPoint): string {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  return (
    `M${round(left)} ${round(top)} L${round(right)} ${round(top)} ` +
    `L${round(right)} ${round(bottom)} L${round(left)} ${round(bottom)} Z`
  );
}

/**
 * The SVG `d` for a drawing, in page coordinates. One path per drawing keeps
 * both the stored shape and the live preview on the same code.
 */
export function drawingPath(
  tool: ReviewDrawingTool,
  points: readonly ReviewPoint[],
): string {
  if (points.length === 0) return "";
  if (tool === "freehand") return polyline(points);

  const from = points[0];
  const to = points[points.length - 1];
  if (points.length === 1) return polyline(points);

  switch (tool) {
    case "box":
      return boxPath(from, to);
    case "ellipse":
      return ellipsePath(from, to);
    case "arrow":
      return polyline([from, to]) + arrowHead(from, to);
    default:
      return polyline([from, to]);
  }
}
