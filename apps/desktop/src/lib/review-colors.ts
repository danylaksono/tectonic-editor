/** Colour palette for PDF review highlights. Annotations store the token
 *  (not a hex value) so rendering can adapt per theme; unknown tokens fall
 *  back to yellow, which also covers highlights saved before colours existed.
 *  Class strings are literal so Tailwind picks them up. */
export interface ReviewHighlightColor {
  id: string;
  label: string;
  /** Solid dot shown in the colour picker. */
  swatch: string;
  /** Translucent wash drawn over the PDF. */
  wash: string;
  /** Drag-preview style while placing the highlight. */
  preview: string;
  /** Icon/accent colour in the comments panel. */
  accent: string;
  /** Blockquote border in the comments panel. */
  border: string;
  /** Concrete CSS colour for SVG strokes — a drawing is painted into an SVG
   *  overlay, which cannot take a Tailwind class. Matches the -500 shade of
   *  the same colour so ink and highlights read as one palette. */
  stroke: string;
}

export const REVIEW_HIGHLIGHT_COLORS: ReviewHighlightColor[] = [
  {
    id: "yellow",
    label: "Yellow",
    swatch: "bg-yellow-400",
    wash: "bg-yellow-300/40 hover:bg-yellow-300/55",
    preview: "bg-yellow-300/40 ring-yellow-500/60",
    accent: "text-yellow-600",
    border: "border-yellow-500/60",
    stroke: "#eab308",
  },
  {
    id: "green",
    label: "Green",
    swatch: "bg-emerald-400",
    wash: "bg-emerald-300/40 hover:bg-emerald-300/55",
    preview: "bg-emerald-300/40 ring-emerald-500/60",
    accent: "text-emerald-600",
    border: "border-emerald-500/60",
    stroke: "#10b981",
  },
  {
    id: "blue",
    label: "Blue",
    swatch: "bg-sky-400",
    wash: "bg-sky-300/40 hover:bg-sky-300/55",
    preview: "bg-sky-300/40 ring-sky-500/60",
    accent: "text-sky-600",
    border: "border-sky-500/60",
    stroke: "#0ea5e9",
  },
  {
    id: "pink",
    label: "Pink",
    swatch: "bg-pink-400",
    wash: "bg-pink-300/40 hover:bg-pink-300/55",
    preview: "bg-pink-300/40 ring-pink-500/60",
    accent: "text-pink-600",
    border: "border-pink-500/60",
    stroke: "#ec4899",
  },
  {
    id: "orange",
    label: "Orange",
    swatch: "bg-orange-400",
    wash: "bg-orange-300/40 hover:bg-orange-300/55",
    preview: "bg-orange-300/40 ring-orange-500/60",
    accent: "text-orange-600",
    border: "border-orange-500/60",
    stroke: "#f97316",
  },
];

export function resolveReviewHighlightColor(
  id: string | undefined,
): ReviewHighlightColor {
  return (
    REVIEW_HIGHLIGHT_COLORS.find((color) => color.id === id) ??
    REVIEW_HIGHLIGHT_COLORS[0]
  );
}
