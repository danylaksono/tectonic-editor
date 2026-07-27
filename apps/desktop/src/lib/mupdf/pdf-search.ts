import type { PdfSearchMatch, Rect } from "./types";

/** Hard cap on collected matches. A common word in a thesis-length document
 * can match tens of thousands of times; past a few hundred the find bar is
 * useless anyway, and every match retained is overlay DOM the viewer has to
 * keep alive. */
export const MAX_PDF_SEARCH_MATCHES = 500;

/** Per-page cap handed to MuPDF, which allocates the quad array up front. */
const MAX_HITS_PER_PAGE = 200;

export interface PdfSearchResult {
  matches: PdfSearchMatch[];
  /** True when the sweep stopped at the match cap rather than the last page. */
  truncated: boolean;
}

export interface PdfSearchOptions {
  maxMatches?: number;
  /** Polled between pages so a superseded query stops mid-sweep. */
  isCancelled?: () => boolean;
  /** Called after each page so results can stream into the UI. */
  onPartial?: (matches: PdfSearchMatch[], pagesSearched: number) => void;
}

/**
 * Sweep every page for `query`, in document order so match order matches
 * reading order.
 *
 * `searchPage` is injected rather than taken from the MuPDF client so the
 * sweep can be tested without the WASM worker.
 */
export async function searchPdfPages(
  searchPage: (
    pageIndex: number,
    needle: string,
    maxHits: number,
  ) => Promise<Rect[][]>,
  pageCount: number,
  query: string,
  options: PdfSearchOptions = {},
): Promise<PdfSearchResult> {
  const maxMatches = options.maxMatches ?? MAX_PDF_SEARCH_MATCHES;
  const needle = query.trim();
  const matches: PdfSearchMatch[] = [];
  if (!needle) return { matches, truncated: false };

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    if (options.isCancelled?.()) break;

    let hits: Rect[][];
    try {
      hits = await searchPage(pageIndex, needle, MAX_HITS_PER_PAGE);
    } catch {
      // One unreadable page shouldn't abandon the rest of the document.
      continue;
    }

    for (const rects of hits) {
      // MuPDF can report a hit with no quads for zero-width matches.
      if (rects.length === 0) continue;
      matches.push({ page: pageIndex + 1, rects });
      if (matches.length >= maxMatches) {
        options.onPartial?.([...matches], pageIndex + 1);
        return { matches, truncated: true };
      }
    }

    options.onPartial?.([...matches], pageIndex + 1);
  }

  return { matches, truncated: false };
}

/** Index of the first match at or after `page`, falling back to the first
 * match overall. Keeps "find" starting from what the reader is looking at
 * rather than from page 1. */
export function firstMatchFromPage(
  matches: PdfSearchMatch[],
  page: number,
): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.page >= page);
  return index === -1 ? 0 : index;
}
