/**
 * Back/forward history for the PDF pane, in the shape browsers use: a stack of
 * visited positions with a cursor into it. A jump records where it left from,
 * so following a citation to the bibliography can be undone in one click.
 *
 * Positions are container scroll offsets, which restores the exact reading
 * position rather than the top of a page.
 */
export interface ViewHistory {
  entries: number[];
  /** Index of the current position, or -1 when nothing has been recorded. */
  index: number;
}

export const EMPTY_HISTORY: ViewHistory = { entries: [], index: -1 };

/** Bounded so a long session cannot grow the stack without limit. */
const MAX_ENTRIES = 50;

/** Jumps shorter than this are not navigation — they are the rounding between
 * a link target and where the page actually settles. */
const MIN_JUMP_PX = 8;

export function canGoBack(history: ViewHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: ViewHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1;
}

/**
 * Record a jump from `from` to `to`. Anything that was ahead of the current
 * position is discarded, exactly as a browser drops the forward stack when you
 * navigate somewhere new.
 */
export function recordJump(
  history: ViewHistory,
  from: number,
  to: number,
): ViewHistory {
  if (Math.abs(to - from) < MIN_JUMP_PX) return history;

  const entries =
    history.index >= 0 ? history.entries.slice(0, history.index + 1) : [];
  // The departure point is the freshest truth about the current entry: the
  // reader may have scrolled since arriving there.
  if (entries.length === 0) entries.push(from);
  else entries[entries.length - 1] = from;
  entries.push(to);

  const overflow = Math.max(0, entries.length - MAX_ENTRIES);
  const trimmed = overflow > 0 ? entries.slice(overflow) : entries;
  return { entries: trimmed, index: trimmed.length - 1 };
}

/** Keep the current entry in step with ordinary scrolling, so going back later
 * returns to where the reader actually was. */
export function updateCurrent(
  history: ViewHistory,
  position: number,
): ViewHistory {
  if (history.index < 0) return history;
  if (history.entries[history.index] === position) return history;
  const entries = history.entries.slice();
  entries[history.index] = position;
  return { entries, index: history.index };
}

export function goBack(
  history: ViewHistory,
): { history: ViewHistory; target: number } | null {
  if (!canGoBack(history)) return null;
  const index = history.index - 1;
  return {
    history: { entries: history.entries, index },
    target: history.entries[index],
  };
}

export function goForward(
  history: ViewHistory,
): { history: ViewHistory; target: number } | null {
  if (!canGoForward(history)) return null;
  const index = history.index + 1;
  return {
    history: { entries: history.entries, index },
    target: history.entries[index],
  };
}
