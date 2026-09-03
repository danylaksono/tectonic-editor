import type { ReviewComment } from "@/stores/review-store";

/**
 * Free-text search across review annotations.
 *
 * Terms are ANDed, because that is how people narrow a long list: typing more
 * words should mean fewer results, not more. Each term is a plain substring
 * match — annotations are prose, and making the reader think about regex
 * syntax to find their own note would be a poor trade.
 *
 * A term written as `#tag` matches tags only, so a search can mix the two:
 * `#weakness sample` finds tagged notes that also mention the sample.
 */

/** Everything about an annotation a search should look at. Replies are
 *  included: a peer's answer is often where the useful sentence lives. */
function haystack(comment: ReviewComment): string {
  return [
    comment.body,
    comment.anchor.selectedText ?? "",
    comment.author,
    ...(comment.tags ?? []),
    ...comment.replies.flatMap((reply) => [reply.body, reply.author]),
  ]
    .join("\n")
    .toLowerCase();
}

function matchesTerm(comment: ReviewComment, term: string): boolean {
  if (term.startsWith("#") && term.length > 1) {
    const wanted = term.slice(1);
    return (comment.tags ?? []).some((tag) => tag.includes(wanted));
  }
  return haystack(comment).includes(term);
}

export function matchesReviewQuery(
  comment: ReviewComment,
  query: string,
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => matchesTerm(comment, term));
}

export function filterReviewComments(
  comments: readonly ReviewComment[],
  query: string,
): ReviewComment[] {
  if (!query.trim()) return [...comments];
  return comments.filter((comment) => matchesReviewQuery(comment, query));
}
