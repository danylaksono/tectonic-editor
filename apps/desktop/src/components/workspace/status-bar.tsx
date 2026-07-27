import { useMemo } from "react";
import {
  Loader2Icon,
  CircleCheckIcon,
  CircleXIcon,
  AlertTriangleIcon,
  CircleIcon,
  FileTextIcon,
  MousePointer2Icon,
  SparklesIcon,
  TargetIcon,
} from "lucide-react";
import {
  hasPdfData,
  resolveTexRoot,
  useDocumentStore,
} from "@/stores/document-store";
import { useProblemsStore } from "@/stores/problems-store";
import { useProposedChangesStore } from "@/stores/proposed-changes-store";
import { useSettingsStore } from "@/stores/settings-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { countProposedChunks } from "@/lib/proposed-chunks";
import { usePdfWordCount } from "@/hooks/use-pdf-word-count";

function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function StatusBar() {
  const files = useDocumentStore((s) => s.files);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const isCompiling = useDocumentStore((s) => s.isCompiling);
  const compileError = useDocumentStore((s) => s.compileError);
  const isSaving = useDocumentStore((s) => s.isSaving);
  const cursorPosition = useDocumentStore((s) => s.cursorPosition);
  const selectionRange = useDocumentStore((s) => s.selectionRange);
  const diagnostics = useProblemsStore((s) => s.diagnostics);
  const compilerBackend = useSettingsStore((s) => s.compilerBackend);
  const pageCount = usePreviewStore((s) => s.pageCount);
  const currentPage = usePreviewStore((s) => s.currentPage);
  const setProblemsDrawerOpen = useWorkspaceLayoutStore(
    (s) => s.setProblemsDrawerOpen,
  );
  const proposedChanges = useProposedChangesStore((s) => s.changes);
  const proposedChunkCount = useMemo(
    () => countProposedChunks(proposedChanges),
    [proposedChanges],
  );

  const activeFile = files.find((f) => f.id === activeFileId);
  // Compile target (.tex root) — shown next to the backend, mirroring what
  // the preview toolbar used to display before it moved here.
  const rootFileName = useMemo(() => {
    if (!activeFileId) return null;
    const rootId = resolveTexRoot(activeFileId, files);
    const root = files.find((f) => f.id === rootId);
    return root?.type === "tex" ? root.relativePath : null;
  }, [activeFileId, files]);
  const isTextFile =
    activeFile && activeFile.type !== "image" && activeFile.type !== "pdf";

  const wordCount = useMemo(() => {
    if (!isTextFile || !activeFile?.content) return 0;
    return countWords(activeFile.content);
  }, [isTextFile, activeFile?.content]);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter(
    (d) => d.severity === "warning",
  ).length;
  const cursor = useMemo(() => {
    if (!isTextFile || !activeFile?.content) return { line: 1, column: 1 };
    const before = activeFile.content.slice(
      0,
      Math.min(cursorPosition, activeFile.content.length),
    );
    const lines = before.split("\n");
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    };
  }, [activeFile?.content, cursorPosition, isTextFile]);
  const selectionLength = selectionRange
    ? Math.abs(selectionRange.end - selectionRange.start)
    : 0;
  const stalePdf = Boolean(compileError && hasPdfData());

  // Word count of the *rendered* document, which is what thesis and journal
  // limits actually mean. Computed on demand — see usePdfWordCount.
  const pdfWordCount = usePdfWordCount();
  const pdfCountAvailable = pageCount > 0;
  const showingPdfCount = pdfWordCount.showing && pdfWordCount.result !== null;

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-sidebar-border border-t bg-sidebar px-3 text-[11px] text-muted-foreground">
      {/* Compile status */}
      <div className="flex items-center gap-1.5">
        {isCompiling ? (
          <>
            <Loader2Icon className="size-3 animate-spin" />
            <span>Compiling…</span>
          </>
        ) : compileError ? (
          <span className="flex items-center gap-1.5 text-destructive">
            <CircleXIcon className="size-3" />
            {stalePdf ? "Compile failed · stale PDF" : "Compile failed"}
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <CircleCheckIcon className="size-3 text-emerald-500" />
            Ready
          </span>
        )}
      </div>

      {/* Diagnostics */}
      {(errorCount > 0 || warningCount > 0) && (
        <button
          type="button"
          className="flex items-center gap-2 rounded px-1 hover:bg-sidebar-accent"
          onClick={() => setProblemsDrawerOpen(true)}
          title="Open Problems"
        >
          {errorCount > 0 && (
            <span className="flex items-center gap-1">
              <CircleXIcon className="size-3 text-destructive" />
              {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <AlertTriangleIcon className="size-3" />
              {warningCount}
            </span>
          )}
        </button>
      )}

      {/* Pending AI edits — click to jump to the next file awaiting review */}
      {proposedChunkCount > 0 && (
        <button
          type="button"
          className="flex items-center gap-1 rounded px-1 font-medium text-violet-600 hover:bg-sidebar-accent dark:text-violet-400"
          onClick={() => {
            const next = proposedChanges.find((c) =>
              files.some((f) => f.relativePath === c.filePath),
            );
            if (next) useDocumentStore.getState().setActiveFile(next.filePath);
          }}
          title="Review pending AI edits (F8 / Shift+F8 to step through changes)"
        >
          <SparklesIcon className="size-3" />
          {proposedChunkCount} AI edit{proposedChunkCount === 1 ? "" : "s"} to
          review
          {proposedChanges.length > 1 && ` · ${proposedChanges.length} files`}
        </button>
      )}

      <div className="ml-auto flex items-center gap-3">
        {isSaving && (
          <span className="flex items-center gap-1">
            <CircleIcon className="size-2 fill-current" />
            Saving…
          </span>
        )}
        {activeFile && (
          <span
            className="max-w-[240px] truncate"
            title={activeFile.relativePath}
          >
            {activeFile.relativePath}
          </span>
        )}
        {isTextFile &&
          (pdfCountAvailable ? (
            <button
              type="button"
              className="rounded px-1 tabular-nums hover:bg-sidebar-accent disabled:cursor-default"
              onClick={pdfWordCount.toggle}
              disabled={pdfWordCount.counting}
              title={
                showingPdfCount
                  ? `${pdfWordCount.result?.characters.toLocaleString()} characters across ${pdfWordCount.result?.pages} ${
                      pdfWordCount.result?.pages === 1 ? "page" : "pages"
                    } of compiled PDF. Click to show the LaTeX source count (${wordCount.toLocaleString()}), which includes markup.`
                  : `${wordCount.toLocaleString()} words of LaTeX source, including markup. Click to ${
                      pdfWordCount.result ? "show" : "count"
                    } the words actually rendered in the PDF.`
              }
            >
              {pdfWordCount.counting
                ? pdfWordCount.progress
                  ? `Counting ${pdfWordCount.progress.done}/${pdfWordCount.progress.total}…`
                  : "Counting…"
                : showingPdfCount
                  ? `${pdfWordCount.result?.words.toLocaleString()} words in PDF`
                  : `${wordCount.toLocaleString()} words`}
            </button>
          ) : (
            <span className="tabular-nums">{wordCount} words</span>
          ))}
        {isTextFile && (
          <span
            className="hidden items-center gap-1 tabular-nums lg:flex"
            title={`${activeFile?.content?.length ?? 0} characters`}
          >
            <MousePointer2Icon className="size-3" />
            Ln {cursor.line}, Col {cursor.column}
            {selectionLength > 0 && ` · ${selectionLength} selected`}
          </span>
        )}
        {pageCount > 0 && (
          <span
            className="flex items-center gap-1 tabular-nums"
            title={`${pageCount} compiled PDF ${pageCount === 1 ? "page" : "pages"}`}
          >
            <FileTextIcon className="size-3" />
            {currentPage}/{pageCount} pages
          </span>
        )}
        {rootFileName && (
          <span
            className="flex items-center gap-1"
            title={`Compile target: ${rootFileName}`}
          >
            <TargetIcon className="size-3" />
            <span className="max-w-[160px] truncate">{rootFileName}</span>
          </span>
        )}
        <span className="uppercase tracking-wide">{compilerBackend}</span>
      </div>
    </div>
  );
}
