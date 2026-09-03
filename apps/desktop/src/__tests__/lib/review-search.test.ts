import { describe, expect, it } from "vitest";
import { filterReviewComments, matchesReviewQuery } from "@/lib/review-search";
import type { ReviewComment } from "@/stores/review-store";

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "review-1",
    kind: "comment",
    documentRoot: "main.tex",
    author: "Dany",
    body: "Justify the sample size here.",
    status: "open",
    anchor: {
      kind: "text",
      page: 12,
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      selectedText: "The estimator remains unbiased.",
    },
    tags: ["weakness", "likely-question"],
    replies: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("matchesReviewQuery", () => {
  it("matches everything when the query is blank", () => {
    expect(matchesReviewQuery(makeComment(), "")).toBe(true);
    expect(matchesReviewQuery(makeComment(), "   ")).toBe(true);
  });

  it("searches the note, the quoted text and the author", () => {
    const comment = makeComment();
    expect(matchesReviewQuery(comment, "sample size")).toBe(true);
    expect(matchesReviewQuery(comment, "unbiased")).toBe(true);
    expect(matchesReviewQuery(comment, "dany")).toBe(true);
    expect(matchesReviewQuery(comment, "bibliography")).toBe(false);
  });

  it("ignores case", () => {
    expect(matchesReviewQuery(makeComment(), "JUSTIFY")).toBe(true);
  });

  it("narrows as terms are added rather than widening", () => {
    const comment = makeComment();
    expect(matchesReviewQuery(comment, "justify estimator")).toBe(true);
    expect(matchesReviewQuery(comment, "justify bibliography")).toBe(false);
  });

  it("restricts a #term to tags", () => {
    const comment = makeComment({ body: "no tag word in the body here" });
    expect(matchesReviewQuery(comment, "#weakness")).toBe(true);
    expect(matchesReviewQuery(comment, "#missing")).toBe(false);
    // The same word without the hash searches everything, so a note that only
    // mentions it in prose still matches.
    expect(
      matchesReviewQuery(
        makeComment({ body: "a weakness", tags: [] }),
        "#weakness",
      ),
    ).toBe(false);
    expect(
      matchesReviewQuery(
        makeComment({ body: "a weakness", tags: [] }),
        "weakness",
      ),
    ).toBe(true);
  });

  it("mixes a tag term with a text term", () => {
    const comment = makeComment();
    expect(matchesReviewQuery(comment, "#weakness sample")).toBe(true);
    expect(matchesReviewQuery(comment, "#weakness bibliography")).toBe(false);
  });

  it("searches replies, where the answer often lives", () => {
    const comment = makeComment({
      replies: [
        {
          id: "r1",
          author: "Peer",
          body: "Cite the power calculation.",
          createdAt: "2026-08-12T10:00:00.000Z",
        },
      ],
    });
    expect(matchesReviewQuery(comment, "power calculation")).toBe(true);
    expect(matchesReviewQuery(comment, "peer")).toBe(true);
  });

  it("treats a bare # as ordinary text rather than an empty tag filter", () => {
    expect(matchesReviewQuery(makeComment({ body: "issue #4" }), "#")).toBe(
      true,
    );
  });
});

describe("filterReviewComments", () => {
  it("returns a copy untouched when there is no query", () => {
    const comments = [makeComment()];
    const result = filterReviewComments(comments, "");
    expect(result).toEqual(comments);
    expect(result).not.toBe(comments);
  });

  it("keeps only matching annotations", () => {
    const comments = [
      makeComment({ id: "a", body: "check the sample" }),
      makeComment({ id: "b", body: "check the citation" }),
    ];
    expect(filterReviewComments(comments, "sample").map((c) => c.id)).toEqual([
      "a",
    ]);
  });
});
