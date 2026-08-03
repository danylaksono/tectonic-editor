import { describe, it, expect } from "vitest";
import { AI_TOOL_NAMES } from "./tool-names";
import { AI_TOOL_DEFINITIONS } from "./tools";

describe("AI_TOOL_NAMES", () => {
  it("stays in sync with AI_TOOL_DEFINITIONS", () => {
    // Skill `tools:` allowlists are validated against AI_TOOL_NAMES. If a tool
    // is added to tools.ts without being listed here, skills can never grant
    // it; if one is removed, allowlists silently keep referring to it.
    expect([...AI_TOOL_NAMES].sort()).toEqual(
      AI_TOOL_DEFINITIONS.map((t) => t.name).sort(),
    );
  });
});
