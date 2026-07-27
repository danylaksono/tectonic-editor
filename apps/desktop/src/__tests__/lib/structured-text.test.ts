import { describe, expect, it } from "vitest";
import { normalizeStructuredText } from "@/lib/mupdf/structured-text";

/**
 * The shape MuPDF 1.27 actually emits, captured from
 * `page.toStructuredText("preserve-whitespace").asJSON()`: each line carries a
 * flat `text` string, its own `font`, and a baseline `y` distinct from the
 * bounding box.
 */
const currentShape = {
  blocks: [
    {
      type: "text",
      bbox: { x: 265, y: 124, w: 79, h: 17 },
      lines: [
        {
          wmode: 0,
          bbox: { x: 265, y: 124, w: 79, h: 17, flags: 0 },
          font: {
            name: "IHAIZV+LMRoman17-Regular",
            family: "serif",
            weight: "normal",
            style: "normal",
            size: 17,
          },
          x: 265,
          y: 137,
          text: "Article title",
        },
      ],
    },
  ],
};

/** The older nested shape, still accepted. */
const legacyShape = {
  blocks: [
    {
      type: "text",
      bbox: { x: 10, y: 20, w: 100, h: 14 },
      lines: [
        {
          wmode: 0,
          bbox: { x: 10, y: 20, w: 100, h: 14 },
          spans: [
            {
              size: 11,
              font: {
                name: "CMR10",
                family: "serif",
                weight: "bold",
                style: "italic",
              },
              chars: [
                { c: "H", origin: { x: 10, y: 31 } },
                { c: "i", origin: { x: 17, y: 31 } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("normalizeStructuredText", () => {
  it("reads the flat line text MuPDF emits", () => {
    const result = normalizeStructuredText(currentShape);
    const line = result.blocks[0].lines[0];

    expect(line.text).toBe("Article title");
  });

  it("uses the line's own baseline rather than the bottom of its bbox", () => {
    const result = normalizeStructuredText(currentShape);

    // bbox bottom would be 124 + 17 = 141, which sits a descender too low.
    expect(result.blocks[0].lines[0].y).toBe(137);
  });

  it("carries the line's font through", () => {
    const result = normalizeStructuredText(currentShape);
    const { font } = result.blocks[0].lines[0];

    expect(font.family).toBe("serif");
    expect(font.size).toBe(17);
    expect(font.name).toBe("IHAIZV+LMRoman17-Regular");
  });

  it("still assembles text from the legacy nested spans shape", () => {
    const result = normalizeStructuredText(legacyShape);
    const line = result.blocks[0].lines[0];

    expect(line.text).toBe("Hi");
    expect(line.y).toBe(31);
    expect(line.font.size).toBe(11);
    expect(line.font.weight).toBe("bold");
  });

  it("falls back to the bbox bottom when no baseline is available", () => {
    const result = normalizeStructuredText({
      blocks: [
        {
          type: "text",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          lines: [{ bbox: { x: 0, y: 20, w: 50, h: 12 }, text: "no baseline" }],
        },
      ],
    });

    expect(result.blocks[0].lines[0].y).toBe(32);
  });

  it("yields empty text rather than throwing on a line with neither shape", () => {
    const result = normalizeStructuredText({
      blocks: [
        {
          type: "text",
          bbox: { x: 0, y: 0, w: 10, h: 10 },
          lines: [{ bbox: { x: 0, y: 0, w: 0, h: 0 } }],
        },
      ],
    });

    expect(result.blocks[0].lines[0].text).toBe("");
    expect(result.blocks[0].lines[0].font.size).toBe(12);
  });

  it("passes non-text blocks through untouched", () => {
    const image = { type: "image", bbox: { x: 0, y: 0, w: 5, h: 5 } };
    const result = normalizeStructuredText({ blocks: [image] });

    expect(result.blocks[0]).toEqual(image);
  });

  it("handles a page with no blocks at all", () => {
    expect(normalizeStructuredText({}).blocks).toEqual([]);
    expect(normalizeStructuredText(null).blocks).toEqual([]);
  });
});
