import { describe, expect, it, vi } from "vitest";
import { firstMatchFromPage, searchPdfPages } from "@/lib/mupdf/pdf-search";
import type { PdfSearchMatch, Rect } from "@/lib/mupdf/types";

const rect = (y: number): Rect => ({ x: 10, y, w: 40, h: 12 });

/** A searchPage stub returning the hits configured per page index. */
function pages(hits: Record<number, Rect[][]>) {
  return vi.fn(async (pageIndex: number) => hits[pageIndex] ?? []);
}

describe("searchPdfPages", () => {
  it("collects matches across pages in document order", async () => {
    const searchPage = pages({
      0: [[rect(100)]],
      2: [[rect(50)], [rect(200)]],
    });

    const result = await searchPdfPages(searchPage, 3, "needle");

    expect(result.truncated).toBe(false);
    expect(result.matches.map((match) => match.page)).toEqual([1, 3, 3]);
    expect(result.matches[0].rects).toEqual([rect(100)]);
  });

  it("keeps every rectangle of a match that wraps across lines", async () => {
    const searchPage = pages({ 0: [[rect(100), rect(115)]] });

    const result = await searchPdfPages(searchPage, 1, "needle");

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].rects).toHaveLength(2);
  });

  it("returns nothing for a blank query without touching the document", async () => {
    const searchPage = pages({ 0: [[rect(100)]] });

    const result = await searchPdfPages(searchPage, 3, "   ");

    expect(result.matches).toEqual([]);
    expect(searchPage).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace from the query", async () => {
    const searchPage = pages({ 0: [[rect(100)]] });

    await searchPdfPages(searchPage, 1, "  needle  ");

    expect(searchPage).toHaveBeenCalledWith(0, "needle", expect.any(Number));
  });

  it("stops at the match cap and reports truncation", async () => {
    const searchPage = pages({
      0: [[rect(10)], [rect(20)]],
      1: [[rect(30)], [rect(40)]],
      2: [[rect(50)]],
    });

    const result = await searchPdfPages(searchPage, 3, "needle", {
      maxMatches: 3,
    });

    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(3);
    // The third page is never reached once the cap is hit.
    expect(searchPage).toHaveBeenCalledTimes(2);
  });

  it("stops sweeping once cancelled", async () => {
    const searchPage = pages({ 0: [[rect(10)]], 1: [[rect(20)]] });
    let cancelled = false;

    const result = await searchPdfPages(searchPage, 5, "needle", {
      isCancelled: () => cancelled,
      onPartial: () => {
        cancelled = true;
      },
    });

    expect(searchPage).toHaveBeenCalledTimes(1);
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it("skips a page that fails to search rather than aborting the sweep", async () => {
    const searchPage = vi.fn(async (pageIndex: number) => {
      if (pageIndex === 1) throw new Error("bad page");
      return [[rect(10)]];
    });

    const result = await searchPdfPages(searchPage, 3, "needle");

    expect(result.matches.map((match) => match.page)).toEqual([1, 3]);
  });

  it("ignores hits that carry no rectangles", async () => {
    const searchPage = pages({ 0: [[], [rect(10)]] });

    const result = await searchPdfPages(searchPage, 1, "needle");

    expect(result.matches).toHaveLength(1);
  });

  it("streams partial results with a fresh array each time", async () => {
    const searchPage = pages({ 0: [[rect(10)]], 1: [[rect(20)]] });
    const snapshots: PdfSearchMatch[][] = [];

    await searchPdfPages(searchPage, 2, "needle", {
      onPartial: (matches) => snapshots.push(matches),
    });

    expect(snapshots.map((snapshot) => snapshot.length)).toEqual([1, 2]);
    // Snapshots must not alias the accumulator, or React would see one
    // unchanging array reference and never re-render.
    expect(snapshots[0]).toHaveLength(1);
    expect(snapshots[0]).not.toBe(snapshots[1]);
  });
});

describe("firstMatchFromPage", () => {
  const matches: PdfSearchMatch[] = [
    { page: 2, rects: [rect(10)] },
    { page: 5, rects: [rect(20)] },
    { page: 9, rects: [rect(30)] },
  ];

  it("selects the first match at or after the given page", () => {
    expect(firstMatchFromPage(matches, 5)).toBe(1);
    expect(firstMatchFromPage(matches, 3)).toBe(1);
  });

  it("selects the first match when the reader is before them all", () => {
    expect(firstMatchFromPage(matches, 1)).toBe(0);
  });

  it("wraps to the first match when the reader is past them all", () => {
    expect(firstMatchFromPage(matches, 20)).toBe(0);
  });

  it("returns -1 when there are no matches", () => {
    expect(firstMatchFromPage([], 3)).toBe(-1);
  });
});
