import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildCitationIndex,
  buildCitationPreview,
  type CitationEntry,
  type CitationPreview,
} from "@/lib/pdf-citation-preview";
import type { CitationAnchorRect } from "@/components/workspace/preview/citation-card";
import { useDocumentStore, type ProjectFile } from "@/stores/document-store";

export interface OpenCitation {
  preview: CitationPreview;
  rect: CitationAnchorRect;
  /** The citation link's own target, so the card can offer to follow it. */
  href: string | null;
}

function rectOf(element: HTMLElement): CitationAnchorRect {
  const { top, bottom, left, right } = element.getBoundingClientRect();
  return { top, bottom, left, right };
}

/**
 * The reference card opened by clicking a citation in the PDF.
 *
 * It stays up until dismissed — clicking elsewhere, pressing Escape, or
 * scrolling the citation out of sight — so the DOI and reference links are
 * ordinary click targets rather than something to be reached before a timer
 * expires.
 *
 * The bibliography is parsed on the first citation clicked rather than up
 * front: a project can carry a few hundred kilobytes of `.bib`, and most
 * preview sessions never open a citation. The parsed index is reused until the
 * project's files change.
 */
export function useCitationPopup(
  containerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [open, setOpen] = useState<OpenCitation | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const indexRef = useRef<{
    files: ProjectFile[];
    entries: Map<string, CitationEntry>;
  } | null>(null);

  const close = useCallback(() => {
    anchorRef.current = null;
    setOpen(null);
  }, []);

  const openForAnchor = useCallback((anchor: HTMLElement) => {
    const key = anchor.dataset.citeKey;
    if (!key) return;

    const files = useDocumentStore.getState().files;
    if (indexRef.current?.files !== files) {
      indexRef.current = { files, entries: buildCitationIndex(files) };
    }

    anchorRef.current = anchor;
    setOpen({
      preview: buildCitationPreview(
        key,
        indexRef.current.entries.get(key) ?? null,
      ),
      rect: rectOf(anchor),
      href: anchor.getAttribute("href"),
    });
  }, []);

  // Repositioning replaces `open` on every scroll frame, so the listener
  // effects below key off whether a card is up rather than its identity.
  const isOpen = open !== null;

  // Dismiss on a click anywhere outside the card. The click that opens the card
  // is stopped by the viewer's own capture-phase handler, so it never reaches
  // this listener and cannot close what it just opened.
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-citation-card]")) return;
      close();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, close]);

  // The card is positioned in viewport coordinates, so it has to track the
  // citation as the page scrolls or zooms under it, and give up once the
  // citation is gone — pages drop their link layer when scrolled far away.
  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    let frame = 0;
    const reposition = () => {
      frame = 0;
      const anchor = anchorRef.current;
      if (!anchor?.isConnected) {
        close();
        return;
      }
      const rect = rectOf(anchor);
      const bounds = container.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) {
        close();
        return;
      }
      setOpen((current) => {
        if (!current) return current;
        const previous = current.rect;
        if (previous.top === rect.top && previous.left === rect.left) {
          return current;
        }
        return { ...current, rect };
      });
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(reposition);
    };

    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [isOpen, containerRef, close]);

  return { open, openForAnchor, close };
}
