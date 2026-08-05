/**
 * Skills are reusable working modes for the AI chat: a Markdown body that is
 * appended to the system prompt while the skill is active, plus metadata.
 *
 * A skill is prompt text, never code. It cannot apply an edit — `propose_edit`
 * still routes through the merge-view review flow — and it can only *narrow*
 * the tool set, never extend it.
 */

export type SkillSource = "builtin" | "user" | "project";

/** Precedence, lowest first. A project skill shadows a user skill of the same name. */
export const SKILL_SOURCE_PRECEDENCE: SkillSource[] = [
  "builtin",
  "user",
  "project",
];

export interface Skill {
  /** kebab-case identifier; the `/name` invocation token. */
  name: string;
  /** Human-readable label for the picker and gallery. */
  title: string;
  description: string;
  /** lucide icon name; the UI falls back to a default when absent or unknown. */
  icon?: string;
  /**
   * Allowlist of AI tool names. `undefined` means "all tools". An empty array
   * means "no tools" — which is what a skill whose `tools:` listed only unknown
   * names resolves to, deliberately, since falling back to all tools would make
   * a typo silently *widen* the skill's reach.
   */
  tools?: string[];
  /** Model to pre-select on activation. The user can always override it. */
  model?: string;
  /** The instructions appended to the system prompt. */
  body: string;
  source: SkillSource;
  /** Absolute path of the skill file itself. Undefined for built-ins. */
  path?: string;
  /**
   * Absolute path of the skill's own folder, for folder-shaped skills
   * (`<name>/SKILL.md` with `references/`, `scripts/`, `assets/` alongside).
   * Undefined for a plain `<name>.md`, which has no folder of its own.
   */
  dir?: string;
  /**
   * Skill-relative paths of the files bundled next to `SKILL.md`. Listed in the
   * prompt so the assistant knows what it can read, and readable only through
   * `read_skill_file`.
   */
  files?: string[];
  /** Non-fatal problems found while parsing, surfaced in the gallery. */
  warnings: string[];
}

/** A skill file that could not be parsed. Listed in the gallery rather than dropped. */
export interface SkillParseError {
  source: SkillSource;
  path: string;
  fileName: string;
  message: string;
}

export interface SkillCatalog {
  /** Effective skills — one per name, precedence applied. */
  skills: Skill[];
  /** Skills shadowed by a higher-precedence skill of the same name. */
  shadowed: Skill[];
  errors: SkillParseError[];
}

export const EMPTY_SKILL_CATALOG: SkillCatalog = {
  skills: [],
  shadowed: [],
  errors: [],
};
