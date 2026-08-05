import { AI_TOOL_NAMES } from "@/lib/ai/tool-names";
import type { Skill, SkillSource } from "./types";

/**
 * Minimal frontmatter parser for skill files.
 *
 * Deliberately not a YAML implementation: skills have five scalar fields and
 * one string list, and the subset below (bare scalars, quoted scalars, inline
 * and block sequences, `#` comments) covers them without adding a parser
 * dependency. Anything richer is rejected as a parse error rather than
 * silently half-understood.
 */

// Leading BOM: files saved by some Windows editors carry a BOM.
const FRONTMATTER_RE =
  /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const KNOWN_KEYS = new Set([
  "name",
  "title",
  "description",
  "icon",
  "tools",
  "model",
]);

type FrontmatterValue = string | string[];

export type ParseResult =
  | { ok: true; skill: Skill }
  | { ok: false; message: string };

/** Strip a trailing ` # comment` from an unquoted scalar. */
function stripComment(value: string): string {
  return value.replace(/\s+#.*$/, "").trim();
}

function unquote(value: string): string | null {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      return value.slice(1, -1);
    }
  }
  return null;
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  const unquoted = unquote(trimmed);
  return unquoted !== null ? unquoted : stripComment(trimmed);
}

function parseInlineList(raw: string): string[] {
  return raw
    .slice(1, -1)
    .split(",")
    .map((item) => parseScalar(item))
    .filter((item) => item.length > 0);
}

/**
 * Parse the `key: value` block between the `---` fences.
 * Returns null on a line that is not understood.
 */
function parseFrontmatter(
  block: string,
):
  | { fields: Map<string, FrontmatterValue>; nestedKeys: string[] }
  | { error: string } {
  const fields = new Map<string, FrontmatterValue>();
  const nestedKeys = new Set<string>();
  const lines = block.split(/\r?\n/);
  let lastKey: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.trim().startsWith("#")) continue;

    // Block sequence item, continuing the previous key
    const seqMatch = line.match(/^[ \t]*-[ \t]+(.*)$/);
    if (seqMatch) {
      if (!lastKey) {
        return { error: `list item with no key above it: "${line.trim()}"` };
      }
      const existing = fields.get(lastKey);
      const item = parseScalar(seqMatch[1]);
      if (Array.isArray(existing)) {
        existing.push(item);
      } else {
        fields.set(lastKey, [item]);
      }
      continue;
    }

    // An indented `key: value` is a nested block (e.g. the `metadata:` map that
    // Agent Skills files carry). Skills have no nested fields, so the block is
    // skipped with a warning rather than failing the whole file — otherwise no
    // real-world SKILL.md would import at all.
    if (
      /^[ \t]+/.test(line) &&
      /^[ \t]*[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/.test(line)
    ) {
      if (lastKey) nestedKeys.add(lastKey);
      continue;
    }

    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:(.*)$/);
    if (!kvMatch) {
      return { error: `could not parse line: "${line.trim()}"` };
    }

    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();
    lastKey = key;

    if (!rawValue) {
      // Either an empty scalar or the header of a block sequence; the
      // sequence branch above replaces this when items follow.
      fields.set(key, "");
      continue;
    }
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      fields.set(key, parseInlineList(rawValue));
      continue;
    }
    fields.set(key, parseScalar(rawValue));
  }

  return { fields, nestedKeys: [...nestedKeys] };
}

/** "fix-build" → "Fix Build" */
function prettifyName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function asString(value: FrontmatterValue | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface ParseSkillOptions {
  source: SkillSource;
  /** Absolute path, for disk skills. */
  path?: string;
  /** Used as `name` when the frontmatter omits it — normally the file stem. */
  fallbackName?: string;
}

/**
 * Parse one skill file. Never throws: a malformed file comes back as
 * `{ ok: false }` so the caller can list it with its error instead of
 * dropping it silently.
 */
export function parseSkill(raw: string, opts: ParseSkillOptions): ParseResult {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return {
      ok: false,
      message:
        "missing frontmatter — a skill must start with a `---` block declaring at least `description`",
    };
  }

  const parsed = parseFrontmatter(match[1]);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const { fields } = parsed;

  const body = (match[2] ?? "").trim();
  if (!body) {
    return { ok: false, message: "empty body — nothing to add to the prompt" };
  }

  const warnings: string[] = [];

  for (const key of fields.keys()) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(`unknown field "${key}" ignored`);
    }
  }
  for (const key of parsed.nestedKeys) {
    warnings.push(`nested values under "${key}" ignored`);
  }

  const name = asString(fields.get("name")) ?? opts.fallbackName;
  if (!name) {
    return { ok: false, message: "missing `name`" };
  }
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      message: `invalid name "${name}" — use lowercase kebab-case, e.g. "fix-build"`,
    };
  }

  const description = asString(fields.get("description"));
  if (!description) {
    return { ok: false, message: "missing `description`" };
  }

  let tools: string[] | undefined;
  const rawTools = fields.get("tools");
  if (rawTools !== undefined) {
    const list = Array.isArray(rawTools)
      ? rawTools
      : rawTools.trim()
        ? [rawTools.trim()]
        : [];
    const known = new Set<string>(AI_TOOL_NAMES);
    const unknown = list.filter((t) => !known.has(t));
    if (unknown.length > 0) {
      warnings.push(
        `unknown tool${unknown.length > 1 ? "s" : ""} ignored: ${unknown.join(", ")}`,
      );
    }
    // Keep the filtered list even when it ends up empty — see `Skill.tools`.
    tools = list.filter((t) => known.has(t));
  }

  return {
    ok: true,
    skill: {
      name,
      title: asString(fields.get("title")) ?? prettifyName(name),
      description,
      icon: asString(fields.get("icon")),
      tools,
      model: asString(fields.get("model")),
      body,
      source: opts.source,
      path: opts.path,
      warnings,
    },
  };
}

/** `proofread.md` → `proofread` */
export function skillNameFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}
