import { describe, it, expect } from "vitest";
import { parseSkill, skillNameFromFileName } from "./parse";

const VALID = `---
name: proofread
title: Proofread
description: Fix grammar without changing meaning
icon: spell-check
tools: [read_file, propose_edit]
model: claude-sonnet-5
---

Do the thing.
`;

function parse(raw: string, fallbackName = "fallback") {
  return parseSkill(raw, { source: "user", path: "/s/x.md", fallbackName });
}

describe("parseSkill", () => {
  it("parses a complete skill", () => {
    const result = parse(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill).toMatchObject({
      name: "proofread",
      title: "Proofread",
      description: "Fix grammar without changing meaning",
      icon: "spell-check",
      tools: ["read_file", "propose_edit"],
      model: "claude-sonnet-5",
      body: "Do the thing.",
      source: "user",
      path: "/s/x.md",
      warnings: [],
    });
  });

  it("falls back to the file name when `name` is omitted", () => {
    const result = parse(`---\ndescription: A skill\n---\nBody.\n`, "my-skill");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.name).toBe("my-skill");
  });

  it("derives a title from the name", () => {
    const result = parse(
      `---\ndescription: A skill\n---\nBody.\n`,
      "fix-build",
    );
    expect(result.ok && result.skill.title).toBe("Fix Build");
  });

  it("handles CRLF line endings", () => {
    const result = parse(VALID.replace(/\n/g, "\r\n"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skill.name).toBe("proofread");
    expect(result.skill.body).toBe("Do the thing.");
  });

  it("handles a leading BOM", () => {
    const result = parse(`﻿${VALID}`);
    expect(result.ok && result.skill.name).toBe("proofread");
  });

  it("keeps unicode in the body", () => {
    const result = parse(
      `---\ndescription: A skill\n---\nAvoid “smart quotes” — really.\n`,
    );
    expect(result.ok && result.skill.body).toBe(
      "Avoid “smart quotes” — really.",
    );
  });

  it("preserves multi-paragraph bodies verbatim", () => {
    const result = parse(
      `---\ndescription: A skill\n---\n\nFirst.\n\n- one\n- two\n\nLast.\n`,
    );
    expect(result.ok && result.skill.body).toBe(
      "First.\n\n- one\n- two\n\nLast.",
    );
  });

  describe("frontmatter values", () => {
    it("strips trailing comments from unquoted scalars", () => {
      const result = parse(
        `---\ndescription: A skill   # what it does\n---\nBody.\n`,
      );
      expect(result.ok && result.skill.description).toBe("A skill");
    });

    it("keeps # inside a quoted scalar", () => {
      const result = parse(`---\ndescription: "C# and LaTeX"\n---\nBody.\n`);
      expect(result.ok && result.skill.description).toBe("C# and LaTeX");
    });

    it("keeps colons inside a value", () => {
      const result = parse(
        `---\ndescription: Fix this: then that\n---\nBody.\n`,
      );
      expect(result.ok && result.skill.description).toBe("Fix this: then that");
    });

    it("accepts block sequences for tools", () => {
      const result = parse(
        `---\ndescription: A skill\ntools:\n  - read_file\n  - propose_edit\n---\nBody.\n`,
      );
      expect(result.ok && result.skill.tools).toEqual([
        "read_file",
        "propose_edit",
      ]);
    });

    it("ignores full-line comments", () => {
      const result = parse(
        `---\n# leading comment\ndescription: A skill\n---\nBody.\n`,
      );
      expect(result.ok && result.skill.description).toBe("A skill");
    });

    it("treats an absent `tools` key as 'all tools'", () => {
      const result = parse(`---\ndescription: A skill\n---\nBody.\n`);
      expect(result.ok && result.skill.tools).toBeUndefined();
    });
  });

  describe("rejections", () => {
    it("rejects a file with no frontmatter", () => {
      const result = parse("Just a markdown file.\n");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/frontmatter/);
    });

    it("rejects a missing description", () => {
      const result = parse(`---\nname: thing\n---\nBody.\n`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/description/);
    });

    it("rejects an empty body", () => {
      const result = parse(`---\ndescription: A skill\n---\n\n   \n`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/empty body/);
    });

    it("rejects a non-kebab-case name", () => {
      const result = parse(
        `---\nname: Not Kebab\ndescription: x\n---\nBody.\n`,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/kebab-case/);
    });

    it("rejects an unparseable frontmatter line", () => {
      const result = parse(
        `---\ndescription: A skill\nthis is not a field\n---\nBody.\n`,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/could not parse line/);
    });
  });

  describe("warnings", () => {
    it("drops unknown tool names and warns", () => {
      const result = parse(
        `---\ndescription: A skill\ntools: [read_file, delete_everything]\n---\nBody.\n`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.skill.tools).toEqual(["read_file"]);
      expect(result.skill.warnings[0]).toMatch(/delete_everything/);
    });

    it("resolves an all-unknown allowlist to no tools, not all tools", () => {
      // A typo must never silently widen a skill's reach.
      const result = parse(
        `---\ndescription: A skill\ntools: [reed_file]\n---\nBody.\n`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.skill.tools).toEqual([]);
      expect(result.skill.warnings).toHaveLength(1);
    });

    it("warns about unknown fields but still parses", () => {
      const result = parse(
        `---\ndescription: A skill\ntemperature: 0.5\n---\nBody.\n`,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.skill.warnings[0]).toMatch(/temperature/);
    });
  });
});

describe("skillNameFromFileName", () => {
  it("strips the .md extension", () => {
    expect(skillNameFromFileName("proofread.md")).toBe("proofread");
    expect(skillNameFromFileName("Proofread.MD")).toBe("Proofread");
    expect(skillNameFromFileName("no-extension")).toBe("no-extension");
  });
});
