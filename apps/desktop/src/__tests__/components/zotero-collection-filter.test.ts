import { describe, expect, it } from "vitest";
import {
  filterCollectionTree,
  flattenCollections,
} from "@/components/workspace/references-panel";
import type { ZoteroCollection } from "@/lib/zotero-api";

function collection(
  key: string,
  name: string,
  parentKey: string | false = false,
): ZoteroCollection {
  return { key, name, parentKey, itemCount: 0 };
}

const tree = flattenCollections([
  collection("A", "Methods"),
  collection("A1", "Spatial Statistics", "A"),
  collection("A2", "Interviews", "A"),
  collection("B", "Background"),
  collection("B1", "Urban Growth", "B"),
]);

describe("filterCollectionTree", () => {
  it("returns everything for an empty query", () => {
    expect(filterCollectionTree(tree, "  ")).toHaveLength(tree.length);
  });

  it("keeps a match and its ancestors", () => {
    const result = filterCollectionTree(tree, "spatial");
    expect(result.map((entry) => entry.collection.key)).toEqual(["A", "A1"]);
  });

  it("preserves the original depth of kept rows", () => {
    const result = filterCollectionTree(tree, "spatial");
    expect(result.map((entry) => entry.depth)).toEqual([0, 1]);
  });

  it("matches case-insensitively across branches", () => {
    const result = filterCollectionTree(tree, "UR");
    expect(result.map((entry) => entry.collection.key)).toEqual(["B", "B1"]);
  });

  it("keeps a matching parent without pulling in its children", () => {
    const result = filterCollectionTree(tree, "methods");
    expect(result.map((entry) => entry.collection.key)).toEqual(["A"]);
  });

  it("returns nothing when no collection matches", () => {
    expect(filterCollectionTree(tree, "zzz")).toEqual([]);
  });
});
