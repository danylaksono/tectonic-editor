import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCitationPopup } from "@/hooks/use-citation-popup";
import { useDocumentStore, type ProjectFile } from "@/stores/document-store";

const BIB = `@article{smith2024,
  title = {A Useful Paper},
  author = {Smith, Jane},
  year = {2024},
  doi = {10.1234/example}
}`;

function bibFile(): ProjectFile {
  return {
    id: "references.bib",
    name: "references.bib",
    relativePath: "references.bib",
    absolutePath: "C:\\project\\references.bib",
    type: "bib",
    content: BIB,
    isDirty: false,
  };
}

/** A stand-in for the PDF scroll container with one citation link inside it,
 * mirroring the anchors the link layer renders. */
function mountContainer(citeKey: string, href = "#page=12") {
  const container = document.createElement("div");
  const anchor = document.createElement("a");
  anchor.dataset.citeKey = citeKey;
  anchor.setAttribute("href", href);
  container.append(anchor);
  document.body.append(container);
  return { container, anchor };
}

beforeEach(() => {
  useDocumentStore.setState({ files: [bibFile()] });
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("useCitationPopup", () => {
  it("opens the reference for a clicked citation", () => {
    const { container, anchor } = mountContainer("smith2024");
    const { result } = renderHook(() =>
      useCitationPopup({ current: container }),
    );

    act(() => result.current.openForAnchor(anchor));

    expect(result.current.open?.preview.entry?.title).toBe("A Useful Paper");
    expect(result.current.open?.preview.link).toBe(
      "https://doi.org/10.1234/example",
    );
    // The citation's own destination travels with it, so the card can offer it.
    expect(result.current.open?.href).toBe("#page=12");
  });

  it("stays open until something dismisses it", () => {
    const { container, anchor } = mountContainer("smith2024");
    const { result } = renderHook(() =>
      useCitationPopup({ current: container }),
    );

    act(() => result.current.openForAnchor(anchor));

    // A click on the card must not dismiss it — this is what made the DOI link
    // unreachable when the card followed the pointer.
    const card = document.createElement("div");
    card.dataset.citationCard = "true";
    const doiButton = document.createElement("button");
    card.append(doiButton);
    document.body.append(card);

    act(() => {
      doiButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.open).not.toBeNull();
  });

  it("dismisses on a click elsewhere", () => {
    const { container, anchor } = mountContainer("smith2024");
    const { result } = renderHook(() =>
      useCitationPopup({ current: container }),
    );

    act(() => result.current.openForAnchor(anchor));
    expect(result.current.open).not.toBeNull();

    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    act(() => {
      elsewhere.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(result.current.open).toBeNull();
  });

  it("dismisses on Escape", () => {
    const { container, anchor } = mountContainer("smith2024");
    const { result } = renderHook(() =>
      useCitationPopup({ current: container }),
    );

    act(() => result.current.openForAnchor(anchor));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.open).toBeNull();
  });

  it("gives up when the citation is torn out of the page", async () => {
    const { container, anchor } = mountContainer("smith2024");
    const { result } = renderHook(() =>
      useCitationPopup({ current: container }),
    );

    act(() => result.current.openForAnchor(anchor));
    expect(result.current.open).not.toBeNull();

    // Pages drop their link layer once scrolled far out of view.
    anchor.remove();
    await act(async () => {
      container.dispatchEvent(new Event("scroll"));
      // Repositioning is deferred to an animation frame.
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(result.current.open).toBeNull();
  });

  it("reports a key with no bibliography entry", () => {
    const { container, anchor } = mountContainer("missing2030");
    const { result } = renderHook(() =>
      useCitationPopup({ current: container }),
    );

    act(() => result.current.openForAnchor(anchor));
    expect(result.current.open?.preview.key).toBe("missing2030");
    expect(result.current.open?.preview.entry).toBeNull();
  });
});
