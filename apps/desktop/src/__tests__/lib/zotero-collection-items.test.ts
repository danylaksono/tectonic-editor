import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCollectionItems, type ZoteroConnection } from "@/lib/zotero-api";

const connection: ZoteroConnection = {
  mode: "cloud",
  apiKey: "test-key",
  userID: "42",
};

const item = {
  key: "ABCD1234",
  bibtex: "@article{doe2024spatial,\n  title = {Spatial models},\n}",
  data: {
    itemType: "journalArticle",
    title: "Spatial models",
    date: "2024-06-01",
    creators: [{ firstName: "Jane", lastName: "Doe" }],
  },
};

function mockZoteroResponse(
  body: unknown,
  headers: Record<string, string> = {},
) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrl(fetchMock: ReturnType<typeof mockZoteroResponse>): URL {
  const [input] = fetchMock.mock.calls[0] ?? [];
  return new URL(String(input));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCollectionItems", () => {
  it("reads the top-level items of one collection", async () => {
    const fetchMock = mockZoteroResponse([item]);
    await fetchCollectionItems(connection, "COLL1234");
    expect(requestedUrl(fetchMock).pathname).toBe(
      "/users/42/collections/COLL1234/items/top",
    );
  });

  it("reads the whole library when no collection is given", async () => {
    const fetchMock = mockZoteroResponse([item]);
    await fetchCollectionItems(connection, null);
    expect(requestedUrl(fetchMock).pathname).toBe("/users/42/items/top");
  });

  it("lists newest first so recent additions are visible", async () => {
    const fetchMock = mockZoteroResponse([item]);
    await fetchCollectionItems(connection, "COLL1234");
    const url = requestedUrl(fetchMock);
    expect(url.searchParams.get("sort")).toBe("dateAdded");
    expect(url.searchParams.get("direction")).toBe("desc");
  });

  it("excludes notes and attachments", async () => {
    const fetchMock = mockZoteroResponse([item]);
    await fetchCollectionItems(connection, "COLL1234");
    expect(requestedUrl(fetchMock).searchParams.get("itemType")).toBe(
      "-attachment||note",
    );
  });

  it("requests the page the caller asked for", async () => {
    const fetchMock = mockZoteroResponse([item]);
    await fetchCollectionItems(connection, "COLL1234", 50, 25);
    const url = requestedUrl(fetchMock);
    expect(url.searchParams.get("start")).toBe("50");
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("reports the library-wide total, not the page size", async () => {
    mockZoteroResponse([item], { "Total-Results": "102" });
    const page = await fetchCollectionItems(connection, "COLL1234");
    expect(page.total).toBe(102);
    expect(page.items).toHaveLength(1);
  });

  it("falls back to the page length when the total header is absent", async () => {
    mockZoteroResponse([item, { ...item, key: "SECOND99" }]);
    expect((await fetchCollectionItems(connection, null)).total).toBe(2);
  });

  it("maps items the same way search does", async () => {
    mockZoteroResponse([item]);
    const [mapped] = (await fetchCollectionItems(connection, null)).items;
    expect(mapped).toMatchObject({
      key: "ABCD1234",
      title: "Spatial models",
      creators: "Doe",
      year: "2024",
    });
  });
});
