import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CornerDownRightIcon,
  ExternalLinkIcon,
  PencilIcon,
} from "lucide-react";
import {
  citationVenue,
  type CitationPreview,
} from "@/lib/pdf-citation-preview";

/** Gap between the citation and the card, and the minimum margin the card
 * keeps from the window edges. */
const OFFSET = 6;
const MARGIN = 8;
const CARD_WIDTH = 340;

export interface CitationAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface CitationCardProps {
  preview: CitationPreview;
  /** Viewport-relative box of the clicked citation link. */
  anchorRect: CitationAnchorRect;
  /** Jump to the bibliography entry in the PDF; absent when the citation's
   * destination could not be resolved to a page. */
  onGoToReference?: () => void;
  /** Open the entry's source in the editor; absent when the key is not in the
   * project's bibliography. */
  onEditEntry?: () => void;
  onOpenLink: (url: string) => void;
}

export function CitationCard({
  preview,
  anchorRect,
  onGoToReference,
  onEditEntry,
  onOpenLink,
}: CitationCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Measure once mounted, and again whenever the citation moves under it: the
  // card flips above the citation when it would otherwise run off the bottom of
  // the window, and is clamped to the window horizontally.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const { width, height } = card.getBoundingClientRect();
    const below = anchorRect.bottom + OFFSET;
    const fitsBelow = below + height + MARGIN <= window.innerHeight;
    const top = fitsBelow
      ? below
      : Math.max(MARGIN, anchorRect.top - OFFSET - height);
    const centered = anchorRect.left + (anchorRect.right - anchorRect.left) / 2;
    const left = Math.min(
      Math.max(MARGIN, centered - width / 2),
      Math.max(MARGIN, window.innerWidth - width - MARGIN),
    );
    setPlacement({ top, left });
  }, [anchorRect]);

  const { entry } = preview;
  const venue = entry ? citationVenue(entry) : undefined;

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`Reference ${preview.key}`}
      data-citation-card="true"
      className="fade-in-0 zoom-in-95 fixed z-50 animate-in rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
      style={{
        width: CARD_WIDTH,
        maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
        top: placement?.top ?? -9999,
        left: placement?.left ?? -9999,
        // Avoid a flash at the measuring position on the first paint.
        visibility: placement ? "visible" : "hidden",
      }}
    >
      {entry ? (
        <div className="flex flex-col gap-1.5">
          {entry.title && (
            <p className="line-clamp-6 font-medium text-sm leading-snug">
              {entry.title}
            </p>
          )}
          {(entry.author || entry.year) && (
            <p className="text-muted-foreground text-xs">
              {[entry.author, entry.year].filter(Boolean).join(" · ")}
            </p>
          )}
          {venue && (
            <p className="text-muted-foreground text-xs italic">{venue}</p>
          )}
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {preview.key}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="font-mono text-sm">{preview.key}</p>
          <p className="text-muted-foreground text-xs">
            No entry with this key in the project bibliography.
          </p>
        </div>
      )}

      {(onGoToReference || onEditEntry || preview.link) && (
        <div className="mt-2.5 flex items-center gap-3 border-t pt-2">
          {onGoToReference && (
            <button
              type="button"
              onClick={onGoToReference}
              className="flex items-center gap-1 rounded text-muted-foreground text-xs hover:text-foreground"
            >
              <CornerDownRightIcon className="size-3" />
              Go to reference
            </button>
          )}
          {onEditEntry && (
            <button
              type="button"
              onClick={onEditEntry}
              title={`Open ${entry?.filePath ?? "the bibliography"}`}
              className="flex items-center gap-1 rounded text-muted-foreground text-xs hover:text-foreground"
            >
              <PencilIcon className="size-3" />
              Edit entry
            </button>
          )}
          {preview.link && (
            <button
              type="button"
              onClick={() => onOpenLink(preview.link!)}
              className="flex items-center gap-1 rounded text-primary text-xs underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
            >
              {preview.linkKind === "doi" ? "DOI" : "Link"}
              <ExternalLinkIcon className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
