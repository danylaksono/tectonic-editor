import { useCallback, useEffect, useRef, useState } from "react";
import { useDocumentStore, getCurrentPdfBytes } from "@/stores/document-store";
import { getOrOpenDocument } from "@/lib/mupdf/pdf-doc-cache";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import { countPdfWords, type PdfWordCount } from "@/lib/pdf-word-count";
import { createLogger } from "@/lib/debug/logger";

const log = createLogger("pdf-word-count");

export interface PdfWordCountState {
  result: PdfWordCount | null;
  counting: boolean;
  /** Pages processed so far, for progress on long documents. */
  progress: { done: number; total: number } | null;
  /** Run the count. Deliberately explicit — extracting the text of every page
   *  is far too expensive to do automatically after each compile. */
  run: () => void;
}

export function usePdfWordCount(): PdfWordCountState {
  const pdfRevision = useDocumentStore((state) => state.pdfRevision);
  const [result, setResult] = useState<PdfWordCount | null>(null);
  const [counting, setCounting] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const generationRef = useRef(0);

  // A recompile makes any previous count stale; drop it rather than showing a
  // number that no longer matches the document.
  useEffect(() => {
    generationRef.current++;
    setResult(null);
    setCounting(false);
    setProgress(null);
  }, [pdfRevision]);

  const run = useCallback(() => {
    const data = getCurrentPdfBytes();
    if (!data) return;

    const generation = ++generationRef.current;
    const isStale = () => generationRef.current !== generation;

    setCounting(true);
    setProgress(null);

    void getOrOpenDocument(data)
      .then(({ docId, pageSizes }) => {
        const client = getMupdfClient();
        return countPdfWords(
          (pageIndex) => client.getPageText(docId, pageIndex),
          pageSizes.length,
          {
            isCancelled: isStale,
            onProgress: (done, total) => {
              if (!isStale()) setProgress({ done, total });
            },
          },
        );
      })
      .then((counted) => {
        if (isStale()) return;
        setResult(counted);
      })
      .catch((error: unknown) => {
        if (isStale()) return;
        log.warn("Could not count words in PDF", { message: String(error) });
      })
      .finally(() => {
        if (isStale()) return;
        setCounting(false);
        setProgress(null);
      });
  }, []);

  return { result, counting, progress, run };
}
