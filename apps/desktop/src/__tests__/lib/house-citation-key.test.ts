import { describe, expect, it } from "vitest";
import {
  collectProjectCitations,
  findExistingCitationKey,
  houseCitationKey,
  prepareBibtexEntries,
  previewHouseCitationKey,
} from "@/lib/bibliography-import";
import type { ProjectFile } from "@/stores/document-store";

const zoteroExport = [
  "@article{doeSpatialModels2024,",
  "  author = {Doe, Jane and Byron, Ada},",
  "  title = {Spatial Models of Urban Growth},",
  "  year = {2024},",
  "  journal = {Journal of Geography}",
  "}",
].join("\n");

function bibFile(content: string): ProjectFile {
  return {
    id: "references.bib",
    name: "references.bib",
    relativePath: "references.bib",
    absolutePath: "/project/references.bib",
    type: "bib",
    content,
  } as ProjectFile;
}

describe("houseCitationKey", () => {
  it("joins family name, year and first substantial title word", () => {
    expect(
      houseCitationKey({
        author: "Lovelace, Ada",
        title: "A Useful Paper",
        year: "2025",
      }),
    ).toBe("lovelace2025useful");
  });

  it("reads a family name given first-name-first", () => {
    expect(
      houseCitationKey({
        author: "Ada Lovelace",
        title: "Notes",
        year: "2025",
      }),
    ).toBe("lovelace2025notes");
  });

  it("uses only the first of several authors", () => {
    expect(
      houseCitationKey({
        author: "Doe, Jane and Byron, Ada",
        title: "Spatial Models",
        year: "2024",
      }),
    ).toBe("doe2024spatial");
  });

  it("strips accents and punctuation from the family name", () => {
    expect(
      houseCitationKey({
        author: "O'Neill-Smith, Pat",
        title: "Cities",
        year: "2020",
      }),
    ).toBe("oneillsmith2020cities");
  });

  it("falls back when author, title or year are missing", () => {
    expect(houseCitationKey({})).toBe("sourcendwork");
  });

  it("suffixes a key that is already taken", () => {
    expect(
      houseCitationKey(
        { author: "Lovelace, Ada", title: "A Useful Paper", year: "2025" },
        ["lovelace2025useful"],
      ),
    ).toBe("lovelace2025useful2");
  });
});

describe("previewHouseCitationKey", () => {
  it("shows the key a Zotero entry will get, not the one it has", () => {
    expect(previewHouseCitationKey(zoteroExport)).toBe("doe2024spatial");
  });

  it("is empty for source with no entry", () => {
    expect(previewHouseCitationKey("not bibtex")).toBe("");
  });
});

describe("prepareBibtexEntries with rekey", () => {
  it("replaces the exporter's key with the house one", () => {
    const [entry] = prepareBibtexEntries(zoteroExport, [], { rekey: true });
    expect(entry.originalKey).toBe("doeSpatialModels2024");
    expect(entry.key).toBe("doe2024spatial");
    expect(entry.source).toContain("@article{doe2024spatial,");
  });

  it("keeps the exporter's key when rekeying is off", () => {
    const [entry] = prepareBibtexEntries(zoteroExport, []);
    expect(entry.key).toBe("doeSpatialModels2024");
  });

  it("still suffixes when the house key is taken", () => {
    const [entry] = prepareBibtexEntries(zoteroExport, ["doe2024spatial"], {
      rekey: true,
    });
    expect(entry.key).toBe("doe2024spatial2");
  });

  it("gives two entries in one batch distinct keys", () => {
    const keys = prepareBibtexEntries(
      `${zoteroExport}\n\n${zoteroExport}`,
      [],
      {
        rekey: true,
      },
    ).map((entry) => entry.key);
    expect(keys).toEqual(["doe2024spatial", "doe2024spatial2"]);
  });

  it("combines rekeying with tidying", () => {
    const [entry] = prepareBibtexEntries(
      '@Article{zot2024,\nAuthor = {Doe, Jane},\nTitle = "Spatial Models",\nYear = 2024\n}',
      [],
      { rekey: true, tidy: true },
    );
    expect(entry.source).toContain("@article{doe2024spatial,");
    expect(entry.source).toContain("title = {Spatial Models},");
  });
});

describe("findExistingCitationKey", () => {
  const index = collectProjectCitations([
    bibFile(
      "@article{smith2019cities,\n  title = {Cities and Their Discontents},\n  year = {2019}\n}",
    ),
  ]);

  it("matches an entry already present under the same key", () => {
    expect(findExistingCitationKey(index, { key: "smith2019cities" })).toBe(
      "smith2019cities",
    );
  });

  it("matches a work stored under a different key, by title", () => {
    expect(
      findExistingCitationKey(index, {
        key: "doe2019cities",
        title: "Cities and their discontents",
      }),
    ).toBe("smith2019cities");
  });

  it("ignores punctuation and case when comparing titles", () => {
    expect(
      findExistingCitationKey(index, {
        title: "CITIES AND THEIR DISCONTENTS!",
      }),
    ).toBe("smith2019cities");
  });

  it("returns null for a reference the project does not have", () => {
    expect(
      findExistingCitationKey(index, {
        key: "doe2024spatial",
        title: "Spatial Models",
      }),
    ).toBeNull();
  });

  it("ignores .tex files when indexing citations", () => {
    const texOnly = collectProjectCitations([
      {
        ...bibFile("@article{smith2019cities}"),
        type: "tex",
        name: "main.tex",
      } as ProjectFile,
    ]);
    expect(texOnly.keys.size).toBe(0);
  });
});
