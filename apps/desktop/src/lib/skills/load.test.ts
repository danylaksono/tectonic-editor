import { describe, it, expect, beforeEach, vi } from "vitest";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import {
  loadAllSkills,
  loadSkillsFromDir,
  mergeSkills,
  projectSkillsDir,
  userSkillsDir,
} from "./load";
import { BUILTIN_SKILLS } from "./builtin";
import { AI_TOOL_NAMES } from "@/lib/ai/tool-names";
import type { Skill, SkillSource } from "./types";

const mockExists = vi.mocked(exists);
const mockReadDir = vi.mocked(readDir);
const mockReadTextFile = vi.mocked(readTextFile);

/** Files keyed by absolute path; directories are inferred from the keys. */
function mockDisk(files: Record<string, string>) {
  const paths = Object.keys(files);
  // True for a file that exists, and for any directory on the way to one.
  mockExists.mockImplementation(async (target) => {
    const path = String(target);
    return paths.includes(path) || paths.some((p) => p.startsWith(`${path}/`));
  });
  mockReadDir.mockImplementation(async (dirPath) => {
    const dir = String(dirPath);
    const children = new Map<string, boolean>(); // name -> isDirectory
    for (const p of paths) {
      if (!p.startsWith(`${dir}/`)) continue;
      const rest = p.slice(dir.length + 1);
      const slash = rest.indexOf("/");
      if (slash === -1) children.set(rest, false);
      else children.set(rest.slice(0, slash), true);
    }
    return [...children].map(([name, isDirectory]) => ({
      name,
      isFile: !isDirectory,
      isDirectory,
      isSymlink: false,
    })) as any;
  });
  mockReadTextFile.mockImplementation(async (path) => {
    const content = files[path as string];
    if (content === undefined) throw new Error(`ENOENT: ${String(path)}`);
    return content;
  });
}

function skillFile(name: string, extra = ""): string {
  return `---\ndescription: ${name} description\n${extra}---\nBody of ${name}.\n`;
}

function fakeSkill(name: string, source: SkillSource, title = name): Skill {
  return {
    name,
    title,
    description: "d",
    body: "b",
    source,
    warnings: [],
  };
}

const USER_DIR = "/home/test/.tectonic/skills";
const PROJECT_DIR = "/proj/.tectonic/skills";

beforeEach(() => {
  vi.clearAllMocks();
  mockDisk({});
});

describe("skill directories", () => {
  it("puts user skills next to the API keys in ~/.tectonic", async () => {
    expect(await userSkillsDir()).toBe(USER_DIR);
  });

  it("puts project skills in .tectonic, not the gitignored .tectonic-editor", async () => {
    const dir = await projectSkillsDir("/proj");
    expect(dir).toBe(PROJECT_DIR);
    expect(dir).not.toContain(".tectonic-editor");
  });
});

describe("loadSkillsFromDir", () => {
  it("returns nothing for a missing directory", async () => {
    const result = await loadSkillsFromDir(USER_DIR, "user");
    expect(result.skills).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("loads every .md file", async () => {
    mockDisk({
      [`${USER_DIR}/alpha.md`]: skillFile("alpha"),
      [`${USER_DIR}/beta.md`]: skillFile("beta"),
    });
    const { skills, errors } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
    expect(skills[0].source).toBe("user");
    expect(errors).toEqual([]);
  });

  it("ignores non-markdown files", async () => {
    mockDisk({
      [`${USER_DIR}/alpha.md`]: skillFile("alpha"),
      [`${USER_DIR}/notes.txt`]: "not a skill",
      [`${USER_DIR}/.env`]: "SECRET=1",
    });
    const { skills } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills.map((s) => s.name)).toEqual(["alpha"]);
  });

  it("reports a malformed file without dropping the rest of the batch", async () => {
    mockDisk({
      [`${USER_DIR}/good.md`]: skillFile("good"),
      [`${USER_DIR}/broken.md`]: "no frontmatter here",
    });
    const { skills, errors } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills.map((s) => s.name)).toEqual(["good"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ fileName: "broken.md", source: "user" });
    expect(errors[0].message).toMatch(/frontmatter/);
  });

  it("reports an unreadable file", async () => {
    mockDisk({ [`${USER_DIR}/gone.md`]: skillFile("gone") });
    mockReadTextFile.mockRejectedValueOnce(new Error("EACCES"));
    const { skills, errors } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills).toEqual([]);
    expect(errors[0].message).toMatch(/EACCES/);
  });

  it("names a skill after its file when the frontmatter omits `name`", async () => {
    mockDisk({ [`${USER_DIR}/my-skill.md`]: skillFile("x") });
    const { skills } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills[0].name).toBe("my-skill");
    expect(skills[0].path).toBe(`${USER_DIR}/my-skill.md`);
  });
});

describe("mergeSkills", () => {
  it("lets a project skill shadow a user skill of the same name", () => {
    const { skills, shadowed } = mergeSkills([
      fakeSkill("dup", "builtin"),
      fakeSkill("dup", "user"),
      fakeSkill("dup", "project"),
    ]);
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe("project");
    expect(shadowed.map((s) => s.source).sort()).toEqual(["builtin", "user"]);
  });

  it("keeps distinct names", () => {
    const { skills, shadowed } = mergeSkills([
      fakeSkill("a", "builtin"),
      fakeSkill("b", "user"),
    ]);
    expect(skills).toHaveLength(2);
    expect(shadowed).toEqual([]);
  });

  it("sorts by title", () => {
    const { skills } = mergeSkills([
      fakeSkill("z", "user", "Zebra"),
      fakeSkill("a", "user", "Apple"),
    ]);
    expect(skills.map((s) => s.title)).toEqual(["Apple", "Zebra"]);
  });
});

describe("loadAllSkills", () => {
  it("returns the built-ins when nothing is on disk", async () => {
    const catalog = await loadAllSkills(null);
    expect(catalog.skills).toHaveLength(BUILTIN_SKILLS.length);
    expect(catalog.skills.every((s) => s.source === "builtin")).toBe(true);
    expect(catalog.errors).toEqual([]);
  });

  it("skips the project directory when no project is open", async () => {
    mockDisk({ [`${PROJECT_DIR}/only-project.md`]: skillFile("p") });
    const catalog = await loadAllSkills(null);
    expect(catalog.skills.map((s) => s.name)).not.toContain("only-project");
  });

  it("combines built-in, user and project skills", async () => {
    mockDisk({
      [`${USER_DIR}/mine.md`]: skillFile("mine"),
      [`${PROJECT_DIR}/ours.md`]: skillFile("ours"),
    });
    const catalog = await loadAllSkills("/proj");
    const names = catalog.skills.map((s) => s.name);
    expect(names).toContain("mine");
    expect(names).toContain("ours");
    expect(names).toContain("proofread");
  });

  it("lets a project skill override a built-in of the same name", async () => {
    mockDisk({ [`${PROJECT_DIR}/proofread.md`]: skillFile("custom") });
    const catalog = await loadAllSkills("/proj");
    const proofread = catalog.skills.find((s) => s.name === "proofread")!;
    expect(proofread.source).toBe("project");
    expect(proofread.body).toBe("Body of custom.");
    expect(catalog.shadowed.some((s) => s.name === "proofread")).toBe(true);
  });

  it("surfaces parse errors alongside the skills that did load", async () => {
    mockDisk({
      [`${USER_DIR}/good.md`]: skillFile("good"),
      [`${USER_DIR}/bad.md`]: "junk",
    });
    const catalog = await loadAllSkills(null);
    expect(catalog.skills.some((s) => s.name === "good")).toBe(true);
    expect(catalog.errors).toHaveLength(1);
  });
});

describe("BUILTIN_SKILLS", () => {
  it("are all valid and uniquely named", () => {
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.source).toBe("builtin");
      expect(skill.body.trim().length).toBeGreaterThan(0);
      expect(skill.description.trim().length).toBeGreaterThan(0);
      expect(skill.warnings).toEqual([]);
    }
  });

  it("gives `explain` no way to edit the document", () => {
    const explain = BUILTIN_SKILLS.find((s) => s.name === "explain")!;
    expect(explain.tools).toBeDefined();
    expect(explain.tools).not.toContain("propose_edit");
    expect(explain.tools).not.toContain("add_citation");
  });

  it("gives `fix-build` the whole tool surface", () => {
    const fix = BUILTIN_SKILLS.find((s) => s.name === "fix-build")!;
    expect(fix.tools).toBeUndefined();
  });
});

describe("folder-shaped skills", () => {
  it("loads <name>/SKILL.md, the Agent Skills layout", async () => {
    mockDisk({
      [`${USER_DIR}/scientific-writing/SKILL.md`]: skillFile("sw"),
    });
    const { skills, errors } = await loadSkillsFromDir(USER_DIR, "user");
    expect(errors).toEqual([]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("scientific-writing");
    expect(skills[0].dir).toBe(`${USER_DIR}/scientific-writing`);
  });

  it("lists the files bundled beside SKILL.md", async () => {
    mockDisk({
      [`${USER_DIR}/writing/SKILL.md`]: skillFile("w"),
      [`${USER_DIR}/writing/references/guide.md`]: "guide",
      [`${USER_DIR}/writing/scripts/check.py`]: "print(1)",
    });
    const { skills } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills[0].files).toEqual([
      "references/guide.md",
      "scripts/check.py",
    ]);
  });

  it("does not list SKILL.md itself", async () => {
    mockDisk({
      [`${USER_DIR}/writing/SKILL.md`]: skillFile("w"),
      [`${USER_DIR}/writing/notes.md`]: "notes",
    });
    const { skills } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills[0].files).toEqual(["notes.md"]);
  });

  it("ignores a directory with no SKILL.md rather than erroring", async () => {
    mockDisk({
      [`${USER_DIR}/notes/todo.md`]: "not a skill",
      [`${USER_DIR}/real.md`]: skillFile("real"),
    });
    const { skills, errors } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills.map((s) => s.name)).toEqual(["real"]);
    expect(errors).toEqual([]);
  });

  it("leaves single-file skills without a folder", async () => {
    mockDisk({ [`${USER_DIR}/plain.md`]: skillFile("plain") });
    const { skills } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills[0].dir).toBeUndefined();
    expect(skills[0].files).toBeUndefined();
  });

  it("reports a malformed SKILL.md against its folder name", async () => {
    mockDisk({ [`${USER_DIR}/broken/SKILL.md`]: "no frontmatter" });
    const { skills, errors } = await loadSkillsFromDir(USER_DIR, "user");
    expect(skills).toEqual([]);
    expect(errors[0].fileName).toBe("SKILL.md");
    expect(errors[0].path).toBe(`${USER_DIR}/broken/SKILL.md`);
  });
});

describe("bundled research skills", () => {
  it("declare only real tools", () => {
    const known = new Set(AI_TOOL_NAMES);
    for (const skill of BUILTIN_SKILLS) {
      for (const tool of skill.tools ?? []) {
        expect(known.has(tool as never), `${skill.name}: ${tool}`).toBe(true);
      }
    }
  });

  it("keep writing-only skills away from execution", () => {
    // A skill that only drafts prose has no business running code.
    for (const name of [
      "scientific-writing",
      "peer-review",
      "literature-review",
    ]) {
      const skill = BUILTIN_SKILLS.find((s) => s.name === name)!;
      expect(skill.tools).toBeDefined();
      expect(skill.tools).not.toContain("run_python");
    }
  });

  it("gives the computational ones what they need", () => {
    for (const name of ["scientific-figures", "statistical-analysis"]) {
      const skill = BUILTIN_SKILLS.find((s) => s.name === name)!;
      expect(skill.tools).toContain("run_python");
    }
  });

  it("never lets peer-review send the manuscript to a network tool", () => {
    const review = BUILTIN_SKILLS.find((s) => s.name === "peer-review")!;
    expect(review.tools).not.toContain("search_references");
    expect(review.tools).not.toContain("lookup_reference");
  });
});
