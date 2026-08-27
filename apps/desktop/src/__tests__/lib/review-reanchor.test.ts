import { describe, expect, it, vi } from "vitest";
import { pagesNearest, reanchorAnnotations } from "@/lib/review-reanchor";
import type { Rect } from "@/lib/mupdf/types";
import type { ReviewAnchor, ReviewComment } from "@/stores/review-store";

const SENTENCE =
  "The estimator remains unbiased under the stated regularity conditions.";

function makeComment(
  anchor: Partial<ReviewAnchor> = {},
  id = "review-1",
): ReviewComment {
  return {
    id,
    kind: "highlight",
    documentRoot: "main.tex",
    author: "Dany",
    body: "",
    status: "open",
    anchor: {
      kind: "text",
      page: 12,
      x: 100,
      y: 200,
      width: 300,
      height: 14,
      selectedText: SENTENCE,
      ...anchor,
    },
    replies: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
}

/** A PDF whose only copy of the sentence lives on `hitPage`. */
function searchStub(hitPage: number, rects: Rect[]) {
  return vi.fn(async (pageIndex: number) =>
    pageIndex + 1 === hitPage ? [rects] : [],
  );
}

const noForwardSearch = vi.fn(async () => []);

describe("pagesNearest", () => {
  it("walks outwards from the stored page", () => {
    expect(pagesNearest(5, 100, 2)).toEqual([5, 6, 4, 7, 3]);
  });

  it("stays inside the document", () => {
    expect(pagesNearest(1, 3, 3)).toEqual([1, 2, 3]);
    expect(pagesNearest(99, 3, 2)).toEqual([3, 2, 1]);
  });
});

describe("reanchorAnnotations", () => {
  it("follows text that moved to another page", async () => {
    const searchPage = searchStub(14, [{ x: 90, y: 400, w: 310, h: 16 }]);
    const updates = await reanchorAnnotations([makeComment()], {
      pageCount: 40,
      searchPage,
      forwardSearch: noForwardSearch,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe("moved");
    expect(updates[0].anchor).toMatchObject({
      page: 14,
      x: 90,
      y: 400,
      width: 310,
      height: 16,
    });
    expect(noForwardSearch).not.toHaveBeenCalled();
  });

  it("reports text found where it already was as unchanged, so nothing is rewritten", async () => {
    const comment = makeComment();
    const searchPage = searchStub(12, [{ x: 100, y: 200, w: 300, h: 14 }]);
    const updates = await reanchorAnnotations([comment], {
      pageCount: 40,
      searchPage,
      forwardSearch: noForwardSearch,
    });

    expect(updates[0].status).toBe("ok");
    expect(updates[0].anchor).toBe(comment.anchor);
  });

  it("spans every rectangle of a match that wraps across lines", async () => {
    const searchPage = searchStub(12, [
      { x: 300, y: 200, w: 100, h: 14 },
      { x: 100, y: 216, w: 120, h: 14 },
    ]);
    const updates = await reanchorAnnotations([makeComment()], {
      pageCount: 40,
      searchPage,
      forwardSearch: noForwardSearch,
    });

    expect(updates[0].anchor).toMatchObject({
      x: 100,
      y: 200,
      width: 300,
      height: 30,
    });
  });

  it("falls back to SyncTeX when there is no text to search for", async () => {
    const comment = makeComment({
      kind: "point",
      selectedText: undefined,
      width: 18,
      height: 18,
      source: { file: "chapters/method.tex", line: 42, column: 0 },
    });
    const searchPage = vi.fn(async () => []);
    const forwardSearch = vi.fn(async () => [
      { page: 9, x: 72, y: 512, width: 400, height: 12 },
    ]);

    const updates = await reanchorAnnotations([comment], {
      pageCount: 40,
      searchPage,
      forwardSearch,
    });

    expect(searchPage).not.toHaveBeenCalled();
    expect(forwardSearch).toHaveBeenCalledWith([
      { file: "chapters/method.tex", line: 42, column: 0 },
    ]);
    expect(updates[0].status).toBe("moved");
    // A pin keeps its own size — SyncTeX reports the size of the text line.
    expect(updates[0].anchor).toMatchObject({
      page: 9,
      x: 72,
      y: 512,
      width: 18,
      height: 18,
    });
  });

  it("asks SyncTeX for every unplaced annotation in one batch", async () => {
    const comments = [
      makeComment(
        {
          selectedText: undefined,
          source: { file: "a.tex", line: 1, column: 0 },
        },
        "a",
      ),
      makeComment(
        {
          selectedText: undefined,
          source: { file: "b.tex", line: 2, column: 0 },
        },
        "b",
      ),
    ];
    const forwardSearch = vi.fn(async () => [
      null,
      { page: 3, x: 10, y: 20, width: 100, height: 12 },
    ]);

    const updates = await reanchorAnnotations(comments, {
      pageCount: 40,
      searchPage: vi.fn(async () => []),
      forwardSearch,
    });

    expect(forwardSearch).toHaveBeenCalledTimes(1);
    expect(updates.find((u) => u.id === "a")?.status).toBe("drifted");
    expect(updates.find((u) => u.id === "b")?.status).toBe("moved");
  });

  it("marks an annotation drifted when neither route can place it", async () => {
    const updates = await reanchorAnnotations([makeComment()], {
      pageCount: 40,
      searchPage: vi.fn(async () => []),
      forwardSearch: noForwardSearch,
    });

    expect(updates[0].status).toBe("drifted");
    expect(updates[0].anchor.page).toBe(12);
  });

  it("keeps the annotation rather than throwing when a page cannot be read", async () => {
    const searchPage = vi.fn(async (pageIndex: number) => {
      if (pageIndex === 11) throw new Error("bad page");
      return pageIndex === 12 ? [[{ x: 1, y: 2, w: 3, h: 4 }]] : [];
    });

    const updates = await reanchorAnnotations([makeComment()], {
      pageCount: 40,
      searchPage,
      forwardSearch: noForwardSearch,
    });

    expect(updates[0].status).toBe("moved");
    expect(updates[0].anchor.page).toBe(13);
  });

  it("reports an annotation with nothing to locate it by as unverified, not drifted", async () => {
    const searchPage = vi.fn(async () => [[{ x: 1, y: 2, w: 3, h: 4 }]]);
    const updates = await reanchorAnnotations(
      // Too short to search for, and no source line either.
      [makeComment({ selectedText: "the" })],
      { pageCount: 40, searchPage, forwardSearch: noForwardSearch },
    );

    expect(searchPage).not.toHaveBeenCalled();
    // Never searched, so its position is unknown - claiming drift here would
    // cry wolf over every old annotation in the project.
    expect(updates[0].status).toBe("unverified");
  });

  it("stops when cancelled by a newer build", async () => {
    let cancelled = false;
    const searchPage = vi.fn(async () => {
      cancelled = true;
      return [];
    });

    const updates = await reanchorAnnotations(
      [makeComment({}, "a"), makeComment({}, "b")],
      {
        pageCount: 40,
        searchPage,
        forwardSearch: noForwardSearch,
        isCancelled: () => cancelled,
      },
    );

    expect(updates).toHaveLength(0);
    expect(noForwardSearch).not.toHaveBeenCalled();
  });

  it("does nothing for a document with no pages", async () => {
    const searchPage = vi.fn(async () => []);
    expect(
      await reanchorAnnotations([makeComment()], {
        pageCount: 0,
        searchPage,
        forwardSearch: noForwardSearch,
      }),
    ).toEqual([]);
    expect(searchPage).not.toHaveBeenCalled();
  });
});
