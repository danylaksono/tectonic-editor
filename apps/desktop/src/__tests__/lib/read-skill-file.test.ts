import { describe, it, expect, beforeEach, vi } from "vitest";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { executeAiTool, AI_TOOL_DEFINITIONS } from "@/lib/ai/tools";
import type { Skill } from "@/lib/skills/types";

const mockRead = vi.mocked(readTextFile);

function folderSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: "writing",
    title: "Writing",
    description: "d",
    body: "b",
    source: "user",
    warnings: [],
    path: "/home/test/.tectonic/skills/writing/SKILL.md",
    dir: "/home/test/.tectonic/skills/writing",
    files: ["references/guide.md", "scripts/check.py", "assets/logo.png"],
    ...overrides,
  };
}

const read = (path: unknown, skill?: Skill) =>
  executeAiTool("read_skill_file", { path }, "t1", { skill });

beforeEach(() => {
  vi.clearAllMocks();
  mockRead.mockResolvedValue("guide contents");
});

describe("read_skill_file", () => {
  it("is offered to the model", () => {
    expect(AI_TOOL_DEFINITIONS.map((t) => t.name)).toContain("read_skill_file");
  });

  it("reads a bundled file relative to the skill folder", async () => {
    const result = await read("references/guide.md", folderSkill());
    expect(result.content).toBe("guide contents");
    expect(mockRead).toHaveBeenCalledWith(
      "/home/test/.tectonic/skills/writing/references/guide.md",
    );
  });

  it("refuses to escape the skill folder", async () => {
    // The case that matters: a skill body can be authored by anyone.
    for (const bad of [
      "../../.ssh/id_rsa",
      "/etc/passwd",
      "C:/Users/dany/.ssh/id_rsa",
      "references/../../../secrets",
    ]) {
      const result = await read(bad, folderSkill());
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/not a path inside the skill folder/);
    }
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("refuses a file that is not bundled with the skill", async () => {
    const result = await read("references/other.md", folderSkill());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/not bundled/);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("refuses binaries", async () => {
    const result = await read("assets/logo.png", folderSkill());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/binary/);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("explains itself when no skill is active", async () => {
    const result = await read("references/guide.md", undefined);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/No skill is active/);
  });

  it("explains itself for a single-file skill", async () => {
    const single = folderSkill({ dir: undefined, files: undefined });
    const result = await read("references/guide.md", single);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/single file/);
  });

  it("cannot be used to read project files", async () => {
    // read_file covers the project; these two scopes stay separate.
    const result = await read("main.tex", folderSkill());
    expect(result.isError).toBe(true);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("truncates a very long bundled file", async () => {
    mockRead.mockResolvedValue("x".repeat(60_000));
    const result = await read("references/guide.md", folderSkill());
    expect(result.content).toMatch(/\[truncated at 40000 characters\]/);
  });

  it("surfaces a read failure", async () => {
    mockRead.mockRejectedValue(new Error("EACCES"));
    const result = await read("references/guide.md", folderSkill());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/EACCES/);
  });

  it("requires a path", async () => {
    const result = await read(undefined, folderSkill());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/requires `path`/);
  });
});
