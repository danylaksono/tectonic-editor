import { describe, expect, it } from "vitest";
import { parseDocumentOutline } from "@/lib/document-outline";

describe("parseDocumentOutline", () => {
  it("parses section hierarchy", () => {
    const outline = parseDocumentOutline(`
\\section{Introduction}
\\subsection{Related Work}
\\subsubsection{Prior Models}
`);

    expect(outline).toMatchObject([
      {
        kind: "section",
        group: "structure",
        level: 2,
        title: "Introduction",
        line: 2,
      },
      {
        kind: "subsection",
        group: "structure",
        level: 3,
        title: "Related Work",
        line: 3,
      },
      {
        kind: "subsubsection",
        group: "structure",
        level: 4,
        title: "Prior Models",
        line: 4,
      },
    ]);
  });

  it("parses floats, equations, labels, and bibliography entries", () => {
    const outline = parseDocumentOutline(`
\\begin{figure}
  \\caption{Model overview}
  \\label{fig:model}
\\end{figure}

\\begin{equation}
  y = mx + b
  \\label{eq:line}
\\end{equation}

\\bibliography{references}
`);

    expect(outline).toEqual([
      {
        kind: "figure",
        group: "objects",
        level: 1,
        title: "Model overview",
        detail: "figure",
        line: 2,
      },
      {
        kind: "label",
        group: "objects",
        level: 2,
        title: "fig:model",
        detail: "label",
        line: 4,
      },
      {
        kind: "equation",
        group: "objects",
        level: 1,
        title: "Equation",
        detail: "equation",
        line: 7,
      },
      {
        kind: "label",
        group: "objects",
        level: 2,
        title: "eq:line",
        detail: "label",
        line: 9,
      },
      {
        kind: "bibliography",
        group: "objects",
        level: 1,
        title: "Bibliography",
        detail: "references",
        line: 12,
      },
    ]);
  });

  it("captures appendix markers", () => {
    const outline = parseDocumentOutline(`
\\appendix
\\section{Supplementary Results}
`);

    expect(outline[0]).toMatchObject({
      kind: "appendix",
      group: "structure",
      title: "Appendix",
      line: 2,
    });
  });
});
