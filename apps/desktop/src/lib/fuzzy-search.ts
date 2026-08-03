/**
 * Fuzzy matching for picker UIs (skill `/` picker, and anywhere else a short
 * query has to rank a list of short identifiers).
 *
 * Two-stage: a Smith-Waterman-style subsequence score first, and only if the
 * query is not a subsequence at all, a bounded Levenshtein fallback so single
 * typos ("scnpy" → "scanpy") still find their target. The typo stage returns a
 * negative score, so a real subsequence match always outranks a typo match.
 */

const SCORE_GAP_LEADING = -0.005;
const SCORE_GAP_TRAILING = -0.005;
const SCORE_GAP_INNER = -0.01;
const SCORE_MATCH_CONSECUTIVE = 1.0;
const SCORE_MATCH_SLASH = 0.9;
const SCORE_MATCH_WORD = 0.8;
const SCORE_MATCH_CAPITAL = 0.7;
const SCORE_MATCH_DOT = 0.6;
const SCORE_MAX_LEADING_GAP = -0.05;

/** Bonus for matching at a word/segment boundary. */
function bonusFor(prev: string, curr: string): number {
  if (prev === "/") return SCORE_MATCH_SLASH;
  if (prev === "-" || prev === "_" || prev === " ") return SCORE_MATCH_WORD;
  if (prev === ".") return SCORE_MATCH_DOT;
  if (prev === prev.toLowerCase() && curr === curr.toUpperCase())
    return SCORE_MATCH_CAPITAL;
  return 0;
}

/**
 * Score `query` against `candidate` as a case-insensitive subsequence.
 * Returns -Infinity when the query is not a subsequence at all.
 */
export function fuzzyScore(query: string, candidate: string): number {
  const n = query.length;
  const m = candidate.length;
  if (n === 0) return 0;
  if (n > m) return -Infinity;

  const qLower = query.toLowerCase();
  const cLower = candidate.toLowerCase();

  // Cheap reject before allocating the DP matrices.
  let qi = 0;
  for (let ci = 0; ci < m && qi < n; ci++) {
    if (qLower[qi] === cLower[ci]) qi++;
  }
  if (qi < n) return -Infinity;

  // D[i][j] = best score ending in a match at j; M[i][j] = best score overall.
  const D: number[][] = [];
  const M: number[][] = [];
  for (let i = 0; i < n; i++) {
    D.push(new Array(m).fill(-Infinity));
    M.push(new Array(m).fill(-Infinity));
  }

  for (let i = 0; i < n; i++) {
    let prevScore = -Infinity;
    const gapScore = i === n - 1 ? SCORE_GAP_TRAILING : SCORE_GAP_INNER;
    for (let j = 0; j < m; j++) {
      if (qLower[i] === cLower[j]) {
        let score = 0;
        if (i === 0) {
          score =
            j === 0
              ? SCORE_MATCH_CONSECUTIVE
              : Math.max(SCORE_MAX_LEADING_GAP, SCORE_GAP_LEADING * j) +
                bonusFor(candidate[j - 1], candidate[j]);
        } else if (j > 0) {
          const consecutive = D[i - 1][j - 1] + SCORE_MATCH_CONSECUTIVE;
          const boundary =
            M[i - 1][j - 1] + bonusFor(candidate[j - 1], candidate[j]);
          score = Math.max(consecutive, boundary);
        }
        D[i][j] = score;
        M[i][j] = Math.max(score, prevScore + gapScore);
      } else {
        D[i][j] = -Infinity;
        M[i][j] = prevScore + gapScore;
      }
      prevScore = M[i][j];
    }
  }
  return M[n - 1][m - 1];
}

/** Standard edit distance, single-row DP. */
export function levenshtein(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  const dp: number[] = Array.from({ length: m + 1 }, (_, i) => i);
  for (let i = 1; i <= n; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= m; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) {
        dp[j] = prev;
      } else {
        dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      }
      prev = tmp;
    }
  }
  return dp[m];
}

/**
 * Typo-tolerant fallback: the best edit distance between `query` and any
 * substring of `candidate`, allowing at most one typo per three query chars.
 * Returns -Infinity when nothing is close enough. Always negative otherwise,
 * so subsequence matches rank above typo matches.
 */
export function typoScore(query: string, candidate: string): number {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  const maxDist = Math.max(1, Math.floor(q.length / 3));
  let bestDist = Infinity;
  const minWin = Math.max(1, q.length - maxDist);
  const maxWin = q.length + maxDist;
  for (let winLen = minWin; winLen <= maxWin && winLen <= c.length; winLen++) {
    for (let start = 0; start + winLen <= c.length; start++) {
      const sub = c.slice(start, start + winLen);
      const dist = levenshtein(q, sub);
      if (dist < bestDist) {
        bestDist = dist;
        if (dist === 0) break;
      }
    }
    if (bestDist === 0) break;
  }
  if (bestDist > maxDist) return -Infinity;
  return -0.5 - bestDist * 0.5;
}

/** The searchable text of one entry. */
export interface FuzzyFields {
  /** Primary identifier — the thing the user types (e.g. a skill's `name`). */
  primary: string;
  /** Optional second identifier (e.g. a skill's human-readable `title`). */
  secondary?: string;
  /**
   * Prose. Matched by substring only, never fuzzily — fuzzy-matching long text
   * makes almost everything match almost every query.
   */
  description?: string | null;
}

/**
 * Combined score for one entry. -Infinity means "do not show".
 */
export function scoreFields(query: string, fields: FuzzyFields): number {
  if (!query) return 0;

  const primaryScore = fuzzyScore(query, fields.primary);
  const secondaryScore = fields.secondary
    ? fuzzyScore(query, fields.secondary)
    : -Infinity;

  let descScore = -Infinity;
  if (fields.description?.toLowerCase().includes(query.toLowerCase())) {
    descScore = query.length * 0.3;
  }

  const fuzzy = Math.max(primaryScore, secondaryScore, descScore);
  if (fuzzy > -Infinity) return fuzzy;

  // Nothing matched as a subsequence — allow a typo, identifiers only.
  return Math.max(
    typoScore(query, fields.primary),
    fields.secondary ? typoScore(query, fields.secondary) : -Infinity,
  );
}

/**
 * Filter and rank `items` by `query`, best first. An empty query returns the
 * items unchanged, in their original order.
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  toFields: (item: T) => FuzzyFields,
): T[] {
  if (!query) return [...items];
  return items
    .map((item) => ({ item, score: scoreFields(query, toFields(item)) }))
    .filter((r) => r.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}
