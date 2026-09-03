import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewMarkdown } from "@/components/workspace/preview/review-markdown";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(async () => {}),
}));

const { ask } = await import("@tauri-apps/plugin-dialog");
const { open: shellOpen } = await import("@tauri-apps/plugin-shell");

// This project runs vitest without `globals`, so RTL's automatic cleanup never
// registers.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const user = () => userEvent.setup({ delay: null });

describe("ReviewMarkdown", () => {
  it("renders emphasis rather than showing the syntax", () => {
    const { container } = render(
      <ReviewMarkdown content="This is **important** and *maybe*." />,
    );

    expect(container.querySelector("strong")?.textContent).toBe("important");
    expect(container.querySelector("em")?.textContent).toBe("maybe");
    expect(container.textContent).not.toContain("**");
  });

  it("renders lists", () => {
    const { container } = render(
      <ReviewMarkdown content={"- first\n- second"} />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders maths, which is the point of having markdown here at all", () => {
    const { container } = render(
      <ReviewMarkdown
        content={"Only unbiased if $\\hat{\\beta}$ converges."}
      />,
    );

    // KaTeX leaves its own markup behind; the raw dollar-delimited source
    // should not survive into the output.
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.textContent).not.toContain("$\\hat");
  });

  it("renders GFM tables", () => {
    const { container } = render(
      <ReviewMarkdown content={"| a | b |\n| --- | --- |\n| 1 | 2 |"} />,
    );

    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("flattens headings so a stray # cannot shout over the note", () => {
    const { container } = render(<ReviewMarkdown content="# Heading" />);

    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).toContain("Heading");
  });

  it("asks before opening a link, then opens it externally", async () => {
    render(<ReviewMarkdown content="[the paper](https://example.com/a.pdf)" />);

    await user().click(screen.getByRole("button", { name: "the paper" }));

    expect(ask).toHaveBeenCalledWith(
      expect.stringContaining("https://example.com/a.pdf"),
      expect.objectContaining({ title: "External Link" }),
    );
    await vi.waitFor(() =>
      expect(shellOpen).toHaveBeenCalledWith("https://example.com/a.pdf"),
    );
  });

  it("refuses to open a non-http scheme", async () => {
    render(<ReviewMarkdown content="[bad](javascript:alert(1))" />);

    await user().click(screen.getByRole("button", { name: "bad" }));

    expect(ask).not.toHaveBeenCalled();
    expect(shellOpen).not.toHaveBeenCalled();
  });

  it("never fetches an image, showing its alt text instead", () => {
    const { container } = render(
      <ReviewMarkdown content="![a figure](https://example.com/x.png)" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[image: a figure]");
  });

  it("renders a code block inert, with no run or insert affordance", () => {
    const { container } = render(
      <ReviewMarkdown content={"```bash\nrm -rf /tmp/x\n```"} />,
    );

    // A comment body can arrive from a peer through the review round-trip, so
    // it must never offer to execute anything.
    expect(container.querySelector("pre")?.textContent).toContain("rm -rf");
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /insert/i })).toBeNull();
  });

  it("does not render raw HTML embedded in a comment", () => {
    const { container } = render(
      <ReviewMarkdown content={'<img src="x" onerror="alert(1)">plain'} />,
    );

    // Escaped to text rather than parsed: no element is created, so there is
    // no attribute for a handler to live on.
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("&lt;img");
    expect(container.textContent).toContain('<img src="x" onerror="alert(1)">');
  });

  it("handles an empty body without throwing", () => {
    const { container } = render(<ReviewMarkdown content="" />);
    expect(container.textContent).toBe("");
  });
});
