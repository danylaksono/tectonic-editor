import { describe, expect, it } from "vitest";
import {
  canGoBack,
  canGoForward,
  EMPTY_HISTORY,
  goBack,
  goForward,
  recordJump,
  updateCurrent,
} from "@/lib/pdf-view-history";

describe("pdf view history", () => {
  it("has nowhere to go before anything is recorded", () => {
    expect(canGoBack(EMPTY_HISTORY)).toBe(false);
    expect(canGoForward(EMPTY_HISTORY)).toBe(false);
    expect(goBack(EMPTY_HISTORY)).toBeNull();
    expect(goForward(EMPTY_HISTORY)).toBeNull();
  });

  it("returns to where a jump started", () => {
    // Reading at 500, clicking a citation that lands in the bibliography.
    const history = recordJump(EMPTY_HISTORY, 500, 9000);
    expect(canGoBack(history)).toBe(true);
    expect(canGoForward(history)).toBe(false);

    const back = goBack(history)!;
    expect(back.target).toBe(500);
    expect(canGoForward(back.history)).toBe(true);

    const forward = goForward(back.history)!;
    expect(forward.target).toBe(9000);
    expect(canGoForward(forward.history)).toBe(false);
  });

  it("ignores jumps too small to be navigation", () => {
    expect(recordJump(EMPTY_HISTORY, 500, 503)).toBe(EMPTY_HISTORY);
  });

  it("records where the reader actually was, not where they arrived", () => {
    // Jump to the bibliography, scroll around it, then follow another link.
    let history = recordJump(EMPTY_HISTORY, 500, 9000);
    history = updateCurrent(history, 9400);
    history = recordJump(history, 9400, 200);

    expect(goBack(history)!.target).toBe(9400);
  });

  it("drops the forward stack when a new jump is made", () => {
    let history = recordJump(EMPTY_HISTORY, 0, 1000);
    history = recordJump(history, 1000, 2000);
    history = goBack(history)!.history;
    expect(canGoForward(history)).toBe(true);

    history = recordJump(history, 1000, 5000);
    expect(canGoForward(history)).toBe(false);
    expect(goBack(history)!.target).toBe(1000);
  });

  it("keeps the stack bounded, dropping the oldest positions", () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < 80; i++) {
      history = recordJump(history, i * 100, (i + 1) * 100);
    }
    expect(history.entries.length).toBe(50);
    expect(history.index).toBe(49);
    expect(history.entries[history.entries.length - 1]).toBe(8000);
  });

  it("leaves the current entry alone when scrolling has not moved it", () => {
    const history = recordJump(EMPTY_HISTORY, 0, 1000);
    expect(updateCurrent(history, 1000)).toBe(history);
    expect(updateCurrent(EMPTY_HISTORY, 400)).toBe(EMPTY_HISTORY);
  });
});
