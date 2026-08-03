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

/**
 * Read every `*.md` in one directory. A missing directory is normal (most
 * projects have no skills) and yields an empty result, not an error.
 * Subdirectories are not scanned.
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

  for (const entry of entries) {
    if (!entry.isFile || !entry.name.toLowerCase().endsWith(".md")) continue;

    const path = await join(dir, entry.name);
    let raw: string;
    try {
      raw = await readTextFile(path);
    } catch (err) {
      errors.push({
        source,
        path,
        fileName: entry.name,
        message: `could not read file: ${String(err)}`,
      });
      continue;
    }

    const result = parseSkill(raw, {
      source,
      path,
      fallbackName: skillNameFromFileName(entry.name),
    });

    if (result.ok) {
      skills.push(result.skill);
    } else {
      errors.push({
        source,
        path,
        fileName: entry.name,
        message: result.message,
      });
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
