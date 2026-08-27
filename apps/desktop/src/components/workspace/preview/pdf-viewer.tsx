import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LinkIcon,
  LoaderIcon,
  MessageSquarePlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  getCachedDocument,
  getOrOpenDocument,
  invalidateDoc,
} from "@/lib/mupdf/pdf-doc-cache";
import { LOCAL_ZOOM_SHORTCUTS_ATTR } from "@/lib/app-zoom";
import { MupdfPage, type MupdfReviewAnnotation } from "./mupdf-page";
import { CitationCard } from "./citation-card";
import { useCitationPopup } from "@/hooks/use-citation-popup";
import {
  canGoBack,
  canGoForward,
  EMPTY_HISTORY,
  goBack,
  goForward,
  recordJump,
  updateCurrent,
  type ViewHistory,
} from "@/lib/pdf-view-history";
import { resolveReviewHighlightColor } from "@/lib/review-colors";
import { useSettingsStore } from "@/stores/settings-store";
import { createLogger } from "@/lib/debug/logger";
import { scrollBehavior } from "@/lib/utils";
import { APP_VISIBILITY_RESTORED } from "@/lib/debug/log-store";
import { MUPDF_CLIENT_RESET } from "@/lib/debug/memory-guard";
import type { PageSize, PdfSearchMatch, Rect } from "@/lib/mupdf/types";
import { getMupdfClient } from "@/lib/mupdf/mupdf-client";
import { firstMatchFromPage, searchPdfPages } from "@/lib/mupdf/pdf-search";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const log = createLogger("pdf-viewer");

/** Module-level scroll position cache: rootFileId → page number */
const scrollPositionCache = new Map<string, number>();

/** Clear all cached scroll positions (e.g., on project close). */
export function clearScrollPositionCache(): void {
  scrollPositionCache.clear();
}

export interface PdfTextSelection {
  text: string;
  pageNumber: number;
  position: { top: number; left: number };
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
}

export interface CaptureResult {
  dataUrl: string;
  pageNumber: number;
  pdfX: number;
  pdfY: number;
}

export interface PdfHighlightLocation {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfReviewAnnotation = MupdfReviewAnnotation;

export interface PdfReviewTarget {
  kind: "text" | "point";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  selectedText: string;
}

export interface PdfViewHistoryState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PdfViewHistoryControls {
  back: () => void;
  forward: () => void;
}

interface PdfContextTarget {
  page: number;
  x: number;
  y: number;
  selectedText: string;
  href: string | null;
  reviewTarget: PdfReviewTarget;
}

interface PdfViewerProps {
  data: Uint8Array;
  scale: number;
  /** Root file ID for scroll position caching across file switches. */
  rootFileId?: string;
  /** Whether this viewer is currently the active/visible one (for keep-alive). */
  isActive?: boolean;
  onError?: (error: string) => void;
  onLoadSuccess?: (numPages: number) => void;
  onScaleChange?: (scale: number) => void;
  onTextClick?: (text: string) => void;
  onSynctexClick?: (page: number, x: number, y: number) => void;
  onTextSelect?: (selection: PdfTextSelection | null) => void;
  onFirstPageSize?: (width: number, height: number) => void;
  onContainerResize?: (width: number, height: number) => void;
  onCurrentPageChange?: (page: number) => void;
  /** Jump to a page. Pass `record` for jumps that should be undoable with the
   *  back button — following a link or a table-of-contents entry — but not for
   *  stepping page by page, which is closer to scrolling. */
  scrollToPageRef?: React.RefObject<
    ((page: number, options?: { record?: boolean }) => void) | null
  >;
  /** Browser-style back/forward through jump positions. */
  viewHistoryRef?: React.RefObject<PdfViewHistoryControls | null>;
  onViewHistoryChange?: (state: PdfViewHistoryState) => void;
  /** Open a bibliography entry's source in the editor, from a citation card. */
  onOpenBibEntry?: (fileId: string, from: number) => void;
  captureMode?: boolean;
  onCapture?: (result: CaptureResult) => void;
  onCancelCapture?: () => void;
  onStartCapture?: () => void;
  highlightLocation?: PdfHighlightLocation | null;
  reviewAnnotations?: PdfReviewAnnotation[];
  selectedReviewAnnotationId?: string | null;
  onSelectReviewAnnotation?: (id: string) => void;
  onAddReviewComment?: (target: PdfReviewTarget) => void;
  /** Fired once the MuPDF document behind the current bytes is open, so the
   *  preview can run work that needs the document itself (extracting the text
   *  under a highlight, re-anchoring review annotations) without opening a
   *  second copy of the PDF in the WASM heap. */
  onDocumentReady?: (docId: number, pageCount: number) => void;
  /** Review "comment pin" tool: clicks place a point comment instead of
   *  interacting with the text layer. */
  commentPlacementMode?: boolean;
  onPlacePointComment?: (target: PdfReviewTarget) => void;
  /** Review "highlighter" tool: drag a box over the PDF to highlight it.
   *  Deliberately not based on text selection, so it also covers figures,
   *  equations, and tables. */
  highlightPlacementMode?: boolean;
  onPlaceHighlight?: (target: PdfReviewTarget) => void;
  /** Colour token for the highlight drag preview. */
  highlightColor?: string;
  /** Lets the toolbar open the find bar, mirroring the Ctrl/Cmd+F binding the
   *  viewer handles when the PDF pane has focus. */
  openSearchRef?: React.RefObject<(() => void) | null>;
}

export function PdfViewer({
  data,
  scale,
  rootFileId,
  isActive = true,
  onError,
  onLoadSuccess,
  onScaleChange,
  onTextClick,
  onSynctexClick,
  onTextSelect,
  onFirstPageSize,
  onContainerResize,
  onCurrentPageChange,
  scrollToPageRef,
  viewHistoryRef,
  onViewHistoryChange,
  onOpenBibEntry,
  captureMode = false,
  onCapture,
  onCancelCapture,
  onStartCapture,
  highlightLocation,
  reviewAnnotations = [],
  selectedReviewAnnotationId,
  onSelectReviewAnnotation,
  onAddReviewComment,
  onDocumentReady,
  commentPlacementMode = false,
  onPlacePointComment,
  highlightPlacementMode = false,
  onPlaceHighlight,
  highlightColor,
  openSearchRef,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const simplePreview = useSettingsStore((s) => s.simplePdfPreview);

  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [contextTarget, setContextTarget] = useState<PdfContextTarget | null>(
    null,
  );
  const docIdRef = useRef(0);
  const loadGenRef = useRef(0);

  // Find bar
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<PdfSearchMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** Bumped on every new query so an in-flight page sweep abandons itself. */
  const searchGenRef = useRef(0);

  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const synctexClickRef = useRef(onSynctexClick);
  synctexClickRef.current = onSynctexClick;
  const textSelectRef = useRef(onTextSelect);
  textSelectRef.current = onTextSelect;

  // Scroll preservation across recompile
  const isFirstLoad = useRef(true);
  const savedPageRef = useRef<number>(0);

  // Increment on app-visibility-restored to force IntersectionObserver reconnection
  const [focusGen, setFocusGen] = useState(0);
  useEffect(() => {
    const handleRestore = () => setFocusGen((g) => g + 1);
    window.addEventListener(APP_VISIBILITY_RESTORED, handleRestore);
    return () =>
      window.removeEventListener(APP_VISIBILITY_RESTORED, handleRestore);
  }, []);

  // The memory guard restarts the MuPDF worker under memory pressure, which
  // kills every docId — forget ours and re-run the load effect so the document
  // reopens through the fresh worker.
  const [mupdfResetGen, setMupdfResetGen] = useState(0);
  useEffect(() => {
    const handleReset = () => {
      docIdRef.current = 0;
      setMupdfResetGen((g) => g + 1);
    };
    window.addEventListener(MUPDF_CLIENT_RESET, handleReset);
    return () => window.removeEventListener(MUPDF_CLIENT_RESET, handleReset);
  }, []);

  // Keep-alive scroll save/restore
  const savedScrollTop = useRef(0);
  const prevIsActive = useRef(isActive);
  useEffect(() => {
    if (prevIsActive.current && !isActive) {
      // Becoming hidden → save scrollTop
      if (containerRef.current) {
        savedScrollTop.current = containerRef.current.scrollTop;
      }
    } else if (!prevIsActive.current && isActive) {
      // Becoming visible → restore scrollTop
      const scrollVal = savedScrollTop.current;
      if (containerRef.current && scrollVal > 0) {
        // Use rAF to ensure layout is computed after visibility change
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = scrollVal;
          }
        });
      }
    }
    prevIsActive.current = isActive;
  }, [isActive]);

  // Capture drag state
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [dragPageNum, setDragPageNum] = useState(0);

  const numPages = pageSizes.length;

  // Back/forward history. Kept in a ref because ordinary scrolling updates the
  // current entry continuously; only the button states are React state.
  const historyRef = useRef<ViewHistory>(EMPTY_HISTORY);
  const [historyState, setHistoryState] = useState<PdfViewHistoryState>({
    canGoBack: false,
    canGoForward: false,
  });

  const syncHistoryState = useCallback(() => {
    const history = historyRef.current;
    const next = {
      canGoBack: canGoBack(history),
      canGoForward: canGoForward(history),
    };
    setHistoryState((current) =>
      current.canGoBack === next.canGoBack &&
      current.canGoForward === next.canGoForward
        ? current
        : next,
    );
  }, []);

  /** Note a jump away from the current position so it can be returned to. */
  const recordHistoryJump = useCallback(
    (from: number, to: number) => {
      historyRef.current = recordJump(historyRef.current, from, to);
      syncHistoryState();
    },
    [syncHistoryState],
  );

  const openPdfHref = useCallback((href: string) => {
    const container = containerRef.current;
    if (!container) return;

    if (href.includes("#page=")) {
      const match = href.match(/#page=(\d+)/);
      if (match) {
        const pageNum = parseInt(match[1], 10);
        scrollToPage(container, pageNum, true);
      }
      return;
    }

    if (
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:")
    ) {
      void ask(`Open in browser?\n${href}`, {
        title: "External Link",
        kind: "info",
        okLabel: "Open",
        cancelLabel: "Cancel",
      }).then((confirmed) => {
        if (confirmed) void shellOpen(href);
      });
    }
  }, []);

  function getVisiblePage(): number {
    const container = containerRef.current;
    if (!container) return 1;
    const pages = container.querySelectorAll(".mupdf-page");
    if (pages.length === 0) return 1;
    const containerRect = container.getBoundingClientRect();
    for (const page of pages) {
      const el = page as HTMLElement;
      const rect = el.getBoundingClientRect();
      if (rect.bottom > containerRect.top + 50) {
        return parseInt(el.getAttribute("data-page-number") || "1", 10);
      }
    }
    return 1;
  }

  /** Scroll the container so the given page is at the top (with 16px offset).
   *  Pass `record` for jumps the back button should be able to undo. */
  function scrollToPage(
    container: HTMLElement,
    page: number,
    record = false,
  ): boolean {
    const pageEl = container.querySelector(
      `[data-page-number="${page}"]`,
    ) as HTMLElement | null;
    if (!pageEl) return false;
    const containerRect = container.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    const from = container.scrollTop;
    container.scrollTop += pageRect.top - containerRect.top - 16;
    if (record) recordHistoryJump(from, container.scrollTop);
    return true;
  }

  const prevRootFileIdRef = useRef<string | undefined>(undefined);

  // Save scroll position when rootFileId is about to change
  useEffect(() => {
    return () => {
      if (prevRootFileIdRef.current && containerRef.current) {
        scrollPositionCache.set(prevRootFileIdRef.current, getVisiblePage());
      }
    };
  }, [rootFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load document with MuPDF (using LRU doc cache)
  useEffect(() => {
    const gen = ++loadGenRef.current;
    prevRootFileIdRef.current = rootFileId;

    const pdfData =
      data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);

    // Validate PDF header — must start with %PDF-
    if (
      pdfData.length < 5 ||
      pdfData[0] !== 0x25 ||
      pdfData[1] !== 0x50 ||
      pdfData[2] !== 0x44 ||
      pdfData[3] !== 0x46
    ) {
      log.error("Invalid PDF data: missing %PDF- header", {
        length: pdfData.length,
        firstBytes: Array.from(pdfData.slice(0, 16)),
      });
      setLoading(false);
      onError?.("Invalid PDF data received. Try recompiling the document.");
      return;
    }

    // Fast path: synchronous cache check — avoids async gap, state churn, and re-renders
    const syncResult = getCachedDocument(pdfData);
    if (syncResult && syncResult.docId === docIdRef.current) {
      // Same document already displayed — only restore scroll position on file switch
      isFirstLoad.current = false;
      if (rootFileId) {
        const targetPage = scrollPositionCache.get(rootFileId) ?? 0;
        if (targetPage > 0) {
          requestAnimationFrame(() => {
            const container = containerRef.current;
            if (container) scrollToPage(container, targetPage);
          });
        }
      }
      return;
    }

    // Save scroll position before reloading (for recompile of same file)
    if (containerRef.current && !isFirstLoad.current) {
      savedPageRef.current = getVisiblePage();
      if (contentRef.current) {
        contentRef.current.style.minHeight = `${contentRef.current.scrollHeight}px`;
      }
    }

    // Helper: retry-scroll to a page element with rAF retries
    const scrollToPageEl = (targetPage: number, maxAttempts = 30) => {
      const attempt = (remaining: number) => {
        const container = containerRef.current;
        if (!container || remaining <= 0) {
          if (contentRef.current) contentRef.current.style.minHeight = "";
          return;
        }
        const pageEl = container.querySelector(
          `[data-page-number="${targetPage}"]`,
        ) as HTMLElement | null;
        if (pageEl && pageEl.clientHeight > 0) {
          scrollToPage(container, targetPage);
          if (contentRef.current) contentRef.current.style.minHeight = "";
        } else {
          requestAnimationFrame(() => attempt(remaining - 1));
        }
      };
      requestAnimationFrame(() => attempt(maxAttempts));
    };

    // Synchronous cache hit for a different doc (file switch to cached PDF)
    if (syncResult) {
      docIdRef.current = syncResult.docId;
      setPageSizes(syncResult.pageSizes);
      setLoading(false);

      if (isFirstLoad.current && syncResult.pageSizes.length > 0) {
        onFirstPageSize?.(
          syncResult.pageSizes[0].width,
          syncResult.pageSizes[0].height,
        );
      }
      isFirstLoad.current = false;
      onLoadSuccess?.(syncResult.pageSizes.length);
      onDocumentReady?.(syncResult.docId, syncResult.pageSizes.length);

      if (rootFileId) {
        const targetPage = scrollPositionCache.get(rootFileId) ?? 0;
        if (targetPage > 0) scrollToPageEl(targetPage);
      }
      return;
    }

    // Cache miss — async path (first load or recompile with new content)
    setLoading(isFirstLoad.current);

    (async () => {
      try {
        const { docId, pageSizes: sizes } = await getOrOpenDocument(pdfData);
        if (gen !== loadGenRef.current) return;

        // A fresh open in this viewer means the previous version of this
        // root's PDF was replaced (recompile) — close it eagerly instead of
        // letting up to MAX_OPEN_DOCS stale versions pile up in WASM memory.
        const prevDocId = docIdRef.current;
        if (prevDocId > 0 && prevDocId !== docId) {
          invalidateDoc(prevDocId);
        }

        docIdRef.current = docId;
        setPageSizes(sizes);
        setLoading(false);

        if (isFirstLoad.current && sizes.length > 0) {
          onFirstPageSize?.(sizes[0].width, sizes[0].height);
        }
        isFirstLoad.current = false;
        onLoadSuccess?.(sizes.length);
        onDocumentReady?.(docId, sizes.length);

        const targetPage = savedPageRef.current;
        if (targetPage > 0) {
          savedPageRef.current = 0;
          scrollToPageEl(targetPage);
        }
      } catch (err) {
        if (gen !== loadGenRef.current) return;
        setLoading(false);
        onError?.(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [data, mupdfResetGen]); // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver for lazy page rendering — only when active
  useEffect(() => {
    if (!isActive) return;
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            const pageNum = parseInt(
              el.getAttribute("data-page-number") || "0",
              10,
            );
            if (pageNum === 0) continue;
            if (entry.isIntersecting) {
              next.add(pageNum);
            } else {
              next.delete(pageNum);
            }
          }
          return next;
        });
      },
      {
        root: container,
        // Lightweight preview keeps fewer offscreen pages rendered — less
        // canvas memory and fewer wasted renders while scrolling.
        rootMargin: simplePreview ? "50% 0px" : "200% 0px",
      },
    );

    const pages = container.querySelectorAll(".mupdf-page");
    pages.forEach((p) => observer.observe(p));

    return () => observer.disconnect();
  }, [pageSizes, scale, isActive, focusGen, simplePreview]);

  // Report container dimensions to parent for fit-to-width/height. The
  // callback lives in a ref so its identity can never recycle the observer:
  // a freshly observe()d ResizeObserver always fires an initial delivery, so
  // recreating it per callback identity turns an unstable parent callback
  // into an infinite render loop (observed in the wild before the July 2026
  // OOM — see handleContainerResize in PdfPreview).
  const containerResizeRef = useRef(onContainerResize);
  containerResizeRef.current = onContainerResize;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      containerResizeRef.current?.(width, height);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Native dblclick listener for synctex
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDblClick = (e: MouseEvent) => {
      if (captureMode) return;
      const cb = synctexClickRef.current;
      if (!cb) return;

      const target = e.target as HTMLElement;
      const pageEl = target.closest(".mupdf-page") as HTMLElement | null;
      if (!pageEl) return;

      const pageNum = parseInt(
        pageEl.getAttribute("data-page-number") || "0",
        10,
      );
      if (pageNum === 0) return;

      const rect = pageEl.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;

      const currentScale = scaleRef.current;
      const pdfX = offsetX / currentScale;
      const pdfY = offsetY / currentScale;

      cb(pageNum, pdfX, pdfY);
    };

    container.addEventListener("dblclick", handleDblClick);
    return () => container.removeEventListener("dblclick", handleDblClick);
  }, [captureMode]);

  // Text selection detection via mouseup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let selectionTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelPendingSelection = () => {
      if (selectionTimer !== null) {
        clearTimeout(selectionTimer);
        selectionTimer = null;
      }
    };

    const handleMouseDown = () => {
      cancelPendingSelection();
    };

    const handleMouseUp = () => {
      if (captureMode) return;
      const cb = textSelectRef.current;
      if (!cb) return;

      cancelPendingSelection();

      selectionTimer = setTimeout(() => {
        selectionTimer = null;

        const sel = window.getSelection();
        const text = sel?.toString().trim();
        if (!text || text.length < 2) {
          cb(null);
          return;
        }

        const anchorEl = sel?.anchorNode?.parentElement;
        if (!anchorEl?.closest(".mupdf-text-layer")) {
          cb(null);
          return;
        }

        const pageEl = anchorEl.closest(".mupdf-page") as HTMLElement | null;
        const pageNum = pageEl
          ? parseInt(pageEl.getAttribute("data-page-number") || "1", 10)
          : 1;

        const range = sel!.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        let pdfX = 0;
        let pdfY = 0;
        let pdfWidth = 0;
        let pdfHeight = 0;
        if (pageEl) {
          const pageRect = pageEl.getBoundingClientRect();
          const currentScale = scaleRef.current;
          pdfX = (rect.left - pageRect.left) / currentScale;
          pdfY = (rect.top - pageRect.top) / currentScale;
          pdfWidth = rect.width / currentScale;
          pdfHeight = rect.height / currentScale;
        }

        cb({
          text,
          pageNumber: pageNum,
          position: { top: rect.bottom, left: rect.left },
          pdfX,
          pdfY,
          pdfWidth,
          pdfHeight,
        });
      }, 300);
    };

    container.addEventListener("mousedown", handleMouseDown);
    container.addEventListener("mouseup", handleMouseUp);
    return () => {
      cancelPendingSelection();
      container.removeEventListener("mousedown", handleMouseDown);
      container.removeEventListener("mouseup", handleMouseUp);
    };
  }, [captureMode]);

  // Fast-scroll (fling) detection: pages first painted during a fling render
  // at half resolution so painting keeps up with the scroll; they upgrade to
  // full quality when scrolling settles (MupdfPage handles the upgrade).
  const [fastScroll, setFastScroll] = useState(false);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isActive) return;

    let lastTop = container.scrollTop;
    let lastTime = performance.now();
    let settleTimer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      const now = performance.now();
      const dt = now - lastTime;
      const dy = Math.abs(container.scrollTop - lastTop);
      lastTop = container.scrollTop;
      lastTime = now;

      // > 3 px/ms ≈ flinging multiple pages per second
      if (dt > 0 && dt < 200 && dy / dt > 3) {
        setFastScroll(true);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => setFastScroll(false), 200);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (settleTimer) clearTimeout(settleTimer);
    };
  }, [pageSizes, isActive]);

  // Track current visible page on scroll
  const currentPageChangeRef = useRef(onCurrentPageChange);
  currentPageChangeRef.current = onCurrentPageChange;
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isActive) return;

    let rafId = 0;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const cb = currentPageChangeRef.current;
        if (cb) cb(getVisiblePage());
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    // Fire initial value
    handleScroll();
    return () => {
      container.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [pageSizes, isActive]);

  // Expose scrollToPage via ref
  useEffect(() => {
    if (!scrollToPageRef) return;
    scrollToPageRef.current = (
      page: number,
      options?: { record?: boolean },
    ) => {
      const container = containerRef.current;
      if (container) scrollToPage(container, page, options?.record ?? false);
    };
    return () => {
      if (scrollToPageRef) scrollToPageRef.current = null;
    };
  }, [scrollToPageRef, pageSizes]);

  // Keep the current history entry in step with ordinary scrolling, so going
  // back returns to where the reader actually was rather than where the last
  // jump happened to land.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isActive) return;

    let rafId = 0;
    const handleScroll = () => {
      if (rafId !== 0) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        historyRef.current = updateCurrent(
          historyRef.current,
          container.scrollTop,
        );
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (rafId !== 0) cancelAnimationFrame(rafId);
    };
  }, [isActive]);

  const navigateHistory = useCallback(
    (direction: "back" | "forward") => {
      const container = containerRef.current;
      if (!container) return;
      const step = (direction === "back" ? goBack : goForward)(
        historyRef.current,
      );
      if (!step) return;
      historyRef.current = step.history;
      container.scrollTop = step.target;
      syncHistoryState();
    },
    [syncHistoryState],
  );

  // Expose back/forward, and report their availability to the toolbar.
  useEffect(() => {
    if (!viewHistoryRef) return;
    viewHistoryRef.current = {
      back: () => navigateHistory("back"),
      forward: () => navigateHistory("forward"),
    };
    return () => {
      if (viewHistoryRef) viewHistoryRef.current = null;
    };
  }, [viewHistoryRef, navigateHistory]);

  useEffect(() => {
    onViewHistoryChange?.(historyState);
  }, [historyState, onViewHistoryChange]);

  // Switching to another document invalidates every recorded offset.
  useEffect(() => {
    historyRef.current = EMPTY_HISTORY;
    syncHistoryState();
  }, [rootFileId, syncHistoryState]);

  // Forward SyncTeX: center the resolved point, not merely the page, so a
  // location near the bottom of a long page is immediately visible.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !highlightLocation || !isActive) return;

    scrollToPage(container, highlightLocation.page);
    const frame = requestAnimationFrame(() => {
      const pageEl = container.querySelector(
        `[data-page-number="${highlightLocation.page}"]`,
      ) as HTMLElement | null;
      if (!pageEl) return;
      const targetTop =
        pageEl.offsetTop +
        highlightLocation.y * scaleRef.current -
        container.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: scrollBehavior(),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [highlightLocation, isActive, pageSizes]);

  // ── Find bar ──────────────────────────────────────────────────────────────

  // Read inside effects and callbacks that must not re-subscribe every time a
  // page of results streams in.
  const searchMatchesRef = useRef<PdfSearchMatch[]>([]);
  searchMatchesRef.current = searchMatches;

  const activeMatchData =
    activeMatch >= 0 ? searchMatches[activeMatch] : undefined;

  // page number → annotations on that page, with stable array identities.
  // An inline filter() here hands every MupdfPage a fresh array each render,
  // defeating its memo() and re-rendering all 200+ pages on any parent render.
  const reviewAnnotationsByPage = useMemo(() => {
    const byPage = new Map<number, MupdfReviewAnnotation[]>();
    for (const annotation of reviewAnnotations) {
      const existing = byPage.get(annotation.page);
      if (existing) existing.push(annotation);
      else byPage.set(annotation.page, [annotation]);
    }
    return byPage;
  }, [reviewAnnotations]);

  /** page number → every match rectangle on that page. */
  const searchRectsByPage = useMemo(() => {
    const byPage = new Map<number, Rect[]>();
    for (const match of searchMatches) {
      const existing = byPage.get(match.page);
      if (existing) existing.push(...match.rects);
      else byPage.set(match.page, [...match.rects]);
    }
    return byPage;
  }, [searchMatches]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // The input mounts with the bar, so focus on the next frame.
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
  }, []);

  const closeSearch = useCallback(() => {
    // Abandon any sweep still walking pages in the worker.
    searchGenRef.current++;
    setSearchOpen(false);
    setSearchMatches([]);
    setActiveMatch(-1);
    setSearching(false);
    setSearchTruncated(false);
    containerRef.current?.focus();
  }, []);

  const stepMatch = useCallback((delta: number) => {
    const total = searchMatchesRef.current.length;
    if (total === 0) return;
    setActiveMatch((current) =>
      current < 0 ? 0 : (current + delta + total) % total,
    );
  }, []);

  useEffect(() => {
    if (!openSearchRef) return;
    openSearchRef.current = openSearch;
    return () => {
      if (openSearchRef) openSearchRef.current = null;
    };
  }, [openSearchRef, openSearch]);

  // Sweep the document for the current query. Debounced: without it every
  // keystroke starts a full-document sweep, and each page costs a structured
  // text extraction in the worker.
  useEffect(() => {
    const gen = ++searchGenRef.current;
    const needle = searchQuery.trim();

    if (!searchOpen || !needle || numPages === 0 || docIdRef.current <= 0) {
      setSearchMatches([]);
      setActiveMatch(-1);
      setSearching(false);
      setSearchTruncated(false);
      return;
    }

    setSearching(true);
    setSearchTruncated(false);
    const startPage = getVisiblePage();

    const timer = setTimeout(() => {
      const docId = docIdRef.current;
      const client = getMupdfClient();
      const isStale = () => searchGenRef.current !== gen;

      searchPdfPages(
        (pageIndex, text, maxHits) =>
          client.searchPage(docId, pageIndex, text, maxHits),
        numPages,
        needle,
        {
          isCancelled: isStale,
          onPartial: (matches) => {
            if (isStale()) return;
            setSearchMatches(matches);
            // Select a match as soon as one exists so next/previous work while
            // the rest of the document is still being swept.
            setActiveMatch((current) =>
              current === -1 && matches.length > 0
                ? firstMatchFromPage(matches, startPage)
                : current,
            );
          },
        },
      )
        .then((result) => {
          if (isStale()) return;
          setSearchMatches(result.matches);
          setSearchTruncated(result.truncated);
          setActiveMatch((current) =>
            current === -1 && result.matches.length > 0
              ? firstMatchFromPage(result.matches, startPage)
              : current,
          );
          setSearching(false);
        })
        .catch((error: unknown) => {
          if (isStale()) return;
          log.error("PDF search failed", { message: String(error) });
          setSearching(false);
        });
    }, 250);

    return () => clearTimeout(timer);
    // pageSizes changes identity on reload, which re-runs the search against
    // the recompiled document.
  }, [searchQuery, searchOpen, numPages, pageSizes]);

  // Centre the active match. Deliberately keyed off the active index rather
  // than the match array, so results streaming in mid-sweep don't yank the
  // viewport away from the user.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !searchOpen || activeMatch < 0) return;
    const match = searchMatchesRef.current[activeMatch];
    if (!match) return;

    const frame = requestAnimationFrame(() => {
      const pageEl = container.querySelector(
        `[data-page-number="${match.page}"]`,
      ) as HTMLElement | null;
      if (!pageEl) {
        scrollToPage(container, match.page);
        return;
      }
      const matchTop = Math.min(...match.rects.map((rect) => rect.y));
      const targetTop =
        pageEl.offsetTop +
        matchTop * scaleRef.current -
        container.clientHeight / 2;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: scrollBehavior(),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeMatch, searchOpen, searchQuery]);

  // Dismiss selection toolbar on scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const cb = textSelectRef.current;
      if (cb) cb(null);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Pinch-to-zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onScaleChange) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.005;
        onScaleChange(Math.max(0.25, Math.min(4, scale + delta)));
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [scale, onScaleChange]);

  // Keyboard zoom (Cmd/Ctrl +/-) — scoped to container to avoid affecting other panels
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onScaleChange) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        onScaleChange(Math.min(4, scale + 0.25));
      } else if (e.key === "-") {
        e.preventDefault();
        onScaleChange(Math.max(0.25, scale - 0.25));
      } else if (e.key === "0") {
        e.preventDefault();
        onScaleChange(1);
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [scale, onScaleChange]);

  // The reference card opened by clicking a citation. Held in a ref as well so
  // the click interceptor below can reach it without re-subscribing.
  const citationPopup = useCitationPopup(containerRef);
  const citationPopupRef = useRef(citationPopup);
  citationPopupRef.current = citationPopup;

  // Intercept link clicks
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (!anchor.closest(".mupdf-link-layer")) return;

      // Stopping propagation here also keeps this click from reaching the
      // card's own dismiss-on-outside-click listener on the document.
      e.preventDefault();
      e.stopPropagation();

      // A citation shows its reference instead of jumping straight to the
      // bibliography; the card offers the jump as one of its actions.
      if (anchor.dataset.citeKey) {
        citationPopupRef.current.openForAnchor(anchor);
        return;
      }

      citationPopupRef.current.close();
      const href = anchor.getAttribute("href");
      if (!href) return;

      openPdfHref(href);
    };

    container.addEventListener("click", handleClick, true);
    return () => container.removeEventListener("click", handleClick, true);
  }, [openPdfHref]);

  // The capture tool and the review highlighter share the drag-a-box gesture.
  const dragMode = captureMode
    ? ("capture" as const)
    : highlightPlacementMode
      ? ("highlight" as const)
      : null;

  // ESC during a drag mode: cancel drag (or capture mode itself)
  useEffect(() => {
    if (!dragMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dragStart) {
          setDragStart(null);
          setDragEnd(null);
        } else if (captureMode) {
          onCancelCapture?.();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dragMode, captureMode, dragStart, onCancelCapture]);

  // Drag to select a region
  const handleCaptureMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!dragMode || e.button !== 0) return;
      const target = e.target as HTMLElement;
      const pageEl = target.closest(".mupdf-page") as HTMLElement | null;
      if (!pageEl) return;
      const pageNum = parseInt(
        pageEl.getAttribute("data-page-number") || "0",
        10,
      );
      if (!pageNum) return;
      setDragPageNum(pageNum);
      setDragStart({ x: e.clientX, y: e.clientY });
      setDragEnd(null);
    },
    [dragMode],
  );

  const handleCaptureMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragMode || !dragStart) return;
      setDragEnd({ x: e.clientX, y: e.clientY });
    },
    [dragMode, dragStart],
  );

  const handleCaptureMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!dragMode || !dragStart) {
        setDragStart(null);
        setDragEnd(null);
        return;
      }
      const end = { x: e.clientX, y: e.clientY };
      const w = Math.abs(end.x - dragStart.x);
      const h = Math.abs(end.y - dragStart.y);

      // Highlighter: convert the dragged box to page-relative PDF coordinates.
      if (dragMode === "highlight") {
        setDragStart(null);
        setDragEnd(null);
        if (w < 6 || h < 6 || !onPlaceHighlight) return;
        const pageEl = containerRef.current?.querySelector(
          `.mupdf-page[data-page-number="${dragPageNum}"]`,
        ) as HTMLElement | null;
        if (!pageEl) return;
        const pageRect = pageEl.getBoundingClientRect();
        const left = Math.max(0, Math.min(dragStart.x, end.x) - pageRect.left);
        const top = Math.max(0, Math.min(dragStart.y, end.y) - pageRect.top);
        const currentScale = scaleRef.current;
        onPlaceHighlight({
          kind: "text",
          page: dragPageNum,
          x: left / currentScale,
          y: top / currentScale,
          width: Math.min(pageRect.width - left, w) / currentScale,
          height: Math.min(pageRect.height - top, h) / currentScale,
          selectedText: "",
        });
        return;
      }

      if (w < 10 || h < 10 || !onCapture) {
        setDragStart(null);
        setDragEnd(null);
        return;
      }

      const pageEl = containerRef.current?.querySelector(
        `.mupdf-page[data-page-number="${dragPageNum}"]`,
      ) as HTMLElement | null;
      const sourceCanvas = pageEl?.querySelector(
        "canvas",
      ) as HTMLCanvasElement | null;
      if (!pageEl || !sourceCanvas) {
        setDragStart(null);
        setDragEnd(null);
        return;
      }

      const pageRect = pageEl.getBoundingClientRect();
      const selLeft = Math.max(0, Math.min(dragStart.x, end.x) - pageRect.left);
      const selTop = Math.max(0, Math.min(dragStart.y, end.y) - pageRect.top);
      const selW = Math.min(pageRect.width - selLeft, w);
      const selH = Math.min(pageRect.height - selTop, h);

      const scaleX = sourceCanvas.width / pageRect.width;
      const scaleY = sourceCanvas.height / pageRect.height;
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = selW * scaleX;
      cropCanvas.height = selH * scaleY;
      const ctx = cropCanvas.getContext("2d")!;
      ctx.drawImage(
        sourceCanvas,
        selLeft * scaleX,
        selTop * scaleY,
        selW * scaleX,
        selH * scaleY,
        0,
        0,
        cropCanvas.width,
        cropCanvas.height,
      );

      const currentScale = scaleRef.current;
      const pdfX = selLeft / currentScale;
      const pdfY = selTop / currentScale;

      onCapture({
        dataUrl: cropCanvas.toDataURL("image/png"),
        pageNumber: dragPageNum,
        pdfX,
        pdfY,
      });

      setDragStart(null);
      setDragEnd(null);
    },
    [dragMode, dragStart, dragPageNum, onCapture, onPlaceHighlight],
  );

  // Text layer click for onTextClick; in comment-placement mode the click
  // instead drops a point comment at the clicked PDF location.
  const handleTextLayerClick = useCallback(
    (e: React.MouseEvent) => {
      if (commentPlacementMode && onPlacePointComment) {
        // A drag-selection also ends in a click on the ancestor — selecting
        // text should open the selection toolbar, not drop a pin.
        if (window.getSelection()?.toString().trim()) return;
        const target = e.target as HTMLElement;
        const pageEl = target.closest(".mupdf-page") as HTMLElement | null;
        if (!pageEl) return;
        const page = parseInt(
          pageEl.getAttribute("data-page-number") || "0",
          10,
        );
        if (!page) return;
        const pageRect = pageEl.getBoundingClientRect();
        const currentScale = scaleRef.current;
        onPlacePointComment({
          kind: "point",
          page,
          x: (e.clientX - pageRect.left) / currentScale,
          y: (e.clientY - pageRect.top) / currentScale,
          width: 12,
          height: 12,
          selectedText: "",
        });
        return;
      }
      if (!onTextClick) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "text" && target.closest(".mupdf-text-layer")) {
        const text = target.textContent?.trim();
        if (text && text.length > 2) {
          onTextClick(text);
        }
      }
    },
    [onTextClick, commentPlacementMode, onPlacePointComment],
  );

  const selRect =
    dragStart && dragEnd
      ? {
          left: Math.min(dragStart.x, dragEnd.x),
          top: Math.min(dragStart.y, dragEnd.y),
          width: Math.abs(dragEnd.x - dragStart.x),
          height: Math.abs(dragEnd.y - dragStart.y),
        }
      : null;

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    const pageEl = target.closest(".mupdf-page") as HTMLElement | null;
    const page = pageEl
      ? parseInt(pageEl.getAttribute("data-page-number") || "0", 10)
      : 0;
    const pageRect = pageEl?.getBoundingClientRect();
    const currentScale = scaleRef.current;
    const selection = window.getSelection();
    const selectionAnchor = selection?.anchorNode?.parentElement;
    const selectedText =
      selectionAnchor && containerRef.current?.contains(selectionAnchor)
        ? (selection?.toString().trim() ?? "")
        : "";
    const selectionRange =
      selectedText && selection?.rangeCount
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
    const selectionPage = selectionAnchor?.closest(
      ".mupdf-page",
    ) as HTMLElement | null;
    const selectionPageRect = selectionPage?.getBoundingClientRect();
    const selectionPageNumber = selectionPage
      ? parseInt(selectionPage.getAttribute("data-page-number") || "0", 10)
      : 0;
    const anchor = target.closest("a") as HTMLAnchorElement | null;
    const reviewTarget: PdfReviewTarget =
      selectionRange && selectionPageRect && selectionPageNumber
        ? {
            kind: "text",
            page: selectionPageNumber,
            x: (selectionRange.left - selectionPageRect.left) / currentScale,
            y: (selectionRange.top - selectionPageRect.top) / currentScale,
            width: selectionRange.width / currentScale,
            height: selectionRange.height / currentScale,
            selectedText,
          }
        : {
            kind: "point",
            page,
            x: pageRect ? (event.clientX - pageRect.left) / currentScale : 0,
            y: pageRect ? (event.clientY - pageRect.top) / currentScale : 0,
            width: 12,
            height: 12,
            selectedText: "",
          };

    setContextTarget({
      page,
      x: pageRect ? (event.clientX - pageRect.left) / currentScale : 0,
      y: pageRect ? (event.clientY - pageRect.top) / currentScale : 0,
      selectedText,
      href: anchor?.getAttribute("href") ?? null,
      reviewTarget,
    });
  }, []);

  const handleContainerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key === "Escape" && searchOpen) {
        event.preventDefault();
        closeSearch();
        return;
      }
      // Alt+Arrow is the browser convention for back and forward.
      if (
        event.altKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        navigateHistory(event.key === "ArrowLeft" ? "back" : "forward");
      }
    },
    [openSearch, closeSearch, searchOpen, navigateHistory],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={captureMode}>
          <div
            ref={containerRef}
            tabIndex={-1}
            {...{ [LOCAL_ZOOM_SHORTCUTS_ATTR]: "true" }}
            className={`pdf-scroll-area min-h-0 flex-1 overflow-auto outline-none ${
              simplePreview ? "pdf-simple" : ""
            }`}
            onKeyDown={handleContainerKeyDown}
            style={{
              cursor:
                dragMode || commentPlacementMode ? "crosshair" : undefined,
              // Drag modes draw a box — suppress incidental text selection.
              userSelect: dragMode ? "none" : undefined,
            }}
            onContextMenu={handleContextMenu}
            onMouseDownCapture={() => containerRef.current?.focus()}
            onMouseDown={handleCaptureMouseDown}
            onMouseMove={handleCaptureMouseMove}
            onMouseUp={handleCaptureMouseUp}
          >
            <div
              ref={contentRef}
              className="pdf-paper-stack flex min-w-fit flex-col items-center gap-7 p-7"
              onClick={handleTextLayerClick}
            >
              {loading && numPages === 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoaderIcon className="size-4 animate-spin" />
                  Loading PDF...
                </div>
              )}
              {pageSizes.map((size, i) => (
                <MupdfPage
                  key={i}
                  docId={docIdRef.current}
                  pageIndex={i}
                  scale={scale}
                  pageWidth={size.width}
                  pageHeight={size.height}
                  isVisible={visiblePages.has(i + 1)}
                  fastScroll={fastScroll}
                  highlight={
                    highlightLocation?.page === i + 1 ? highlightLocation : null
                  }
                  reviewAnnotations={reviewAnnotationsByPage.get(i + 1)}
                  selectedReviewAnnotationId={selectedReviewAnnotationId}
                  onSelectReviewAnnotation={onSelectReviewAnnotation}
                  searchRects={
                    searchOpen ? searchRectsByPage.get(i + 1) : undefined
                  }
                  activeSearchRects={
                    searchOpen && activeMatchData?.page === i + 1
                      ? activeMatchData.rects
                      : undefined
                  }
                />
              ))}
            </div>
            {selRect && (
              <div
                className={
                  dragMode === "highlight"
                    ? `pointer-events-none fixed rounded-sm ring-1 ${resolveReviewHighlightColor(highlightColor).preview}`
                    : "pointer-events-none fixed border-2 border-primary bg-primary/10"
                }
                style={selRect}
              />
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-56">
          <ContextMenuItem
            disabled={!onSynctexClick || !contextTarget?.page}
            onSelect={() => {
              if (!contextTarget?.page) return;
              onSynctexClick?.(
                contextTarget.page,
                contextTarget.x,
                contextTarget.y,
              );
            }}
          >
            <FileTextIcon />
            Go to source location
          </ContextMenuItem>
          {onAddReviewComment && (
            <ContextMenuItem
              disabled={!contextTarget?.page}
              onSelect={() => {
                if (contextTarget?.page) {
                  onAddReviewComment(contextTarget.reviewTarget);
                }
              }}
            >
              <MessageSquarePlusIcon />
              Add review comment
            </ContextMenuItem>
          )}
          {contextTarget?.href && (
            <>
              <ContextMenuItem
                onSelect={() => openPdfHref(contextTarget.href!)}
              >
                <ExternalLinkIcon />
                Open link
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() =>
                  void navigator.clipboard.writeText(contextTarget.href!)
                }
              >
                <LinkIcon />
                Copy link
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={!contextTarget?.selectedText}
            onSelect={() => {
              if (contextTarget?.selectedText) {
                void navigator.clipboard.writeText(contextTarget.selectedText);
              }
            }}
          >
            <CopyIcon />
            Copy selected text
          </ContextMenuItem>
          {onStartCapture && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={onStartCapture}>
                <CrosshairIcon />
                Capture &amp; Ask
                <ContextMenuShortcut>
                  {navigator.userAgent.includes("Mac") ? "⌘X" : "Ctrl+X"}
                </ContextMenuShortcut>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {citationPopup.open && (
        <CitationCard
          preview={citationPopup.open.preview}
          anchorRect={citationPopup.open.rect}
          onGoToReference={
            citationPopup.open.href?.includes("#page=")
              ? () => {
                  const href = citationPopup.open?.href;
                  citationPopup.close();
                  if (href) openPdfHref(href);
                }
              : undefined
          }
          onEditEntry={
            onOpenBibEntry && citationPopup.open.preview.entry
              ? () => {
                  const entry = citationPopup.open?.preview.entry;
                  citationPopup.close();
                  if (entry) onOpenBibEntry(entry.fileId, entry.from);
                }
              : undefined
          }
          onOpenLink={(url) => {
            citationPopup.close();
            openPdfHref(url);
          }}
        />
      )}

      {searchOpen && (
        <div className="absolute top-2 right-4 z-20 flex items-center gap-1 rounded-md border border-border bg-popover/95 p-1 shadow-md backdrop-blur">
          <SearchIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                stepMatch(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeSearch();
              }
            }}
            placeholder="Find in document"
            aria-label="Find in document"
            className="h-6 w-44 bg-transparent px-1 text-foreground text-xs outline-none placeholder:text-muted-foreground"
          />
          <span className="min-w-16 shrink-0 text-center text-[11px] text-muted-foreground tabular-nums">
            {searchQuery.trim() === ""
              ? ""
              : searching && searchMatches.length === 0
                ? "Searching…"
                : searchMatches.length === 0
                  ? "No results"
                  : `${Math.max(1, activeMatch + 1)} of ${
                      searchMatches.length
                    }${searchTruncated ? "+" : ""}`}
          </span>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            disabled={searchMatches.length === 0}
            onClick={() => stepMatch(-1)}
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
          >
            <ChevronUpIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            disabled={searchMatches.length === 0}
            onClick={() => stepMatch(1)}
            title="Next match (Enter)"
            aria-label="Next match"
          >
            <ChevronDownIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={closeSearch}
            title="Close find bar (Esc)"
            aria-label="Close find bar"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
