import type { StructuredTextData, StructuredTextLine } from "./types";

/**
 * Normalise MuPDF's structured-text JSON into our flat line format.
 *
 * MuPDF emits each line as a `text` string carrying its own `font` and
 * baseline `y`. Older releases instead nested spans of chars under each line,
 * so that shape is still accepted.
 *
 * Kept out of the worker module, which can only be imported for its
 * side effects (top-level `await import("mupdf")` boots the WASM runtime), so
 * that this stays directly testable — reading only the old shape silently
 * produced an empty string for every line, which emptied PDF text selection
 * and any word count along with it.
 */
export function normalizeStructuredText(raw: unknown): StructuredTextData {
  const blocks = (raw as { blocks?: unknown[] } | null)?.blocks ?? [];
  return {
    blocks: blocks.map((block: any) => {
      if (block?.type !== "text") return block;
      return {
        type: "text",
        bbox: block.bbox,
        lines: (block.lines || []).map(normalizeLine),
      };
    }),
  } as StructuredTextData;
}

function normalizeLine(line: any): StructuredTextLine {
  const spans = line.spans || [];
  const hasSpans = spans.length > 0;

  const text: string =
    typeof line.text === "string"
      ? line.text
      : hasSpans
        ? spans
            .map((span: any) =>
              (span.chars || []).map((ch: any) => ch.c).join(""),
            )
            .join("")
        : "";

  const fontSource = line.font ?? (hasSpans ? spans[0].font : undefined);

  // The line's own `y` is its baseline. Falling back to the bottom of the
  // bounding box drops the glyphs by the descender height.
  const baselineY =
    typeof line.y === "number"
      ? line.y
      : hasSpans && spans[0].chars?.[0]?.origin
        ? spans[0].chars[0].origin.y
        : (line.bbox?.y || 0) + (line.bbox?.h || 0);

  return {
    bbox: line.bbox || { x: 0, y: 0, w: 0, h: 0 },
    wmode: line.wmode || 0,
    x: line.bbox?.x || 0,
    y: baselineY,
    text,
    font: {
      name: fontSource?.name || "",
      family: fontSource?.family || "",
      size: fontSource?.size || (hasSpans ? spans[0].size : 0) || 12,
      weight: fontSource?.weight || "normal",
      style: fontSource?.style || "normal",
    },
  };
}
