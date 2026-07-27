import { describe, expect, it, vi } from "vitest";
import {
  countPdfWords,
  countWords,
  joinPageLines,
  pageLines,
} from "@/lib/pdf-word-count";
import type { StructuredTextData } from "@/lib/mupdf/types";

/** A structured-text page with one text block holding the given lines. */
function page(...lines: string[]): StructuredTextData {
  return {
    blocks: [
      {
        type: "text",
        bbox: { x: 0, y: 0, w: 500, h: 700 },
        lines: lines.map((text, index) => ({
          bbox: { x: 0, y: index * 14, w: 400, h: 12 },
          wmode: 0,
          x: 0,
          y: index * 14,
          text,
          font: {
            name: "CMR10",
            family: "serif",
            size: 10,
            weight: "normal",
            style: "normal",
          },
        })),
      },
    ],
  };
}

describe("countWords", () => {
  it("counts whitespace-separated tokens", () => {
    expect(countWords("the quick brown fox")).toBe(4);
  });

  it("ignores tokens with no letters or digits", () => {
    expect(countWords("a — b • c")).toBe(3);
  });

  it("counts numbers and alphanumerics as words", () => {
    expect(countWords("Table 3 shows R2 values")).toBe(5);
  });

  it("returns zero for empty and whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n  ")).toBe(0);
  });
});

describe("joinPageLines", () => {
  it("rejoins a word hyphenated across a line break", () => {
    expect(joinPageLines(["a hyphen-", "ation example"])).toBe(
      "a hyphenation example ",
    );
    expect(countWords(joinPageLines(["a hyphen-", "ation example"]))).toBe(3);
  });

  it("keeps a compound whose continuation is capitalised", () => {
    const joined = joinPageLines(["the Fourier-", "Transform of"]);
    expect(joined).toContain("Fourier-");
    expect(countWords(joined)).toBe(4);
  });

  it("keeps a trailing hyphen when it ends the page", () => {
    expect(joinPageLines(["dangling hyphen-"])).toBe("dangling hyphen- ");
  });

  it("separates ordinary lines with a space", () => {
    expect(countWords(joinPageLines(["first line", "second line"]))).toBe(4);
  });
});

describe("pageLines", () => {
  it("flattens text blocks in order", () => {
    expect(pageLines(page("one two", "three"))).toEqual(["one two", "three"]);
  });

  it("skips non-text blocks", () => {
    const withImage: StructuredTextData = {
      blocks: [
        ...page("visible text").blocks,
        {
          type: "image",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          lines: [],
        } as unknown as StructuredTextData["blocks"][number],
      ],
    };
    expect(pageLines(withImage)).toEqual(["visible text"]);
  });
});

describe("countPdfWords", () => {
  it("totals words and characters across pages", async () => {
    const pages = [page("one two three"), page("four five")];
    const getPageText = vi.fn(async (index: number) => pages[index]);

    const result = await countPdfWords(getPageText, 2);

    expect(result.words).toBe(5);
    expect(result.pages).toBe(2);
    // Characters exclude whitespace: "onetwothree" + "fourfive".
    expect(result.characters).toBe(19);
  });

  it("skips a page whose text cannot be extracted", async () => {
    const getPageText = vi.fn(async (index: number) => {
      if (index === 1) throw new Error("bad page");
      return page("one two");
    });

    const result = await countPdfWords(getPageText, 3);

    expect(result.words).toBe(4);
    expect(result.pages).toBe(2);
  });

  it("stops early once cancelled", async () => {
    const getPageText = vi.fn(async () => page("one"));
    let cancelled = false;

    const result = await countPdfWords(getPageText, 10, {
      isCancelled: () => cancelled,
      onProgress: () => {
        cancelled = true;
      },
    });

    expect(getPageText).toHaveBeenCalledTimes(1);
    expect(result.pages).toBe(1);
  });

  it("reports progress per page", async () => {
    const getPageText = vi.fn(async () => page("word"));
    const seen: number[] = [];

    await countPdfWords(getPageText, 3, {
      onProgress: (done) => seen.push(done),
    });

    expect(seen).toEqual([1, 2, 3]);
  });

  it("returns an empty count for a document with no pages", async () => {
    const getPageText = vi.fn(async () => page("unused"));

    const result = await countPdfWords(getPageText, 0);

    expect(result).toEqual({ words: 0, characters: 0, pages: 0 });
    expect(getPageText).not.toHaveBeenCalled();
  });
});
