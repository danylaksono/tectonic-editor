import { describe, expect, it } from "vitest";
import {
  buildCitationIndex,
  buildCitationPreview,
  citationKeyFromDest,
  citationVenue,
  doiUrl,
} from "@/lib/pdf-citation-preview";
import type { ProjectFile } from "@/stores/document-store";

function file(
  name: string,
  type: ProjectFile["type"],
  content: string,
): ProjectFile {
  return {
    id: name,
    name,
    relativePath: name,
    absolutePath: `C:\\project\\${name}`,
    type,
    content,
    isDirty: false,
  };
}

describe("citationKeyFromDest", () => {
  it("reads the key out of a hyperref citation destination", () => {
    expect(citationKeyFromDest("cite.smith2024")).toBe("smith2024");
    expect(citationKeyFromDest("cite.van-der-berg_2019a")).toBe(
      "van-der-berg_2019a",
    );
  });

  it("ignores destinations that are not citations", () => {
    expect(citationKeyFromDest("section.2.1")).toBeNull();
    expect(citationKeyFromDest("figure.4")).toBeNull();
    expect(citationKeyFromDest("cite.")).toBeNull();
    expect(citationKeyFromDest(null)).toBeNull();
    expect(citationKeyFromDest(undefined)).toBeNull();
  });
});

describe("doiUrl", () => {
  it("accepts the shapes DOIs are written in", () => {
    expect(doiUrl("10.5198/jtlu.v3i1.99")).toBe(
      "https://doi.org/10.5198/jtlu.v3i1.99",
    );
    expect(doiUrl("doi:10.1/x")).toBe("https://doi.org/10.1/x");
    expect(doiUrl("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
    expect(doiUrl("http://dx.doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
    expect(doiUrl(" 10.1/x ")).toBe("https://doi.org/10.1/x");
  });

  it("rejects values that are not DOIs", () => {
    expect(doiUrl(undefined)).toBeNull();
    expect(doiUrl("")).toBeNull();
    expect(doiUrl("see the publisher website")).toBeNull();
    expect(doiUrl("https://example.com/paper.pdf")).toBeNull();
  });
});

describe("buildCitationIndex", () => {
  const files = [
    file(
      "references.bib",
      "bib",
      `@article{smith2024,
  title = {A Useful Paper},
  author = {Smith, Jane and Doe, John},
  journal = {Journal of Examples},
  year = {2024},
  doi = {10.1234/example}
}

@book{smith2024,
  title = {A Later Duplicate},
  year = {2025}
}

@misc{arxiv2023,
  title = {A Preprint},
  year = {2023},
  url = {https://arxiv.org/abs/2301.00001}
}`,
    ),
    // Double backticks are LaTeX open quotes, so this source cannot be written
    // as a template literal.
    file(
      "main.tex",
      "tex",
      [
        "\\begin{thebibliography}{9}",
        "\\bibitem{mcmahan2017communication}",
        "B.~McMahan, E.~Moore, and B.~Aguera y Arcas, ``Communication-efficient" +
          " learning of deep networks,'' in \\textit{Proc. AISTATS}," +
          " pp.~1273--1282, 2017. \\url{https://doi.org/10.5555/aistats}",
        "",
        "\\bibitem[Legacy 1999]{legacy1999}",
        "A.~Legacy, ``An older work.'' % trailing comment",
        "\\end{thebibliography}",
      ].join("\n"),
    ),
    file(
      "notes.md",
      "other",
      "@article{ignored2020, title = {Not a bib file}}",
    ),
  ];
  const index = buildCitationIndex(files);

  it("indexes .bib entries and inline bibitems", () => {
    expect(index.get("smith2024")?.title).toBe("A Useful Paper");
    expect(index.get("legacy1999")?.type).toBe("bibitem");
  });

  it("locates each entry in its file, so the editor can open it", () => {
    const smith = index.get("smith2024")!;
    expect(smith.fileId).toBe("references.bib");
    expect(files[0].content!.slice(smith.from)).toMatch(/^@article\{smith2024/);

    // A bibitem is located at the command itself, not at its body.
    const legacy = index.get("legacy1999")!;
    expect(legacy.fileId).toBe("main.tex");
    expect(files[1].content!.slice(legacy.from)).toMatch(
      /^\\bibitem\[Legacy 1999\]\{legacy1999\}/,
    );
  });

  it("renders a bibitem body as the reference text a reader sees", () => {
    expect(index.get("mcmahan2017communication")?.title).toBe(
      'B. McMahan, E. Moore, and B. Aguera y Arcas, "Communication-efficient ' +
        'learning of deep networks," in Proc. AISTATS, pp. 1273–1282, 2017. ' +
        "https://doi.org/10.5555/aistats",
    );
    expect(index.get("legacy1999")?.title).toBe('A. Legacy, "An older work."');
  });

  it("links a bibitem through the DOI in its body", () => {
    const preview = buildCitationPreview(
      "mcmahan2017communication",
      index.get("mcmahan2017communication")!,
    );
    expect(preview.link).toBe("https://doi.org/10.5555/aistats");
    expect(preview.linkKind).toBe("doi");
  });

  it("keeps the first definition of a duplicated key, as BibTeX does", () => {
    expect(index.get("smith2024")?.title).not.toBe("A Later Duplicate");
  });

  it("does not scan files that are neither .bib nor .tex", () => {
    expect(index.has("ignored2020")).toBe(false);
  });

  it("prefers the DOI over the url field for the entry link", () => {
    const preview = buildCitationPreview("smith2024", index.get("smith2024")!);
    expect(preview.link).toBe("https://doi.org/10.1234/example");
    expect(preview.linkKind).toBe("doi");
    expect(citationVenue(preview.entry!)).toBe("Journal of Examples");
  });

  it("falls back to the url field when there is no DOI", () => {
    const preview = buildCitationPreview("arxiv2023", index.get("arxiv2023")!);
    expect(preview.link).toBe("https://arxiv.org/abs/2301.00001");
    expect(preview.linkKind).toBe("url");
  });

  it("reports an unresolved key without a link", () => {
    const preview = buildCitationPreview("missing2030", null);
    expect(preview.entry).toBeNull();
    expect(preview.link).toBeNull();
    expect(preview.linkKind).toBeNull();
  });
});
