import { describe, it, expect } from "vitest";
import {
  bundledFilesSection,
  isProbablyBinary,
  normalizeSkillRelativePath,
} from "./skill-files";

describe("normalizeSkillRelativePath", () => {
  it("accepts ordinary relative paths", () => {
    expect(normalizeSkillRelativePath("references/guide.md")).toBe(
      "references/guide.md",
    );
    expect(normalizeSkillRelativePath("notes.md")).toBe("notes.md");
    expect(normalizeSkillRelativePath("a/b/c/d.txt")).toBe("a/b/c/d.txt");
  });

  it("normalises Windows separators and redundant segments", () => {
    expect(normalizeSkillRelativePath("references\\guide.md")).toBe(
      "references/guide.md",
    );
    expect(normalizeSkillRelativePath("./references//guide.md")).toBe(
      "references/guide.md",
    );
    expect(normalizeSkillRelativePath("  scripts/run.py  ")).toBe(
      "scripts/run.py",
    );
  });

  it("refuses traversal out of the skill folder", () => {
    // A skill body may have been written by someone else — this is the case
    // that must not resolve.
    for (const bad of [
      "../secrets.txt",
      "references/../../etc/passwd",
      "..",
      "a/../../b",
      "..\\..\\Windows\\System32\\config",
      "references/..",
    ]) {
      expect(normalizeSkillRelativePath(bad)).toBeNull();
    }
  });

  it("refuses absolute and UNC paths", () => {
    for (const bad of [
      "/etc/passwd",
      "\\Windows",
      "C:/Users/dany/.ssh/id_rsa",
      "c:\\Windows\\System32",
      "//server/share/file",
      "\\\\server\\share",
    ]) {
      expect(normalizeSkillRelativePath(bad)).toBeNull();
    }
  });

  it("refuses empty or meaningless paths", () => {
    for (const bad of ["", "   ", ".", "./", "//"]) {
      expect(normalizeSkillRelativePath(bad)).toBeNull();
    }
  });
});

describe("isProbablyBinary", () => {
  it("flags binaries", () => {
    expect(isProbablyBinary("assets/logo.png")).toBe(true);
    expect(isProbablyBinary("data.ZIP")).toBe(true);
    expect(isProbablyBinary("lib/thing.so")).toBe(true);
  });

  it("passes text", () => {
    expect(isProbablyBinary("references/guide.md")).toBe(false);
    expect(isProbablyBinary("scripts/run.py")).toBe(false);
    expect(isProbablyBinary("LICENSE")).toBe(false);
  });
});

describe("bundledFilesSection", () => {
  it("is empty when a skill bundles nothing", () => {
    expect(bundledFilesSection([])).toBe("");
  });

  it("lists the files for the model", () => {
    const section = bundledFilesSection(["references/a.md", "scripts/b.py"]);
    expect(section).toContain("read_skill_file");
    expect(section).toContain("- references/a.md");
    expect(section).toContain("- scripts/b.py");
  });
});
