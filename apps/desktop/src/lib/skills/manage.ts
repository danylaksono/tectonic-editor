import {
  mkdir,
  remove,
  writeTextFile,
  readTextFile,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { exists } from "@/lib/tauri/fs";
import { parseSkill, skillNameFromFileName } from "./parse";
import { projectSkillsDir, userSkillsDir } from "./load";
import type { Skill, SkillSource } from "./types";

/**
 * Creating, duplicating and importing skill files.
 *
 * Everything here writes plain Markdown into a skills directory. There is no
 * install-from-URL path: a skill body is instructions handed to a model that
 * holds propose_edit and add_citation, so it is only ever added from a file the
 * user already has, and the gallery shows the full body before it can be
 * activated.
 */

export const NEW_SKILL_TEMPLATE = `---
description: One line describing what this skill does
# icon: sparkles
# tools: [read_file, search_project, propose_edit]
---

Describe how the assistant should work while this skill is active.

- Be specific about what to do and what to leave alone.
- The rules the assistant always follows (propose edits for review, never
  invent citations) still apply — this only narrows them.
`;

/** Where a new user skill goes, created if absent. */
export async function ensureUserSkillsDir(): Promise<string> {
  const dir = await userSkillsDir();
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return dir;
}

/** Where a new project skill goes, created if absent. */
export async function ensureProjectSkillsDir(
  projectRoot: string,
): Promise<string> {
  const dir = await projectSkillsDir(projectRoot);
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * A `<base>.md` path in `dir` that does not exist yet, suffixing `-2`, `-3`…
 * on collision so importing never overwrites an existing skill.
 */
export async function uniqueSkillPath(
  dir: string,
  base: string,
): Promise<string> {
  const safeBase =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "skill";

  let candidate = await join(dir, `${safeBase}.md`);
  let n = 2;
  while (await exists(candidate)) {
    candidate = await join(dir, `${safeBase}-${n}.md`);
    n += 1;
  }
  return candidate;
}

export interface WriteSkillResult {
  path: string;
  name: string;
}

/**
 * Write skill markdown into a skills directory after checking it parses.
 * Returns the created path, or throws with the parse error — a file that
 * cannot be read as a skill is never silently written.
 */
export async function writeSkillFile(
  dir: string,
  base: string,
  content: string,
  source: SkillSource,
): Promise<WriteSkillResult> {
  const path = await uniqueSkillPath(dir, base);
  const fallbackName = skillNameFromFileName(path.split(/[\\/]/).pop() ?? base);

  const parsed = parseSkill(content, { source, path, fallbackName });
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }

  await writeTextFile(path, content);
  return { path, name: parsed.skill.name };
}

/** Create a starter skill the user can edit. */
export async function createSkill(
  dir: string,
  source: SkillSource,
): Promise<WriteSkillResult> {
  return writeSkillFile(dir, "new-skill", NEW_SKILL_TEMPLATE, source);
}

/**
 * The name a skill file gets when its frontmatter omits `name`. For a folder
 * skill that is the folder, not "SKILL".
 */
export function fallbackNameForPath(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const fileName = parts[parts.length - 1] ?? "";
  if (fileName.toLowerCase() === "skill.md") {
    return parts[parts.length - 2] ?? "skill";
  }
  return skillNameFromFileName(fileName);
}

/**
 * Delete a skill. For a folder skill the whole folder goes, including its
 * bundled `references/` and `scripts/` — leaving those behind would orphan
 * them, since nothing else reads that directory.
 *
 * Built-ins have no file and cannot be deleted; the caller must not offer it.
 */
export async function deleteSkill(skill: Skill): Promise<string> {
  if (!skill.path) {
    throw new Error(`"${skill.title}" is built in and cannot be deleted.`);
  }
  const target = skill.dir ?? skill.path;
  await remove(target, { recursive: Boolean(skill.dir) });
  return target;
}

/**
 * Overwrite an existing skill file. Validates first, so a broken edit is
 * reported to the user instead of leaving a skill that silently stops loading.
 */
export async function saveSkillFile(
  path: string,
  content: string,
  source: SkillSource,
): Promise<WriteSkillResult> {
  const parsed = parseSkill(content, {
    source,
    path,
    fallbackName: fallbackNameForPath(path),
  });
  if (!parsed.ok) throw new Error(parsed.message);

  await writeTextFile(path, content);
  return { path, name: parsed.skill.name };
}

/**
 * Copy a skill into a writable directory. Built-ins have no file, so their
 * markdown is reconstructed from the in-memory definition.
 */
export async function duplicateSkill(
  skill: Skill,
  dir: string,
  source: SkillSource,
): Promise<WriteSkillResult> {
  const content = skill.path
    ? await readTextFile(skill.path)
    : serializeSkill(skill);
  return writeSkillFile(dir, `${skill.name}-copy`, content, source);
}

/** Render a skill back to its file form (used to duplicate a built-in). */
export function serializeSkill(skill: Skill): string {
  const lines = ["---", `description: ${skill.description}`];
  if (skill.icon) lines.push(`icon: ${skill.icon}`);
  if (skill.tools) lines.push(`tools: [${skill.tools.join(", ")}]`);
  if (skill.model) lines.push(`model: ${skill.model}`);
  lines.push("---", "", skill.body, "");
  return lines.join("\n");
}

export interface ImportResult {
  imported: WriteSkillResult[];
  /** Files that were not skills, with the reason. Never written. */
  rejected: { fileName: string; message: string }[];
}

/**
 * Import `.md` files the user picked from disk — the supported way to add a
 * skill found online: download it, look at it, then import it. Each file must
 * parse as a skill or it is rejected with its error rather than copied.
 */
export async function importSkillFiles(
  paths: string[],
  dir: string,
  source: SkillSource,
): Promise<ImportResult> {
  const imported: WriteSkillResult[] = [];
  const rejected: ImportResult["rejected"] = [];

  for (const sourcePath of paths) {
    const fileName = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
    try {
      const content = await readTextFile(sourcePath);
      const result = await writeSkillFile(
        dir,
        skillNameFromFileName(fileName),
        content,
        source,
      );
      imported.push(result);
    } catch (err) {
      rejected.push({
        fileName,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { imported, rejected };
}
