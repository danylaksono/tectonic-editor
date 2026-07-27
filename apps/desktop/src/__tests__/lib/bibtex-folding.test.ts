import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bibEntryFoldRange } from "@/components/workspace/editor/lang-bibtex";

/** Fold the entry starting on the given 1-based line of `source`. */
function foldFrom(source: string, lineNumber: number) {
  const state = EditorState.create({ doc: source });
  const line = state.doc.line(lineNumber);
  return bibEntryFoldRange(state, line.from, line.to);
}

/** The text a fold range would hide. */
function folded(source: string, lineNumber: number) {
  const range = foldFrom(source, lineNumber);
  if (!range) return null;
  return source.slice(range.from, range.to);
}

describe("bibEntryFoldRange", () => {
  it("folds from the end of the opening line to the closing brace", () => {
    const source = [
      "@article{smith2020,",
      "  title = {A Title},",
      "  year = {2020}",
      "}",
    ].join("\n");

    expect(folded(source, 1)).toBe("\n  title = {A Title},\n  year = {2020}\n");
  });

  it("ignores lines that do not open an entry", () => {
    const source = ["@article{smith2020,", "  title = {A Title}", "}"].join(
      "\n",
    );

    expect(foldFrom(source, 2)).toBeNull();
  });

  it("does not fold an entry that fits on one line", () => {
    expect(foldFrom("@misc{k, title = {T}}", 1)).toBeNull();
  });

  it("keeps nested and escaped braces inside field values out of the fold boundary", () => {
    const source = [
      "@article{key,",
      "  title = {A {Nested} Title},",
      "  note = {an escaped \\} stays inside the value}",
      "}",
    ].join("\n");

    const range = foldFrom(source, 1);
    expect(range).not.toBeNull();
    expect(source.slice(range!.to)).toBe("}");
  });

  it("treats quoted field values as opaque", () => {
    const source = [
      "@article{key,",
      '  title = "A } brace in a quoted value",',
      "  year = {2020}",
      "}",
    ].join("\n");

    const range = foldFrom(source, 1);
    expect(range).not.toBeNull();
    expect(source.slice(range!.to)).toBe("}");
  });

  it("supports parenthesis-delimited entries", () => {
    const source = ["@article(key,", "  title = {A Title}", ")"].join("\n");

    const range = foldFrom(source, 1);
    expect(range).not.toBeNull();
    expect(source.slice(range!.to)).toBe(")");
  });

  it("skips @comment blocks", () => {
    const source = ["@comment{", "  anything at all", "}"].join("\n");

    expect(foldFrom(source, 1)).toBeNull();
  });

  it("returns null for an entry that is never closed", () => {
    const source = ["@article{key,", "  title = {A Title}"].join("\n");

    expect(foldFrom(source, 1)).toBeNull();
  });
});
