import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZoteroSearchForm } from "@/components/workspace/zotero-search-form";
import type { ZoteroSearchResult } from "@/lib/zotero-api";
import { useZoteroStore } from "@/stores/zotero-store";
import type { ProjectFile } from "@/stores/document-store";

const bibFile = {
  id: "references.bib",
  name: "references.bib",
  relativePath: "references.bib",
  absolutePath: "/project/references.bib",
  type: "bib",
  content: "@article{existing2020,\n  title = {Already Here}\n}",
} as ProjectFile;

const result: ZoteroSearchResult = {
  key: "ABCD1234",
  title: "Spatial models",
  creators: "Doe et al.",
  year: "2024",
  itemType: "journalArticle",
  publication: "Journal of Geography",
  bibtex: [
    "@article{doeSpatialModels2024,",
    "  author = {Doe, Jane},",
    "  title = {Spatial models},",
    "  year = {2024}",
    "}",
  ].join("\n"),
};

function connect(searchLibrary: () => Promise<ZoteroSearchResult[]>) {
  useZoteroStore.setState({
    isAuthenticated: true,
    connectionMode: "cloud",
    username: "jane",
    desktopItemsAvailable: null,
    searchLibrary,
  });
}

afterEach(() => {
  cleanup();
  useZoteroStore.setState({
    isAuthenticated: false,
    connectionMode: null,
    username: null,
  });
  vi.restoreAllMocks();
});

describe("ZoteroSearchForm", () => {
  it("asks the user to connect a library first", () => {
    useZoteroStore.setState({ isAuthenticated: false, connectionMode: null });
    render(
      <ZoteroSearchForm
        files={[bibFile]}
        onBack={vi.fn()}
        onImported={vi.fn()}
      />,
    );
    expect(screen.getByText("No Zotero library connected")).toBeTruthy();
  });

  it("searches the library and lists what it finds", async () => {
    const searchLibrary = vi.fn(async () => [result]);
    connect(searchLibrary);
    const user = userEvent.setup();
    render(
      <ZoteroSearchForm
        files={[bibFile]}
        onBack={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search Zotero library"), "spatial");
    await waitFor(() => expect(searchLibrary).toHaveBeenCalledWith("spatial"));
    expect(await screen.findByText("Spatial models")).toBeTruthy();
    expect(
      screen.getByText("Doe et al. · 2024 · Journal of Geography"),
    ).toBeTruthy();
  });

  it("surfaces the reason a search failed", async () => {
    connect(vi.fn(async () => Promise.reject(new Error("Zotero is asleep"))));
    const user = userEvent.setup();
    render(
      <ZoteroSearchForm
        files={[bibFile]}
        onBack={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search Zotero library"), "spatial");
    expect(await screen.findByText("Zotero is asleep")).toBeTruthy();
  });

  it("names each result by the key it will carry in the project", async () => {
    connect(vi.fn(async () => [result]));
    const user = userEvent.setup();
    render(
      <ZoteroSearchForm
        files={[bibFile]}
        onBack={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search Zotero library"), "spatial");
    expect(await screen.findByText("doe2024spatial")).toBeTruthy();
  });

  it("marks a result the project already cites", async () => {
    connect(
      vi.fn(async () => [
        {
          ...result,
          title: "Already Here",
          bibtex: result.bibtex.replace("Spatial models", "Already Here"),
        },
      ]),
    );
    const user = userEvent.setup();
    render(
      <ZoteroSearchForm
        files={[bibFile]}
        onBack={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search Zotero library"), "spatial");
    expect(await screen.findByText("In bibliography")).toBeTruthy();
  });

  it("counts what selecting a result would add", async () => {
    connect(vi.fn(async () => [result]));
    const user = userEvent.setup();
    render(
      <ZoteroSearchForm
        files={[bibFile]}
        onBack={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("Search Zotero library"), "spatial");
    await user.click(await screen.findByText("Spatial models"));
    expect(screen.getByText("1 selected · 1 to add")).toBeTruthy();
  });

  it("returns to the reference list without searching", async () => {
    const onBack = vi.fn();
    connect(vi.fn(async () => []));
    const user = userEvent.setup();
    render(
      <ZoteroSearchForm
        files={[bibFile]}
        onBack={onBack}
        onImported={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "References" }));
    expect(onBack).toHaveBeenCalled();
  });
});
