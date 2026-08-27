import { describe, expect, it } from "vitest";
import { reviewGutterEntries } from "@/lib/review-gutter";
import type { ReviewComment } from "@/stores/review-store";

function makeComment(
  overrides: Partial<ReviewComment> = {},
  source: { file: string; line: number } | null = {
    file: "chapters/method.tex",
    line: 214,
  },
): ReviewComment {
  return {
    id: "review-1",
    kind: "comment",
    documentRoot: "main.tex",
    author: "Dany",
    body: "Clarify this.",
    status: "open",
    anchor: {
      kind: "text",
      page: 12,
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      source: source
        ? { file: source.file, line: source.line, column: 0 }
        : undefined,
    },
    replies: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("reviewGutterEntries", () => {
  it("keeps only annotations pointing at the file on screen", () => {
    const entries = reviewGutterEntries(
      [
        makeComment({ id: "a" }, { file: "chapters/method.tex", line: 214 }),
        makeComment({ id: "b" }, { file: "chapters/results.tex", line: 5 }),
      ],
      "chapters/method.tex",
    );

    expect(entries).toEqual([{ line: 214, ids: ["a"], openCount: 1 }]);
  });

  it("matches paths across separators and ./ prefixes", () => {
    const entries = reviewGutterEntries(
      [makeComment({ id: "a" }, { file: "./chapters\\method.tex", line: 3 })],
      "chapters/method.tex",
    );

    expect(entries).toHaveLength(1);
  });

  it("groups several annotations on one line, open ones first", () => {
    const entries = reviewGutterEntries(
      [
        makeComment(
          {
            id: "resolved",
            status: "resolved",
            createdAt: "2026-08-01T10:00:00.000Z",
          },
          { file: "a.tex", line: 10 },
        ),
        makeComment(
          { id: "newer-open", createdAt: "2026-08-05T10:00:00.000Z" },
          { file: "a.tex", line: 10 },
        ),
        makeComment(
          { id: "older-open", createdAt: "2026-08-02T10:00:00.000Z" },
          { file: "a.tex", line: 10 },
        ),
      ],
      "a.tex",
    );

    // Clicking the marker reveals ids[0], so an open note must sort ahead of a
    // resolved one on the same line.
    expect(entries[0].ids).toEqual(["older-open", "newer-open", "resolved"]);
    expect(entries[0].openCount).toBe(2);
  });

  it("returns entries in line order", () => {
    const entries = reviewGutterEntries(
      [
        makeComment({ id: "a" }, { file: "a.tex", line: 90 }),
        makeComment({ id: "b" }, { file: "a.tex", line: 12 }),
      ],
      "a.tex",
    );

    expect(entries.map((entry) => entry.line)).toEqual([12, 90]);
  });

  it("skips annotations with no source location", () => {
    expect(reviewGutterEntries([makeComment({}, null)], "a.tex")).toEqual([]);
  });

  it("skips nonsense line numbers rather than placing a marker at zero", () => {
    expect(
      reviewGutterEntries(
        [
          makeComment({ id: "a" }, { file: "a.tex", line: 0 }),
          makeComment({ id: "b" }, { file: "a.tex", line: -3 }),
        ],
        "a.tex",
      ),
    ).toEqual([]);
  });

  it("still marks a line whose annotations are all resolved", () => {
    const entries = reviewGutterEntries(
      [
        makeComment(
          { id: "a", status: "resolved" },
          { file: "a.tex", line: 4 },
        ),
      ],
      "a.tex",
    );

    expect(entries).toEqual([{ line: 4, ids: ["a"], openCount: 0 }]);
  });
});
