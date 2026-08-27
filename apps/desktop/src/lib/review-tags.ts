/** Tags on review annotations.
 *
 *  Tags are free-form, but normalised to a lowercase kebab form so that
 *  "Likely Question", "#likely-question" and "likely question" all land on the
 *  same chip — a filter is only useful if the same idea doesn't split across
 *  three spellings. */

/** Long enough for a phrase, short enough to stay a chip. */
export const MAX_REVIEW_TAG_LENGTH = 24;
/** Past a handful the card turns into a tag cloud and stops being scannable. */
export const MAX_REVIEW_TAGS = 8;

/** Offered when a project has no tags yet. Deliberately a viva-prep set
 *  rather than a generic one — these are only suggestions, any tag works. */
export const SUGGESTED_REVIEW_TAGS = [
  "likely-question",
  "weakness",
  "defend",
  "rewrite",
  "cite-check",
  "typo",
];

/** `null` when the input holds nothing usable (punctuation, a bare "#"). */
export function normalizeReviewTag(raw: string): string | null {
  const slug = raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= MAX_REVIEW_TAG_LENGTH) return slug || null;
  // Cut on a word boundary where there is one: "chapter-three-needs-a" reads
  // as a tag, "chapter-three-needs-a-mu" reads as a bug.
  const cut = slug.slice(0, MAX_REVIEW_TAG_LENGTH);
  const lastDash = cut.lastIndexOf("-");
  const trimmed =
    lastDash > MAX_REVIEW_TAG_LENGTH / 2 ? cut.slice(0, lastDash) : cut;
  return trimmed.replace(/-+$/, "") || null;
}

/** Normalise a list, dropping blanks and duplicates, capped at MAX_REVIEW_TAGS. */
export function dedupeReviewTags(tags: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = normalizeReviewTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
    if (result.length >= MAX_REVIEW_TAGS) break;
  }
  return result;
}

/** Split typed input on commas and whitespace, so "typo, cite-check" and
 *  "typo cite-check" both add two tags. */
export function parseReviewTags(input: string): string[] {
  return dedupeReviewTags(input.split(/[,\s]+/));
}

export interface ReviewTagCount {
  tag: string;
  count: number;
}

/** Every tag in use, most-used first, for the panel's filter row. */
export function collectReviewTags(
  comments: readonly { tags?: string[] }[],
): ReviewTagCount[] {
  const counts = new Map<string, number>();
  for (const comment of comments) {
    for (const tag of comment.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
