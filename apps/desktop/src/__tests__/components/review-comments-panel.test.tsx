import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewCommentsPanel } from "@/components/workspace/preview/review-comments-panel";
import type { ReviewComment } from "@/stores/review-store";

// This project runs vitest without `globals`, so RTL's automatic cleanup
// never registers - without this, each render stacks another panel in the DOM
// and every query finds several.
afterEach(cleanup);

/** No per-keystroke delay: these tests are about ordering and filtering, not
 *  typing cadence, and the default delay makes the file slow enough to crowd
 *  neighbouring suites when vitest runs files in parallel. */
const user = () => userEvent.setup({ delay: null });

function makeComment(
  id: string,
  overrides: Partial<ReviewComment> = {},
): ReviewComment {
  return {
    id,
    kind: "comment",
    documentRoot: "main.tex",
    author: "Dany",
    body: `note ${id}`,
    status: "open",
    anchor: {
      kind: "text",
      page: 1,
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    },
    replies: [],
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(
  comments: ReviewComment[],
  overrides: Partial<Parameters<typeof ReviewCommentsPanel>[0]> = {},
) {
  const onSelect = vi.fn();
  const props = {
    comments,
    loading: false,
    selectedId: null,
    anchorChecks: new Map(),
    onSelect,
    onGoToSource: vi.fn(),
    onSetStatus: vi.fn(),
    onSetTags: vi.fn(),
    onExport: vi.fn(),
    onReply: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const view = render(<ReviewCommentsPanel {...props} />);
  return { onSelect, props, view };
}

describe("ReviewCommentsPanel keyboard navigation", () => {
  it("starts at the top of the list when nothing is selected", async () => {
    const comments = [
      makeComment("a", { anchor: { ...makeComment("a").anchor, page: 1 } }),
      makeComment("b", { anchor: { ...makeComment("b").anchor, page: 2 } }),
    ];
    const { onSelect } = renderPanel(comments);

    await user().keyboard("j");

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("starts at the end when stepping backwards from nothing", async () => {
    const comments = [
      makeComment("a", { anchor: { ...makeComment("a").anchor, page: 1 } }),
      makeComment("b", { anchor: { ...makeComment("b").anchor, page: 2 } }),
    ];
    const { onSelect } = renderPanel(comments);

    await user().keyboard("k");

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
  });

  it("moves down with j and up with k from the current selection", async () => {
    const comments = [
      makeComment("a", { anchor: { ...makeComment("a").anchor, page: 1 } }),
      makeComment("b", { anchor: { ...makeComment("b").anchor, page: 2 } }),
      makeComment("c", { anchor: { ...makeComment("c").anchor, page: 3 } }),
    ];
    const { onSelect } = renderPanel(comments, { selectedId: "b" });

    await user().keyboard("j");
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "c" }),
    );

    await user().keyboard("k");
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "a" }),
    );
  });

  it("wraps around the ends rather than stopping", async () => {
    const comments = [
      makeComment("a", { anchor: { ...makeComment("a").anchor, page: 1 } }),
      makeComment("b", { anchor: { ...makeComment("b").anchor, page: 2 } }),
    ];
    const { onSelect } = renderPanel(comments, { selectedId: "b" });

    await user().keyboard("j");

    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "a" }),
    );
  });

  it("skips resolved annotations with n", async () => {
    const comments = [
      makeComment("open-1", {
        anchor: { ...makeComment("x").anchor, page: 1 },
      }),
      makeComment("done", {
        status: "resolved",
        anchor: { ...makeComment("x").anchor, page: 2 },
      }),
      makeComment("open-2", {
        anchor: { ...makeComment("x").anchor, page: 3 },
      }),
    ];
    // Resolved shown, so plain j would land on it; n must not.
    const { onSelect } = renderPanel(comments, { selectedId: "open-1" });
    await user().click(screen.getByRole("button", { name: "Show resolved" }));

    await user().keyboard("n");

    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "open-2" }),
    );
  });

  it("leaves typing in the search box alone", async () => {
    const { onSelect } = renderPanel([makeComment("a")]);

    const search = screen.getByRole("textbox", { name: "Search annotations" });
    await user().click(search);
    await user().keyboard("jk");

    expect(onSelect).not.toHaveBeenCalled();
    expect((search as HTMLInputElement).value).toBe("jk");
  });

  it("focuses the search box on /", async () => {
    renderPanel([makeComment("a")]);

    await user().keyboard("/");

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Search annotations" }),
    );
  });
});

describe("ReviewCommentsPanel search", () => {
  it("narrows the list to matching annotations", async () => {
    renderPanel([
      makeComment("a", { body: "check the sample size" }),
      makeComment("b", { body: "check the citation" }),
    ]);

    await user().type(
      screen.getByRole("textbox", { name: "Search annotations" }),
      "sample",
    );

    expect(screen.getByText("check the sample size")).toBeTruthy();
    expect(screen.queryByText("check the citation")).toBeNull();
  });

  it("says so when a search matches nothing", async () => {
    renderPanel([makeComment("a", { body: "check the sample size" })]);

    await user().type(
      screen.getByRole("textbox", { name: "Search annotations" }),
      "bibliography",
    );

    expect(screen.getByText("Nothing matches this search")).toBeTruthy();
  });

  it("exports only what the search left showing, and says so", async () => {
    const onExport = vi.fn();
    renderPanel(
      [
        makeComment("a", { body: "check the sample size" }),
        makeComment("b", { body: "check the citation" }),
      ],
      { onExport },
    );

    await user().type(
      screen.getByRole("textbox", { name: "Search annotations" }),
      "sample",
    );
    await user().click(
      screen.getByRole("button", { name: "Export review notes" }),
    );

    const [exported, note] = onExport.mock.calls[0];
    expect(exported.map((c: ReviewComment) => c.id)).toEqual(["a"]);
    expect(note).toContain('matching "sample"');
  });
});
