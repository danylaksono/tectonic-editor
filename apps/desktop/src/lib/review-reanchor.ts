import type { Rect } from "@/lib/mupdf/types";
import type {
  ReviewAnchor,
  ReviewAnchorUpdate,
  ReviewComment,
  ReviewSourceLocation,
} from "@/stores/review-store";

/**
 * Checking review annotations against a freshly compiled PDF.
 *
 * Annotations are stored as page + x/y boxes measured against one exact build,
 * so a recompile that reflows text leaves them pointing somewhere else.
 *
 * This pass reports that; it does not repair it. An annotation stays exactly
 * where it was placed, because that position is a deliberate act — the reader
 * put the box where they meant it, over a figure, a margin, a region — and
 * re-seating it on whatever the text search matched replaces their judgement
 * with a guess. A confidently wrong new position is worse than a stale one: it
 * looks authoritative. So the pass answers "is this still true?" and leaves
 * acting on the answer to the person.
 *
 * Two ways to ask, in order of precision:
 *
 *  1. The text the annotation covers (captured when it was made). Searching
 *     for it finds the exact span wherever it ended up, and survives source
 *     edits elsewhere in the document.
 *  2. The SyncTeX source location. Coarser — it resolves a source line rather
 *     than a span — and only as good as the stored line number, which the user
 *     may since have edited around. But it is the only route for annotations
 *     with no text under them.
 *
 * Four outcomes: the text is where the annotation is (ok), it is somewhere
 * else and we know where (shifted), it is gone (drifted), or there was nothing
 * to search by in the first place (unverified) — which is not evidence either
 * way, and calling it drift would cry wolf over every old annotation.
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
/** PDF points. Roughly a line of body text: rebuilds nudge things by fractions
 *  of a point, and a highlight drawn a little above its words should not be
 *  reported as having moved. */
const POSITION_TOLERANCE = 12;

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

/** Compare where the text turned up against where the annotation sits.
 *
 *  Only the top-left corner is compared. Size is deliberately ignored: a
 *  dragged highlight is whatever box the reader swept out, which has no reason
 *  to match the bounding box of the words inside it, and treating that
 *  difference as movement would report drift on every annotation ever made
 *  with the highlighter. */
function classify(
  id: string,
  anchor: ReviewAnchor,
  box: ReanchorBox,
): ReviewAnchorUpdate {
  const inPlace =
    box.page === anchor.page &&
    Math.abs(box.x - anchor.x) < POSITION_TOLERANCE &&
    Math.abs(box.y - anchor.y) < POSITION_TOLERANCE;
  return inPlace
    ? { id, status: "ok" }
    : { id, status: "shifted", foundAt: box };
}

/**
 * Check the given annotations against the current PDF. Nothing is modified:
 * the result says, per annotation, whether its text is still under it and
 * where else it turned up. Callers filter out annotations already checked
 * against this build — the pass is idempotent, but not free.
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
      updates.push(classify(comment.id, comment.anchor, box));
    } else if (comment.anchor.source) {
      needSynctex.push({ comment, source: comment.anchor.source });
    } else {
      updates.push({
        id: comment.id,
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
          ? classify(comment.id, comment.anchor, box)
          : { id: comment.id, status: "drifted" },
      );
    });
  }

  return updates;
}
