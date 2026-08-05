import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import { exists } from "@/lib/tauri/fs";
import { createLogger } from "@/lib/debug/logger";
import { BUILTIN_SKILLS } from "./builtin";
import { parseSkill, skillNameFromFileName } from "./parse";
import {
  SKILL_SOURCE_PRECEDENCE,
  type Skill,
  type SkillCatalog,
  type SkillParseError,
  type SkillSource,
} from "./types";

const log = createLogger("skills");

/**
 * User skills sit next to the API keys in `~/.tectonic/`.
 */
export async function userSkillsDir(): Promise<string> {
  return join(await homeDir(), ".tectonic", "skills");
}

/**
 * Project skills live in `<project>/.tectonic/`, NOT in `.tectonic-editor/`.
 * `.tectonic-editor/` is machine-local state — it is auto-added to .gitignore
 * and stripped from export archives — whereas skills are authored content a
 * co-author should get on clone.
 */
export function projectSkillsDir(projectRoot: string): Promise<string> {
  return join(projectRoot, ".tectonic", "skills");
}

/** Cap on bundled files listed per folder skill — the list goes in the prompt. */
const MAX_BUNDLED_FILES = 60;
/** How deep to walk inside a skill folder. */
const MAX_BUNDLE_DEPTH = 3;

/**
 * List the files bundled next to a `SKILL.md`, as skill-relative paths. The
 * result is capped and depth-limited: it is injected into the prompt, and a
 * skill folder that happens to contain a checkout should not blow up the
 * context.
 */
async function listBundledFiles(skillDir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(absolute: string, relative: string, depth: number) {
    if (depth > MAX_BUNDLE_DEPTH || found.length >= MAX_BUNDLED_FILES) return;
    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(absolute);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_BUNDLED_FILES) return;
      if (entry.name.startsWith(".")) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(await join(absolute, entry.name), childRelative, depth + 1);
      } else if (entry.isFile && entry.name !== SKILL_FILE_NAME) {
        found.push(childRelative);
      }
    }
  }

  await walk(skillDir, "", 0);
  return found.sort();
}

/** The file that marks a directory as a skill, per the Agent Skills layout. */
const SKILL_FILE_NAME = "SKILL.md";

/**
 * Read the skills in one directory. Two layouts are supported:
 *
 * - `<name>.md` — a single file.
 * - `<name>/SKILL.md` — a folder that may also carry `references/`, `scripts/`
 *   and `assets/`. This is the layout used by the open Agent Skills standard,
 *   so skills written for other tools can be dropped in as-is.
 *
 * A missing directory is normal (most projects have no skills) and yields an
 * empty result, not an error.
 */
export async function loadSkillsFromDir(
  dir: string,
  source: SkillSource,
): Promise<{ skills: Skill[]; errors: SkillParseError[] }> {
  const skills: Skill[] = [];
  const errors: SkillParseError[] = [];

  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    if (!(await exists(dir))) return { skills, errors };
    entries = await readDir(dir);
  } catch (err) {
    log.debug("could not read skills directory", { dir, error: String(err) });
    return { skills, errors };
  }

  /** Parse one skill file into `skills` or `errors`. */
  async function ingest(
    path: string,
    fileName: string,
    fallbackName: string,
    skillDir?: string,
  ) {
    let raw: string;
    try {
      raw = await readTextFile(path);
    } catch (err) {
      errors.push({
        source,
        path,
        fileName,
        message: `could not read file: ${String(err)}`,
      });
      return;
    }

    const result = parseSkill(raw, { source, path, fallbackName });
    if (!result.ok) {
      errors.push({ source, path, fileName, message: result.message });
      return;
    }

    if (skillDir) {
      result.skill.dir = skillDir;
      const files = await listBundledFiles(skillDir);
      if (files.length > 0) result.skill.files = files;
    }
    skills.push(result.skill);
  }

  for (const entry of entries) {
    if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
      await ingest(
        await join(dir, entry.name),
        entry.name,
        skillNameFromFileName(entry.name),
      );
      continue;
    }

    if (entry.isDirectory && !entry.name.startsWith(".")) {
      const skillDir = await join(dir, entry.name);
      const skillFile = await join(skillDir, SKILL_FILE_NAME);
      // A directory without SKILL.md is not a skill — skip it silently rather
      // than reporting an error for, say, a stray `notes/` folder.
      if (!(await exists(skillFile))) continue;
      await ingest(skillFile, SKILL_FILE_NAME, entry.name, skillDir);
    }
  }

  return { skills, errors };
}

function precedenceOf(source: SkillSource): number {
  return SKILL_SOURCE_PRECEDENCE.indexOf(source);
}

/**
 * Merge sources by name, highest precedence winning (project > user > builtin).
 * Shadowed skills are kept separately rather than discarded so the gallery can
 * show that a project skill is overriding a built-in.
 */
export function mergeSkills(all: Skill[]): {
  skills: Skill[];
  shadowed: Skill[];
} {
  const winners = new Map<string, Skill>();
  const shadowed: Skill[] = [];

  for (const skill of all) {
    const current = winners.get(skill.name);
    if (!current) {
      winners.set(skill.name, skill);
      continue;
    }
    if (precedenceOf(skill.source) >= precedenceOf(current.source)) {
      winners.set(skill.name, skill);
      shadowed.push(current);
    } else {
      shadowed.push(skill);
    }
  }

  const skills = [...winners.values()].sort((a, b) =>
    a.title.localeCompare(b.title),
  );
  return { skills, shadowed };
}

/**
 * Build the full catalog: built-ins, then `~/.tectonic/skills`, then the
 * project's own skills. Never throws — a broken directory or file is reported
 * through `errors`.
 */
export async function loadAllSkills(
  projectRoot: string | null,
): Promise<SkillCatalog> {
  const errors: SkillParseError[] = [];
  const collected: Skill[] = [...BUILTIN_SKILLS];

  try {
    const userDir = await userSkillsDir();
    const user = await loadSkillsFromDir(userDir, "user");
    collected.push(...user.skills);
    errors.push(...user.errors);
  } catch (err) {
    log.debug("skipping user skills", { error: String(err) });
  }

  if (projectRoot) {
    try {
      const projectDir = await projectSkillsDir(projectRoot);
      const project = await loadSkillsFromDir(projectDir, "project");
      collected.push(...project.skills);
      errors.push(...project.errors);
    } catch (err) {
      log.debug("skipping project skills", { error: String(err) });
    }
  }

  const { skills, shadowed } = mergeSkills(collected);
  log.info("skills loaded", {
    total: skills.length,
    shadowed: shadowed.length,
    errors: errors.length,
  });
  return { skills, shadowed, errors };
}
