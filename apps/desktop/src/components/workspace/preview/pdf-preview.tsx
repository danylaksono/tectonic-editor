import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  FileTextIcon,
  CheckCircle2Icon,
  SpellCheckIcon,
  AlertCircleIcon,
  LoaderIcon,
  RefreshCwIcon,
  MinusIcon,
  PlusIcon,
  DownloadIcon,
  HistoryIcon,
  MousePointerClickIcon,
  CrosshairIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  MessageSquarePlusIcon,
  MessageSquareTextIcon,
  Minimize2Icon,
  HighlighterIcon,
  CheckIcon,
  SparklesIcon,
  GaugeIcon,
  SearchIcon,
  CopyIcon,
} from "lucide-react";
import { toast } from "sonner";
import { writeFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import {
  useDocumentStore,
  getPdfBytes,
  getCurrentPdfBytes,
  hasPdfData,
} from "@/stores/document-store";
import { useHistoryStore } from "@/stores/history-store";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { usePreviewStore } from "@/stores/preview-store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { HistoryPanel } from "@/components/workspace/history-panel";
import {
  compileLatex,
  synctexEdit,
  resolveCompileTarget,
  formatCompileError,
  effectiveCompileProfile,
  profilesEqual,
  type CompileFailure,
} from "@/lib/latex-compiler";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorBoundary } from "react-error-boundary";
import {
  SelectionToolbar,
  type ToolbarAction,
} from "@/components/workspace/editor/selection-toolbar";
import { save } from "@tauri-apps/plugin-dialog";
import {
  PdfViewer,
  type PdfHighlightLocation,
  type PdfReviewAnnotation,
  type PdfReviewTarget,
  type PdfTextSelection,
  type CaptureResult,
  type PdfViewHistoryControls,
  type PdfViewHistoryState,
} from "./pdf-viewer";
import { resolveTexRoot } from "@/stores/document-store";
import { createLogger } from "@/lib/debug/logger";
import {
  useReviewStore,
  type ReviewComment,
  type ReviewSourceLocation,
} from "@/stores/review-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  ReviewCommentDialog,
  ReviewCommentsPanel,
  type ReviewCommentDraft,
} from "./review-comments-panel";
import { runOneShotPrompt } from "@/lib/ai/one-shot";
import {
  buildExplainCompileErrorPrompt,
  EXPLAIN_ERROR_SYSTEM_PROMPT,
} from "@/lib/ai/explain-compile-error";
import { MarkdownRenderer } from "@/components/ai-chat/markdown-renderer";
import { suggestCompileFix } from "@/lib/latex-guidance";
import { zoomCache, type FitMode } from "./zoom-cache";
import {
  REVIEW_HIGHLIGHT_COLORS,
  resolveReviewHighlightColor,
} from "@/lib/review-colors";

const log = createLogger("pdf-preview");

/** Max number of PdfViewer instances kept alive simultaneously. */
const MAX_ALIVE_VIEWERS = 5;

const ZOOM_OPTIONS = [
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
  { value: "1.5", label: "150%" },
  { value: "2", label: "200%" },
  { value: "3", label: "300%" },
  { value: "4", label: "400%" },
];

interface CompileErrorDetailsProps {
  failure: CompileFailure;
  errors: string[];
  compilerBackend: string;
  rootFileName: string;
  errorExplanation: string | null;
  isExplaining: boolean;
  aiProvider: string;
  onRetry: () => void;
  onExplain: () => void;
  onFixWithChat: () => void;
  /** Jump to the error location in the editor. Absent when the source file
   *  could not be matched to a project file. */
  onGoToSource?: () => void;
}

/** The "what happened / where / suggested action" panel for a failed
 *  compile. Shared between the full-page error state (no PDF available yet)
 *  and the dialog reachable from the "showing stale PDF" banner, so error
 *  details stay reachable even when an earlier successful compile is still
 *  on screen. */
function CompileErrorDetails({
  failure,
  errors,
  compilerBackend,
  rootFileName,
  errorExplanation,
  isExplaining,
  aiProvider,
  onRetry,
  onExplain,
  onFixWithChat,
  onGoToSource,
}: CompileErrorDetailsProps) {
  const locationLabel = `${failure.sourceFile ?? rootFileName}${
    failure.sourceLine ? `, line ${failure.sourceLine}` : ""
  }`;
  return (
    <div className="w-full max-w-lg">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
          <AlertCircleIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-base text-destructive">
              Compilation failed
            </h2>
            <span className="rounded-full bg-destructive/15 px-2 py-0.5 font-medium text-destructive text-xs">
              {errors.length} {errors.length === 1 ? "error" : "errors"}
            </span>
          </div>
          <p className="mt-1 truncate text-muted-foreground text-xs">
            {failure.backend === "unknown" ? compilerBackend : failure.backend}
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-destructive/20 bg-background">
        <div className="space-y-2 border-b p-3 text-sm">
          <div>
            <span className="font-medium">What happened:</span>{" "}
            {failure.summary}
          </div>
          <div>
            <span className="font-medium">Where:</span>{" "}
            {onGoToSource ? (
              <button
                type="button"
                onClick={onGoToSource}
                title="Go to this location in the editor"
                className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
              >
                {locationLabel}
              </button>
            ) : (
              locationLabel
            )}
          </div>
          <div>
            <span className="font-medium">Suggested action:</span>{" "}
            {suggestCompileFix(failure.rawEngineOutput, failure.category)}
          </div>
        </div>
        <div className="max-h-60 divide-y divide-border overflow-y-auto">
          {errors.map((error, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3 py-2.5">
              <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive/70" />
              <span className="text-foreground text-sm">{error}</span>
            </div>
          ))}
        </div>
        {errorExplanation !== null && (
          <div className="border-t p-3">
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
              <SparklesIcon className="size-3.5" />
              AI explanation
              {isExplaining && <LoaderIcon className="size-3 animate-spin" />}
            </div>
            <div className="max-h-64 overflow-y-auto">
              <MarkdownRenderer
                content={errorExplanation}
                className="prose prose-sm dark:prose-invert max-w-none text-sm"
              />
            </div>
          </div>
        )}
        <details className="border-t p-3">
          <summary className="cursor-pointer text-muted-foreground text-xs">
            Technical details
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
            {failure.rawEngineOutput}
          </pre>
        </details>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-7 gap-1.5 px-2.5 text-xs"
        >
          <RefreshCwIcon className="size-3.5" />
          Retry
        </Button>
        {aiProvider !== "none" && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={onExplain}
              disabled={isExplaining}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <SparklesIcon className="size-3.5" />
              {isExplaining ? "Explaining…" : "Explain error"}
            </Button>
            <Button
              size="sm"
              onClick={onFixWithChat}
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <MousePointerClickIcon className="size-3.5" />
              Fix with Chat
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function PdfPreview() {
  const compilerBackend = useSettingsStore((s) => s.compilerBackend);
  const setCompilerBackend = useSettingsStore((s) => s.setCompilerBackend);
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const pdfRevision = useDocumentStore((s) => s.pdfRevision);
  const compileError = useDocumentStore((s) => s.compileError);
  const isCompiling = useDocumentStore((s) => s.isCompiling);

  // Estimated compile progress. LaTeX gives no true progress signal, so this
  // is elapsed time vs. the previous build's duration, capped at 99% — shown
  // only when the last build was slow enough for an estimate to be useful.
  const [compileProgress, setCompileProgress] = useState<{
    percent: number;
    remainingSec: number;
  } | null>(null);
  useEffect(() => {
    if (!isCompiling) {
      setCompileProgress(null);
      return;
    }
    const expected =
      useDocumentStore.getState().lastCompileStats?.durationMs ?? 0;
    if (expected < 3000) return; // fast builds: the spinner alone is fine
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      setCompileProgress({
        percent: Math.min(99, Math.round((elapsed / expected) * 100)),
        remainingSec: Math.max(0, Math.ceil((expected - elapsed) / 1000)),
      });
    };
    tick();
    const timer = setInterval(tick, 500);
    return () => {
      clearInterval(timer);
      setCompileProgress(null);
    };
  }, [isCompiling]);
  const isSaving = useDocumentStore((s) => s.isSaving);
  const contentGeneration = useDocumentStore((s) => s.contentGeneration);
  const setPdfData = useDocumentStore((s) => s.setPdfData);
  const setCompileError = useDocumentStore((s) => s.setCompileError);
  const setIsCompiling = useDocumentStore((s) => s.setIsCompiling);
  const content = useDocumentStore((s) => s.content);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const files = useDocumentStore((s) => s.files);
  const saveAllFiles = useDocumentStore((s) => s.saveAllFiles);
  const setActiveFile = useDocumentStore((s) => s.setActiveFile);
  const activeFile = useDocumentStore((s) => {
    return s.files.find((f) => f.id === s.activeFileId) ?? null;
  });

  // AI explanation of the current compile error (one-shot, outside chat)
  const [errorExplanation, setErrorExplanation] = useState<string | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const explainCancelRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    // A new compile result invalidates any in-flight or shown explanation
    explainCancelRef.current?.();
    explainCancelRef.current = null;
    setErrorExplanation(null);
    setIsExplaining(false);
  }, [compileError]);
  useEffect(() => () => explainCancelRef.current?.(), []);
  const requestJumpToPosition = useDocumentStore(
    (s) => s.requestJumpToPosition,
  );

  const [pdfError, setPdfError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const setStatusPageCount = usePreviewStore((state) => state.setPageCount);
  const setStatusCurrentPage = usePreviewStore((state) => state.setCurrentPage);
  const locationRequest = usePreviewStore((state) => state.locationRequest);
  const requestPdfLocation = usePreviewStore((state) => state.requestLocation);
  const clearLocationRequest = usePreviewStore(
    (state) => state.clearLocationRequest,
  );
  const reviewMode = useWorkspaceLayoutStore((state) => state.reviewMode);
  const setReviewMode = useWorkspaceLayoutStore((state) => state.setReviewMode);
  const readerMode = useWorkspaceLayoutStore((state) => state.readerMode);
  const setReaderMode = useWorkspaceLayoutStore((state) => state.setReaderMode);
  const reviewComments = useReviewStore((state) => state.comments);
  const reviewLoading = useReviewStore((state) => state.loading);
  const loadReviewProject = useReviewStore((state) => state.loadProject);
  const clearReviewProject = useReviewStore((state) => state.clearProject);
  const addReviewComment = useReviewStore((state) => state.addComment);
  const setReviewCommentStatus = useReviewStore(
    (state) => state.setCommentStatus,
  );
  const deleteReviewComment = useReviewStore((state) => state.deleteComment);
  const addReviewReply = useReviewStore((state) => state.addReply);
  const [pageInputValue, setPageInputValue] = useState<string>("1");
  const [isEditingPage, setIsEditingPage] = useState(false);
  const scrollToPageRef = useRef<
    ((page: number, options?: { record?: boolean }) => void) | null
  >(null);
  const openPdfSearchRef = useRef<(() => void) | null>(null);
  const viewHistoryRef = useRef<PdfViewHistoryControls | null>(null);
  const [viewHistory, setViewHistory] = useState<PdfViewHistoryState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [scale, setScale] = useState<number>(1.0);
  const [captureMode, setCaptureMode] = useState(false);
  const [synctexHighlight, setSynctexHighlight] =
    useState<PdfHighlightLocation | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ReviewCommentDraft | null>(
    null,
  );
  const reviewHighlightColor = useSettingsStore(
    (state) => state.reviewHighlightColor,
  );
  const setReviewHighlightColor = useSettingsStore(
    (state) => state.setReviewHighlightColor,
  );
  // Armed tool while review mode is on: drag-a-box highlighter or
  // click-to-pin comments. "none" leaves the PDF in plain browse mode.
  const [reviewTool, setReviewTool] = useState<
    "none" | "highlight" | "comment"
  >("none");
  useEffect(() => {
    if (!reviewMode) setReviewTool("none");
  }, [reviewMode]);
  const [fitMode, setFitMode] = useState<FitMode>(null);
  const [containerSize, setContainerSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [firstPageSize, setFirstPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const hasInitialCompile = useRef(false);
  const initialized = useDocumentStore((s) => s.initialized);

  // Derive pdfData from external cache, re-read whenever pdfRevision bumps
  const pdfData = useMemo(() => getCurrentPdfBytes(), [pdfRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep-alive: track which root files have PdfViewer instances alive (LRU order)
  const currentRootFileId = resolveTexRoot(activeFile?.id ?? "", files);
  useEffect(() => {
    setStatusPageCount(0);
    setStatusCurrentPage(1);
  }, [
    currentRootFileId,
    pdfRevision,
    setStatusCurrentPage,
    setStatusPageCount,
  ]);
  const lastCompiledGeneration = useDocumentStore((s) =>
    currentRootFileId
      ? s.lastCompiledGenerations.get(currentRootFileId)
      : undefined,
  );
  const rootEntry = files.find((f) => f.id === currentRootFileId);
  const rootFileName = rootEntry?.relativePath ?? "main.tex";
  // Whether the project has a compilable .tex root — compiling works from any
  // active file (.bib, .sty, images), so gate on the root, not the active file.
  const isCompilable = rootEntry?.type === "tex" || files.length === 0;

  // Fast-preview build options and the profile of the currently displayed PDF
  const fastCompile = useDocumentStore((s) => s.fastCompile);
  const setFastCompile = useDocumentStore((s) => s.setFastCompile);
  const displayedBuildProfile = useDocumentStore(
    (s) => s.pdfBuildProfiles.get(currentRootFileId) ?? null,
  );
  const fastCompileActive =
    fastCompile.onlyCurrentChapter ||
    fastCompile.skipFigures ||
    fastCompile.singlePass;
  const partialPreviewLabel = displayedBuildProfile
    ? [
        displayedBuildProfile.includeOnly
          ? `${displayedBuildProfile.includeOnly} only`
          : null,
        displayedBuildProfile.draft ? "no figures" : null,
        displayedBuildProfile.singlePass ? "single pass" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const runFullBuild = () => {
    setFastCompile({
      onlyCurrentChapter: false,
      skipFigures: false,
      singlePass: false,
    });
    handleCompile(true);
  };

  // Normalized compile failure, available regardless of whether a stale PDF
  // is still on screen — so error details stay reachable even when the
  // full-page error state (which only shows when there's no PDF at all) is
  // bypassed by an earlier successful compile.
  const compileFailure = useMemo<CompileFailure | null>(() => {
    if (!compileError) return null;
    return typeof compileError === "string"
      ? formatCompileError(compileError)
      : compileError;
  }, [compileError]);
  const compileFailureMessages = useMemo(() => {
    if (!compileFailure) return [];
    return [
      ...new Set(
        compileFailure.rawEngineOutput
          .split(/\s*!\s*/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s !== "Compilation failed"),
      ),
    ];
  }, [compileFailure]);
  const [staleErrorDialogOpen, setStaleErrorDialogOpen] = useState(false);
  useEffect(() => {
    // A fresh compile (success or new failure) invalidates the dialog's
    // stale contents — close it rather than show a leftover error.
    setStaleErrorDialogOpen(false);
  }, [compileError]);
  const documentReviewComments = useMemo(
    () =>
      reviewComments.filter((comment) => comment.documentRoot === rootFileName),
    [reviewComments, rootFileName],
  );
  const reviewAnnotations: PdfReviewAnnotation[] = useMemo(
    () =>
      documentReviewComments.map((comment) => ({
        id: comment.id,
        page: comment.anchor.page,
        x: comment.anchor.x,
        y: comment.anchor.y,
        width: comment.anchor.width,
        height: comment.anchor.height,
        kind: comment.anchor.kind,
        annotationKind: comment.kind,
        status: comment.status,
        color: comment.color,
      })),
    [documentReviewComments],
  );
  const previewIsStale =
    !!pdfData &&
    isCompilable &&
    lastCompiledGeneration !== undefined &&
    contentGeneration !== lastCompiledGeneration;
  const [aliveOrder, setAliveOrder] = useState<string[]>([]);
  const prevRootRef = useRef(currentRootFileId);

  useEffect(() => {
    if (!projectRoot) {
      clearReviewProject();
      return;
    }
    if (useReviewStore.getState().projectRoot !== projectRoot) {
      void loadReviewProject(projectRoot);
    }
  }, [projectRoot, loadReviewProject, clearReviewProject]);

  // Save/restore zoom state per root file on switch
  useEffect(() => {
    const prev = prevRootRef.current;
    if (prev && prev !== currentRootFileId) {
      // Save previous root's zoom
      zoomCache.set(prev, { scale, fitMode });
    }
    // Restore new root's zoom
    const cached = zoomCache.get(currentRootFileId);
    if (cached) {
      setScale(cached.scale);
      setFitMode(cached.fitMode);
    }
    prevRootRef.current = currentRootFileId;
  }, [currentRootFileId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update alive set when active root changes and has PDF data
  useEffect(() => {
    if (!currentRootFileId || !pdfData) return;
    setAliveOrder((prev) => {
      if (prev[0] === currentRootFileId) return prev; // already at front
      const without = prev.filter((id) => id !== currentRootFileId);
      return [currentRootFileId, ...without].slice(0, MAX_ALIVE_VIEWERS);
    });
  }, [currentRootFileId, pdfData]);

  // PDF text selection toolbar
  const [pdfSelection, setPdfSelection] = useState<PdfTextSelection | null>(
    null,
  );
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const handleTextClick = useCallback(
    (text: string) => {
      let index = content.indexOf(text);
      if (index === -1) {
        const cleanText = text.replace(/[{}\\$]/g, "");
        if (cleanText.length > 2) index = content.indexOf(cleanText);
      }
      if (index === -1 && text.length > 5) {
        const words = text.split(/\s+/).filter((w) => w.length > 3);
        for (const word of words) {
          index = content.indexOf(word);
          if (index !== -1) break;
        }
      }
      if (index !== -1) requestJumpToPosition(index);
    },
    [content, requestJumpToPosition],
  );

  /** Open a project file (by path relative to the project root) and move the
   *  cursor to a 1-based line and optional column. Shared by SyncTeX clicks
   *  and the compile-error "Where:" link. */
  const jumpToFileLine = useCallback(
    (file: string, line: number, column = 0) => {
      const normalize = (p: string) =>
        p.replace(/\\/g, "/").replace(/^\.\//, "");
      const normalizedTarget = normalize(file);
      const targetFile = files.find(
        (f) => normalize(f.relativePath) === normalizedTarget,
      );
      if (!targetFile) return;

      const state = useDocumentStore.getState();
      const needsSwitch = state.activeFileId !== targetFile.id;
      // Both review and reader mode hide the editor — a jump into source has
      // to bring it back before the cursor move means anything.
      const leavingReview = reviewMode || readerMode;
      if (reviewMode) setReviewMode(false);
      if (readerMode) setReaderMode(false);
      if (needsSwitch) {
        setActiveFile(targetFile.id);
      }

      const fileContent = targetFile.content ?? "";
      const fileLines = fileContent.split("\n");
      const targetLine = Math.max(1, Math.min(line, fileLines.length));
      let offset = 0;
      for (let i = 0; i < targetLine - 1; i++) {
        offset += fileLines[i].length + 1;
      }
      if (column > 0) {
        offset += Math.min(column, fileLines[targetLine - 1]?.length ?? 0);
      }

      if (needsSwitch || leavingReview) {
        setTimeout(() => requestJumpToPosition(offset), 100);
      } else {
        requestJumpToPosition(offset);
      }
    },
    [
      files,
      reviewMode,
      setReviewMode,
      readerMode,
      setReaderMode,
      setActiveFile,
      requestJumpToPosition,
    ],
  );

  const handleSynctexClick = useCallback(
    async (page: number, x: number, y: number) => {
      if (!projectRoot) return;
      const result = await synctexEdit(projectRoot, page, x, y);
      if (!result) return;
      jumpToFileLine(result.file, result.line, result.column);
    },
    [projectRoot, jumpToFileLine],
  );

  // Resolved source location from synctex
  const [resolvedSource, setResolvedSource] = useState<{
    file: string;
    line: number;
    column: number;
  } | null>(null);

  // Instant highlight: no dialog, saved immediately with a synctex source so
  // "go to source" works on it like any comment.
  const createHighlightAnnotation = useCallback(
    async (target: PdfReviewTarget) => {
      if (!target.page) return;
      const source = projectRoot
        ? await synctexEdit(projectRoot, target.page, target.x, target.y)
        : null;
      const comment = addReviewComment({
        documentRoot: rootFileName,
        kind: "highlight",
        color: useSettingsStore.getState().reviewHighlightColor,
        body: "",
        anchor: {
          kind: target.kind,
          page: target.page,
          x: target.x,
          y: target.y,
          width: Math.max(12, target.width),
          height: Math.max(12, target.height),
          selectedText: target.selectedText || undefined,
          source: source ?? undefined,
        },
      });
      setSelectedReviewId(comment.id);
    },
    [projectRoot, rootFileName, addReviewComment],
  );

  const handleTextSelect = useCallback((selection: PdfTextSelection | null) => {
    setPdfSelection(selection);
    setResolvedSource(null);
  }, []);

  // When PDF selection changes, resolve source via synctex
  useEffect(() => {
    if (!pdfSelection || !projectRoot) return;
    let cancelled = false;
    synctexEdit(
      projectRoot,
      pdfSelection.pageNumber,
      pdfSelection.pdfX,
      pdfSelection.pdfY,
    )
      .then((result) => {
        if (cancelled || !result) return;
        setResolvedSource(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pdfSelection, projectRoot]);

  const pdfContextLabel = resolvedSource
    ? `~@${resolvedSource.file}:${resolvedSource.line}`
    : pdfSelection
      ? `~@PDF page ${pdfSelection.pageNumber}`
      : "";

  const navigateToSourceLocation = useCallback(
    (source: ReviewSourceLocation) => {
      const normalize = (p: string) =>
        p.replace(/\\/g, "/").replace(/^\.\//, "");
      const normalizedTarget = normalize(source.file);
      const targetFile = files.find(
        (f) => normalize(f.relativePath) === normalizedTarget,
      );
      if (!targetFile) return;

      const state = useDocumentStore.getState();
      const needsSwitch = state.activeFileId !== targetFile.id;
      const leavingReader = readerMode;
      if (leavingReader) setReaderMode(false);
      if (needsSwitch) setActiveFile(targetFile.id);

      const fileContent = targetFile.content ?? "";
      const fileLines = fileContent.split("\n");
      const targetLine = Math.max(1, Math.min(source.line, fileLines.length));
      let offset = 0;
      for (let i = 0; i < targetLine - 1; i++) {
        offset += fileLines[i].length + 1;
      }
      if (source.column > 0) {
        offset += Math.min(
          source.column,
          fileLines[targetLine - 1]?.length ?? 0,
        );
      }

      if (needsSwitch || leavingReader) {
        setTimeout(() => requestJumpToPosition(offset), 100);
      } else {
        requestJumpToPosition(offset);
      }
    },
    [files, readerMode, setReaderMode, setActiveFile, requestJumpToPosition],
  );

  const navigateToSource = useCallback(() => {
    if (resolvedSource) navigateToSourceLocation(resolvedSource);
  }, [resolvedSource, navigateToSourceLocation]);

  const buildPdfContext = useCallback(
    (text: string) => {
      const locationNote = resolvedSource
        ? `near ${resolvedSource.file}:${resolvedSource.line}`
        : pdfSelection
          ? `PDF page ${pdfSelection.pageNumber}`
          : "PDF";
      return `[Selected from PDF output, approximate source location: ${locationNote}]\n${text}`;
    },
    [resolvedSource, pdfSelection],
  );

  const handlePdfToolbarSendPrompt = useCallback(
    (prompt: string) => {
      if (!pdfSelection) return;
      const label = pdfContextLabel;
      const sel = pdfSelection;
      setPdfSelection(null);
      window.getSelection()?.removeAllRanges();
      useAiChatStore.getState().sendPrompt(prompt, {
        label,
        filePath: resolvedSource?.file ?? "document.pdf",
        selectedText: buildPdfContext(sel.text),
      });
    },
    [pdfSelection, pdfContextLabel, resolvedSource, buildPdfContext],
  );

  const startReviewComment = useCallback(
    async (target: PdfReviewTarget) => {
      if (!target.page) return;
      const source = projectRoot
        ? await synctexEdit(projectRoot, target.page, target.x, target.y)
        : null;
      setReviewDraft({
        documentRoot: rootFileName,
        anchor: {
          kind: target.kind,
          page: target.page,
          x: target.x,
          y: target.y,
          width: Math.max(12, target.width),
          height: Math.max(12, target.height),
          selectedText: target.selectedText || undefined,
          source: source ?? undefined,
        },
      });
    },
    [projectRoot, rootFileName],
  );

  const pdfToolbarActions: ToolbarAction[] = useMemo(
    () => [
      {
        id: "copy",
        label: "Copy",
        icon: <CopyIcon className="size-4" />,
      },
      {
        id: "highlight",
        label: "Highlight",
        icon: <HighlighterIcon className="size-4" />,
      },
      {
        id: "comment",
        label: "Add review comment",
        icon: <MessageSquarePlusIcon className="size-4" />,
      },
      // Proofread feeds the AI chat — only offer it when a provider is configured.
      ...(aiProvider !== "none"
        ? [
            {
              id: "proofread",
              label: "Proofread",
              icon: <SpellCheckIcon className="size-4" />,
            },
          ]
        : []),
      {
        id: "navigate",
        label: "Navigate to source",
        icon: <FileTextIcon className="size-4" />,
        hint: "dbl-click",
      },
    ],
    [aiProvider],
  );

  const handlePdfToolbarAction = useCallback(
    (actionId: string) => {
      if (!pdfSelection) return;
      const label = pdfContextLabel;
      const sel = pdfSelection;
      setPdfSelection(null);
      window.getSelection()?.removeAllRanges();
      if (actionId === "copy") {
        void navigator.clipboard.writeText(sel.text).then(
          () => toast.success("Copied to clipboard"),
          () => toast.error("Could not copy the selected text"),
        );
      } else if (actionId === "comment") {
        void startReviewComment({
          kind: "text",
          page: sel.pageNumber,
          x: sel.pdfX,
          y: sel.pdfY,
          width: sel.pdfWidth,
          height: sel.pdfHeight,
          selectedText: sel.text,
        });
      } else if (actionId === "highlight") {
        void createHighlightAnnotation({
          kind: "text",
          page: sel.pageNumber,
          x: sel.pdfX,
          y: sel.pdfY,
          width: sel.pdfWidth,
          height: sel.pdfHeight,
          selectedText: sel.text,
        });
      } else if (actionId === "proofread") {
        useAiChatStore
          .getState()
          .sendPrompt("Proofread and fix any errors in this text", {
            label,
            filePath: resolvedSource?.file ?? "document.pdf",
            selectedText: buildPdfContext(sel.text),
          });
      } else if (actionId === "navigate") {
        navigateToSource();
      }
    },
    [
      pdfSelection,
      pdfContextLabel,
      resolvedSource,
      navigateToSource,
      buildPdfContext,
      startReviewComment,
      createHighlightAnnotation,
    ],
  );

  const handleSaveReviewComment = useCallback(
    (body: string) => {
      if (!reviewDraft) return;
      const comment = addReviewComment({
        documentRoot: reviewDraft.documentRoot,
        anchor: reviewDraft.anchor,
        body,
      });
      setSelectedReviewId(comment.id);
      setReviewDraft(null);
      setPdfSelection(null);
      window.getSelection()?.removeAllRanges();
      setReviewMode(true);
    },
    [reviewDraft, addReviewComment, setReviewMode],
  );

  const handleSelectReviewComment = useCallback(
    (comment: ReviewComment) => {
      setSelectedReviewId(comment.id);
      requestPdfLocation({
        page: comment.anchor.page,
        x: comment.anchor.x,
        y: comment.anchor.y,
        width: comment.anchor.width,
        height: comment.anchor.height,
      });
    },
    [requestPdfLocation],
  );

  const handleSelectReviewAnnotation = useCallback(
    (id: string) => {
      const comment = documentReviewComments.find((item) => item.id === id);
      if (comment) handleSelectReviewComment(comment);
    },
    [documentReviewComments, handleSelectReviewComment],
  );

  const handleReviewGoToSource = useCallback(
    (comment: ReviewComment) => {
      if (!comment.anchor.source) return;
      const source = comment.anchor.source;
      setReviewMode(false);
      setTimeout(() => navigateToSourceLocation(source), 50);
    },
    [navigateToSourceLocation, setReviewMode],
  );

  const handlePdfToolbarDismiss = useCallback(() => {
    setPdfSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const pdfToolbarPosition = (() => {
    if (!pdfSelection || !previewContainerRef.current) return null;
    const containerRect = previewContainerRef.current.getBoundingClientRect();
    const relTop = pdfSelection.position.top - containerRect.top + 4;
    const relLeft = Math.max(
      8,
      Math.min(
        pdfSelection.position.left - containerRect.left,
        containerRect.width - 272,
      ),
    );
    return { top: relTop, left: relLeft };
  })();

  useEffect(() => {
    if (hasInitialCompile.current) return;
    if (!initialized || !projectRoot) return;
    if (pdfData || isCompiling || compileError) return;

    hasInitialCompile.current = true;

    const compile = async () => {
      setIsCompiling(true);
      try {
        await saveAllFiles();
        const { files: allFiles, activeFileId } = useDocumentStore.getState();
        const resolved = resolveCompileTarget(activeFileId, allFiles);
        if (!resolved) {
          setCompileError(
            "No .tex file found in this project. Create a main.tex file to compile.",
          );
          return;
        }
        const { rootId, targetPath } = resolved;
        const texlive =
          useSettingsStore.getState().compilerBackend === "texlive";
        const data = await compileLatex(projectRoot, targetPath, texlive);
        setPdfData(data, rootId);
      } catch (error) {
        setCompileError(formatCompileError(error));
      } finally {
        setIsCompiling(false);
      }
    };
    compile();
  }, [
    initialized,
    projectRoot,
    pdfData,
    isCompiling,
    compileError,
    setIsCompiling,
    setPdfData,
    setCompileError,
    saveAllFiles,
    files,
    activeFile,
  ]);

  // Recompute scale when fit mode is active and container/page size changes
  useEffect(() => {
    if (!fitMode || !containerSize || !firstPageSize) return;
    const PADDING = 32; // p-4 on each side
    if (fitMode === "fit-width") {
      const newScale = (containerSize.width - PADDING) / firstPageSize.width;
      setScale(Math.max(0.25, Math.min(4, newScale)));
    } else if (fitMode === "fit-height") {
      const newScale = (containerSize.height - PADDING) / firstPageSize.height;
      setScale(Math.max(0.25, Math.min(4, newScale)));
    }
  }, [fitMode, containerSize, firstPageSize]);

  const zoomIn = () => {
    setFitMode(null);
    setScale((s) => Math.min(4, s + 0.1));
  };
  const zoomOut = () => {
    setFitMode(null);
    setScale((s) => Math.max(0.25, s - 0.1));
  };

  const handleExport = async () => {
    const currentPdf = getCurrentPdfBytes();
    if (!currentPdf) return;
    // Never let a fast-preview build slip out as if it were the final PDF
    if (partialPreviewLabel) {
      const proceed = window.confirm(
        `This PDF is a partial fast preview (${partialPreviewLabel}) — not the final document.\n\nExport it anyway?`,
      );
      if (!proceed) return;
    }
    const mainFile = files.find(
      (f) => f.name === "main.tex" || f.name === "document.tex",
    );
    const defaultName = mainFile
      ? mainFile.name.replace(/\.tex$/, ".pdf")
      : "document.pdf";
    const filePath = await save({
      title: "Export PDF",
      defaultPath: defaultName,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!filePath) return;
    await writeFile(filePath, new Uint8Array(currentPdf));
  };

  const handleCurrentPageChange = useCallback(
    (page: number) => {
      setStatusCurrentPage(page);
      setCurrentPage((prev) => {
        if (prev === page) return prev;
        if (!isEditingPage) setPageInputValue(String(page));
        return page;
      });
    },
    [isEditingPage, setStatusCurrentPage],
  );

  /** `record` marks a jump the back button should undo — a page entered by
   *  number, or a location opened from elsewhere in the app. Stepping page by
   *  page is closer to scrolling and is left out of the history. */
  const goToPage = useCallback(
    (page: number, options?: { record?: boolean }) => {
      const clamped = Math.max(1, Math.min(numPages, page));
      scrollToPageRef.current?.(clamped, options);
    },
    [numPages],
  );

  useEffect(() => {
    if (!locationRequest || numPages === 0 || locationRequest.page > numPages) {
      return;
    }

    if (locationRequest.highlight !== false) {
      setSynctexHighlight(locationRequest);
    }
    requestAnimationFrame(() =>
      goToPage(locationRequest.page, { record: true }),
    );
    const timer = window.setTimeout(() => {
      setSynctexHighlight(null);
      clearLocationRequest();
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [locationRequest, numPages, goToPage, clearLocationRequest]);

  const handlePageInputCommit = useCallback(() => {
    setIsEditingPage(false);
    const parsed = parseInt(pageInputValue, 10);
    if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= numPages) {
      goToPage(parsed, { record: true });
    } else {
      setPageInputValue(String(currentPage));
    }
  }, [pageInputValue, numPages, currentPage, goToPage]);

  const handleLoadSuccess = (pages: number) => {
    setNumPages(pages);
    setStatusPageCount(pages);
  };
  const handleScaleChange = (newScale: number) => {
    setFitMode(null);
    setScale(newScale);
  };

  const handleCompile = async (force = false) => {
    // Read all guard values from the store to avoid stale closures
    const state = useDocumentStore.getState();
    if (!state.projectRoot) return;
    if (state.isCompiling) {
      // Queue a recompile after the current one finishes
      state.setPendingRecompile(true);
      return;
    }
    const allFiles = state.files;
    const activeFileId = state.activeFileId;
    // Any active file is fine — resolveCompileTarget finds the .tex root
    // (and returns null when the project has none).
    const resolved = resolveCompileTarget(activeFileId, allFiles);
    if (!resolved) {
      setCompileError(
        "No .tex file found in this project. Create a main.tex file to compile.",
      );
      return;
    }
    const { rootId, targetPath: targetFile } = resolved;
    const buildProfile = effectiveCompileProfile(
      rootId,
      activeFileId,
      allFiles,
      state.fastCompile,
    );
    // Skip recompile if no edits since last successful compile of this root
    // with the same build profile (unless force=true, e.g. Recompile button)
    if (!force) {
      const lastGen = state.lastCompiledGenerations.get(rootId);
      if (
        hasPdfData() &&
        lastGen !== undefined &&
        state.contentGeneration === lastGen &&
        profilesEqual(state.pdfBuildProfiles.get(rootId) ?? null, buildProfile)
      )
        return;
    }
    useHistoryStore.getState().stopReview();
    setIsCompiling(true);
    state.setPendingRecompile(false);
    setPdfError(null);
    const compileStart = Date.now();
    try {
      await saveAllFiles();
      const texlive = useSettingsStore.getState().compilerBackend === "texlive";
      const data = await compileLatex(
        state.projectRoot,
        targetFile,
        texlive,
        buildProfile,
      );
      setPdfData(data, rootId, buildProfile);
    } catch (error) {
      setCompileError(formatCompileError(error), rootId);
    } finally {
      // Ensure the spinner is visible for at least 500ms for visual feedback
      const elapsed = Date.now() - compileStart;
      state.setLastCompileStats({ endedAt: Date.now(), durationMs: elapsed });
      if (elapsed < 500) {
        await new Promise((r) => setTimeout(r, 500 - elapsed));
      }
      setIsCompiling(false);
      // If a recompile was requested while we were compiling, trigger it now
      // Use setTimeout to avoid unbounded recursion on the call stack
      if (useDocumentStore.getState().pendingRecompile) {
        setTimeout(() => handleCompile(), 0);
      }
    }
  };

  const handleCapture = async (result: CaptureResult) => {
    setCaptureMode(false);
    if (!projectRoot) return;

    const fileName = `capture-p${result.pageNumber}-${Date.now()}.png`;
    const relativePath = `attachments/${fileName}`;

    try {
      const attachmentsDir = await join(projectRoot, "attachments");
      if (!(await exists(attachmentsDir))) {
        await mkdir(attachmentsDir, { recursive: true });
      }
      const fullPath = await join(projectRoot, relativePath);

      const base64 = result.dataUrl.split(",")[1];
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      await writeFile(fullPath, bytes);

      await useDocumentStore.getState().refreshFiles();

      useAiChatStore.getState().addPendingAttachment({
        label: `@${relativePath}`,
        filePath: relativePath,
        selectedText: `[Captured region from PDF page ${result.pageNumber}]`,
        imageDataUrl: result.dataUrl,
      });
    } catch (err) {
      log.error("Capture failed to save", { error: String(err) });
    }
  };

  // Listen for global Capture & Ask shortcut (Cmd+X / Ctrl+X).
  // Capture feeds the AI chat, so it's inert when no provider is configured.
  useEffect(() => {
    if (aiProvider === "none") return;
    const handleToggleCapture = () => {
      if (pdfData) setCaptureMode((prev) => !prev);
    };
    window.addEventListener("toggle-capture-mode", handleToggleCapture);
    return () =>
      window.removeEventListener("toggle-capture-mode", handleToggleCapture);
  }, [pdfData, aiProvider]);

  const handleFixWithChat = () => {
    const errorList = compileFailureMessages.map((e) => `- ${e}`).join("\n");
    useAiChatStore
      .getState()
      .sendPrompt(
        `[Compilation errors]\n${errorList}\n\nFix these LaTeX compilation errors.`,
      );
  };

  const handleExplainError = () => {
    if (!compileFailure) return;
    setIsExplaining(true);
    setErrorExplanation("");
    const handle = runOneShotPrompt({
      prompt: buildExplainCompileErrorPrompt(
        compileFailure,
        files,
        rootFileName,
      ),
      systemPrompt: EXPLAIN_ERROR_SYSTEM_PROMPT,
      onDelta: (text) => setErrorExplanation(text),
    });
    explainCancelRef.current = handle.cancel;
    handle.result
      .then((text) => setErrorExplanation(text))
      .catch((err: Error) => {
        if (err.message === "Cancelled") return;
        setErrorExplanation(
          (prev) => prev || `_Could not get an explanation: ${err.message}_`,
        );
      })
      .finally(() => setIsExplaining(false));
  };

  // Jump target for the compile error's "Where:" link — only offered when the
  // reported (or fallback root) file actually exists in the project.
  const errorSourceTarget = useMemo(() => {
    if (!compileFailure) return null;
    const file = compileFailure.sourceFile ?? rootFileName;
    const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");
    const exists = files.some(
      (f) => normalize(f.relativePath) === normalize(file),
    );
    return exists ? { file, line: compileFailure.sourceLine ?? 1 } : null;
  }, [compileFailure, rootFileName, files]);

  const handleGoToErrorSource = errorSourceTarget
    ? () => jumpToFileLine(errorSourceTarget.file, errorSourceTarget.line)
    : undefined;

  const renderContent = () => {
    if (compileFailure && !pdfData) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-6">
          <CompileErrorDetails
            failure={compileFailure}
            errors={compileFailureMessages}
            compilerBackend={compilerBackend}
            rootFileName={rootFileName}
            errorExplanation={errorExplanation}
            isExplaining={isExplaining}
            aiProvider={aiProvider}
            onRetry={() => handleCompile(true)}
            onExplain={handleExplainError}
            onFixWithChat={handleFixWithChat}
            onGoToSource={handleGoToErrorSource}
          />
        </div>
      );
    }
    if (!pdfData && isCompiling) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8">
          <div className="mb-4 flex size-14 items-center justify-center rounded-md bg-background text-muted-foreground shadow-xs">
            <LoaderIcon className="size-6 animate-spin" />
          </div>
          <h2 className="mb-2 font-medium text-foreground text-lg">
            Building preview
          </h2>
          <p className="max-w-sm text-center text-muted-foreground text-sm">
            Compiling {rootFileName} with {compilerBackend}.
          </p>
          {compileProgress && (
            <div className="mt-4 w-56">
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${compileProgress.percent}%` }}
                />
              </div>
              <div className="mt-1.5 text-center text-muted-foreground text-xs">
                {compileProgress.remainingSec > 0
                  ? `~${compileProgress.remainingSec}s left (estimated from the previous build)`
                  : "Taking longer than the previous build — almost there…"}
              </div>
            </div>
          )}
        </div>
      );
    }
    if (!pdfData) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8">
          <FileTextIcon className="mb-4 size-16 text-muted-foreground/50" />
          <h2 className="mb-2 font-medium text-lg text-muted-foreground">
            PDF Preview
          </h2>
          <p className="mb-4 text-center text-muted-foreground text-sm">
            {isCompilable
              ? `Save (Ctrl+S) or click Compile to build ${rootFileName} — this works from any file in the project.`
              : "No compilable .tex file found in this project."}
          </p>
          {isCompilable && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => handleCompile(true)}
            >
              <RefreshCwIcon className="size-3.5" />
              Compile
            </Button>
          )}
        </div>
      );
    }
    if (pdfError) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8">
          <AlertCircleIcon className="mb-4 size-12 text-destructive" />
          <h2 className="mb-2 font-medium text-destructive text-lg">
            PDF Load Error
          </h2>
          <p className="max-w-md text-center text-muted-foreground text-sm">
            {pdfError}
          </p>
        </div>
      );
    }

    // Keep-alive rendering: one PdfViewer per root file, toggle via CSS.
    // Use visibility:hidden + absolute positioning instead of display:none
    // so that the browser preserves scrollTop on the overflow container.
    return (
      <div className="relative flex min-h-0 flex-1">
        {aliveOrder.map((rootId) => {
          const data = getPdfBytes(rootId);
          if (!data) return null;
          const isActive = rootId === currentRootFileId;
          return (
            <ErrorBoundary
              key={rootId}
              fallback={
                <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/30 p-8">
                  <AlertCircleIcon className="size-10 text-destructive" />
                  <p className="text-muted-foreground text-sm">
                    PDF viewer crashed. Try recompiling.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleCompile(true)}
                  >
                    <RefreshCwIcon className="size-3.5" />
                    Recompile
                  </Button>
                </div>
              }
            >
              <div
                className={
                  isActive
                    ? "absolute inset-0 flex flex-col"
                    : "pointer-events-none invisible absolute inset-0 flex flex-col"
                }
              >
                <PdfViewer
                  data={data}
                  scale={scale}
                  rootFileId={rootId}
                  isActive={isActive}
                  onError={isActive ? setPdfError : undefined}
                  onLoadSuccess={isActive ? handleLoadSuccess : undefined}
                  onScaleChange={isActive ? handleScaleChange : undefined}
                  onTextClick={isActive ? handleTextClick : undefined}
                  onSynctexClick={isActive ? handleSynctexClick : undefined}
                  onTextSelect={isActive ? handleTextSelect : undefined}
                  onFirstPageSize={
                    isActive
                      ? (w, h) => setFirstPageSize({ width: w, height: h })
                      : undefined
                  }
                  onContainerResize={
                    isActive
                      ? (w, h) => setContainerSize({ width: w, height: h })
                      : undefined
                  }
                  onCurrentPageChange={
                    isActive ? handleCurrentPageChange : undefined
                  }
                  scrollToPageRef={isActive ? scrollToPageRef : undefined}
                  viewHistoryRef={isActive ? viewHistoryRef : undefined}
                  onViewHistoryChange={isActive ? setViewHistory : undefined}
                  openSearchRef={isActive ? openPdfSearchRef : undefined}
                  captureMode={isActive ? captureMode : false}
                  onCapture={isActive ? handleCapture : undefined}
                  onCancelCapture={
                    isActive ? () => setCaptureMode(false) : undefined
                  }
                  onStartCapture={
                    isActive && aiProvider !== "none"
                      ? () => setCaptureMode(true)
                      : undefined
                  }
                  highlightLocation={isActive ? synctexHighlight : null}
                  reviewAnnotations={isActive ? reviewAnnotations : []}
                  selectedReviewAnnotationId={
                    isActive ? selectedReviewId : null
                  }
                  onSelectReviewAnnotation={
                    isActive ? handleSelectReviewAnnotation : undefined
                  }
                  onAddReviewComment={isActive ? startReviewComment : undefined}
                  commentPlacementMode={
                    isActive && reviewMode && reviewTool === "comment"
                  }
                  onPlacePointComment={
                    isActive ? startReviewComment : undefined
                  }
                  highlightPlacementMode={
                    isActive && reviewMode && reviewTool === "highlight"
                  }
                  onPlaceHighlight={
                    isActive ? createHighlightAnnotation : undefined
                  }
                  highlightColor={reviewHighlightColor}
                />
              </div>
            </ErrorBoundary>
          );
        })}
      </div>
    );
  };

  const compileStatusMessage = isSaving
    ? "Saving files"
    : isCompiling
      ? "Compiling document"
      : compileError
        ? "Compile failed"
        : pdfData
          ? "Compile finished, PDF preview updated"
          : "";

  return (
    <div
      ref={previewContainerRef}
      className={`paper-stage @container/pv relative flex h-full min-w-0 flex-col ${
        reviewMode ? "pr-80" : ""
      }`}
    >
      {/* Screen-reader announcement of compile progress; visually hidden. */}
      <div aria-live="polite" role="status" className="sr-only">
        {compileStatusMessage}
      </div>
      <div className="preview-toolbar flex h-[calc(44px+var(--titlebar-height))] shrink-0 items-center border-border border-b px-2.5 pt-[var(--titlebar-height)]">
        <div className="flex items-center gap-1">
          <Select
            value={compilerBackend}
            onValueChange={(v) =>
              setCompilerBackend(v as "tectonic" | "texlive")
            }
          >
            <SelectTrigger size="sm" className="h-7! w-auto text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tectonic">Tectonic</SelectItem>
              <SelectItem value="texlive">TeXLive</SelectItem>
            </SelectContent>
          </Select>
          {isSaving && (
            <div
              className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1"
              title="Saving..."
            >
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              <span className="@[34rem]/pv:inline hidden font-medium text-muted-foreground text-xs">
                Saving...
              </span>
            </div>
          )}
          {!isSaving && isCompiling && (
            <div
              className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1"
              title={
                compileProgress
                  ? `Compiling — about ${compileProgress.percent}% (estimated from the previous build)`
                  : "Compiling..."
              }
            >
              <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
              <span className="@[34rem]/pv:inline hidden font-medium text-muted-foreground text-xs">
                {compileProgress
                  ? `Compiling… ${compileProgress.percent}%`
                  : "Compiling..."}
              </span>
              {/* Narrow panes: still show the bare percentage next to the spinner */}
              {compileProgress && (
                <span className="@[34rem]/pv:hidden font-medium text-muted-foreground text-xs">
                  {compileProgress.percent}%
                </span>
              )}
            </div>
          )}
          {!isSaving &&
            !isCompiling &&
            !compileError &&
            pdfData &&
            isCompilable && (
              <div
                className={
                  previewIsStale
                    ? "@[42rem]/pv:flex hidden items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 font-medium text-amber-700 text-xs dark:text-amber-300"
                    : "@[42rem]/pv:flex hidden items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 text-xs dark:text-emerald-300"
                }
              >
                {previewIsStale ? (
                  <FileTextIcon className="size-3.5" />
                ) : (
                  <CheckCircle2Icon className="size-3.5" />
                )}
              </div>
            )}
          {!isSaving && !isCompiling && !compileError && isCompilable && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => handleCompile(true)}
              title={pdfData ? "Recompile" : "Compile"}
            >
              <RefreshCwIcon className="size-3.5" />
              <span className="@[34rem]/pv:inline hidden">
                {pdfData ? "Recompile" : "Compile"}
              </span>
            </Button>
          )}
          {isCompilable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={
                    fastCompileActive
                      ? "h-7 gap-1.5 bg-amber-500/10 px-2.5 text-amber-700 text-xs hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-300"
                      : "h-7 gap-1.5 px-2.5 text-muted-foreground text-xs"
                  }
                  title={
                    fastCompileActive
                      ? "Fast preview builds are on — the PDF is not final"
                      : "Build mode: full (final PDF)"
                  }
                >
                  <GaugeIcon className="size-3.5" />
                  <span className="@[34rem]/pv:inline hidden">
                    {fastCompileActive ? "Fast" : "Full"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  Fast preview — builds are quicker but the PDF is not final
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={fastCompile.onlyCurrentChapter}
                  onCheckedChange={(v) =>
                    setFastCompile({ onlyCurrentChapter: Boolean(v) })
                  }
                >
                  <div>
                    <div>Only current chapter</div>
                    <div className="text-muted-foreground text-xs">
                      \includeonly the file being edited (when \include'd)
                    </div>
                  </div>
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={fastCompile.skipFigures}
                  onCheckedChange={(v) =>
                    setFastCompile({ skipFigures: Boolean(v) })
                  }
                >
                  <div>
                    <div>Skip figures (draft)</div>
                    <div className="text-muted-foreground text-xs">
                      Figures render as empty boxes
                    </div>
                  </div>
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={fastCompile.singlePass}
                  onCheckedChange={(v) =>
                    setFastCompile({ singlePass: Boolean(v) })
                  }
                >
                  <div>
                    <div>Single pass</div>
                    <div className="text-muted-foreground text-xs">
                      Skip bibliography and reference stabilization
                    </div>
                  </div>
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={runFullBuild}>
                  Run full build now
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!isSaving && !isCompiling && compileError && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-destructive text-xs hover:text-destructive"
              onClick={() => handleCompile(true)}
              disabled={!isCompilable}
              title="Retry compile"
            >
              <RefreshCwIcon className="size-3.5" />
              <span className="@[34rem]/pv:inline hidden">Retry</span>
            </Button>
          )}
        </div>
        <div data-tauri-drag-region className="flex-1 self-stretch" />
        <div className="flex shrink-0 items-center gap-1">
          {/* Review tools — the wide review view leaves plenty of toolbar
              room, so they live here rather than floating over the PDF.
              Click a tool again to disarm it and go back to browsing. */}
          {pdfData && reviewMode && (
            <>
              <Button
                variant={reviewTool === "highlight" ? "secondary" : "ghost"}
                size="icon"
                className="size-7"
                title="Highlighter — drag a box over the PDF to highlight it"
                aria-label="Highlighter"
                aria-pressed={reviewTool === "highlight"}
                onClick={() =>
                  setReviewTool((tool) =>
                    tool === "highlight" ? "none" : "highlight",
                  )
                }
              >
                <HighlighterIcon className="size-3.5" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Highlight colour"
                    aria-label="Highlight colour"
                  >
                    <span
                      className={`size-3 rounded-full ${resolveReviewHighlightColor(reviewHighlightColor).swatch}`}
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-36">
                  {REVIEW_HIGHLIGHT_COLORS.map((color) => (
                    <DropdownMenuItem
                      key={color.id}
                      onClick={() => {
                        setReviewHighlightColor(color.id);
                        // Picking a colour arms the highlighter too.
                        setReviewTool("highlight");
                      }}
                    >
                      <span className={`size-3 rounded-full ${color.swatch}`} />
                      {color.label}
                      {reviewHighlightColor === color.id && (
                        <CheckIcon className="ml-auto size-3.5" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant={reviewTool === "comment" ? "secondary" : "ghost"}
                size="icon"
                className="size-7"
                title="Comment — click the PDF to pin a comment"
                aria-label="Comment pin"
                aria-pressed={reviewTool === "comment"}
                onClick={() =>
                  setReviewTool((tool) =>
                    tool === "comment" ? "none" : "comment",
                  )
                }
              >
                <MessageSquarePlusIcon className="size-3.5" />
              </Button>
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}
          {pdfData && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => viewHistoryRef.current?.back()}
                disabled={!viewHistory.canGoBack}
                title="Back (Alt+Left)"
              >
                <ArrowLeftIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => viewHistoryRef.current?.forward()}
                disabled={!viewHistory.canGoForward}
                title="Forward (Alt+Right)"
              >
                <ArrowRightIcon className="size-3.5" />
              </Button>
              <div className="mx-1 h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                title="Page Up"
              >
                <ChevronUpIcon className="size-3.5" />
              </Button>
              {isEditingPage ? (
                <input
                  type="text"
                  inputMode="numeric"
                  className="h-6 w-8 shrink-0 rounded border border-border bg-background text-center text-foreground text-xs outline-none focus:ring-1 focus:ring-ring"
                  value={pageInputValue}
                  onChange={(e) => setPageInputValue(e.target.value)}
                  onBlur={handlePageInputCommit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePageInputCommit();
                    if (e.key === "Escape") {
                      setIsEditingPage(false);
                      setPageInputValue(String(currentPage));
                    }
                  }}
                />
              ) : (
                <button
                  className="flex h-6 min-w-[2rem] shrink-0 items-center justify-center rounded px-1 text-muted-foreground text-xs tabular-nums hover:bg-muted"
                  onClick={() => {
                    setIsEditingPage(true);
                    setPageInputValue(String(currentPage));
                  }}
                  title="Click to jump to page"
                >
                  {currentPage}
                </button>
              )}
              <span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs">
                / {numPages}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= numPages}
                title="Page Down"
              >
                <ChevronDownIcon className="size-3.5" />
              </Button>
              <div className="mx-1 h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={zoomOut}
                disabled={scale <= 0.25}
              >
                <MinusIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={zoomIn}
                disabled={scale >= 4}
              >
                <PlusIcon className="size-3.5" />
              </Button>
              <Select
                value={fitMode ?? scale.toString()}
                onValueChange={(v) => {
                  if (v === "fit-width" || v === "fit-height") {
                    setFitMode(v);
                  } else {
                    setFitMode(null);
                    setScale(Number(v));
                  }
                }}
              >
                <SelectTrigger size="sm" className="h-7! w-auto text-xs">
                  <SelectValue>
                    {fitMode === "fit-width"
                      ? "Fit width"
                      : fitMode === "fit-height"
                        ? "Fit height"
                        : `${Math.round(scale * 100)}%`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="popper" align="end">
                  <SelectItem value="fit-width">Fit to width</SelectItem>
                  <SelectItem value="fit-height">Fit to height</SelectItem>
                  <SelectSeparator />
                  {ZOOM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mx-1 h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => openPdfSearchRef.current?.()}
                title="Find in PDF (Ctrl+F)"
              >
                <SearchIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={handleExport}
                title="Export PDF"
              >
                <DownloadIcon className="size-3.5" />
              </Button>
            </>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title="History"
              >
                <HistoryIcon className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-96">
              <HistoryPanel maxHeight="max-h-[32rem]" />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {renderContent()}
      {/* Floating review toggle — lives over the PDF instead of the toolbar
          to keep the toolbar compact. Shifts left of the comments panel
          (w-80, z-40) while review mode is open, since the panel has no
          close button of its own. */}
      {pdfData && !pdfError && (
        <Button
          variant={reviewMode ? "secondary" : "outline"}
          size="sm"
          onClick={() => setReviewMode(!reviewMode)}
          title={reviewMode ? "Exit PDF review" : "Review PDF"}
          className={`absolute bottom-4 z-30 h-8 gap-1.5 px-3 text-xs shadow-lg ${
            reviewMode
              ? "right-[21rem]"
              : "right-4 bg-background/95 backdrop-blur-sm"
          }`}
        >
          {reviewMode ? (
            <Minimize2Icon className="size-3.5" />
          ) : (
            <MessageSquareTextIcon className="size-3.5" />
          )}
          {reviewMode ? "Exit review" : "Review"}
        </Button>
      )}
      {compileFailure && pdfData && (
        <button
          type="button"
          onClick={() => setStaleErrorDialogOpen(true)}
          className="absolute top-[calc(48px+var(--titlebar-height))] left-1/2 z-30 -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-100 px-3 py-2 font-medium text-amber-950 text-xs shadow transition-colors hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900"
        >
          Showing the last successful PDF — the latest compile failed.{" "}
          <span className="underline">View details</span>
        </button>
      )}
      {/* Partial-preview ribbon: stays as long as the displayed PDF was built
          with fast-preview options, so a draft is never mistaken for final. */}
      {pdfData && partialPreviewLabel && (
        <div className="absolute top-[calc(48px+var(--titlebar-height))] right-4 z-30 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-100 px-3 py-2 font-medium text-amber-950 text-xs shadow dark:bg-amber-950 dark:text-amber-100">
          <GaugeIcon className="size-3.5 shrink-0" />
          <span>Not the final PDF — {partialPreviewLabel}</span>
          <button
            type="button"
            onClick={runFullBuild}
            className="shrink-0 underline underline-offset-2 hover:opacity-80"
          >
            Run full build
          </button>
        </div>
      )}
      <Dialog
        open={staleErrorDialogOpen && Boolean(compileFailure)}
        onOpenChange={setStaleErrorDialogOpen}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader className="sr-only">
            <DialogTitle>Compile error details</DialogTitle>
          </DialogHeader>
          {compileFailure && (
            <CompileErrorDetails
              failure={compileFailure}
              errors={compileFailureMessages}
              compilerBackend={compilerBackend}
              rootFileName={rootFileName}
              errorExplanation={errorExplanation}
              isExplaining={isExplaining}
              aiProvider={aiProvider}
              onRetry={() => {
                setStaleErrorDialogOpen(false);
                handleCompile(true);
              }}
              onExplain={handleExplainError}
              onFixWithChat={handleFixWithChat}
              onGoToSource={
                handleGoToErrorSource
                  ? () => {
                      setStaleErrorDialogOpen(false);
                      handleGoToErrorSource();
                    }
                  : undefined
              }
            />
          )}
        </DialogContent>
      </Dialog>
      {/* PDF selection toolbar */}
      {pdfToolbarPosition && pdfSelection && (
        <SelectionToolbar
          position={pdfToolbarPosition}
          contextLabel={pdfContextLabel}
          actions={pdfToolbarActions}
          onSendPrompt={handlePdfToolbarSendPrompt}
          onAction={handlePdfToolbarAction}
          onDismiss={handlePdfToolbarDismiss}
          showPrompt={aiProvider !== "none"}
        />
      )}
      {/* Capture mode floating banner */}
      {captureMode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-sm">
            <CrosshairIcon className="size-3.5 text-primary" />
            <span className="text-foreground text-xs">
              Drag to select a region
            </span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
              ESC
            </kbd>
            <span className="text-[10px] text-muted-foreground">or</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
              {navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl+"}X
            </kbd>
            <span className="text-[10px] text-muted-foreground">to cancel</span>
          </div>
        </div>
      )}
      {reviewMode && (
        <div className="absolute inset-y-0 right-0 z-40">
          <ReviewCommentsPanel
            comments={documentReviewComments}
            loading={reviewLoading}
            selectedId={selectedReviewId}
            onSelect={handleSelectReviewComment}
            onGoToSource={handleReviewGoToSource}
            onSetStatus={(comment, status) =>
              setReviewCommentStatus(comment.id, status)
            }
            onReply={(comment, body) => addReviewReply(comment.id, body)}
            onDelete={(comment) => {
              if (
                window.confirm(
                  "Delete this review comment? This cannot be undone.",
                )
              ) {
                deleteReviewComment(comment.id);
                if (selectedReviewId === comment.id) setSelectedReviewId(null);
              }
            }}
          />
        </div>
      )}
      <ReviewCommentDialog
        draft={reviewDraft}
        onOpenChange={(open) => {
          if (!open) setReviewDraft(null);
        }}
        onSave={handleSaveReviewComment}
      />
    </div>
  );
}
