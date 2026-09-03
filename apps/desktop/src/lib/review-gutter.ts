import { RangeSet, StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { ReviewComment } from "@/stores/review-store";

/**
 * Review annotations in the editor gutter.
 *
 * Annotations are made on the PDF, but they are fixed in the source, and until
 * now the only way to see one from the editor was to go looking for it in the
 * preview. A dot on the line an annotation points at closes that loop: it is
 * visible while you are editing the paragraph the note is about, and clicking
 * it reveals the annotation in the PDF.
 *
 * Line numbers come from SyncTeX, so they describe the source as it was at the
 * last compile. Markers are mapped through edits so they follow the text you
 * are typing around, and re-sync to the truth on the next build.
 */

export interface ReviewGutterEntry {
  /** 1-based source line, as recorded by SyncTeX at compile time. */
  line: number;
  /** Annotations on that line, open ones first. */
  ids: string[];
  openCount: number;
}

/** Path comparison that survives Windows separators and "./" prefixes, which
 *  SyncTeX and the file tree disagree about. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Group a file's annotations by the source line they point at.
 *
 * Resolved annotations still get a marker — a resolved note is a record of a
 * decision about that line, and hiding it would make the gutter lie about what
 * has been discussed there — but they never contribute to the open count that
 * gives the dot its colour.
 */
export function reviewGutterEntries(
  comments: readonly ReviewComment[],
  filePath: string,
): ReviewGutterEntry[] {
  const target = normalizePath(filePath);
  const byLine = new Map<number, ReviewComment[]>();

  for (const comment of comments) {
    const source = comment.anchor.source;
    if (!source || normalizePath(source.file) !== target) continue;
    if (!Number.isFinite(source.line) || source.line < 1) continue;
    const line = Math.floor(source.line);
    const existing = byLine.get(line);
    if (existing) existing.push(comment);
    else byLine.set(line, [comment]);
  }

  return [...byLine.entries()]
    .map(([line, group]) => {
      const ordered = [...group].sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      });
      return {
        line,
        ids: ordered.map((comment) => comment.id),
        openCount: ordered.filter((comment) => comment.status === "open")
          .length,
      };
    })
    .sort((a, b) => a.line - b.line);
}

export const setReviewGutterEntries = StateEffect.define<ReviewGutterEntry[]>();

class ReviewGutterMarker extends GutterMarker {
  constructor(readonly entry: ReviewGutterEntry) {
    super();
  }

  eq(other: ReviewGutterMarker) {
    return (
      other.entry.openCount === this.entry.openCount &&
      other.entry.ids.length === this.entry.ids.length &&
      other.entry.ids.every((id, index) => id === this.entry.ids[index])
    );
  }

  toDOM() {
    const total = this.entry.ids.length;
    const open = this.entry.openCount;
    const marker = document.createElement("span");
    marker.className = open > 0 ? "cm-review-marker" : "cm-review-marker-done";
    // A count only earns its place when there is more than one note here.
    marker.textContent = total > 1 ? String(total) : "";
    const noun = total === 1 ? "annotation" : "annotations";
    marker.title =
      open > 0
        ? `${total} review ${noun}, ${open} open — click to show in the PDF`
        : `${total} resolved review ${noun} — click to show in the PDF`;
    return marker;
  }
}

function buildMarkers(
  state: EditorState,
  entries: readonly ReviewGutterEntry[],
): RangeSet<ReviewGutterMarker> {
  const lineCount = state.doc.lines;
  const ranges = entries
    // A line number from an older, longer version of the file would throw.
    .filter((entry) => entry.line <= lineCount)
    .map((entry) => ({
      from: state.doc.line(entry.line).from,
      value: new ReviewGutterMarker(entry),
    }))
    .sort((a, b) => a.from - b.from)
    .map(({ from, value }) => value.range(from));
  return RangeSet.of(ranges, true);
}

const reviewMarkerField = StateField.define<RangeSet<ReviewGutterMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setReviewGutterEntries)) {
        return buildMarkers(tr.state, effect.value);
      }
    }
    // Follow the text being typed around rather than sitting on a stale line
    // number until the next compile re-syncs the entries.
    return tr.docChanged ? markers.map(tr.changes) : markers;
  },
});

const reviewGutterTheme = EditorView.baseTheme({
  ".cm-review-gutter": {
    minWidth: "14px",
    cursor: "pointer",
  },
  ".cm-review-gutter .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-review-marker, .cm-review-marker-done": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "10px",
    height: "10px",
    borderRadius: "999px",
    fontSize: "8px",
    lineHeight: "10px",
    fontWeight: "600",
    padding: "0 2px",
  },
  ".cm-review-marker": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
  },
  // Resolved notes stay visible as a record, but recede.
  ".cm-review-marker-done": {
    backgroundColor:
      "color-mix(in srgb, var(--muted-foreground) 35%, transparent)",
    color: "var(--muted-foreground)",
  },
});

/**
 * Build the gutter. `onReveal` is handed the first annotation on the clicked
 * line — open ones sort first, so a click lands on the one still needing
 * attention rather than on a resolved note above it.
 */
export function reviewGutterExtension(
  onReveal: (id: string) => void,
): Extension {
  return [
    reviewMarkerField,
    gutter({
      class: "cm-review-gutter",
      markers: (view) => view.state.field(reviewMarkerField),
      domEventHandlers: {
        click(view, block) {
          let hit: ReviewGutterMarker | null = null;
          view.state
            .field(reviewMarkerField)
            .between(block.from, block.to, (_from, _to, marker) => {
              hit = marker;
              return false;
            });
          if (!hit) return false;
          const [first] = (hit as ReviewGutterMarker).entry.ids;
          if (first) onReveal(first);
          return true;
        },
      },
    }),
    reviewGutterTheme,
  ];
}
