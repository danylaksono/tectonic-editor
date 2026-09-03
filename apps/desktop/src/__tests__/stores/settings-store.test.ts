import { describe, it, expect } from "vitest";
import {
  useSettingsStore,
  clampEditorFontSize,
  DEFAULT_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  MAX_EDITOR_FONT_SIZE,
} from "@/stores/settings-store";
import {
  DEFAULT_REVIEW_TAGS,
  MAX_SUGGESTED_REVIEW_TAGS,
} from "@/lib/review-tags";

describe("editor font size", () => {
  it("defaults to DEFAULT_EDITOR_FONT_SIZE", () => {
    expect(useSettingsStore.getState().editorFontSize).toBe(
      DEFAULT_EDITOR_FONT_SIZE,
    );
  });

  it("clampEditorFontSize clamps out-of-range and non-finite values", () => {
    expect(clampEditorFontSize(1)).toBe(MIN_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(100)).toBe(MAX_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(Number.NaN)).toBe(DEFAULT_EDITOR_FONT_SIZE);
    expect(clampEditorFontSize(15.6)).toBe(16);
  });

  it("setEditorFontSize stores a clamped value", () => {
    useSettingsStore.getState().setEditorFontSize(MAX_EDITOR_FONT_SIZE + 10);
    expect(useSettingsStore.getState().editorFontSize).toBe(
      MAX_EDITOR_FONT_SIZE,
    );
    useSettingsStore.getState().setEditorFontSize(DEFAULT_EDITOR_FONT_SIZE);
    expect(useSettingsStore.getState().editorFontSize).toBe(
      DEFAULT_EDITOR_FONT_SIZE,
    );
  });
});

describe("review tag vocabulary", () => {
  it("starts from the built-in list", () => {
    expect(useSettingsStore.getState().reviewTags).toEqual(DEFAULT_REVIEW_TAGS);
  });

  it("normalises what the user types so the panel and the list agree", () => {
    useSettingsStore.getState().setReviewTags(["Likely Question", "#TYPO  "]);
    expect(useSettingsStore.getState().reviewTags).toEqual([
      "likely-question",
      "typo",
    ]);
  });

  it("drops duplicates and blanks", () => {
    useSettingsStore.getState().setReviewTags(["typo", "Typo", "  ", "#"]);
    expect(useSettingsStore.getState().reviewTags).toEqual(["typo"]);
  });

  it("allows a longer vocabulary than one annotation can carry", () => {
    const many = Array.from({ length: 30 }, (_, i) => `tag-${i}`);
    useSettingsStore.getState().setReviewTags(many);
    expect(useSettingsStore.getState().reviewTags).toHaveLength(
      MAX_SUGGESTED_REVIEW_TAGS,
    );
  });

  it("can be emptied, which just means no suggestions", () => {
    useSettingsStore.getState().setReviewTags([]);
    expect(useSettingsStore.getState().reviewTags).toEqual([]);
    useSettingsStore.getState().setReviewTags([...DEFAULT_REVIEW_TAGS]);
  });
});
