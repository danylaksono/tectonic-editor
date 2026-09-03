import { afterEach, describe, expect, it, vi } from "vitest";
import { searchZoteroItems, type ZoteroConnection } from "@/lib/zotero-api";

const connection: ZoteroConnection = {
  mode: "cloud",
  apiKey: "test-key",
  userID: "42",
};

function mockZoteroResponse(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof mockZoteroResponse>): URL {
  const [input] = fetchMock.mock.calls[0] ?? [];
  return new URL(String(input));
}

const journalArticle = {
  key: "ABCD1234",
  bibtex: "@article{doe2024spatial,\n  title = {Spatial models},\n}",
  data: {
    itemType: "journalArticle",
    title: "Spatial models",
    date: "2024-06-01",
    publicationTitle: "Journal of Geography",
    creators: [
      { firstName: "Jane", lastName: "Doe" },
      { firstName: "Ada", lastName: "Byron" },
      { firstName: "Alan", lastName: "Turing" },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchZoteroItems", () => {
  it("skips the request entirely for a blank query", async () => {
    const fetchMock = mockZoteroResponse([]);
    expect(await searchZoteroItems(connection, "   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches top-level items in titleCreatorYear mode", async () => {
    const fetchMock = mockZoteroResponse([]);
    await searchZoteroItems(connection, "  spatial models  ");
    const url = requestedUrl(fetchMock);
    expect(url.pathname).toBe("/users/42/items/top");
    expect(url.searchParams.get("q")).toBe("spatial models");
    expect(url.searchParams.get("qmode")).toBe("titleCreatorYear");
    expect(url.searchParams.get("include")).toBe("data,bibtex");
  });

  it("excludes notes and attachments, which have no BibTeX form", async () => {
    const fetchMock = mockZoteroResponse([]);
    await searchZoteroItems(connection, "spatial");
    expect(requestedUrl(fetchMock).searchParams.get("itemType")).toBe(
      "-attachment||note",
    );
  });

  it("honours a caller-supplied limit", async () => {
    const fetchMock = mockZoteroResponse([]);
    await searchZoteroItems(connection, "spatial", 5);
    expect(requestedUrl(fetchMock).searchParams.get("limit")).toBe("5");
  });

  it("maps an item to its title, year and publication", async () => {
    mockZoteroResponse([journalArticle]);
    const [result] = await searchZoteroItems(connection, "spatial");
    expect(result).toMatchObject({
      key: "ABCD1234",
      title: "Spatial models",
      year: "2024",
      itemType: "journalArticle",
      publication: "Journal of Geography",
    });
  });

  it("abbreviates three or more creators", async () => {
    mockZoteroResponse([journalArticle]);
    const [result] = await searchZoteroItems(connection, "spatial");
    expect(result.creators).toBe("Doe et al.");
  });

  it("names both creators of a two-author work", async () => {
    mockZoteroResponse([
      {
        ...journalArticle,
        data: {
          ...journalArticle.data,
          creators: journalArticle.data.creators.slice(0, 2),
        },
      },
    ]);
    const [result] = await searchZoteroItems(connection, "spatial");
    expect(result.creators).toBe("Doe and Byron");
  });

  it("falls back to institutional single-field creator names", async () => {
    mockZoteroResponse([
      {
        ...journalArticle,
        data: {
          ...journalArticle.data,
          creators: [{ name: "World Health Organization" }],
        },
      },
    ]);
    const [result] = await searchZoteroItems(connection, "who");
    expect(result.creators).toBe("World Health Organization");
  });

  it("drops items Zotero could not export to BibTeX", async () => {
    mockZoteroResponse([
      journalArticle,
      { key: "NOBIB123", bibtex: "  ", data: { title: "Unexportable" } },
    ]);
    const results = await searchZoteroItems(connection, "spatial");
    expect(results.map((result) => result.key)).toEqual(["ABCD1234"]);
  });

  it("falls back to the book title and item key when fields are missing", async () => {
    mockZoteroResponse([
      {
        key: "BOOK9999",
        bibtex: "@incollection{,\n  title = {A chapter},\n}",
        data: { itemType: "bookSection", bookTitle: "An Edited Volume" },
      },
    ]);
    const [result] = await searchZoteroItems(connection, "chapter");
    expect(result).toMatchObject({
      title: "BOOK9999",
      publication: "An Edited Volume",
      year: "",
    });
  });

  it("reports a server failure with an actionable message", async () => {
    mockZoteroResponse({ error: "boom" }, 500);
    await expect(searchZoteroItems(connection, "spatial")).rejects.toThrow(
      /Zotero's server returned an error \(HTTP 500\)/,
    );
  });

  it("reports an invalid key rather than a bare status", async () => {
    mockZoteroResponse({}, 403);
    await expect(searchZoteroItems(connection, "spatial")).rejects.toThrow(
      "Invalid or expired Zotero API key",
    );
  });
});
