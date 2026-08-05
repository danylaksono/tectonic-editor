import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CitationCard } from "@/components/workspace/preview/citation-card";
import { buildCitationPreview } from "@/lib/pdf-citation-preview";

const anchorRect = { top: 100, bottom: 112, left: 200, right: 214 };

const entry = {
  key: "smith2024",
  type: "article",
  title: "A Useful Paper",
  author: "Smith, Jane",
  year: "2024",
  journal: "Journal of Examples",
  doi: "10.1234/example",
  filePath: "references.bib",
  fileId: "references.bib",
  from: 0,
};

afterEach(() => {
  // The card renders through a portal, so it outlives the render container
  // without an explicit unmount (this suite runs without vitest globals).
  cleanup();
  vi.restoreAllMocks();
});

describe("CitationCard", () => {
  it("shows the reference metadata", () => {
    render(
      <CitationCard
        preview={buildCitationPreview("smith2024", entry)}
        anchorRect={anchorRect}
        onOpenLink={vi.fn()}
      />,
    );

    expect(screen.getByText("A Useful Paper")).toBeTruthy();
    expect(screen.getByText("Smith, Jane · 2024")).toBeTruthy();
    expect(screen.getByText("Journal of Examples")).toBeTruthy();
    expect(screen.getByText("smith2024")).toBeTruthy();
  });

  it("offers the DOI, the jump to the bibliography, and the entry's source", async () => {
    const onOpenLink = vi.fn();
    const onGoToReference = vi.fn();
    const onEditEntry = vi.fn();

    render(
      <CitationCard
        preview={buildCitationPreview("smith2024", entry)}
        anchorRect={anchorRect}
        onGoToReference={onGoToReference}
        onEditEntry={onEditEntry}
        onOpenLink={onOpenLink}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /DOI/ }));
    expect(onOpenLink).toHaveBeenCalledWith("https://doi.org/10.1234/example");

    await userEvent.click(
      screen.getByRole("button", { name: /Go to reference/ }),
    );
    expect(onGoToReference).toHaveBeenCalled();

    const edit = screen.getByRole("button", { name: /Edit entry/ });
    // The file it opens is named, since a project can have several .bib files.
    expect(edit.getAttribute("title")).toBe("Open references.bib");
    await userEvent.click(edit);
    expect(onEditEntry).toHaveBeenCalled();
  });

  it("omits the jump when the citation has no resolvable destination", () => {
    render(
      <CitationCard
        preview={buildCitationPreview("smith2024", entry)}
        anchorRect={anchorRect}
        onOpenLink={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Go to reference/ }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /DOI/ })).toBeTruthy();
  });

  it("names the key that the bibliography does not define", () => {
    render(
      <CitationCard
        preview={buildCitationPreview("missing2030", null)}
        anchorRect={anchorRect}
        onGoToReference={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );

    expect(screen.getByText("missing2030")).toBeTruthy();
    expect(
      screen.getByText("No entry with this key in the project bibliography."),
    ).toBeTruthy();
    // The jump still works when the key is unknown to the bibliography: the
    // PDF's own link is what resolves it, not the `.bib` file.
    expect(
      screen.getByRole("button", { name: /Go to reference/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /DOI/ })).toBeNull();
  });

  it("marks itself so an outside click can be told from a click on it", () => {
    render(
      <CitationCard
        preview={buildCitationPreview("smith2024", entry)}
        anchorRect={anchorRect}
        onOpenLink={vi.fn()}
      />,
    );

    const card = screen.getByRole("dialog");
    expect(card.dataset.citationCard).toBe("true");
    expect(card.closest("[data-citation-card]")).toBe(card);
  });
});
