import { useEffect, useRef, useState, useCallback, memo } from "react";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import {
  capRenderDpi,
  SIMPLE_MAX_RENDER_PIXELS,
} from "@/lib/mupdf/render-limits";
import { useSettingsStore } from "@/stores/settings-store";
import { createLogger } from "@/lib/debug/logger";
import { APP_VISIBILITY_RESTORED } from "@/lib/debug/log-store";
import type { StructuredTextData, LinkData, Rect } from "@/lib/mupdf/types";
import { MessageSquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveReviewHighlightColor } from "@/lib/review-colors";
import {
  DEFAULT_STROKE_WIDTH,
  drawingPath,
  type ReviewDrawingTool,
  type ReviewPoint,
} from "@/lib/review-drawing";
import { citationKeyFromDest } from "@/lib/pdf-citation-preview";

const log = createLogger("mupdf-page");

export interface MupdfReviewAnnotation {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "text" | "point";
  /** Highlights render as a clickable wash without the comment bubble;
   *  drawings render as ink in an SVG overlay. */
  annotationKind: "comment" | "highlight" | "drawing";
  /** Set only when annotationKind is "drawing". */
  drawing?: {
    tool: ReviewDrawingTool;
    points: ReviewPoint[];
    strokeWidth?: number;
  };
  status: "open" | "resolved";
  /** Highlight colour token; falls back to yellow. */
  color?: string;
}

interface MupdfPageProps {
  docId: number;
  pageIndex: number;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  isVisible: boolean;
  /** True while the user is flinging through the document — pages first
   *  painted during a fast scroll render at half resolution, then upgrade
   *  when scrolling settles. */
  fastScroll?: boolean;
  highlight?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  reviewAnnotations?: MupdfReviewAnnotation[];
  selectedReviewAnnotationId?: string | null;
  onSelectReviewAnnotation?: (id: string) => void;
  /** Find-bar matches falling on this page, in unscaled page coordinates. */
  searchRects?: Rect[];
  /** Rectangles of the currently selected match, if it is on this page. */
  activeSearchRects?: Rect[];
}

/** Check if a canvas appears blank (GPU context was silently invalidated).
 *  Uses a single getImageData call covering a small center region. */
function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return true; // context fully lost
  // Sample a 2x2 region from the center in one GPU readback
  const cx = Math.max(0, Math.floor(canvas.width / 2) - 1);
  const cy = Math.max(0, Math.floor(canvas.height / 2) - 1);
  const data = ctx.getImageData(cx, cy, 2, 2).data;
  // If all sampled pixels have zero alpha, canvas is blank
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

export const MupdfPage = memo(function MupdfPage({
  docId,
  pageIndex,
  scale,
  pageWidth,
  pageHeight,
  isVisible,
  fastScroll = false,
  highlight,
  reviewAnnotations = [],
  selectedReviewAnnotationId,
  onSelectReviewAnnotation,
  searchRects = [],
  activeSearchRects = [],
}: MupdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simplePreview = useSettingsStore((s) => s.simplePdfPreview);
  const [textData, setTextData] = useState<StructuredTextData | null>(null);
  const [links, setLinks] = useState<LinkData[]>([]);
  const renderGenRef = useRef(0);
  // Single-flight render guard: at most one drawPage in the worker per page,
  // with latest-wins coalescing. Without this, scroll/zoom bursts queue an
  // unbounded number of renders, each producing a multi-MB pixel buffer —
  // a sustained burst allocates faster than GC frees and OOMs the renderer.
  const renderInFlightRef = useRef(false);
  const renderQueuedRef = useRef(false);
  // What the canvas currently shows — used to skip redundant renders and to
  // upgrade half-resolution fast-scroll paints once scrolling settles.
  const renderedRef = useRef({ docId: 0, dpi: 0 });

  // Debounced zoom: CSS scales the existing canvas instantly (cssW/cssH below
  // track the live scale), while the expensive re-render at the new DPI only
  // happens once the scale stops changing — a pinch gesture no longer issues
  // a render per tick.
  const [settledScale, setSettledScale] = useState(scale);
  useEffect(() => {
    if (scale === settledScale) return;
    const timer = setTimeout(() => setSettledScale(scale), 180);
    return () => clearTimeout(timer);
  }, [scale, settledScale]);

  const cssW = pageWidth * scale;
  const cssH = pageHeight * scale;

  /** Re-render the page onto the canvas via MuPDF worker.
   *  Pass force=true to bypass the already-rendered check (e.g. when the
   *  canvas content was lost while backgrounded). */
  const renderPage = useCallback(
    (force = false) => {
      if (!isVisible || docId <= 0) return;
      if (renderInFlightRef.current) {
        // Coalesce: re-render once with the latest params when the current
        // render completes, no matter how many requests arrived meanwhile.
        renderQueuedRef.current = true;
        return;
      }

      // Lightweight preview: render at CSS resolution (no DPR upscale) with a
      // tighter pixel budget — 2-4× less memory and decode work per page.
      const dpr = simplePreview ? 1 : window.devicePixelRatio || 1;
      const fullDpi = capRenderDpi(
        settledScale * 72 * dpr,
        pageWidth,
        pageHeight,
        simplePreview ? SIMPLE_MAX_RENDER_PIXELS : undefined,
      );
      // First paint during a fling: render at half resolution — cheap enough
      // to keep up with the scroll; the settle pass below upgrades it.
      const firstPaint =
        renderedRef.current.docId !== docId || renderedRef.current.dpi === 0;
      const dpi = fastScroll && firstPaint ? fullDpi / 2 : fullDpi;

      // Skip when the canvas already shows this document at (or above) the
      // requested resolution — makes redundant effect re-runs free.
      if (
        !force &&
        renderedRef.current.docId === docId &&
        renderedRef.current.dpi >= dpi - 0.01
      ) {
        return;
      }

      const gen = ++renderGenRef.current;
      renderInFlightRef.current = true;
      const client = getMupdfClient();

      client
        .drawPage(docId, pageIndex, dpi)
        .then((imageData) => {
          if (gen !== renderGenRef.current) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = imageData.width;
          canvas.height = imageData.height;
          // Synchronous copy — the ImageData buffer is released immediately.
          // (createImageBitmap added an async hop that retained every buffer
          // in a burst until the compositor caught up.)
          canvas.getContext("2d")!.putImageData(imageData, 0, 0);
          renderedRef.current = { docId, dpi };
        })
        .catch((err) => {
          if (gen !== renderGenRef.current) return;
          log.error(`Render error page ${pageIndex}`, { error: String(err) });
        })
        .finally(() => {
          renderInFlightRef.current = false;
          if (renderQueuedRef.current) {
            renderQueuedRef.current = false;
            renderPageRef.current();
          }
        });
    },
    [
      docId,
      pageIndex,
      settledScale,
      isVisible,
      pageWidth,
      pageHeight,
      simplePreview,
      fastScroll,
    ],
  );

  // Latest renderPage identity, so a queued follow-up uses current params
  // instead of the closure that started the in-flight render.
  const renderPageRef = useRef(renderPage);
  renderPageRef.current = renderPage;

  // Release the canvas backing store when the page scrolls far out of view
  // (beyond the IntersectionObserver margin). Without this, every visited page
  // keeps a full-resolution bitmap (~10-30 MB at typical zoom × DPR) alive for
  // the whole session — scrolling through a long document accumulates
  // gigabytes and can OOM the renderer process. The CSS size is set separately
  // in style, so layout is unaffected; re-entering the margin re-renders.
  useEffect(() => {
    if (isVisible) return;
    renderGenRef.current++; // cancel any in-flight render
    renderQueuedRef.current = false;
    renderedRef.current = { docId: 0, dpi: 0 };
    const canvas = canvasRef.current;
    if (canvas && canvas.width > 0) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [isVisible]);

  // Initial render and re-render on dependency changes (the already-rendered
  // check inside renderPage makes redundant runs free).
  useEffect(() => {
    if (!isVisible || docId <= 0) return;
    renderPage();
  }, [docId, pageIndex, isVisible, renderPage]);

  // Text + link layers depend only on the document, not the zoom level —
  // fetch once per doc instead of on every scale change and visibility flip.
  // Lightweight preview skips them entirely (no text selection / clickable
  // links; double-click sync and review tools are coordinate-based and keep
  // working).
  const textFetchedDocIdRef = useRef(0);
  useEffect(() => {
    if (simplePreview) {
      textFetchedDocIdRef.current = 0;
      setTextData(null);
      setLinks([]);
      return;
    }
    if (!isVisible || docId <= 0) return;
    if (textFetchedDocIdRef.current === docId) return;

    let cancelled = false;
    const client = getMupdfClient();

    Promise.all([
      client.getPageText(docId, pageIndex).then((data) => {
        if (!cancelled) setTextData(data);
      }),
      client.getPageLinks(docId, pageIndex).then((data) => {
        if (!cancelled) setLinks(data);
      }),
    ])
      .then(() => {
        if (!cancelled) textFetchedDocIdRef.current = docId;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [docId, pageIndex, isVisible, simplePreview]);

  // Re-render canvas when returning from background if content was lost
  useEffect(() => {
    const handleVisibilityRestored = () => {
      const canvas = canvasRef.current;
      if (!canvas || !isVisible || docId <= 0) return;
      if (isCanvasBlank(canvas)) {
        log.warn(
          `Canvas blank after visibility restore, re-rendering page ${pageIndex}`,
        );
        renderPage(true);
      }
    };

    window.addEventListener(APP_VISIBILITY_RESTORED, handleVisibilityRestored);
    return () =>
      window.removeEventListener(
        APP_VISIBILITY_RESTORED,
        handleVisibilityRestored,
      );
  }, [docId, pageIndex, isVisible, renderPage]);

  return (
    <div
      className="mupdf-page relative"
      data-page-number={pageIndex + 1}
      style={{ width: cssW, height: cssH }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: cssW, height: cssH, display: "block" }}
      />

      {/* Text layer for selection */}
      {textData && (
        <svg
          className="mupdf-text-layer"
          viewBox={`0 0 ${pageWidth} ${pageHeight}`}
          preserveAspectRatio="none"
          style={{ width: cssW, height: cssH }}
        >
          {textData.blocks.map(
            (block, bi) =>
              block.type === "text" &&
              block.lines.map((line, li) => (
                <text
                  key={`${bi}-${li}`}
                  x={line.bbox.x}
                  y={line.y}
                  fontSize={line.font.size}
                  fontFamily={line.font.family || line.font.name || "serif"}
                  textLength={line.bbox.w > 0 ? line.bbox.w : undefined}
                  lengthAdjust="spacingAndGlyphs"
                >
                  {line.text}
                </text>
              )),
          )}
        </svg>
      )}

      {/* Link layer */}
      {links.length > 0 && (
        <div className="mupdf-link-layer">
          {links.map((link, i) => (
            <a
              key={i}
              href={link.href}
              data-external={link.isExternal ? "true" : undefined}
              // Marks the anchor for the citation hover card, which the viewer
              // resolves against the project bibliography.
              data-cite-key={citationKeyFromDest(link.dest) ?? undefined}
              style={{
                left: `${(link.x / pageWidth) * 100}%`,
                top: `${(link.y / pageHeight) * 100}%`,
                width: `${(link.w / pageWidth) * 100}%`,
                height: `${(link.h / pageHeight) * 100}%`,
              }}
            >
              <span className="sr-only">Link</span>
            </a>
          ))}
        </div>
      )}

      {/* Search matches. Drawn under the SyncTeX highlight and review layers
          so neither is obscured while a find is open. */}
      {searchRects.map((rect, i) => (
        <div
          key={`search-${i}`}
          className="pointer-events-none absolute z-[2] rounded-[1px] bg-yellow-400/40 mix-blend-multiply dark:mix-blend-screen"
          style={{
            left: rect.x * scale,
            top: rect.y * scale,
            width: Math.max(2, rect.w * scale),
            height: Math.max(2, rect.h * scale),
          }}
          aria-hidden="true"
        />
      ))}
      {activeSearchRects.map((rect, i) => (
        <div
          key={`active-search-${i}`}
          className="pointer-events-none absolute z-[2] rounded-[1px] bg-orange-500/50 ring-1 ring-orange-600"
          style={{
            left: rect.x * scale,
            top: rect.y * scale,
            width: Math.max(2, rect.w * scale),
            height: Math.max(2, rect.h * scale),
          }}
          aria-hidden="true"
        />
      ))}

      {highlight && (
        <div
          className="synctex-highlight pointer-events-none absolute z-[3] rounded-sm border-2 border-blue-500 bg-blue-400/20 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]"
          style={{
            left: highlight.x * scale,
            top: highlight.y * scale,
            width: Math.max(12, highlight.width * scale),
            height: Math.max(12, highlight.height * scale),
          }}
          aria-hidden="true"
        />
      )}

      {reviewAnnotations.some((annotation) => annotation.drawing) && (
        <svg
          className="pointer-events-none absolute inset-0 z-[4] size-full"
          viewBox={`0 0 ${pageWidth} ${pageHeight}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <title>Review drawings</title>
          {reviewAnnotations.map((annotation) =>
            annotation.drawing ? (
              <path
                key={annotation.id}
                d={drawingPath(
                  annotation.drawing.tool,
                  annotation.drawing.points,
                )}
                fill="none"
                stroke={
                  annotation.status === "resolved"
                    ? "currentColor"
                    : resolveReviewHighlightColor(annotation.color).stroke
                }
                strokeOpacity={annotation.status === "resolved" ? 0.35 : 1}
                strokeWidth={
                  annotation.drawing.strokeWidth ?? DEFAULT_STROKE_WIDTH
                }
                strokeLinecap="round"
                strokeLinejoin="round"
                // Only the ink is clickable, so a big loop does not swallow
                // clicks meant for the page inside it.
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                className={cn(
                  selectedReviewAnnotationId === annotation.id &&
                    "drop-shadow-[0_0_3px_rgba(59,130,246,0.9)]",
                )}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectReviewAnnotation?.(annotation.id);
                }}
              />
            ) : null,
          )}
        </svg>
      )}

      {reviewAnnotations.map((annotation) => (
        <div key={annotation.id}>
          {annotation.kind === "text" &&
            annotation.annotationKind !== "drawing" &&
            (annotation.annotationKind === "highlight" ? (
              // Highlights are directly clickable — there is no bubble marker.
              <button
                type="button"
                className={cn(
                  "absolute z-[3] cursor-pointer rounded-sm",
                  annotation.status === "resolved"
                    ? "bg-slate-300/25 hover:bg-slate-300/40"
                    : resolveReviewHighlightColor(annotation.color).wash,
                  selectedReviewAnnotationId === annotation.id &&
                    "ring-2 ring-blue-500/60",
                )}
                style={{
                  left: annotation.x * scale,
                  top: annotation.y * scale,
                  width: Math.max(10, annotation.width * scale),
                  height: Math.max(10, annotation.height * scale),
                }}
                aria-label={`Open highlight on page ${annotation.page}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectReviewAnnotation?.(annotation.id);
                }}
              />
            ) : (
              <div
                className={cn(
                  "pointer-events-none absolute z-[3] rounded-sm border",
                  annotation.status === "resolved"
                    ? "border-slate-400/50 bg-slate-300/15"
                    : "border-amber-500/50 bg-amber-300/25",
                  selectedReviewAnnotationId === annotation.id &&
                    "ring-2 ring-blue-500/60",
                )}
                style={{
                  left: annotation.x * scale,
                  top: annotation.y * scale,
                  width: Math.max(10, annotation.width * scale),
                  height: Math.max(10, annotation.height * scale),
                }}
                aria-hidden="true"
              />
            ))}
          {annotation.annotationKind === "comment" && (
            <button
              type="button"
              className={cn(
                "absolute z-[4] flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-transform hover:scale-110",
                annotation.status === "resolved"
                  ? "border-slate-400 bg-slate-100 text-slate-500"
                  : "border-amber-500 bg-amber-300 text-amber-950",
                selectedReviewAnnotationId === annotation.id &&
                  "ring-2 ring-blue-500 ring-offset-1",
              )}
              style={{
                left:
                  (annotation.x +
                    (annotation.kind === "text" ? annotation.width : 0)) *
                  scale,
                top: annotation.y * scale,
              }}
              aria-label={`Open review comment on page ${annotation.page}`}
              onClick={(event) => {
                event.stopPropagation();
                onSelectReviewAnnotation?.(annotation.id);
              }}
            >
              <MessageSquareIcon className="size-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
});
