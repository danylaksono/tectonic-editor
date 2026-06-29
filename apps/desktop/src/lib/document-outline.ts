export type OutlineItemKind =
  | "part"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "appendix"
  | "figure"
  | "table"
  | "equation"
  | "label"
  | "bibliography";

export type OutlineItemGroup = "structure" | "objects";

export interface OutlineItem {
  kind: OutlineItemKind;
  group: OutlineItemGroup;
  level: number;
  title: string;
  detail?: string;
  line: number;
}

const HEADING_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
};

function stripLatex(value: string) {
  return value
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstBraceArgument(line: string, command: string) {
  const start = line.search(
    new RegExp(`\\\\${command}\\*?(?:\\[[^\\]]*\\])?\\s*\\{`),
  );
  if (start === -1) return null;
  const open = line.indexOf("{", start);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < line.length; i++) {
    if (line[i] === "{") depth++;
    if (line[i] === "}") {
      depth--;
      if (depth === 0) return line.slice(open + 1, i);
    }
  }

  return null;
}

function findLabels(line: string) {
  const labels: string[] = [];
  const regex = /\\label\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line))) {
    labels.push(match[1].trim());
  }
  return labels;
}

export function parseDocumentOutline(content: string): OutlineItem[] {
  const lines = content.split("\n");
  const items: OutlineItem[] = [];
  let openFloatIndex: number | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    const headingMatch = line.match(
      /\\(part|chapter|section|subsection|subsubsection)\*?(?:\[[^\]]*\])?\s*\{/,
    );
    if (headingMatch) {
      const type = headingMatch[1];
      const title = firstBraceArgument(line, type);
      items.push({
        kind: type as OutlineItemKind,
        group: "structure",
        level: HEADING_LEVELS[type] ?? 2,
        title: stripLatex(title ?? "") || "Untitled",
        line: lineNumber,
      });
    }

    if (/\\appendix\b/.test(line)) {
      items.push({
        kind: "appendix",
        group: "structure",
        level: 1,
        title: "Appendix",
        line: lineNumber,
      });
    }

    const beginMatch = line.match(
      /\\begin\{(figure|table|equation|align|gather|multline)\*?\}/,
    );
    if (beginMatch) {
      const environment = beginMatch[1];
      if (environment === "figure" || environment === "table") {
        items.push({
          kind: environment,
          group: "objects",
          level: 1,
          title: environment === "figure" ? "Figure" : "Table",
          detail: environment,
          line: lineNumber,
        });
        openFloatIndex = items.length - 1;
      } else {
        items.push({
          kind: "equation",
          group: "objects",
          level: 1,
          title: "Equation",
          detail: environment,
          line: lineNumber,
        });
      }
    }

    const caption = firstBraceArgument(line, "caption");
    if (caption && openFloatIndex != null) {
      items[openFloatIndex] = {
        ...items[openFloatIndex],
        title: stripLatex(caption) || items[openFloatIndex].title,
      };
    }

    if (/\\end\{(figure|table)\*?\}/.test(line)) {
      openFloatIndex = null;
    }

    const bibliographyMatch = line.match(
      /\\(bibliography|printbibliography|addbibresource)(?:\[[^\]]*\])?(?:\{([^}]*)\})?/,
    );
    if (bibliographyMatch) {
      const target = bibliographyMatch[2]?.trim();
      items.push({
        kind: "bibliography",
        group: "objects",
        level: 1,
        title:
          bibliographyMatch[1] === "addbibresource"
            ? "Bibliography file"
            : "Bibliography",
        detail: target,
        line: lineNumber,
      });
    }

    for (const label of findLabels(line)) {
      items.push({
        kind: "label",
        group: "objects",
        level: 2,
        title: label,
        detail: "label",
        line: lineNumber,
      });
    }
  });

  return items;
}
