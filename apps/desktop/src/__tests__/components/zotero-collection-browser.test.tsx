import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZoteroCollectionBrowser } from "@/components/workspace/zotero-collection-browser";
import type { ZoteroItemPage, ZoteroSearchResult } from "@/lib/zotero-api";
import { useZoteroStore } from "@/stores/zotero-store";
import { useDocumentStore, type ProjectFile } from "@/stores/document-store";

const bibFile = {
  id: "references.bib",
  name: "references.bib",
  relativePath: "references.bib",
  absolutePath: "/project/references.bib",
  type: "bib",
  content: "@article{existing2020,\n  title = {Already Here}\n}",
} as ProjectFile;

function item(key: string, title: string, citekey: string): ZoteroSearchResult {
  return {
    key,
    citekey,
    title,
    creators: "Doe",
    year: "2024",
    itemType: "journalArticle",
    publication: "Journal of Geography",
    bibtex: `@article{${citekey},\n  title = {${title}}\n}`,
  };
}

const spatial = item("ITEM0001", "Spatial models", "doe2024spatial");
const urban = item("ITEM0002", "Urban growth", "doe2024urban");

function setUp(
  page: Partial<ZoteroItemPage> & { items: ZoteroSearchResult[] },
) {
  const browseCollection = vi.fn(async () => ({
    items: page.items,
    total: page.total ?? page.items.length,
  }));
  useZoteroStore.setState({ browseCollection });
  useDocumentStore.setState({ files: [bibFile] });
  return browseCollection;
}

function renderBrowser(onBack = vi.fn()) {
  return render(
    <ZoteroCollectionBrowser
      collectionKey="COLL1234"
      name="Methods"
      onBack={onBack}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ZoteroCollectionBrowser", () => {
  it("lists the items a collection holds", async () => {
    setUp({ items: [spatial, urban] });
    renderBrowser();

    expect(await screen.findByText("Spatial models")).toBeTruthy();
    expect(screen.getByText("Urban growth")).toBeTruthy();
  });

  it("says how many items there are and how they are ordered", async () => {
    setUp({ items: [spatial, urban], total: 102 });
    renderBrowser();

    expect(
      await screen.findByText("2 of 102 items · newest first"),
    ).toBeTruthy();
  });

  it("filters the loaded items", async () => {
    setUp({ items: [spatial, urban] });
    const user = userEvent.setup();
    renderBrowser();
    await screen.findByText("Spatial models");

    await user.type(screen.getByLabelText("Filter items in Methods"), "urban");
    expect(screen.queryByText("Spatial models")).toBeNull();
    expect(screen.getByText("Urban growth")).toBeTruthy();
  });

  it("counts the references a selection would add", async () => {
    setUp({ items: [spatial, urban] });
    const user = userEvent.setup();
    renderBrowser();

    await user.click(await screen.findByText("Spatial models"));
    expect(screen.getByText("Add 1 to bibliography")).toBeTruthy();
  });

  it("selects every shown item at once", async () => {
    setUp({ items: [spatial, urban] });
    const user = userEvent.setup();
    renderBrowser();
    await screen.findByText("Spatial models");

    await user.click(screen.getByText("Select all shown"));
    expect(screen.getByText("Add 2 to bibliography")).toBeTruthy();
  });

  it("will not add a reference the project already cites", async () => {
    setUp({ items: [item("ITEM0003", "Already Here", "existing2020")] });
    const user = userEvent.setup();
    renderBrowser();

    const row = await screen.findByTitle("Already in your bibliography");
    expect(row.hasAttribute("disabled")).toBe(true);
    await user.click(row);
    expect(screen.getByText("Add selected")).toBeTruthy();
  });

  it("offers to load the rest of a long collection", async () => {
    setUp({ items: [spatial, urban], total: 60 });
    renderBrowser();

    expect(await screen.findByText("Load 50 more")).toBeTruthy();
  });

  it("stops offering more once everything is loaded", async () => {
    setUp({ items: [spatial, urban] });
    renderBrowser();
    await screen.findByText("Spatial models");

    expect(screen.queryByText(/Load \d+ more/)).toBeNull();
  });

  it("surfaces why the items could not be read", async () => {
    useZoteroStore.setState({
      browseCollection: vi.fn(async () =>
        Promise.reject(new Error("Zotero Desktop could not read item data")),
      ),
    });
    useDocumentStore.setState({ files: [bibFile] });
    renderBrowser();

    expect(
      await screen.findByText("Zotero Desktop could not read item data"),
    ).toBeTruthy();
  });

  it("returns to the collection list", async () => {
    const onBack = vi.fn();
    setUp({ items: [spatial] });
    const user = userEvent.setup();
    renderBrowser(onBack);

    await user.click(screen.getByLabelText("Back to collections"));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });
});
