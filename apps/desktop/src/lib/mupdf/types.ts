export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FontInfo {
  family: string;
  size: number;
  weight: string;
  style: string;
}

export interface StructuredTextChar {
  c: string;
  quad: number[];
  origin: { x: number; y: number };
}

export interface StructuredTextSpan {
  font: FontInfo;
  chars: StructuredTextChar[];
}

export interface StructuredTextLine {
  bbox: Rect;
  wmode: number;
  x: number;
  y: number;
  text: string;
  font: {
    name: string;
    family: string;
    size: number;
    weight: string;
    style: string;
  };
}

export interface StructuredTextBlock {
  type: "text";
  bbox: Rect;
  lines: StructuredTextLine[];
}

export interface StructuredTextData {
  blocks: StructuredTextBlock[];
}

export interface LinkData {
  x: number;
  y: number;
  w: number;
  h: number;
  href: string;
  isExternal: boolean;
  /** Destination name for internal links (e.g. `cite.smith2020`, `section.2.1`),
   * or null for external links and unnamed destinations. */
  dest: string | null;
}

export interface PageSize {
  width: number;
  height: number;
}

/** An entry from the PDF's own bookmark tree (what hyperref writes), flattened
 * to a list with an explicit nesting level. This is the *compiled* structure,
 * with real page numbers — distinct from the outline parsed out of the LaTeX
 * source. */
export interface PdfOutlineItem {
  title: string;
  /** 1-based page, or null when the destination can't be resolved. */
  page: number | null;
  /** 0 for top-level entries. */
  level: number;
}

/** One search match on one page, in unscaled PDF page coordinates.
 *
 * A match that wraps across lines or columns covers more than one rectangle,
 * so `rects` is the whole match rather than one box per match. */
export interface PdfSearchMatch {
  /** 1-based, matching the rest of the viewer's page numbering. */
  page: number;
  rects: Rect[];
}

export type WorkerRequest = [string, number, unknown[]];
export type WorkerResponse =
  | ["RESULT", number, unknown]
  | ["ERROR", number, { name: string; message: string }]
  | ["INIT", number, string[]];
