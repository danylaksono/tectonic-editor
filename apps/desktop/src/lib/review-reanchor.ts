import type { Rect } from "@/lib/mupdf/types";
import type {
  ReviewAnchor,
  ReviewAnchorUpdate,
  ReviewComment,
  ReviewSourceLocation,
} from "@/stores/review-store";

/**
 * Re-anchoring review annotations onto a freshly compiled PDF.
 *
 * Annotations are stored as page + x/y boxes measured against one exact build.
 * Recompile after editing a chapter and every anchor below the edit is off by
 * however much the text moved — silently, which is worse than losing them,
 * because a comment then sits over the wrong paragraph.
 *
 * Two ways back to the right place, in order of precision:
 *
 *  1. The text the annotation covers (captured when it was made). Searching
 *     for it finds the exact span wherever it ended up, and survives source
 *     edits elsewhere in the document.
 *  2. The SyncTeX source location. Coarser — it resolves a source line, so a
 *     half-paragraph highlight snaps to that line's box — and only as good as
 *     the stored line number, which the user may since have edited around. But
 *     it is the only route for annotations with no text under them.
 *
 * Anything a route was tried on and failed is reported as drifted rather than
 * moved, so the UI can say so instead of pretending. An annotation with neither
 * a text nor a source locator is reported as unverified instead: we cannot tell
 * whether it moved, and calling that drift would cry wolf on every old
 * annotation in the project.
 */

/** Shorter needles than this match half the document. */
const MIN_ANCHOR_TEXT = 6;
/** Handed to MuPDF as the needle. Long multi-line needles miss more often than
 *  they help; the opening words are enough to identify a span. */
const PRIMARY_NEEDLE_CHARS = 60;
/** Retried on the original page only, for text reflowed enough that the longer
 *  needle no longer matches. */
const FALLBACK_NEEDLE_CHARS = 24;
/** How far from the stored page to look. Edits shift content by a page or two;
 *  sweeping the whole document per annotation would be O(pages x notes). */
const SEARCH_RADIUS_PAGES = 8;
/** MuPDF allocates the quad array up front, and only the first hit is used. */
const MAX_HITS_PER_PAGE = 4;
/** Ceiling on one pass, so a pathological project cannot hang the preview. */
const MAX_REANCHOR_ANNOTATIONS = 500;
/** PDF points. Sub-point jitter between builds is not a move worth saving. */
const POSITION_EPSILON = 1.5;

export interface ReanchorBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReanchorContext {
  pageCount: number;
  /** pageIndex is 0-based, matching the MuPDF client. */
  searchPage(
    pageIndex: number,
    needle: string,
    maxHits: number,
  ): Promise<Rect[][]>;
  /** Batched SyncTeX forward search, results index-aligned with the input.
   *  Batched because resolving one location means reading and parsing the whole
   *  synctex file — minutes of work if repeated per annotation. */
  forwardSearch(
    sources: ReviewSourceLocation[],
  ): Promise<(ReanchorBox | null)[]>;
  isCancelled?(): boolean;
}

/** Collapse the whitespace MuPDF reports between lines so the needle still
 *  matches text that has since been rewrapped. */
function normalizeNeedle(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Cut at a word boundary — a needle ending mid-word matches nothing. */
function truncateNeedle(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Pages to try, nearest to `page` first: p, p+1, p-1, p+2, p-2, and so on. */
export function pagesNearest(
  page: number,
  pageCount: number,
  radius = SEARCH_RADIUS_PAGES,
): number[] {
  const pages: number[] = [];
  const start = Math.min(Math.max(1, page), Math.max(1, pageCount));
  for (let offset = 0; offset <= radius; offset++) {
    const candidates =
      offset === 0 ? [start] : [start + offset, start - offset];
    for (const candidate of candidates) {
      if (candidate >= 1 && candidate <= pageCount) pages.push(candidate);
    }
  }
  return pages;
}

/** Bounding box over every rectangle a match covers — a match wrapping across
 *  lines reports one rect per line. */
function boundsOf(rects: Rect[]): Omit<ReanchorBox, "page"> | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w);
    bottom = Math.max(bottom, rect.y + rect.h);
  }
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** Whether an annotation carries text worth searching for. Also decides
 *  whether a failure counts as evidence of drift: text we never searched for
 *  tells us nothing. */
function isSearchable(text: string | undefined): boolean {
  return normalizeNeedle(text ?? "").length >= MIN_ANCHOR_TEXT;
}

async function relocateByText(
  anchor: ReviewAnchor,
  ctx: ReanchorContext,
): Promise<ReanchorBox | null> {
  if (!isSearchable(anchor.selectedText)) return null;
  const text = normalizeNeedle(anchor.selectedText ?? "");

  const primary = truncateNeedle(text, PRIMARY_NEEDLE_CHARS);

  const findOn = async (page: number, needle: string) => {
    let hits: Rect[][];
    try {
      hits = await ctx.searchPage(page - 1, needle, MAX_HITS_PER_PAGE);
    } catch {
      // One unreadable page should not abandon the annotation.
      return null;
    }
    for (const rects of hits) {
      const bounds = boundsOf(rects);
      if (bounds) return { page, ...bounds };
    }
    return null;
  };

  for (const page of pagesNearest(anchor.page, ctx.pageCount)) {
    if (ctx.isCancelled?.()) return null;
    const found = await findOn(page, primary);
    if (found) return found;
  }

  // Last resort, and only where the annotation started: a short needle over the
  // whole radius would happily match an unrelated paragraph two pages away.
  const fallback = truncateNeedle(text, FALLBACK_NEEDLE_CHARS);
  if (fallback !== primary && fallback.length >= MIN_ANCHOR_TEXT) {
    if (ctx.isCancelled?.()) return null;
    return findOn(Math.min(Math.max(1, anchor.page), ctx.pageCount), fallback);
  }
  return null;
}

/** Apply a located box to an anchor, reporting whether it actually moved.
 *  Point pins keep their own size — text search and SyncTeX both report the
 *  size of the surrounding text, which is not the size of a pin. */
function settle(
  id: string,
  anchor: ReviewAnchor,
  box: ReanchorBox,
): ReviewAnchorUpdate {
  const keepSize = anchor.kind === "point";
  const next: ReviewAnchor = {
    ...anchor,
    page: box.page,
    x: box.x,
    y: box.y,
    width: keepSize || box.width <= 0 ? anchor.width : box.width,
    height: keepSize || box.height <= 0 ? anchor.height : box.height,
  };
  const unchanged =
    next.page === anchor.page &&
    Math.abs(next.x - anchor.x) < POSITION_EPSILON &&
    Math.abs(next.y - anchor.y) < POSITION_EPSILON &&
    Math.abs(next.width - anchor.width) < POSITION_EPSILON &&
    Math.abs(next.height - anchor.height) < POSITION_EPSILON;
  return unchanged
    ? { id, anchor, status: "ok" }
    : { id, anchor: next, status: "moved" };
}

/**
 * Check the given annotations against the current PDF and report where each
 * belongs now. Callers filter out annotations already checked against this
 * build — the pass is idempotent, but not free.
 */
export async function reanchorAnnotations(
  comments: readonly ReviewComment[],
  ctx: ReanchorContext,
): Promise<ReviewAnchorUpdate[]> {
  if (ctx.pageCount <= 0) return [];
  const updates: ReviewAnchorUpdate[] = [];
  /** Annotations text search could not place, paired with their source line. */
  const needSynctex: {
    comment: ReviewComment;
    source: ReviewSourceLocation;
  }[] = [];

  for (const comment of comments.slice(0, MAX_REANCHOR_ANNOTATIONS)) {
    if (ctx.isCancelled?.()) return updates;
    const box = await relocateByText(comment.anchor, ctx);
    // A search abandoned mid-flight proves nothing — classifying it now would
    // report drift that a newer build has already made irrelevant.
    if (ctx.isCancelled?.()) return updates;
    if (box) {
      updates.push(settle(comment.id, comment.anchor, box));
    } else if (comment.anchor.source) {
      needSynctex.push({ comment, source: comment.anchor.source });
    } else {
      updates.push({
        id: comment.id,
        anchor: comment.anchor,
        status: isSearchable(comment.anchor.selectedText)
          ? "drifted"
          : "unverified",
      });
    }
  }

  if (needSynctex.length > 0 && !ctx.isCancelled?.()) {
    let boxes: (ReanchorBox | null)[] = [];
    try {
      boxes = await ctx.forwardSearch(needSynctex.map((entry) => entry.source));
    } catch {
      boxes = [];
    }
    needSynctex.forEach(({ comment }, index) => {
      const box = boxes[index];
      updates.push(
        box && box.page >= 1 && box.page <= ctx.pageCount
          ? settle(comment.id, comment.anchor, box)
          : { id: comment.id, anchor: comment.anchor, status: "drifted" },
      );
    });
  }

  return updates;
}
