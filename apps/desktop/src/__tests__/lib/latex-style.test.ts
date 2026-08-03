import { describe, expect, it } from "vitest";
import {
  findStyleIssues,
  type StyleIssue,
  type StyleRule,
} from "@/lib/latex-style";

function rules(source: string): StyleRule[] {
  return findStyleIssues(source).map((issue) => issue.rule);
}

function only(source: string, rule: StyleRule): StyleIssue[] {
  return findStyleIssues(source).filter((issue) => issue.rule === rule);
}

/** Apply an issue's fix the way the editor action does. */
function applyFix(source: string, issue: StyleIssue): string {
  if (!issue.fix) throw new Error(`no fix for ${issue.rule}`);
  let result = source;
  for (const edit of [...issue.fix.edits].sort((a, b) => b.from - a.from))
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  return result;
}

describe("protected regions", () => {
  it("ignores prose rules inside comments", () => {
    expect(rules('% see "this" and ... in Figure \\ref{a}')).toEqual([]);
  });

  it("ignores verbatim environments", () => {
    const source = [
      "\\begin{verbatim}",
      'print("hello...")',
      "\\end{verbatim}",
    ].join("\n");
    expect(rules(source)).toEqual([]);
  });

  it("ignores lstlisting bodies", () => {
    const source = '\\begin{lstlisting}\nx = "a..."\n\\end{lstlisting}';
    expect(rules(source)).toEqual([]);
  });

  it("ignores \\verb spans with arbitrary delimiters", () => {
    expect(rules("Run \\verb|cd ...| now.")).toEqual([]);
    expect(rules('Run \\verb+"quoted"+ now.')).toEqual([]);
  });

  it("ignores inline and display math bodies", () => {
    expect(rules("$a ... b$")).toEqual([]);
    expect(rules("\\[ a ... b \\]")).toEqual([]);
    expect(rules("\\( a ... b \\)")).toEqual([]);
    expect(rules("\\begin{align}\na &... b\n\\end{align}")).toEqual([]);
  });

  it("ignores URLs, file paths, and label arguments", () => {
    expect(rules("\\url{http://x.test/a...b}")).toEqual([]);
    expect(rules("\\includegraphics[width=2cm]{fig/a...b.png}")).toEqual([]);
    expect(rules("\\label{sec:a...b}")).toEqual([]);
    expect(rules("\\texttt{a...b}")).toEqual([]);
  });

  it("does not protect prose after a literal argument closes", () => {
    expect(rules("\\label{x} and then ...")).toEqual(["ellipsis"]);
  });

  it("does not treat a bracket group after the arguments as optional", () => {
    // "[note]" is prose here, not an optional argument of \ref.
    expect(rules("See \\ref{x} [note ...]")).toEqual(["ellipsis"]);
  });

  it("ignores escaped characters", () => {
    expect(rules('50\\% of \\"a and \\$5')).toEqual([]);
  });

  it("stays quiet on unterminated math rather than flooding", () => {
    expect(rules('Text $a "b" ... c')).toEqual([]);
  });
});

describe("non-breaking space before references", () => {
  it("flags a plain space between the noun and the reference", () => {
    const issues = only(
      "As shown in Figure \\ref{fig:a}.",
      "nonbreaking-space",
    );
    expect(issues).toHaveLength(1);
    expect(applyFix("As shown in Figure \\ref{fig:a}.", issues[0])).toBe(
      "As shown in Figure~\\ref{fig:a}.",
    );
  });

  it("accepts a tie that is already there", () => {
    expect(rules("See Figure~\\ref{fig:a}.")).toEqual([]);
  });

  it("covers the common noun and command spellings", () => {
    expect(only("Table \\ref{t}", "nonbreaking-space")).toHaveLength(1);
    expect(only("Eq. \\eqref{e}", "nonbreaking-space")).toHaveLength(1);
    expect(only("Sections \\cref{a}", "nonbreaking-space")).toHaveLength(1);
    expect(only("Chapter \\autoref{c}", "nonbreaking-space")).toHaveLength(1);
  });

  it("leaves a line break alone — the space is not the author's to bind", () => {
    expect(rules("See Figure\n\\ref{fig:a}.")).toEqual([]);
  });

  it("does not fire on unrelated words", () => {
    expect(rules("The preference \\ref{x} holds.")).toEqual([]);
  });
});

describe("display math dollars", () => {
  it("rewrites $$…$$ to \\[…\\]", () => {
    const source = "Before\n$$ a = b $$\nAfter";
    const issues = only(source, "display-math-dollars");
    expect(issues).toHaveLength(1);
    expect(applyFix(source, issues[0])).toBe("Before\n\\[ a = b \\]\nAfter");
  });

  it("leaves inline math alone", () => {
    expect(rules("Inline $a = b$ here.")).toEqual([]);
  });

  it("does not confuse two inline spans with one display span", () => {
    expect(rules("$a$ and $b$")).toEqual([]);
  });
});

describe("straight quotes", () => {
  it("distinguishes opening from closing quotes", () => {
    const source = 'He said "hello" loudly.';
    const issues = only(source, "straight-quotes");
    expect(issues).toHaveLength(2);
    expect(issues[0].fix?.edits[0].insert).toBe("``");
    expect(issues[1].fix?.edits[0].insert).toBe("''");
  });

  it("produces valid LaTeX when both fixes are applied", () => {
    const source = 'He said "hello" loudly.';
    const issues = only(source, "straight-quotes");
    let result = source;
    for (const issue of [...issues].reverse()) result = applyFix(result, issue);
    expect(result).toBe("He said ``hello'' loudly.");
  });

  it("treats a quote after an opening bracket as opening", () => {
    const issues = only('("quoted")', "straight-quotes");
    expect(issues[0].fix?.edits[0].insert).toBe("``");
  });

  it("leaves apostrophes alone", () => {
    expect(rules("The author's argument doesn't change.")).toEqual([]);
  });

  it("leaves babel umlaut shorthands alone", () => {
    // M"oller is an o-umlaut, not an unbalanced quote.
    expect(rules('Tory and M"oller argue that')).toEqual([]);
    expect(rules('gro"se Stra"se')).toEqual([]);
  });

  it("still flags a closing quote that touches a letter on one side", () => {
    expect(only('say "hi" now', "straight-quotes")).toHaveLength(2);
  });
});

describe("ellipsis", () => {
  it("replaces three periods with \\dots", () => {
    const source = "and so on...";
    const issues = only(source, "ellipsis");
    expect(applyFix(source, issues[0])).toBe("and so on\\dots");
  });

  it("collapses longer runs into a single issue", () => {
    expect(only("wait.....", "ellipsis")).toHaveLength(1);
  });

  it("ignores ordinary sentence periods", () => {
    expect(rules("One. Two. Three.")).toEqual([]);
  });
});

describe("deprecated commands", () => {
  it("flags plain-TeX font switches", () => {
    expect(rules("{\\bf bold} and {\\it italic}")).toEqual([
      "deprecated-command",
      "deprecated-command",
    ]);
  });

  it("does not flag the modern declaration forms", () => {
    expect(rules("{\\bfseries bold} {\\itshape it} {\\ttfamily tt}")).toEqual(
      [],
    );
  });

  it("does not mistake \\item for \\it", () => {
    expect(rules("\\item First")).toEqual([]);
  });

  it("offers no fix, because the switch has no visible scope", () => {
    expect(only("{\\bf x}", "deprecated-command")[0].fix).toBeUndefined();
  });
});

describe("obsolete environments", () => {
  it("renames both halves of an eqnarray", () => {
    const source = "\\begin{eqnarray}\na &=& b\n\\end{eqnarray}";
    const issues = only(source, "obsolete-environment");
    expect(issues).toHaveLength(1);
    expect(applyFix(source, issues[0])).toBe(
      "\\begin{align}\na &=& b\n\\end{align}",
    );
  });

  it("keeps the star when converting", () => {
    const source = "\\begin{eqnarray*}\na\n\\end{eqnarray*}";
    expect(applyFix(source, only(source, "obsolete-environment")[0])).toBe(
      "\\begin{align*}\na\n\\end{align*}",
    );
  });

  it("reports but does not rewrite an unbalanced environment", () => {
    const issues = only("\\begin{eqnarray}\na = b\n", "obsolete-environment");
    expect(issues).toHaveLength(1);
    expect(issues[0].fix).toBeUndefined();
  });
});

describe("sectioning level jumps", () => {
  it("flags a skipped level", () => {
    const issues = only(
      "\\section{A}\n\\subsubsection{B}\n",
      "sectioning-jump",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("subsection");
  });

  it("accepts the first heading at any level", () => {
    expect(rules("\\subsection{Standalone}\n")).toEqual([]);
  });

  it("accepts descending one level at a time and any climb back up", () => {
    const source =
      "\\section{A}\n\\subsection{B}\n\\subsubsection{C}\n\\section{D}\n";
    expect(rules(source)).toEqual([]);
  });

  it("does not match commands that merely start with a section name", () => {
    expect(rules("\\section{A}\n\\sectionmark{short}\n")).toEqual([]);
  });
});

describe("issue ordering", () => {
  it("returns issues sorted by position", () => {
    const source = 'Intro "q" and Figure \\ref{a} then...';
    const positions = findStyleIssues(source).map((issue) => issue.from);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
