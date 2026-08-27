import { describe, expect, it } from "vitest";
import { prepareBibtexEntries } from "@/lib/bibliography-import";

const smith = "@article{smith2024,\n  title = {A Paper},\n  year = {2024}\n}";
const jones = "@book{jones2020,\n  title = {A Book},\n  year = {2020}\n}";

describe("prepareBibtexEntries", () => {
  it("keeps a key that does not collide", () => {
    const [entry] = prepareBibtexEntries(smith, []);
    expect(entry).toMatchObject({ originalKey: "smith2024", key: "smith2024" });
    expect(entry.source).toBe(smith);
  });

  it("suffixes a key that collides with the project", () => {
    const [entry] = prepareBibtexEntries(smith, ["smith2024"]);
    expect(entry.key).toBe("smith20242");
    expect(entry.source).toContain("@article{smith20242,");
  });

  it("keeps counting past an existing suffixed key", () => {
    const [entry] = prepareBibtexEntries(smith, ["smith2024", "smith20242"]);
    expect(entry.key).toBe("smith20243");
  });

  it("does not let two entries in one batch claim the same key", () => {
    const keys = prepareBibtexEntries(`${smith}\n\n${smith}`, []).map(
      (entry) => entry.key,
    );
    expect(keys).toEqual(["smith2024", "smith20242"]);
  });

  it("renames only the colliding entry in a mixed batch", () => {
    const prepared = prepareBibtexEntries(`${smith}\n\n${jones}`, [
      "smith2024",
    ]);
    expect(prepared.map((entry) => entry.key)).toEqual([
      "smith20242",
      "jones2020",
    ]);
  });

  it("preserves the original key for reporting a rename", () => {
    const [entry] = prepareBibtexEntries(smith, ["smith2024"]);
    expect(entry.originalKey).toBe("smith2024");
    expect(entry.title).toBe("A Paper");
  });

  it("returns nothing for source without a complete entry", () => {
    expect(prepareBibtexEntries("", [])).toEqual([]);
    expect(prepareBibtexEntries("not bibtex at all", [])).toEqual([]);
  });
});

describe("prepareBibtexEntries with tidy", () => {
  const zoteroStyle = [
    "@Article{doe2024,",
    'Title = "Spatial models",',
    "Year = 2024,",
    "Journal={Journal of Geography},",
    "abstract={}",
    "}",
  ].join("\n");

  it("leaves hand-written source untouched by default", () => {
    expect(prepareBibtexEntries(zoteroStyle, [])[0].source).toBe(zoteroStyle);
  });

  it("normalises an exporter's entry type and field names", () => {
    const [entry] = prepareBibtexEntries(zoteroStyle, [], { tidy: true });
    expect(entry.source).toContain("@article{doe2024,");
    expect(entry.source).toContain("title = {Spatial models},");
  });

  it("rewrites quoted values as braced ones", () => {
    const [entry] = prepareBibtexEntries(zoteroStyle, [], { tidy: true });
    expect(entry.source).not.toContain('"Spatial models"');
  });

  it("drops empty fields the exporter emitted", () => {
    const [entry] = prepareBibtexEntries(zoteroStyle, [], { tidy: true });
    expect(entry.source).not.toContain("abstract");
  });

  it("tidies the renamed entry, not the original key", () => {
    const [entry] = prepareBibtexEntries(zoteroStyle, ["doe2024"], {
      tidy: true,
    });
    expect(entry.key).toBe("doe20242");
    expect(entry.source).toContain("@article{doe20242,");
    expect(entry.source).not.toContain("@article{doe2024,");
  });

  it("keeps unparseable source rather than dropping it", () => {
    const broken = "@article{onlykey}";
    expect(prepareBibtexEntries(broken, [], { tidy: true })).toEqual(
      prepareBibtexEntries(broken, []),
    );
  });
});
