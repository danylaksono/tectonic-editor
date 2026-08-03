/** Style checks for LaTeX prose: typography and modern-command nudges that a
 *  compile never complains about. Everything here is advisory — issues surface
 *  as "info" and, where the rewrite is unambiguous, carry exact edits so the
 *  fix stays one click. Rules stay quiet inside comments, verbatim blocks,
 *  math, and literal arguments (URLs, labels, file paths), where the text is
 *  code rather than prose and straight quotes or "..." are deliberate. */

export type StyleRule =
  | "nonbreaking-space"
  | "display-math-dollars"
  | "straight-quotes"
  | "ellipsis"
  | "deprecated-command"
  | "obsolete-environment"
  | "sectioning-jump";

export interface StyleEdit {
  from: number;
  to: number;
  insert: string;
}

export interface StyleFix {
  label: string;
  edits: StyleEdit[];
}

export interface StyleIssue {
  rule: StyleRule;
  from: number;
  to: number;
  message: string;
  /** Absent when the correct rewrite depends on author intent — a font switch
   *  has no visible scope, so replacing it automatically would guess wrong. */
  fix?: StyleFix;
}

/** Environments whose body is reproduced verbatim. */
const VERBATIM_ENVIRONMENTS = new Set([
  "verbatim",
  "Verbatim",
  "BVerbatim",
  "LVerbatim",
  "semiverbatim",
  "alltt",
  "lstlisting",
  "minted",
  "listing",
  "filecontents",
  "comment",
  "tikzpicture",
  "pycode",
  "sagesilent",
]);

/** Environments whose body is math. Trailing "*" is stripped before lookup. */
const MATH_ENVIRONMENTS = new Set([
  "math",
  "displaymath",
  "equation",
  "align",
  "alignat",
  "gather",
  "multline",
  "flalign",
  "eqnarray",
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "Bmatrix",
  "vmatrix",
  "Vmatrix",
  "smallmatrix",
  "cases",
  "split",
  "aligned",
  "gathered",
  "alignedat",
  "IEEEeqnarray",
]);

/** Commands whose braced arguments hold code rather than prose. The number is
 *  how many required groups to treat as literal; optional [..] groups sitting
 *  in front of them are consumed too. */
const LITERAL_ARGUMENT_COMMANDS = new Map<string, number>(
  Object.entries({
    url: 1,
    nolinkurl: 1,
    path: 1,
    href: 1,
    includegraphics: 1,
    includepdf: 1,
    lstinputlisting: 1,
    graphicspath: 1,
    input: 1,
    include: 1,
    subfile: 1,
    bibliography: 1,
    addbibresource: 1,
    bibliographystyle: 1,
    bibitem: 1,
    label: 1,
    ref: 1,
    eqref: 1,
    cref: 1,
    Cref: 1,
    cpageref: 1,
    autoref: 1,
    pageref: 1,
    nameref: 1,
    vref: 1,
    cite: 1,
    citep: 1,
    citet: 1,
    citeauthor: 1,
    citeyear: 1,
    parencite: 1,
    textcite: 1,
    footcite: 1,
    autocite: 1,
    supercite: 1,
    usepackage: 1,
    RequirePackage: 1,
    documentclass: 1,
    newcommand: 2,
    renewcommand: 2,
    providecommand: 2,
    newenvironment: 3,
    renewenvironment: 3,
    DeclareMathOperator: 2,
    newtheorem: 2,
    theoremstyle: 1,
    hypersetup: 1,
    geometry: 1,
    lstset: 1,
    tikzset: 1,
    pgfplotsset: 1,
    usetikzlibrary: 1,
    setlength: 2,
    addtolength: 2,
    definecolor: 3,
    pagestyle: 1,
    thispagestyle: 1,
    texttt: 1,
  }),
);

type RegionKind = "comment" | "verbatim" | "math" | "literal";

interface Region {
  kind: RegionKind;
  from: number;
  to: number;
}

interface DisplayDollarMath {
  from: number;
  to: number;
  bodyFrom: number;
  bodyTo: number;
}

interface ScanResult {
  /** Sorted, non-overlapping spans where prose rules must not fire. Environment
   *  and math delimiters stay outside their region so rules that target the
   *  delimiters themselves still see them. */
  regions: Region[];
  displayDollarMath: DisplayDollarMath[];
}

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

/** End index (exclusive) of the balanced group opening at `start`, or -1. */
function readGroup(source: string, start: number): number {
  const open = source[start];
  if (open !== "{" && open !== "[") return -1;
  const close = open === "{" ? "}" : "]";
  let depth = 0;

  for (let index = start; index < source.length; index++) {
    if (isEscaped(source, index)) continue;
    const char = source[index];
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function scanRegions(source: string): ScanResult {
  const regions: Region[] = [];
  const displayDollarMath: DisplayDollarMath[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === "%") {
      const newline = source.indexOf("\n", index);
      const end = newline === -1 ? source.length : newline;
      regions.push({ kind: "comment", from: index, to: end });
      index = end;
      continue;
    }

    if (char === "$") {
      const display = source[index + 1] === "$";
      const bodyFrom = index + (display ? 2 : 1);
      let closing = -1;
      for (let i = bodyFrom; i < source.length; i++) {
        if (source[i] !== "$" || isEscaped(source, i)) continue;
        if (display && source[i + 1] !== "$") continue;
        closing = i;
        break;
      }
      if (closing === -1) {
        // Unterminated math: treat the remainder as math so prose rules stay
        // quiet rather than firing all over half-written source.
        regions.push({ kind: "math", from: bodyFrom, to: source.length });
        break;
      }
      regions.push({ kind: "math", from: bodyFrom, to: closing });
      if (display)
        displayDollarMath.push({
          from: index,
          to: closing + 2,
          bodyFrom,
          bodyTo: closing,
        });
      index = closing + (display ? 2 : 1);
      continue;
    }

    if (char !== "\\") {
      index++;
      continue;
    }

    const next = source[index + 1];
    if (next === "[" || next === "(") {
      const closer = next === "[" ? "\\]" : "\\)";
      const bodyFrom = index + 2;
      const at = source.indexOf(closer, bodyFrom);
      regions.push({
        kind: "math",
        from: bodyFrom,
        to: at === -1 ? source.length : at,
      });
      index = at === -1 ? source.length : at + 2;
      continue;
    }

    const name = /^[a-zA-Z]+/.exec(source.slice(index + 1, index + 64))?.[0];
    if (!name) {
      // An escaped character (\%, \$, \", \\) — step over both.
      index += 2;
      continue;
    }
    let cursor = index + 1 + name.length;

    if (name === "verb" || name === "lstinline") {
      if (source[cursor] === "*") cursor++;
      if (source[cursor] === "{") {
        const end = readGroup(source, cursor);
        if (end !== -1) {
          regions.push({ kind: "verbatim", from: cursor + 1, to: end - 1 });
          index = end;
          continue;
        }
      }
      const delimiter = source[cursor];
      if (delimiter) {
        const at = source.indexOf(delimiter, cursor + 1);
        regions.push({
          kind: "verbatim",
          from: cursor + 1,
          to: at === -1 ? source.length : at,
        });
        index = at === -1 ? source.length : at + 1;
        continue;
      }
      index = cursor;
      continue;
    }

    if (name === "begin") {
      const nameEnd = readGroup(source, cursor);
      if (nameEnd === -1) {
        index = cursor;
        continue;
      }
      const environment = source.slice(cursor + 1, nameEnd - 1).trim();
      const base = environment.replace(/\*$/, "");
      const kind: RegionKind | null = VERBATIM_ENVIRONMENTS.has(base)
        ? "verbatim"
        : MATH_ENVIRONMENTS.has(base)
          ? "math"
          : null;
      if (!kind) {
        index = nameEnd;
        continue;
      }
      const closing = source.indexOf(`\\end{${environment}}`, nameEnd);
      const end = closing === -1 ? source.length : closing;
      regions.push({ kind, from: nameEnd, to: end });
      index = end;
      continue;
    }

    if (name === "def") {
      // \def\macro{body}: step over the macro name so the body is the group.
      const macro = /^\\(?:[a-zA-Z]+|.)/.exec(source.slice(cursor));
      if (macro) cursor += macro[0].length;
    }

    const literalGroups =
      name === "def" ? 1 : LITERAL_ARGUMENT_COMMANDS.get(name);
    if (literalGroups === undefined) {
      index = cursor;
      continue;
    }

    let remaining = literalGroups;
    while (remaining > 0 && cursor < source.length) {
      while (source[cursor] === " " || source[cursor] === "\t") cursor++;
      const open = source[cursor];
      if (open !== "[" && open !== "{") break;
      const end = readGroup(source, cursor);
      if (end === -1) break;
      regions.push({ kind: "literal", from: cursor + 1, to: end - 1 });
      cursor = end;
      if (open === "{") remaining--;
    }
    index = Math.max(cursor, index + 1);
  }

  regions.sort((a, b) => a.from - b.from);
  return { regions, displayDollarMath };
}

/** Binary-search predicate over the sorted, non-overlapping region list. */
function createProtectionLookup(regions: Region[]) {
  return (from: number, to: number): boolean => {
    let low = 0;
    let high = regions.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const region = regions[mid];
      if (region.to <= from) low = mid + 1;
      else if (region.from >= to) high = mid - 1;
      else return true;
    }
    return false;
  };
}

const REFERENCE_NOUNS =
  "Figures?|Figs?\\.|Tables?|Sections?|Secs?\\.|Equations?|Eqs?\\.|" +
  "Chapters?|Appendix|Appendices|Listings?|Algorithms?|Theorems?|Lemmas?|" +
  "Definitions?|Corollary|Corollaries|Remarks?|Pages?|Parts?|Steps?|Examples?";

const REFERENCE_COMMANDS =
  "ref|eqref|cref|Cref|cpageref|autoref|pageref|nameref|vref|" +
  "cite[a-zA-Z]*|parencite|textcite|footcite|autocite";

/** Plain-TeX font switches and layout commands with maintained replacements. */
const DEPRECATED_COMMANDS: Record<string, string> = {
  bf: "\\textbf{…} or \\bfseries",
  it: "\\textit{…} or \\itshape",
  rm: "\\textrm{…} or \\rmfamily",
  sf: "\\textsf{…} or \\sffamily",
  sl: "\\textsl{…} or \\slshape",
  sc: "\\textsc{…} or \\scshape",
  tt: "\\texttt{…} or \\ttfamily",
  centerline: "the center environment",
};

const OBSOLETE_ENVIRONMENTS: Record<string, string> = {
  eqnarray: "align",
};

const SECTIONING_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

/** Longest-first so the alternation never settles for a shorter prefix. */
const SECTIONING_PATTERN =
  /\\(subparagraph|subsubsection|subsection|paragraph|chapter|section|part)\*?[ \t]*[[{]/g;

function nonbreakingSpaceIssues(
  source: string,
  isProtected: (from: number, to: number) => boolean,
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const pattern = new RegExp(
    `\\b(${REFERENCE_NOUNS})([ \\t]+)\\\\(?:${REFERENCE_COMMANDS})\\b`,
    "g",
  );
  for (const match of source.matchAll(pattern)) {
    const from = (match.index ?? 0) + match[1].length;
    const to = from + match[2].length;
    if (isProtected(from, to)) continue;
    issues.push({
      rule: "nonbreaking-space",
      from,
      to,
      message: `Bind "${match[1]}" to its number with a non-breaking space (~) so the reference cannot start a new line.`,
      fix: { label: "Insert ~", edits: [{ from, to, insert: "~" }] },
    });
  }
  return issues;
}

function displayMathDollarIssues(
  displayDollarMath: DisplayDollarMath[],
): StyleIssue[] {
  return displayDollarMath.map((math) => ({
    rule: "display-math-dollars" as const,
    from: math.from,
    to: math.to,
    message:
      "$$…$$ is plain TeX and gets amsmath spacing wrong — \\[…\\] is the LaTeX form.",
    fix: {
      label: "Replace with \\[…\\]",
      edits: [
        { from: math.from, to: math.bodyFrom, insert: "\\[" },
        { from: math.bodyTo, to: math.to, insert: "\\]" },
      ],
    },
  }));
}

function straightQuoteIssues(
  source: string,
  isProtected: (from: number, to: number) => boolean,
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (let index = source.indexOf('"'); index !== -1; ) {
    const next = source.indexOf('"', index + 1);
    const previous = index > 0 ? source[index - 1] : "";
    const following = source[index + 1] ?? "";
    // Letters on both sides means a babel shorthand (M"oller, stra"se), never
    // a quotation mark — a real quote always abuts a space or punctuation.
    const shorthand = /\p{L}/u.test(previous) && /\p{L}/u.test(following);
    if (
      !shorthand &&
      !isProtected(index, index + 1) &&
      !isEscaped(source, index)
    ) {
      const opening = previous === "" || /[\s([{~\-–—/]/.test(previous);
      const replacement = opening ? "``" : "''";
      issues.push({
        rule: "straight-quotes",
        from: index,
        to: index + 1,
        message: `A straight " always renders as a closing quote — use ${replacement} for ${opening ? "an opening" : "a closing"} quote.`,
        fix: {
          label: `Replace with ${replacement}`,
          edits: [{ from: index, to: index + 1, insert: replacement }],
        },
      });
    }
    index = next;
  }
  return issues;
}

function ellipsisIssues(
  source: string,
  isProtected: (from: number, to: number) => boolean,
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  for (const match of source.matchAll(/\.{3,}/g)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    issues.push({
      rule: "ellipsis",
      from,
      to,
      message:
        "Consecutive periods set uneven spacing — \\dots is the LaTeX ellipsis.",
      fix: {
        label: "Replace with \\dots",
        edits: [{ from, to, insert: "\\dots" }],
      },
    });
  }
  return issues;
}

function deprecatedCommandIssues(
  source: string,
  isProtected: (from: number, to: number) => boolean,
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const pattern = new RegExp(
    `\\\\(${Object.keys(DEPRECATED_COMMANDS).join("|")})\\b`,
    "g",
  );
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    issues.push({
      rule: "deprecated-command",
      from,
      to,
      message: `\\${match[1]} is a plain-TeX carry-over — use ${DEPRECATED_COMMANDS[match[1]]}.`,
    });
  }
  return issues;
}

function obsoleteEnvironmentIssues(
  source: string,
  isProtected: (from: number, to: number) => boolean,
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  const pattern = new RegExp(
    `\\\\begin\\{(${Object.keys(OBSOLETE_ENVIRONMENTS).join("|")})(\\*?)\\}`,
    "g",
  );
  for (const match of source.matchAll(pattern)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const environment = `${match[1]}${match[2]}`;
    const replacement = `${OBSOLETE_ENVIRONMENTS[match[1]]}${match[2]}`;
    const message = `${environment} spaces relations badly — amsmath's ${replacement} is the maintained replacement.`;

    // Only offer the rewrite when the matching \end is actually there;
    // renaming one half of an unbalanced pair would break the build.
    const closing = source.indexOf(`\\end{${environment}}`, to);
    if (closing === -1) {
      issues.push({ rule: "obsolete-environment", from, to, message });
      continue;
    }
    const nameFrom = from + "\\begin{".length;
    const closingNameFrom = closing + "\\end{".length;
    issues.push({
      rule: "obsolete-environment",
      from,
      to,
      message,
      fix: {
        label: `Convert to ${replacement}`,
        edits: [
          {
            from: nameFrom,
            to: nameFrom + environment.length,
            insert: replacement,
          },
          {
            from: closingNameFrom,
            to: closingNameFrom + environment.length,
            insert: replacement,
          },
        ],
      },
    });
  }
  return issues;
}

function sectioningJumpIssues(
  source: string,
  isProtected: (from: number, to: number) => boolean,
): StyleIssue[] {
  const issues: StyleIssue[] = [];
  let previous: { name: string; level: number } | null = null;

  for (const match of source.matchAll(SECTIONING_PATTERN)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (isProtected(from, to)) continue;
    const name = match[1];
    const level = SECTIONING_LEVELS[name];
    // The first heading sets the baseline: plenty of documents legitimately
    // open at \section without a \chapter above it.
    const above = previous;
    if (above && level > above.level + 1) {
      const skipped = Object.keys(SECTIONING_LEVELS).filter((candidate) => {
        const value = SECTIONING_LEVELS[candidate];
        return value > above.level && value < level;
      });
      issues.push({
        rule: "sectioning-jump",
        from,
        to: from + 1 + name.length,
        message: `\\${name} follows \\${above.name}, skipping \\${skipped.join(" and \\")} — the table of contents will have a gap.`,
      });
    }
    previous = { name, level };
  }
  return issues;
}

/** Every style issue in `source`, ordered by position. */
export function findStyleIssues(source: string): StyleIssue[] {
  const { regions, displayDollarMath } = scanRegions(source);
  const isProtected = createProtectionLookup(regions);

  return [
    ...nonbreakingSpaceIssues(source, isProtected),
    ...displayMathDollarIssues(displayDollarMath),
    ...straightQuoteIssues(source, isProtected),
    ...ellipsisIssues(source, isProtected),
    ...deprecatedCommandIssues(source, isProtected),
    ...obsoleteEnvironmentIssues(source, isProtected),
    ...sectioningJumpIssues(source, isProtected),
  ].sort((left, right) => left.from - right.from);
}
