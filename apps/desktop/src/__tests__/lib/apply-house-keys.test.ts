import { describe, expect, it } from "vitest";
import { applyHouseKeys } from "@/lib/bibliography-import";

function zoteroEntry(
  itemKey: string,
  {
    key = "doeSpatialModels2024",
    author = "Doe, Jane",
    title = "Spatial Models",
    year = "2024",
  } = {},
) {
  return {
    itemKey,
    bibtex: [
      `@Article{${key},`,
      `Author = {${author}},`,
      `Title = "${title}",`,
      `Year = ${year}`,
      "}",
    ].join("\n"),
  };
}

describe("applyHouseKeys", () => {
  it("keys a fresh import in house style", () => {
    const [entry] = applyHouseKeys([zoteroEntry("ITEM0001")]);
    expect(entry.citekey).toBe("doe2024spatial");
    expect(entry.source).toContain("@article{doe2024spatial,");
  });

  it("reports the key against the library item that produced it", () => {
    const [entry] = applyHouseKeys([zoteroEntry("ITEM0001")]);
    expect(entry.itemKey).toBe("ITEM0001");
  });

  it("tidies the entry on the way through", () => {
    const [entry] = applyHouseKeys([zoteroEntry("ITEM0001")]);
    expect(entry.source).toContain("title = {Spatial Models},");
    expect(entry.source).not.toContain('"Spatial Models"');
  });

  it("keeps the key an earlier sync already gave an item", () => {
    const [entry] = applyHouseKeys([zoteroEntry("ITEM0001")], {
      ITEM0001: "doe2024spatial",
    });
    expect(entry.citekey).toBe("doe2024spatial");
  });

  it("never rewrites a key the document may already cite", () => {
    // The item was first imported under Zotero's own key; keep it.
    const [entry] = applyHouseKeys([zoteroEntry("ITEM0001")], {
      ITEM0001: "doeSpatialModels2024",
    });
    expect(entry.citekey).toBe("doeSpatialModels2024");
    expect(entry.source).toContain("@article{doeSpatialModels2024,");
  });

  it("keys only the items an earlier sync did not cover", () => {
    const keyed = applyHouseKeys(
      [
        zoteroEntry("ITEM0001"),
        zoteroEntry("ITEM0002", { title: "Urban Growth" }),
      ],
      { ITEM0001: "legacyKey1999" },
    );
    expect(keyed.map((entry) => entry.citekey)).toEqual([
      "legacyKey1999",
      "doe2024urban",
    ]);
  });

  it("separates two works that want the same key", () => {
    const keyed = applyHouseKeys([
      zoteroEntry("ITEM0001", { title: "Spatial Models I" }),
      zoteroEntry("ITEM0002", { key: "other2024", title: "Spatial Models II" }),
    ]);
    expect(keyed.map((entry) => entry.citekey)).toEqual([
      "doe2024spatial",
      "doe2024spatial2",
    ]);
  });

  it("does not hand a new item a key a kept one is using", () => {
    const keyed = applyHouseKeys(
      [zoteroEntry("ITEM0001"), zoteroEntry("ITEM0002", { key: "other2024" })],
      { ITEM0001: "doe2024spatial" },
    );
    expect(keyed[1].citekey).toBe("doe2024spatial2");
  });

  it("skips an entry that is not parseable BibTeX", () => {
    expect(applyHouseKeys([{ itemKey: "ITEM0001", bibtex: "   " }])).toEqual(
      [],
    );
  });

  it("returns nothing for an empty batch", () => {
    expect(applyHouseKeys([])).toEqual([]);
  });
});
