import { describe, expect, it } from "vitest";
import {
  DEFAULT_STROKE_WIDTH,
  drawingBounds,
  drawingPath,
  isTwoPointTool,
  simplifyStroke,
  type ReviewPoint,
} from "@/lib/review-drawing";

describe("isTwoPointTool", () => {
  it("separates the shapes from freehand", () => {
    expect(isTwoPointTool("freehand")).toBe(false);
    for (const tool of ["line", "arrow", "box", "ellipse"] as const) {
      expect(isTwoPointTool(tool)).toBe(true);
    }
  });
});

describe("simplifyStroke", () => {
  it("leaves a two-point stroke alone", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyStroke(points)).toEqual(points);
  });

  it("drops points too close together to carry any shape", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.2, y: 0 },
      { x: 0.4, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(simplifyStroke(points)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it("always keeps where the pen went down and came up", () => {
    const points: ReviewPoint[] = Array.from({ length: 50 }, (_, i) => ({
      x: i * 0.1,
      y: 0,
    }));
    const result = simplifyStroke(points);
    expect(result[0]).toEqual(points[0]);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it("caps a very long scribble so one mark cannot bloat a shared file", () => {
    const points: ReviewPoint[] = Array.from({ length: 5000 }, (_, i) => ({
      x: i * 3,
      y: Math.sin(i) * 20,
    }));
    const result = simplifyStroke(points);
    expect(result.length).toBeLessThanOrEqual(601);
    expect(result[result.length - 1]).toEqual(points[points.length - 1]);
  });

  it("handles a stroke of one point", () => {
    expect(simplifyStroke([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
  });
});

describe("drawingBounds", () => {
  it("covers the ink, not just the centre line", () => {
    const bounds = drawingBounds(
      [
        { x: 10, y: 20 },
        { x: 40, y: 60 },
      ],
      4,
    );
    // Grown by half the stroke width on each side.
    expect(bounds).toEqual({ x: 8, y: 18, width: 34, height: 44 });
  });

  it("gives a usable box for a stroke with no extent", () => {
    const bounds = drawingBounds(
      [
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ],
      DEFAULT_STROKE_WIDTH,
    );
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it("returns an empty box rather than infinities for no points", () => {
    expect(drawingBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("drawingPath", () => {
  const a = { x: 10, y: 10 };
  const b = { x: 50, y: 30 };

  it("traces every point of a freehand stroke", () => {
    const d = drawingPath("freehand", [a, { x: 20, y: 25 }, b]);
    expect(d).toBe("M10 10 L20 25 L50 30");
  });

  it("uses only the two ends of a shape, ignoring the path between", () => {
    const withDetour = drawingPath("line", [a, { x: 999, y: 999 }, b]);
    expect(withDetour).toBe(drawingPath("line", [a, b]));
  });

  it("closes a box", () => {
    expect(drawingPath("box", [a, b])).toBe("M10 10 L50 10 L50 30 L10 30 Z");
  });

  it("draws a box the same however the drag ran", () => {
    expect(drawingPath("box", [b, a])).toBe(drawingPath("box", [a, b]));
  });

  it("draws an ellipse as arcs", () => {
    const d = drawingPath("ellipse", [a, b]);
    expect(d).toContain("a20 10");
  });

  it("gives an arrow a head at the end the drag finished on", () => {
    const d = drawingPath("arrow", [a, b]);
    // Shaft, then a separate subpath for the head.
    expect(d.startsWith("M10 10 L50 30")).toBe(true);
    expect(d.split("M").length).toBe(3);
    expect(d).toContain("L50 30");
  });

  it("degenerates safely", () => {
    expect(drawingPath("freehand", [])).toBe("");
    expect(drawingPath("arrow", [a])).toBe("M10 10");
    // Zero-size ellipse falls back to a line rather than emitting broken arcs.
    expect(drawingPath("ellipse", [a, a])).toBe("M10 10 L10 10");
  });
});
