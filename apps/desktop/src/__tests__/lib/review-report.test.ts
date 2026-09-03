import { describe, expect, it } from "vitest";
import { buildReviewReport, reviewReportFileName } from "@/lib/review-report";
import type { ReviewComment } from "@/stores/review-store";

const EXPORTED_AT = new Date("2026-08-27T12:00:00.000Z");

function makeComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "review-1",
    kind: "comment",
    documentRoot: "main.tex",
    author: "Dany",
    body: "Clarify this sentence.",
    status: "open",
    anchor: {
      kind: "text",
      page: 12,
      x: 100,
      y: 200,
      width: 300,
      height: 14,
      selectedText: "The estimator remains unbiased.",
      source: { file: "chapters/method.tex", line: 214, column: 0 },
    },
    replies: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

const options = { documentRoot: "main.tex", exportedAt: EXPORTED_AT };

describe("buildReviewReport", () => {
  it("renders an annotation with its quote, note and source", () => {
    const report = buildReviewReport([makeComment()], options);

    expect(report).toContain("# Review notes — main.tex");
    expect(report).toContain("### p. 12 · Dany · comment · open");
    expect(report).toContain("> The estimator remains unbiased.");
    expect(report).toContain("Clarify this sentence.");
    expect(report).toContain("Source: `chapters/method.tex:214`");
  });

  it("orders entries down the document, not open-first like the panel", () => {
    const report = buildReviewReport(
      [
        makeComment({
          id: "c",
          status: "open",
          body: "third",
          anchor: { ...makeComment().anchor, page: 12, y: 500 },
        }),
        makeComment({
          id: "a",
          status: "resolved",
          body: "first",
          anchor: { ...makeComment().anchor, page: 3, y: 100 },
        }),
        makeComment({
          id: "b",
          status: "open",
          body: "second",
          anchor: { ...makeComment().anchor, page: 12, y: 100 },
        }),
      ],
      options,
    );

    expect(report.indexOf("first")).toBeLessThan(report.indexOf("second"));
    expect(report.indexOf("second")).toBeLessThan(report.indexOf("third"));
  });

  it("counts open and total, and names the reviewers", () => {
    const report = buildReviewReport(
      [
        makeComment({ id: "a", author: "Dany" }),
        makeComment({ id: "b", author: "Peer", status: "resolved" }),
      ],
      options,
    );

    expect(report).toContain("2 annotations (1 open)");
    expect(report).toContain("reviewers: Dany, Peer");
  });

  it("summarises tags with their open counts", () => {
    const report = buildReviewReport(
      [
        makeComment({ id: "a", tags: ["weakness"] }),
        makeComment({ id: "b", tags: ["weakness"], status: "resolved" }),
      ],
      options,
    );

    expect(report).toContain("## By tag");
    expect(report).toContain("| weakness | 1 | 2 |");
    expect(report).toContain("`#weakness`");
  });

  it("leaves the tag table out when nothing is tagged", () => {
    expect(buildReviewReport([makeComment()], options)).not.toContain(
      "## By tag",
    );
  });

  it("says what a filtered export left out", () => {
    const report = buildReviewReport([makeComment()], {
      ...options,
      filterNote: "open annotations, tagged #weakness",
      totalCount: 9,
    });

    expect(report).toContain(
      "> Filtered to open annotations, tagged #weakness — 1 of 9 annotations.",
    );
  });

  it("does not claim to have left anything out when the filter kept everything", () => {
    const report = buildReviewReport([makeComment()], {
      ...options,
      filterNote: "open annotations",
      totalCount: 1,
    });

    expect(report).toContain("> Filtered to open annotations.");
  });

  it("marks a highlight that carries no note", () => {
    const report = buildReviewReport(
      [makeComment({ kind: "highlight", body: "" })],
      options,
    );

    expect(report).toContain("*Highlighted, no note.*");
  });

  it("quotes replies under their annotation", () => {
    const report = buildReviewReport(
      [
        makeComment({
          replies: [
            {
              id: "r1",
              author: "Peer",
              body: "Agreed, cite Wooldridge.",
              createdAt: "2026-08-12T10:00:00.000Z",
            },
          ],
        }),
      ],
      options,
    );

    expect(report).toMatch(/\*\*Peer\*\* replied \(.+\):/);
    expect(report).toContain("> Agreed, cite Wooldridge.");
  });

  it("keeps a multi-line quote inside the blockquote", () => {
    const report = buildReviewReport(
      [
        makeComment({
          anchor: {
            ...makeComment().anchor,
            selectedText: "first line\nsecond line",
          },
        }),
      ],
      options,
    );

    expect(report).toContain("> first line\n> second line");
  });

  it("still produces a readable document when nothing matches", () => {
    const report = buildReviewReport([], options);

    expect(report).toContain("# Review notes — main.tex");
    expect(report).toContain("No annotations to report.");
    expect(report).not.toContain("## Annotations");
  });
});

describe("reviewReportFileName", () => {
  it("derives the name from the root file", () => {
    expect(reviewReportFileName("main.tex")).toBe("main-review.md");
    expect(reviewReportFileName("thesis/main.tex")).toBe(
      "thesis-main-review.md",
    );
  });
});
