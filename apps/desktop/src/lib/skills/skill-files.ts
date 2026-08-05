/**
 * Path handling for folder-shaped skills (`<name>/SKILL.md` with `references/`,
 * `scripts/`, `assets/` alongside).
 *
 * A skill body can ask the assistant to read its own bundled files, so these
 * paths come from a file that may have been written by someone else. They are
 * resolved conservatively: relative, forward-slashed, no traversal.
 */

/** Files that never make sense to hand to the model, by extension. */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".pyc",
  ".so",
  ".dll",
  ".dylib",
  ".exe",
]);

export function isProbablyBinary(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/**
 * Normalise a skill-relative path, or return null if it escapes the skill
 * folder. Rejects absolute paths (POSIX and Windows), UNC paths, `..` segments,
 * and empty results. Backslashes are accepted as separators, since a skill
 * authored on Windows may use them.
 */
export function normalizeSkillRelativePath(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // Absolute: /x, C:\x, \\server\share
  if (/^[/\\]/.test(raw)) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null;

  const segments = raw.split(/[/\\]+/);
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    // No traversal at all — not "resolve then check", which is easy to get
    // subtly wrong; a skill has no legitimate reason to reference its parent.
    if (segment === "..") return null;
    resolved.push(segment);
  }

  return resolved.length > 0 ? resolved.join("/") : null;
}

/**
 * The manifest appended to a skill's prompt so the assistant knows which
 * bundled files exist without having to guess or list them.
 */
export function bundledFilesSection(files: string[]): string {
  if (files.length === 0) return "";
  return [
    "",
    "---",
    "",
    "Files bundled with this skill. Read them with `read_skill_file` when the",
    "instructions above refer to them — do not guess at their contents:",
    "",
    ...files.map((f) => `- ${f}`),
  ].join("\n");
}
