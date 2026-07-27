import { useEffect, useState } from "react";
import { useDocumentStore, getCurrentPdfBytes } from "@/stores/document-store";
import { getOrOpenDocument } from "@/lib/mupdf/pdf-doc-cache";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import type { PdfOutlineItem } from "@/lib/mupdf/types";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("pdf-outline");

/**
 * The compiled PDF's bookmark tree (what `hyperref` writes), refreshed on each
 * recompile.
 *
 * Gated on `enabled` rather than fetched eagerly: opening a document pins its
 * bytes and parsed structures in the WASM heap, so this only runs while the
 * reader is actually looking at the PDF outline.
 */
export function usePdfOutline(enabled: boolean): {
  items: PdfOutlineItem[];
  loading: boolean;
} {
  const pdfRevision = useDocumentStore((state) => state.pdfRevision);
  const [items, setItems] = useState<PdfOutlineItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const data = getCurrentPdfBytes();
    if (!data) {
      setItems([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // The viewer has almost always opened these same bytes already, so this is
    // a cache hit rather than a second copy of the document.
    getOrOpenDocument(data)
      .then(({ docId }) => getMupdfClient().getOutline(docId))
      .then((outline) => {
        if (!cancelled) setItems(outline);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        log.warn("Could not read PDF outline", { message: String(error) });
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, pdfRevision]);

  return { items, loading };
}
