import type { ReviewComment } from "@/stores/review-store";
import { collectReviewTags } from "@/lib/review-tags";

/**
 * Rendering review annotations as a Markdown document.
 *
 * The review files on disk are already JSON, so "export" is not about getting
 * the data out — it is about getting it into a form a person can read straight
 * through: what you hand a supervisor, or print and take into the room. That
 * means document order (not the panel's open-first order), the quoted text with
 * each note so it stands alone away from the PDF, and the source location so
 * every entry is still actionable back in the editor.
 */

export interface ReviewReportOptions {
  /** Root .tex file the annotations belong to, used as the title. */
  documentRoot: string;
  /** Defaults to now; injectable so the output is testable. */
  exportedAt?: Date;
  /** What the reader is looking at when the export was filtered, e.g.
   *  "open annotations tagged #likely-question". Omitted when it is everything. */
  filterNote?: string;
  /** Size of the unfiltered set, so a filtered report says what it left out. */
  totalCount?: number;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Quote a passage as Markdown, keeping its line breaks inside the quote. */
function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line.trim()}`.trimEnd())
    .join("\n");
}

/** Reading order: down the document, then down each page. The panel sorts
 *  open annotations first, which is right for working through a list and wrong
 *  for a document meant to be read alongside the PDF. */
function inReadingOrder(comments: readonly ReviewComment[]): ReviewComment[] {
  return [...comments].sort(
    (a, b) => a.anchor.page - b.anchor.page || a.anchor.y - b.anchor.y,
  );
}

function renderEntry(comment: ReviewComment): string {
  const lines: string[] = [];
  const heading = [
    `p. ${comment.anchor.page}`,
    comment.author,
    comment.kind === "highlight" ? "highlight" : "comment",
    comment.status,
  ].join(" · ");
  lines.push(`### ${heading}`);

  if (comment.tags?.length) {
    lines.push("", comment.tags.map((tag) => `\`#${tag}\``).join(" "));
  }
  if (comment.anchor.selectedText) {
    lines.push("", blockquote(comment.anchor.selectedText));
  }
  if (comment.body) {
    lines.push("", comment.body);
  } else if (comment.kind === "highlight") {
    lines.push("", "*Highlighted, no note.*");
  }
  if (comment.anchor.source) {
    const { file, line } = comment.anchor.source;
    lines.push("", `Source: \`${file}:${line}\``);
  }
  for (const reply of comment.replies) {
    const when = formatShortDate(reply.createdAt);
    lines.push(
      "",
      `**${reply.author}** replied${when ? ` (${when})` : ""}:`,
      "",
      blockquote(reply.body),
    );
  }
  return lines.join("\n");
}

/** Tag counts as a table, so a long list stays scannable. Skipped entirely
 *  when nothing is tagged. */
function renderTagSummary(comments: readonly ReviewComment[]): string | null {
  const tags = collectReviewTags(comments);
  if (tags.length === 0) return null;
  const openByTag = new Map<string, number>();
  for (const comment of comments) {
    if (comment.status !== "open") continue;
    for (const tag of comment.tags ?? []) {
      openByTag.set(tag, (openByTag.get(tag) ?? 0) + 1);
    }
  }
  return [
    "## By tag",
    "",
    "| Tag | Open | Total |",
    "| --- | ---: | ----: |",
    ...tags.map(
      ({ tag, count }) => `| ${tag} | ${openByTag.get(tag) ?? 0} | ${count} |`,
    ),
  ].join("\n");
}

export function buildReviewReport(
  comments: readonly ReviewComment[],
  options: ReviewReportOptions,
): string {
  const exportedAt = options.exportedAt ?? new Date();
  const openCount = comments.filter(
    (comment) => comment.status === "open",
  ).length;
  const reviewers = [...new Set(comments.map((c) => c.author))].sort();

  const sections: string[] = [`# Review notes — ${options.documentRoot}`];

  const meta = [
    formatDate(exportedAt),
    `${comments.length} annotation${comments.length === 1 ? "" : "s"} (${openCount} open)`,
  ];
  if (reviewers.length > 0) meta.push(`reviewers: ${reviewers.join(", ")}`);
  sections.push(`*${meta.join(" · ")}*`);

  if (options.filterNote) {
    const outOf =
      options.totalCount !== undefined && options.totalCount > comments.length
        ? ` — ${comments.length} of ${options.totalCount} annotations`
        : "";
    sections.push(`> Filtered to ${options.filterNote}${outOf}.`);
  }

  if (comments.length === 0) {
    sections.push("No annotations to report.");
    return `${sections.join("\n\n")}\n`;
  }

  const tagSummary = renderTagSummary(comments);
  if (tagSummary) sections.push(tagSummary);

  sections.push("## Annotations");
  sections.push(inReadingOrder(comments).map(renderEntry).join("\n\n---\n\n"));

  return `${sections.join("\n\n")}\n`;
}

/** Default file name for the saved report, derived from the root file. */
export function reviewReportFileName(documentRoot: string): string {
  const base = documentRoot.replace(/\.tex$/i, "").replace(/[\\/]/g, "-");
  return `${base || "review"}-review.md`;
}
