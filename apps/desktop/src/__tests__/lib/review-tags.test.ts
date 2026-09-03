import { describe, expect, it } from "vitest";
import {
  collectReviewTags,
  dedupeReviewTags,
  MAX_REVIEW_TAGS,
  normalizeReviewTag,
  parseReviewTags,
} from "@/lib/review-tags";

describe("normalizeReviewTag", () => {
  it("folds spelling variants onto one tag", () => {
    const expected = "likely-question";
    for (const raw of [
      "likely-question",
      "Likely Question",
      "#likely question",
      "  LIKELY_QUESTION  ",
    ]) {
      expect(normalizeReviewTag(raw)).toBe(expected);
    }
  });

  it("rejects input with nothing usable in it", () => {
    expect(normalizeReviewTag("#")).toBeNull();
    expect(normalizeReviewTag("   ")).toBeNull();
    expect(normalizeReviewTag("!!!")).toBeNull();
  });

  it("truncates without leaving a trailing separator", () => {
    const tag = normalizeReviewTag("a".repeat(30));
    expect(tag).toBe("a".repeat(24));
    // The cut can land on a separator; the tag should not end in one.
    expect(normalizeReviewTag("chapter three needs a much longer title")).toBe(
      "chapter-three-needs-a",
    );
  });
});

describe("parseReviewTags", () => {
  it("splits on commas and whitespace alike", () => {
    expect(parseReviewTags("typo, cite-check")).toEqual(["typo", "cite-check"]);
    expect(parseReviewTags("typo cite-check")).toEqual(["typo", "cite-check"]);
  });

  it("drops duplicates that normalise to the same tag", () => {
    expect(parseReviewTags("Typo, typo, #TYPO")).toEqual(["typo"]);
  });
});

describe("dedupeReviewTags", () => {
  it("keeps first-seen order and caps the list", () => {
    const many = Array.from({ length: MAX_REVIEW_TAGS + 3 }, (_, i) => `t${i}`);
    const result = dedupeReviewTags(many);
    expect(result).toHaveLength(MAX_REVIEW_TAGS);
    expect(result[0]).toBe("t0");
  });
});

describe("collectReviewTags", () => {
  it("counts tags, most used first, ties broken alphabetically", () => {
    expect(
      collectReviewTags([
        { tags: ["weakness", "defend"] },
        { tags: ["weakness"] },
        { tags: ["defend"] },
        { tags: ["a-tag"] },
        {},
      ]),
    ).toEqual([
      { tag: "defend", count: 2 },
      { tag: "weakness", count: 2 },
      { tag: "a-tag", count: 1 },
    ]);
  });
});
