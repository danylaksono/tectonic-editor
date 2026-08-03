import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import {
  createSkill,
  duplicateSkill,
  ensureUserSkillsDir,
  importSkillFiles,
  serializeSkill,
  uniqueSkillPath,
  writeSkillFile,
} from "./manage";
import { parseSkill } from "./parse";
import { BUILTIN_SKILLS } from "./builtin";
import type { Skill } from "./types";

const mockExists = vi.mocked(exists);
const mockMkdir = vi.mocked(mkdir);
const mockWrite = vi.mocked(writeTextFile);
const mockRead = vi.mocked(readTextFile);

const DIR = "/home/test/.tectonic/skills";

const VALID = `---
description: A skill
---
Body.
`;

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(false);
  mockWrite.mockResolvedValue();
  mockMkdir.mockResolvedValue();
});

describe("ensureUserSkillsDir", () => {
  it("creates the directory when it does not exist", async () => {
    expect(await ensureUserSkillsDir()).toBe(DIR);
    expect(mockMkdir).toHaveBeenCalledWith(DIR, { recursive: true });
  });

  it("does not recreate an existing directory", async () => {
    mockExists.mockResolvedValue(true);
    await ensureUserSkillsDir();
    expect(mockMkdir).not.toHaveBeenCalled();
  });
});

describe("uniqueSkillPath", () => {
  it("uses the plain name when free", async () => {
    expect(await uniqueSkillPath(DIR, "proofread")).toBe(`${DIR}/proofread.md`);
  });

  it("suffixes rather than overwriting an existing file", async () => {
    mockExists.mockImplementation(async (p) => String(p).endsWith("/take.md"));
    expect(await uniqueSkillPath(DIR, "take")).toBe(`${DIR}/take-2.md`);
  });

  it("slugifies an awkward base name", async () => {
    expect(await uniqueSkillPath(DIR, "My Skill! (v2)")).toBe(
      `${DIR}/my-skill-v2.md`,
    );
  });

  it("falls back to 'skill' when nothing usable remains", async () => {
    expect(await uniqueSkillPath(DIR, "!!!")).toBe(`${DIR}/skill.md`);
  });
});

describe("writeSkillFile", () => {
  it("writes a valid skill and reports its name", async () => {
    const result = await writeSkillFile(DIR, "my-skill", VALID, "user");
    expect(result.path).toBe(`${DIR}/my-skill.md`);
    expect(result.name).toBe("my-skill");
    expect(mockWrite).toHaveBeenCalledWith(`${DIR}/my-skill.md`, VALID);
  });

  it("refuses to write content that is not a skill", async () => {
    await expect(
      writeSkillFile(DIR, "junk", "just some notes", "user"),
    ).rejects.toThrow(/frontmatter/);
    // Nothing may land on disk when the content is unusable
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe("createSkill", () => {
  it("writes a starter file that itself parses as a skill", async () => {
    await createSkill(DIR, "user");
    const [, content] = mockWrite.mock.calls[0];
    const parsed = parseSkill(content as string, {
      source: "user",
      fallbackName: "new-skill",
    });
    expect(parsed.ok).toBe(true);
  });
});

describe("serializeSkill / duplicateSkill", () => {
  it("round-trips every built-in through the file format", () => {
    for (const builtin of BUILTIN_SKILLS) {
      const parsed = parseSkill(serializeSkill(builtin), {
        source: "user",
        fallbackName: builtin.name,
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.skill.description).toBe(builtin.description);
      expect(parsed.skill.body).toBe(builtin.body);
      expect(parsed.skill.tools).toEqual(builtin.tools);
      expect(parsed.skill.icon).toBe(builtin.icon);
    }
  });

  it("copies a file-backed skill verbatim", async () => {
    mockRead.mockResolvedValue(VALID);
    const skill: Skill = {
      name: "mine",
      title: "Mine",
      description: "d",
      body: "b",
      source: "user",
      path: `${DIR}/mine.md`,
      warnings: [],
    };
    const result = await duplicateSkill(skill, DIR, "user");
    expect(mockRead).toHaveBeenCalledWith(`${DIR}/mine.md`);
    expect(result.path).toBe(`${DIR}/mine-copy.md`);
    expect(mockWrite).toHaveBeenCalledWith(`${DIR}/mine-copy.md`, VALID);
  });

  it("reconstructs a built-in, which has no file", async () => {
    const proofread = BUILTIN_SKILLS.find((s) => s.name === "proofread")!;
    await duplicateSkill(proofread, DIR, "user");
    expect(mockRead).not.toHaveBeenCalled();
    const [path, content] = mockWrite.mock.calls[0];
    expect(path).toBe(`${DIR}/proofread-copy.md`);
    expect(content).toContain("propose_edit");
  });
});

describe("importSkillFiles", () => {
  it("imports a valid file", async () => {
    mockRead.mockResolvedValue(VALID);
    const result = await importSkillFiles(["/downloads/cool.md"], DIR, "user");
    expect(result.imported).toEqual([{ path: `${DIR}/cool.md`, name: "cool" }]);
    expect(result.rejected).toEqual([]);
  });

  it("rejects a file that is not a skill instead of copying it", async () => {
    mockRead.mockResolvedValue("# Just a readme");
    const result = await importSkillFiles(
      ["/downloads/README.md"],
      DIR,
      "user",
    );
    expect(result.imported).toEqual([]);
    expect(result.rejected[0].fileName).toBe("README.md");
    expect(result.rejected[0].message).toMatch(/frontmatter/);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("imports the good files and reports the bad ones", async () => {
    mockRead.mockImplementation(async (p) =>
      String(p).includes("good") ? VALID : "nope",
    );
    const result = await importSkillFiles(
      ["/d/good.md", "/d/bad.md"],
      DIR,
      "user",
    );
    expect(result.imported).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("reports an unreadable file rather than throwing", async () => {
    mockRead.mockRejectedValue(new Error("EACCES"));
    const result = await importSkillFiles(["/d/x.md"], DIR, "user");
    expect(result.rejected[0].message).toMatch(/EACCES/);
  });
});
