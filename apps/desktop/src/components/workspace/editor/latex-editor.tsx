import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import {
  EditorView,
  drawSelection,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  rectangularSelection,
  crosshairCursor,
  scrollPastEnd,
  Decoration,
  ViewPlugin,
  hoverTooltip,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentMore,
  indentLess,
  insertNewlineKeepIndent,
  toggleComment,
  undo,
  redo,
  undoDepth,
  redoDepth,
  selectAll,
} from "@codemirror/commands";
import {
  syntaxTreeAvailable,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { useTheme } from "next-themes";
import {
  search,
  highlightSelectionMatches,
  selectNextOccurrence,
  SearchQuery,
  setSearchQuery as setSearchQueryEffect,
  findNext,
  findPrevious,
} from "@codemirror/search";
import {
  unifiedMergeView,
  getChunks,
  acceptChunk,
  rejectChunk,
  goToNextChunk,
  goToPreviousChunk,
} from "@codemirror/merge";
import {
  latex,
  latexCompletionSource,
  latexLinter,
} from "codemirror-lang-latex";
import { bibtex } from "./lang-bibtex";
import {
  linter,
  lintGutter,
  forEachDiagnostic,
  type Diagnostic,
} from "@codemirror/lint";
import {
  useDocumentStore,
  hasPdfData,
  type ProjectFile,
} from "@/stores/document-store";
import {
  useProposedChangesStore,
  type ProposedChange,
} from "@/stores/proposed-changes-store";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useHistoryStore, type FileDiff } from "@/stores/history-store";
import { useProblemsStore, type DiagnosticItem } from "@/stores/problems-store";
import {
  compileLatex,
  resolveCompileTarget,
  formatCompileError,
  effectiveCompileProfile,
  profilesEqual,
  synctexView,
} from "@/lib/latex-compiler";
import { useSettingsStore } from "@/stores/settings-store";
import { getEditorThemeExtensions } from "@/lib/editor-themes";
import { EditorTabs } from "./editor-tabs";
import { EditorToolbar } from "./editor-toolbar";
import { SelectionToolbar, type ToolbarAction } from "./selection-toolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  BrushCleaningIcon,
  ClipboardPasteIcon,
  FileSearchIcon,
  PencilIcon,
  Redo2Icon,
  ScissorsIcon,
  SpellCheckIcon,
  TextSelectIcon,
  RotateCcwIcon,
  TagIcon,
  CopyIcon,
  Undo2Icon,
  XIcon,
  PlusIcon,
  Heading1Icon,
  Heading2Icon,
  ListIcon,
  BookMarkedIcon,
  ImagePlusIcon,
  Table2Icon,
  SigmaIcon,
  Link2Icon,
  BoxesIcon,
  RefreshCwIcon,
  MinimizeIcon,
  MaximizeIcon,
  LightbulbIcon,
  LanguagesIcon,
  SearchIcon,
} from "lucide-react";
import { AiChatDrawer } from "@/components/ai-chat/ai-chat-drawer";
import { ProposedChangesPanel } from "@/components/ai-chat/proposed-changes-panel";
import { findUnverifiedBibAdditions } from "@/lib/citation-review";
import { ImagePreview } from "./image-preview";
import { SearchPanel } from "./search-panel";
import { CitationInlineEditor } from "./citation-inline-editor";
import { CrossReferenceInlineEditor } from "./cross-reference-inline-editor";
import { FigureInlineEditor } from "./figure-inline-editor";
import { EnvironmentInlineEditor } from "./environment-inline-editor";
import { BibEntryInlineEditor } from "./bib-entry-inline-editor";
import { PdfViewer } from "@/components/workspace/preview/pdf-viewer";
import { readFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createLogger } from "@/lib/debug/logger";
import { toast } from "sonner";
import { semanticCompletionSource } from "@/lib/semantic/completion-source";
import { latexTabCompletion } from "@/lib/latex-inline-completion";
import { applyFormattedText, formatLatexSource } from "@/lib/latex-format";
import { findStyleIssues } from "@/lib/latex-style";
import { sourceLensExtension } from "@/lib/source-lens";
import { defaultWorkspaceMode, useLensStore } from "@/stores/lens-store";
import { usePreviewStore } from "@/stores/preview-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { dispatchEditorAction } from "@/lib/editor-actions";
import { clipboardImageFile } from "@/lib/pasted-image";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import { findTables } from "@/lib/latex-tables";
import { findMathNodes } from "@/lib/latex-math";
import { parseBibEntries, parseBibItems, type BibCitation } from "@/lib/bibtex";
import {
  detectCitationPackage,
  findCitationAt,
  findCitations,
  serializeCitation,
  type CitationDraft,
  type CitationMatch,
} from "@/lib/latex-citations";
import {
  detectReferencePackage,
  findLabelDefinitions,
  findReferenceAt,
  findReferences,
  serializeReference,
  type LabelDefinition,
  type ReferenceDraft,
  type ReferenceMatch,
} from "@/lib/latex-cross-references";
import {
  findFigureAt,
  findFigures,
  type FigureMatch,
} from "@/lib/latex-figures";
import {
  findEditableEnvironmentAt,
  findEditableEnvironments,
  type EnvironmentMatch,
} from "@/lib/latex-environments";
import {
  findDeclaredPackages,
  findMissingPackageRequirements,
  friendlyLatexDiagnostic,
} from "@/lib/latex-guidance";
import {
  confirmPackageRequirements,
  featureForPackage,
} from "@/lib/feature-packages";
import {
  findBibEntries,
  findBibEntryAt,
  tidyBibEntrySource,
  type BibEntryMatch,
} from "@/lib/bibtex-entries";

const log = createLogger("merge-view");

function buildCitationDecorations(view: EditorView): DecorationSet {
  const marks = findCitations(view.state.doc.toString()).map((citation) =>
    Decoration.mark({ class: "cm-citation-command" }).range(
      citation.from,
      citation.to,
    ),
  );
  return Decoration.set(marks, true);
}

const citationDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildCitationDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildCitationDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function buildReferenceDecorations(view: EditorView): DecorationSet {
  const marks = findReferences(view.state.doc.toString()).map((reference) =>
    Decoration.mark({ class: "cm-cross-reference-command" }).range(
      reference.from,
      reference.to,
    ),
  );
  return Decoration.set(marks, true);
}

const referenceDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildReferenceDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildReferenceDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function semanticBlockDecorations(view: EditorView): DecorationSet {
  const content = view.state.doc.toString();
  const marks = [
    ...findFigures(content).map((figure) =>
      Decoration.mark({ class: "cm-semantic-block-command" }).range(
        figure.graphicFrom,
        figure.graphicTo,
      ),
    ),
    ...findEditableEnvironments(content).map((environment) =>
      Decoration.mark({ class: "cm-semantic-block-command" }).range(
        environment.beginFrom,
        environment.beginTo,
      ),
    ),
    ...findTables(content).map((table) =>
      Decoration.mark({ class: "cm-semantic-block-command" }).range(
        table.from,
        Math.min(table.to, table.from + "\\begin{table}".length),
      ),
    ),
    ...findMathNodes(content).map((node) =>
      Decoration.mark({ class: "cm-semantic-block-command" }).range(
        node.from,
        node.to,
      ),
    ),
  ];
  return Decoration.set(marks, true);
}

const semanticBlockDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = semanticBlockDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = semanticBlockDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

function bibEntryDecorations(view: EditorView): DecorationSet {
  return Decoration.set(
    findBibEntries(view.state.doc.toString()).map((entry) =>
      Decoration.mark({ class: "cm-bib-entry-key" }).range(
        entry.keyFrom,
        entry.keyTo,
      ),
    ),
    true,
  );
}

const bibEntryDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = bibEntryDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged)
        this.decorations = bibEntryDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

function getActiveFileContent(): string {
  const state = useDocumentStore.getState();
  const activeFile = state.files.find((f) => f.id === state.activeFileId);
  return activeFile?.content ?? "";
}

/** Per-file editor state cache: fileId → { cursor, scrollTop } */
const editorStateCache = new Map<
  string,
  { cursor: number; scrollTop: number }
>();

/** Clear editor state cache (e.g., on project close). */
export function clearEditorStateCache(): void {
  editorStateCache.clear();
}

/** Style suggestions as diagnostics. Advisory, so they use "info" severity and
 *  stay out of the Problems panel's error/warning counts; where the rule found
 *  an unambiguous rewrite, the action applies the exact edits it computed. */
function styleDiagnostics(source: string): Diagnostic[] {
  return findStyleIssues(source).map((issue) => ({
    from: issue.from,
    to: issue.to,
    severity: "info" as const,
    source: "style",
    message: issue.message,
    actions: issue.fix
      ? [
          {
            name: issue.fix.label,
            apply: (view: EditorView) => {
              view.dispatch({ changes: issue.fix?.edits ?? [] });
            },
          },
        ]
      : [],
  }));
}

/** Editor text size, swapped via compartment so changes don't rebuild the editor. */
function editorFontSizeTheme(size: number) {
  return EditorView.theme({ "&": { fontSize: `${size}px` } });
}

export function LatexEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const files = useDocumentStore((s) => s.files);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const setContent = useDocumentStore((s) => s.setContent);
  const setCursorPosition = useDocumentStore((s) => s.setCursorPosition);
  const setSelectionRange = useDocumentStore((s) => s.setSelectionRange);
  const jumpToPosition = useDocumentStore((s) => s.jumpToPosition);
  const clearJumpRequest = useDocumentStore((s) => s.clearJumpRequest);
  const pdfRevision = useDocumentStore((s) => s.pdfRevision);
  const requestPdfLocation = usePreviewStore((s) => s.requestLocation);

  const setIsCompiling = useDocumentStore((s) => s.setIsCompiling);
  const setPdfData = useDocumentStore((s) => s.setPdfData);
  const setCompileError = useDocumentStore((s) => s.setCompileError);
  const saveAllFiles = useDocumentStore((s) => s.saveAllFiles);
  const importFiles = useDocumentStore((s) => s.importFiles);
  const createFolder = useDocumentStore((s) => s.createFolder);
  const folders = useDocumentStore((s) => s.folders);

  const activeFile = files.find((f) => f.id === activeFileId);
  const isTextFile =
    activeFile?.type === "tex" ||
    activeFile?.type === "bib" ||
    activeFile?.type === "style" ||
    activeFile?.type === "other";
  const activeFileContent = activeFile?.content;
  const isLargeFileNotLoaded =
    isTextFile && activeFileContent === undefined && !!activeFile;
  const loadFileContent = useDocumentStore((s) => s.loadFileContent);

  // History review state
  const reviewingSnapshot = useHistoryStore((s) => s.reviewingSnapshot);
  const historyDiffResult = useHistoryStore((s) => s.diffResult);

  const [imageScale, setImageScale] = useState(1.0);
  const [cropMode, setCropMode] = useState(false);

  // Reset scale and crop mode when switching files
  useEffect(() => {
    setImageScale(1.0);
    setCropMode(false);
  }, [activeFileId]);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [contextPosition, setContextPosition] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const [mergeChunkInfo, setMergeChunkInfo] = useState({
    total: 0,
    current: 0,
  });
  const [selectionCoords, setSelectionCoords] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [citationEditor, setCitationEditor] = useState<{
    target: CitationMatch;
    anchor: { top: number; bottom: number; left: number };
  } | null>(null);
  const [referenceEditor, setReferenceEditor] = useState<{
    target: ReferenceMatch;
    anchor: { top: number; bottom: number; left: number };
  } | null>(null);
  const [figureEditor, setFigureEditor] = useState<{
    target: FigureMatch;
    anchor: { top: number; bottom: number; left: number };
  } | null>(null);
  const [environmentEditor, setEnvironmentEditor] = useState<{
    target: EnvironmentMatch;
    anchor: { top: number; bottom: number; left: number };
  } | null>(null);
  const [bibEntryEditor, setBibEntryEditor] = useState<{
    target: BibEntryMatch;
    anchor: { top: number; bottom: number; left: number };
  } | null>(null);
  useEffect(() => {
    setCitationEditor(null);
    setReferenceEditor(null);
    setFigureEditor(null);
    setEnvironmentEditor(null);
    setBibEntryEditor(null);
  }, [activeFileId]);
  // When the selection toolbar is visible, prevent CM selection changes from clearing it.
  // Only explicit dismiss/send/action should clear the toolbar.
  const toolbarStickyRef = useRef(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const { resolvedTheme } = useTheme();
  const vimMode = useSettingsStore((s) => s.vimMode);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const editorHighlightTheme = useSettingsStore((s) => s.editorHighlightTheme);
  const lensExperimental = useSettingsStore((s) => s.lensExperimental);
  const workspaceModes = useLensStore((s) => s.workspaceModes);
  const editorMode = projectRoot
    ? (workspaceModes[projectRoot] ?? defaultWorkspaceMode(projectRoot))
    : "source";
  const lensActive =
    editorMode === "lens" &&
    (lensExperimental || defaultWorkspaceMode(projectRoot) === "lens");
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const setProblemDiagnostics = useProblemsStore((s) => s.setDiagnostics);
  const clearProblemDiagnostics = useProblemsStore((s) => s.clearDiagnostics);

  const compileRef = useRef<(opts?: { skipIfUnchanged?: boolean }) => void>(
    () => {},
  );
  // One-shot timer for an implicit compile deferred by the cooldown.
  const deferredCompileRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (deferredCompileRef.current) clearTimeout(deferredCompileRef.current);
    },
    [],
  );
  const isSearchOpenRef = useRef(false);
  const themeCompartmentRef = useRef(new Compartment());
  const fontSizeCompartmentRef = useRef(new Compartment());
  const mergeCompartmentRef = useRef(new Compartment());
  const vimCompartmentRef = useRef(new Compartment());
  const lensCompartmentRef = useRef(new Compartment());
  const isMergeActiveRef = useRef(false);
  const pendingChangeRef = useRef<ProposedChange | null>(null);
  const handleKeepAllRef = useRef<() => void>(() => {});
  const handleUndoAllRef = useRef<() => void>(() => {});
  const acceptCurrentChunkRef = useRef<() => void>(() => {});
  const rejectCurrentChunkRef = useRef<() => void>(() => {});
  const diagnosticsRef = useRef<DiagnosticItem[]>([]);
  const bibliographyEntriesRef = useRef<BibCitation[]>([]);
  const labelDefinitionsRef = useRef<LabelDefinition[]>([]);
  const declaredPackagesRef = useRef<Set<string>>(new Set());
  const pdfAvailable = useMemo(() => hasPdfData(), [pdfRevision]);

  const citationPackage = useMemo(
    () =>
      detectCitationPackage(
        files
          .filter((file) => file.name.toLowerCase().endsWith(".tex"))
          .map((file) => file.content ?? ""),
      ),
    [files],
  );
  const bibliographyEntries = useMemo(
    () =>
      files.flatMap((file) => {
        if (!file.content) return [];
        if (file.name.toLowerCase().endsWith(".bib")) {
          return parseBibEntries(file.content, file.relativePath);
        }
        if (file.name.toLowerCase().endsWith(".tex")) {
          return parseBibItems(file.content, file.relativePath);
        }
        return [];
      }),
    [files],
  );
  bibliographyEntriesRef.current = bibliographyEntries;
  const texProjectFiles = useMemo(
    () =>
      files
        .filter((file) => file.name.toLowerCase().endsWith(".tex"))
        .map((file) => ({
          filePath: file.relativePath,
          content: file.content ?? "",
        })),
    [files],
  );
  const labelDefinitions = useMemo(
    () => findLabelDefinitions(texProjectFiles),
    [texProjectFiles],
  );
  labelDefinitionsRef.current = labelDefinitions;
  const referencePackage = useMemo(
    () => detectReferencePackage(texProjectFiles.map((file) => file.content)),
    [texProjectFiles],
  );
  declaredPackagesRef.current = findDeclaredPackages(
    texProjectFiles.map((file) => file.content),
  );

  const addPackageToProject = useCallback(
    (_view: EditorView, packageName: string) => {
      const feature = featureForPackage(packageName);
      if (feature) void confirmPackageRequirements([feature]);
    },
    [],
  );

  const openCitationEditorAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "tex" || isMergeActiveRef.current) return false;
      const target = findCitationAt(view.state.doc.toString(), position);
      if (!target) return false;
      const startCoords = view.coordsAtPos(target.from);
      const endCoords = view.coordsAtPos(
        Math.min(target.to, view.state.doc.length),
      );
      if (!startCoords || !endCoords) return false;
      setReferenceEditor(null);
      setFigureEditor(null);
      setEnvironmentEditor(null);
      setCitationEditor({
        target,
        anchor: {
          top: Math.min(startCoords.top, endCoords.top),
          bottom: Math.max(startCoords.bottom, endCoords.bottom),
          left: startCoords.left,
        },
      });
      return true;
    },
    [activeFile?.type],
  );

  const openReferenceEditorAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "tex" || isMergeActiveRef.current) return false;
      const target = findReferenceAt(view.state.doc.toString(), position);
      if (!target) return false;
      const startCoords = view.coordsAtPos(target.from);
      const endCoords = view.coordsAtPos(
        Math.min(target.to, view.state.doc.length),
      );
      if (!startCoords || !endCoords) return false;
      setCitationEditor(null);
      setFigureEditor(null);
      setEnvironmentEditor(null);
      setReferenceEditor({
        target,
        anchor: {
          top: Math.min(startCoords.top, endCoords.top),
          bottom: Math.max(startCoords.bottom, endCoords.bottom),
          left: startCoords.left,
        },
      });
      return true;
    },
    [activeFile?.type],
  );

  const openFigureEditorAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "tex" || isMergeActiveRef.current) return false;
      const target = findFigureAt(view.state.doc.toString(), position);
      if (!target) return false;
      const coords = view.coordsAtPos(target.graphicTo);
      if (!coords) return false;
      setCitationEditor(null);
      setReferenceEditor(null);
      setEnvironmentEditor(null);
      setFigureEditor({
        target,
        anchor: { top: coords.top, bottom: coords.bottom, left: coords.left },
      });
      return true;
    },
    [activeFile?.type],
  );

  const openEnvironmentEditorAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "tex" || isMergeActiveRef.current) return false;
      const target = findEditableEnvironmentAt(
        view.state.doc.toString(),
        position,
      );
      if (!target) return false;
      const coords = view.coordsAtPos(target.beginTo);
      if (!coords) return false;
      setCitationEditor(null);
      setReferenceEditor(null);
      setFigureEditor(null);
      setEnvironmentEditor({
        target,
        anchor: { top: coords.top, bottom: coords.bottom, left: coords.left },
      });
      return true;
    },
    [activeFile?.type],
  );

  const openBibEntryEditorAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "bib" || isMergeActiveRef.current) return false;
      const target = findBibEntryAt(view.state.doc.toString(), position);
      if (!target) return false;
      const coords = view.coordsAtPos(target.keyTo);
      if (!coords) return false;
      setBibEntryEditor({
        target,
        anchor: { top: coords.top, bottom: coords.bottom, left: coords.left },
      });
      return true;
    },
    [activeFile?.type],
  );

  const tidyBibEntryAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "bib" || isMergeActiveRef.current) return false;
      const target = findBibEntryAt(view.state.doc.toString(), position);
      if (!target) return false;
      const tidied = tidyBibEntrySource(target.source);
      if (tidied !== target.source) {
        view.dispatch({
          changes: { from: target.from, to: target.to, insert: tidied },
          selection: { anchor: target.from + tidied.length },
        });
      }
      view.focus();
      return true;
    },
    [activeFile?.type],
  );

  const openTableEditorAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "tex" || isMergeActiveRef.current) return false;
      const table = findTables(view.state.doc.toString()).find(
        (item) => position >= item.from && position <= item.to,
      );
      if (!table) return false;
      window.dispatchEvent(
        new CustomEvent("edit-structured-table", {
          detail: {
            model: table,
            apply: (replacement: string) => {
              if (
                view.state.sliceDoc(table.from, table.to) !==
                table.originalSource
              ) {
                toast.error(
                  "The table changed while the editor was open. Reopen it to avoid overwriting source.",
                );
                return;
              }
              view.dispatch({
                changes: {
                  from: table.from,
                  to: table.to,
                  insert: replacement,
                },
              });
              view.focus();
            },
          },
        }),
      );
      return true;
    },
    [activeFile?.type],
  );

  const openMathEditorAt = useCallback(
    (view: EditorView, position: number): boolean => {
      if (activeFile?.type !== "tex" || isMergeActiveRef.current) return false;
      const math = findMathNodes(view.state.doc.toString()).find(
        (item) => position >= item.from && position <= item.to,
      );
      if (!math) return false;
      window.dispatchEvent(
        new CustomEvent("edit-structured-math", {
          detail: {
            node: math,
            apply: (replacement: string) => {
              if (view.state.sliceDoc(math.from, math.to) !== math.source) {
                toast.error(
                  "The equation changed while the editor was open. Reopen it to avoid overwriting source.",
                );
                return;
              }
              view.dispatch({
                changes: { from: math.from, to: math.to, insert: replacement },
              });
              view.focus();
            },
          },
        }),
      );
      return true;
    },
    [activeFile?.type],
  );

  const handleEditorContextMenu = useCallback((event: React.MouseEvent) => {
    const view = viewRef.current;
    if (!view) return;
    const position =
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      view.state.selection.main.head;
    const selection = view.state.selection.main;
    if (position < selection.from || position > selection.to) {
      view.dispatch({ selection: { anchor: position } });
    }
    setContextPosition(position);
  }, []);

  const handleGoToPdf = useCallback(async () => {
    const view = viewRef.current;
    if (!view || !projectRoot || !activeFile || activeFile.type !== "tex") {
      return;
    }
    const position = Math.min(
      contextPosition ?? view.state.selection.main.head,
      view.state.doc.length,
    );
    const sourceLine = view.state.doc.lineAt(position);
    const location = await synctexView(
      projectRoot,
      activeFile.relativePath,
      sourceLine.number,
    );
    if (!location) {
      toast.error("Could not find the corresponding PDF location", {
        description: "Recompile the document to refresh its SyncTeX data.",
      });
      return;
    }
    requestPdfLocation(location);
  }, [activeFile, contextPosition, projectRoot, requestPdfLocation]);

  const copyEditorSelection = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    view.focus();
  }, []);

  const cutEditorSelection = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to));
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
    });
    view.focus();
  }, []);

  const pasteIntoEditor = useCallback(async () => {
    const view = viewRef.current;
    if (!view) return;
    try {
      const text = await navigator.clipboard.readText();
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    } catch {
      toast.error("Clipboard access was denied");
    }
  }, []);

  const contextBibEntry = (() => {
    const view = viewRef.current;
    if (!view || contextPosition === null || activeFile?.type !== "bib")
      return null;
    return findBibEntryAt(view.state.doc.toString(), contextPosition);
  })();

  const structuredContextLabel = (() => {
    const view = viewRef.current;
    if (!view || contextPosition === null) return null;
    if (activeFile?.type === "bib") {
      return contextBibEntry ? "Edit bibliography entry" : null;
    }
    const source = view.state.doc.toString();
    if (activeFile?.type !== "tex") return null;
    if (findCitationAt(source, contextPosition)) return "Edit citation";
    if (findReferenceAt(source, contextPosition)) return "Edit reference";
    if (findFigureAt(source, contextPosition)) return "Edit figure";
    if (
      findTables(source).some(
        (item) => contextPosition >= item.from && contextPosition <= item.to,
      )
    ) {
      return "Edit table";
    }
    if (
      findMathNodes(source).some(
        (item) => contextPosition >= item.from && contextPosition <= item.to,
      )
    ) {
      return "Edit equation";
    }
    if (findEditableEnvironmentAt(source, contextPosition)) {
      return "Edit environment";
    }
    return null;
  })();

  const editStructuredContext = useCallback(() => {
    const view = viewRef.current;
    if (!view || contextPosition === null) return;
    openCitationEditorAt(view, contextPosition) ||
      openReferenceEditorAt(view, contextPosition) ||
      openFigureEditorAt(view, contextPosition) ||
      openTableEditorAt(view, contextPosition) ||
      openMathEditorAt(view, contextPosition) ||
      openEnvironmentEditorAt(view, contextPosition) ||
      openBibEntryEditorAt(view, contextPosition);
  }, [
    contextPosition,
    openBibEntryEditorAt,
    openCitationEditorAt,
    openEnvironmentEditorAt,
    openFigureEditorAt,
    openMathEditorAt,
    openReferenceEditorAt,
    openTableEditorAt,
  ]);

  const tidyContextBibEntry = useCallback(() => {
    const view = viewRef.current;
    if (!view || contextPosition === null) return;
    tidyBibEntryAt(view, contextPosition);
  }, [contextPosition, tidyBibEntryAt]);

  useEffect(() => {
    isSearchOpenRef.current = isSearchOpen;
  }, [isSearchOpen]);

  useEffect(() => {
    if (!activeFile || !isTextFile || isLargeFileNotLoaded) {
      diagnosticsRef.current = [];
      clearProblemDiagnostics();
    }
  }, [activeFile, isTextFile, isLargeFileNotLoaded, clearProblemDiagnostics]);

  // Proposed changes for active file
  const proposedChanges = useProposedChangesStore((s) => s.changes);
  const activeFileChange = useMemo(() => {
    if (!activeFile) return null;
    return (
      proposedChanges.find((c) => c.filePath === activeFile.relativePath) ??
      null
    );
  }, [proposedChanges, activeFile]);

  // Keep all changes (⌘Y)
  handleKeepAllRef.current = () => {
    const view = viewRef.current;
    const change = pendingChangeRef.current;
    if (!view || !change) return;
    // Unverified bibliography entries must be reviewed chunk by chunk
    if (findUnverifiedBibAdditions(change).length > 0) {
      toast.warning(
        "Keep All is blocked: this change adds bibliography entries that were not built by the reference resolver. Accept them chunk by chunk (Ctrl+Shift+Y).",
      );
      return;
    }
    isMergeActiveRef.current = false;
    setMergeChunkInfo({ total: 0, current: 0 });
    view.dispatch({ effects: mergeCompartmentRef.current.reconfigure([]) });
    setContent(change.newContent);
    useProposedChangesStore.getState().keepChange(change.id);
    pendingChangeRef.current = null;
    // Auto-navigate to next file with pending changes (only if file exists)
    const remaining = useProposedChangesStore.getState().changes;
    if (remaining.length > 0) {
      const docStore = useDocumentStore.getState();
      const nextFile = remaining.find((c) =>
        docStore.files.some((f) => f.relativePath === c.filePath),
      );
      if (nextFile) {
        docStore.setActiveFile(nextFile.filePath);
      }
    }
  };

  // Undo all changes (⌘N)
  handleUndoAllRef.current = () => {
    const view = viewRef.current;
    const change = pendingChangeRef.current;
    if (!view || !change) return;
    isMergeActiveRef.current = false;
    setMergeChunkInfo({ total: 0, current: 0 });
    view.dispatch({ effects: mergeCompartmentRef.current.reconfigure([]) });
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: change.oldContent,
      },
      annotations: Transaction.addToHistory.of(false),
    });
    setContent(change.oldContent);
    useProposedChangesStore.getState().undoChange(change.id);
    pendingChangeRef.current = null;
    // Auto-navigate to next file with pending changes (only if file exists)
    const remaining = useProposedChangesStore.getState().changes;
    if (remaining.length > 0) {
      const docStore = useDocumentStore.getState();
      const nextFile = remaining.find((c) =>
        docStore.files.some((f) => f.relativePath === c.filePath),
      );
      if (nextFile) {
        docStore.setActiveFile(nextFile.filePath);
      }
    }
  };

  // Navigate to a specific chunk by index
  const goToChunk = (index: number) => {
    const view = viewRef.current;
    if (!view) return;
    const chunks = getChunks(view.state);
    if (!chunks || index < 0 || index >= chunks.chunks.length) return;
    const chunk = chunks.chunks[index];
    view.dispatch({
      selection: { anchor: chunk.fromB },
      effects: EditorView.scrollIntoView(chunk.fromB, { y: "center" }),
    });
    view.focus();
  };

  // After individual accept/reject, navigate to next chunk or auto-resolve
  const afterChunkAction = (view: EditorView, prevIdx: number) => {
    const remaining = getChunks(view.state);
    if (!remaining || remaining.chunks.length === 0) {
      // All chunks resolved — clean up merge view
      const change = pendingChangeRef.current;
      if (change) {
        isMergeActiveRef.current = false;
        setMergeChunkInfo({ total: 0, current: 0 });
        const finalContent = view.state.doc.toString();
        view.dispatch({ effects: mergeCompartmentRef.current.reconfigure([]) });
        setContent(finalContent);
        if (finalContent === change.oldContent) {
          useProposedChangesStore.getState().undoChange(change.id);
        } else {
          useProposedChangesStore.getState().keepChange(change.id);
        }
        pendingChangeRef.current = null;
        // Auto-navigate to next file with pending changes
        const pendingChanges = useProposedChangesStore.getState().changes;
        if (pendingChanges.length > 0) {
          useDocumentStore.getState().setActiveFile(pendingChanges[0].filePath);
        }
      }
    } else {
      // Focus the next remaining chunk
      const nextIdx = Math.min(prevIdx, remaining.chunks.length - 1);
      const next = remaining.chunks[nextIdx];
      view.dispatch({
        selection: { anchor: next.fromB },
        effects: EditorView.scrollIntoView(next.fromB, { y: "center" }),
      });
    }
    view.focus();
  };

  const acceptCurrentChunk = () => {
    const view = viewRef.current;
    if (!view) return;
    const chunks = getChunks(view.state);
    const idx = mergeChunkInfo.current - 1;
    if (!chunks || idx < 0 || idx >= chunks.chunks.length) return;
    acceptChunk(view, chunks.chunks[idx].fromB);
    afterChunkAction(view, idx);
  };

  const rejectCurrentChunk = () => {
    const view = viewRef.current;
    if (!view) return;
    const chunks = getChunks(view.state);
    const idx = mergeChunkInfo.current - 1;
    if (!chunks || idx < 0 || idx >= chunks.chunks.length) return;
    rejectChunk(view, chunks.chunks[idx].fromB);
    afterChunkAction(view, idx);
  };
  acceptCurrentChunkRef.current = acceptCurrentChunk;
  rejectCurrentChunkRef.current = rejectCurrentChunk;

  useEffect(() => {
    if (!searchQuery || !activeFileContent) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }
    const regex = new RegExp(
      searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    const matches = activeFileContent.match(regex);
    setMatchCount(matches?.length ?? 0);
    setCurrentMatch(matches && matches.length > 0 ? 1 : 0);
  }, [searchQuery, activeFileContent]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const query = new SearchQuery({
      search: searchQuery,
      caseSensitive: false,
      literal: true,
    });
    view.dispatch({ effects: setSearchQueryEffect.of(query) });
    if (searchQuery) findNext(view);
  }, [searchQuery]);

  const handleFindNext = () => {
    const view = viewRef.current;
    if (view) {
      findNext(view);
      view.focus();
    }
  };
  const handleFindPrevious = () => {
    const view = viewRef.current;
    if (view) {
      findPrevious(view);
      view.focus();
    }
  };

  // Compile: save all files first, then compile via Tauri command.
  // Works from any active file (.bib, .sty, …) — resolveCompileTarget
  // finds the .tex root regardless.
  compileRef.current = async ({ skipIfUnchanged = false } = {}) => {
    const state = useDocumentStore.getState();
    if (!projectRoot || !activeFile) return;
    if (state.isCompiling) {
      // Queue a recompile after the current one finishes
      state.setPendingRecompile(true);
      return;
    }
    const { files: allFiles } = state;
    const resolved = resolveCompileTarget(activeFile.id, allFiles);
    if (!resolved) {
      setCompileError(
        "No .tex file found in this project. Create a main.tex file to compile.",
        activeFile.id,
      );
      return;
    }
    const { rootId, targetPath } = resolved;
    const buildProfile = effectiveCompileProfile(
      rootId,
      state.activeFileId,
      allFiles,
      state.fastCompile,
    );
    // Implicit compiles (save-triggered, auto mode, queued follow-ups) bail
    // when nothing changed since the last successful compile of this root,
    // and defer while the post-build cooldown is active — 1.5× the last
    // build's duration (capped at 5 min), so slow projects are not compiled
    // back-to-back. Explicit compiles (Ctrl+Enter, buttons) always run now.
    if (skipIfUnchanged) {
      if (
        state.lastCompiledGenerations.get(rootId) === state.contentGeneration &&
        profilesEqual(state.pdfBuildProfiles.get(rootId) ?? null, buildProfile)
      ) {
        return;
      }
      const stats = state.lastCompileStats;
      const cooldownUntil = stats
        ? stats.endedAt + Math.min(stats.durationMs * 1.5, 300_000)
        : 0;
      const wait = cooldownUntil - Date.now();
      if (wait > 0) {
        // Defer rather than drop: the build still happens once the project
        // has had breathing room. A single timer absorbs repeated requests.
        if (deferredCompileRef.current)
          clearTimeout(deferredCompileRef.current);
        deferredCompileRef.current = setTimeout(() => {
          deferredCompileRef.current = null;
          compileRef.current({ skipIfUnchanged: true });
        }, wait);
        return;
      }
    }
    useHistoryStore.getState().stopReview();
    setIsCompiling(true);
    state.setPendingRecompile(false);
    const compileStart = Date.now();
    try {
      await saveAllFiles();
      // Pre-compile snapshot (fire-and-forget to avoid blocking compilation start)
      useHistoryStore
        .getState()
        .createSnapshot(projectRoot, "[compile] Pre-compile")
        .catch(() => {});
      const useTexlive =
        useSettingsStore.getState().compilerBackend === "texlive";
      const data = await compileLatex(
        projectRoot,
        targetPath,
        useTexlive,
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
      // If a recompile was requested while we were compiling, trigger it as an
      // implicit compile: skipIfUnchanged routes it through the cooldown so a
      // slow project gets breathing room instead of building back-to-back.
      // Use setTimeout to avoid unbounded recursion on the call stack.
      if (useDocumentStore.getState().pendingRecompile) {
        setTimeout(() => compileRef.current?.({ skipIfUnchanged: true }), 0);
      }
    }
  };

  // Allow the command palette (and other UI) to trigger a compile.
  useEffect(() => {
    const handler = () => compileRef.current();
    window.addEventListener("trigger-compile", handler);
    return () => window.removeEventListener("trigger-compile", handler);
  }, []);

  // Auto-compile mode: recompile ~2s after the last edit anywhere in the
  // project. Every keystroke bumps contentGeneration and resets the timer;
  // skipIfUnchanged makes redundant firings no-ops, edits that land
  // mid-compile are absorbed by the pendingRecompile queue, and the
  // post-build cooldown inside compileRef paces slow projects.
  const autoCompile = useSettingsStore((s) => s.autoCompile);
  const contentGeneration = useDocumentStore((s) => s.contentGeneration);
  useEffect(() => {
    if (!autoCompile) return;
    const timer = setTimeout(() => {
      compileRef.current({ skipIfUnchanged: true });
    }, 2000);
    return () => clearTimeout(timer);
  }, [autoCompile, contentGeneration]);

  useEffect(() => {
    if (!containerRef.current || !isTextFile) return;
    const currentContent = getActiveFileContent();
    diagnosticsRef.current = [];
    clearProblemDiagnostics();

    const updateListener = EditorView.updateListener.of((update) => {
      if (isMergeActiveRef.current) {
        const chunks = getChunks(update.state);
        if (chunks) {
          const total = chunks.chunks.length;
          // Track current chunk based on cursor position
          const cursorPos = update.state.selection.main.head;
          let current = 0;
          for (let i = 0; i < chunks.chunks.length; i++) {
            if (cursorPos >= chunks.chunks[i].fromB) current = i + 1;
          }
          setMergeChunkInfo({
            total,
            current: Math.min(Math.max(1, current), total),
          });

          // Auto-resolve when all chunks have been individually accepted/rejected
          // Note: acceptChunk doesn't change the main doc (only the original),
          // so we check total === 0 regardless of docChanged
          if (total === 0) {
            const change = pendingChangeRef.current;
            if (change) {
              setTimeout(() => {
                const v = viewRef.current;
                if (!v || !isMergeActiveRef.current) return;
                // Guard: bail if already resolved by afterChunkAction or a new stacked edit arrived
                if (pendingChangeRef.current !== change) return;
                isMergeActiveRef.current = false;
                setMergeChunkInfo({ total: 0, current: 0 });
                const finalContent = v.state.doc.toString();
                v.dispatch({
                  effects: mergeCompartmentRef.current.reconfigure([]),
                });
                setContent(finalContent);
                if (finalContent === change.oldContent) {
                  useProposedChangesStore.getState().undoChange(change.id);
                } else {
                  useProposedChangesStore.getState().keepChange(change.id);
                }
                pendingChangeRef.current = null;
                // Auto-navigate to next file with pending changes
                const remaining = useProposedChangesStore.getState().changes;
                if (remaining.length > 0) {
                  useDocumentStore
                    .getState()
                    .setActiveFile(remaining[0].filePath);
                }
              }, 0);
            }
          }
        }
        return;
      }
      if (update.docChanged) setContent(update.state.doc.toString());
      if (update.selectionSet) {
        const { from, to, head } = update.state.selection.main;
        setCursorPosition(head);

        // Compute toolbar position below the selection end
        // Skip toolbar for "select all" (Cmd+A) to avoid overlay issues
        const isSelectAll = from === 0 && to === update.state.doc.length;
        if (from !== to && !isSelectAll) {
          setSelectionRange({ start: from, end: to });
          const startCoords = update.view.coordsAtPos(from);
          const endCoords = update.view.coordsAtPos(to);
          if (endCoords && startCoords) {
            setSelectionCoords({
              top: endCoords.bottom, // below last line of selection
              left: startCoords.left, // aligned to selection start
            });
          }
          toolbarStickyRef.current = true;
        } else if (!toolbarStickyRef.current) {
          // Only clear selection/coords if the toolbar is not being interacted with.
          // Clicking the toolbar input causes CM to lose focus and collapse the selection,
          // but we want to keep the toolbar visible until explicitly dismissed.
          setSelectionRange(null);
          setSelectionCoords(null);
        }
      }

      // Sync diagnostics for Problems panel
      const diags: DiagnosticItem[] = [];
      forEachDiagnostic(update.state, (d, from) => {
        diags.push({
          from,
          to: d.to,
          severity: d.severity,
          message: d.message,
          line: update.state.doc.lineAt(from).number,
        });
      });
      if (
        diags.length !== diagnosticsRef.current.length ||
        diags.some(
          (d, i) =>
            d.from !== diagnosticsRef.current[i]?.from ||
            d.message !== diagnosticsRef.current[i]?.message,
        )
      ) {
        diagnosticsRef.current = diags;
        setProblemDiagnostics(diags, activeFile?.relativePath ?? "main.tex");
      }
    });

    // Wrap selected text with a LaTeX command, or insert empty command at cursor
    const wrapSelection = (view: EditorView, cmd: string): boolean => {
      const { from, to } = view.state.selection.main;
      const selected = view.state.sliceDoc(from, to);
      const wrapped = `\\${cmd}{${selected}}`;
      const cursorPos = selected
        ? from + wrapped.length
        : from + cmd.length + 2;
      view.dispatch({
        changes: { from, to, insert: wrapped },
        selection: { anchor: cursorPos },
      });
      return true;
    };

    const compileKeymap = Prec.highest(
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            compileRef.current();
            return true;
          },
        },
        {
          key: "Alt-Enter",
          run: (view) => {
            const position = view.state.selection.main.head;
            return (
              openCitationEditorAt(view, position) ||
              openReferenceEditorAt(view, position) ||
              openFigureEditorAt(view, position) ||
              openTableEditorAt(view, position) ||
              openMathEditorAt(view, position) ||
              openEnvironmentEditorAt(view, position) ||
              openBibEntryEditorAt(view, position)
            );
          },
        },
        {
          key: "Mod-s",
          run: (view) => {
            const state = useDocumentStore.getState();
            state.setIsSaving(true);
            // Auto-format .tex files before writing to disk (like a
            // prettier-on-save). Never blocks the save: formatting failures
            // (e.g. unbalanced environments mid-edit) are logged and skipped.
            const maybeFormat = async () => {
              const active = state.files.find(
                (f) => f.id === state.activeFileId,
              );
              if (
                active?.type !== "tex" ||
                !useSettingsStore.getState().formatLatexOnSave
              ) {
                return;
              }
              const before = view.state.doc.toString();
              try {
                const formatted = await formatLatexSource(before);
                // Skip if the user kept typing while the formatter ran.
                if (view.state.doc.toString() === before) {
                  applyFormattedText(view, formatted);
                }
              } catch (error) {
                log.warn("Skipping LaTeX auto-format", {
                  error: String(error),
                });
              }
            };
            maybeFormat()
              .then(() => state.saveCurrentFile())
              .then(() => {
                // Overleaf-style save-and-compile: rebuild the detected root
                // document (which may be another file that \input's this one).
                // Fire-and-forget so the saving indicator clears independently.
                compileRef.current({ skipIfUnchanged: true });
              })
              .finally(() => setTimeout(() => state.setIsSaving(false), 500));
            return true;
          },
        },
        {
          key: "Mod-f",
          run: () => {
            setIsSearchOpen(true);
            return true;
          },
        },
        // Find next/previous for the query the custom SearchPanel put into
        // CodeMirror's search state. Bound here rather than by spreading
        // searchKeymap, which would take Mod-f over to CodeMirror's own panel.
        {
          key: "F3",
          run: findNext,
          shift: findPrevious,
          preventDefault: true,
        },
        {
          key: "Mod-d",
          run: selectNextOccurrence,
          preventDefault: true,
        },
        {
          key: "Escape",
          run: () => {
            if (isSearchOpenRef.current) {
              setIsSearchOpen(false);
              return true;
            }
            return false;
          },
        },
        {
          key: "Mod-y",
          run: () => {
            if (isMergeActiveRef.current) {
              handleKeepAllRef.current();
              return true;
            }
            return false;
          },
        },
        {
          key: "Mod-n",
          run: () => {
            if (isMergeActiveRef.current) {
              handleUndoAllRef.current();
              return true;
            }
            return false;
          },
        },
        {
          key: "F8",
          run: (view) =>
            isMergeActiveRef.current ? goToNextChunk(view) : false,
        },
        {
          key: "Shift-F8",
          run: (view) =>
            isMergeActiveRef.current ? goToPreviousChunk(view) : false,
        },
        {
          key: "Mod-Shift-y",
          run: () => {
            if (!isMergeActiveRef.current) return false;
            acceptCurrentChunkRef.current();
            return true;
          },
        },
        {
          key: "Mod-Shift-n",
          run: () => {
            if (!isMergeActiveRef.current) return false;
            rejectCurrentChunkRef.current();
            return true;
          },
        },
        {
          key: "Mod-b",
          run: (view) => wrapSelection(view, "textbf"),
        },
        {
          key: "Mod-i",
          run: (view) => wrapSelection(view, "textit"),
        },
        {
          key: "Mod-/",
          run: toggleComment,
        },
      ]),
    );

    const citationHover = hoverTooltip(
      (view, position) => {
        const citation = findCitationAt(view.state.doc.toString(), position);
        if (!citation) return null;
        return {
          pos: citation.from,
          end: citation.to,
          above: true,
          create: () => {
            const dom = document.createElement("div");
            dom.className =
              "max-w-sm space-y-2 rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-lg";
            const heading = document.createElement("div");
            heading.className =
              "font-medium text-[11px] text-muted-foreground uppercase tracking-wide";
            heading.textContent =
              citation.keys.length === 1
                ? "Citation"
                : `${citation.keys.length} citations`;
            dom.appendChild(heading);

            const entryMap = new Map(
              bibliographyEntriesRef.current.map((entry) => [entry.key, entry]),
            );
            for (const key of citation.keys) {
              const entry = entryMap.get(key);
              const row = document.createElement("div");
              row.className = "space-y-0.5";
              const title = document.createElement("div");
              title.className = entry
                ? "max-w-xs truncate font-medium text-xs"
                : "max-w-xs truncate font-medium text-destructive text-xs";
              title.textContent = entry?.title ?? `Missing reference: ${key}`;
              row.appendChild(title);
              const metadata = document.createElement("div");
              metadata.className =
                "max-w-xs truncate text-[11px] text-muted-foreground";
              metadata.textContent = entry
                ? [entry.author, entry.year].filter(Boolean).join(" · ") || key
                : "Click to choose a replacement";
              row.appendChild(metadata);
              dom.appendChild(row);
            }
            return { dom };
          },
        };
      },
      { hoverTime: 250, hideOnChange: true },
    );

    const referenceHover = hoverTooltip(
      (view, position) => {
        const reference = findReferenceAt(view.state.doc.toString(), position);
        if (!reference) return null;
        return {
          pos: reference.from,
          end: reference.to,
          above: true,
          create: () => {
            const label = labelDefinitionsRef.current.find(
              (definition) => definition.key === reference.key,
            );
            const dom = document.createElement("div");
            dom.className =
              "max-w-sm space-y-1 rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-lg";
            const title = document.createElement("div");
            title.className = label
              ? "max-w-xs truncate font-medium text-xs"
              : "max-w-xs truncate font-medium text-destructive text-xs";
            title.textContent =
              label?.context ?? `Missing label: ${reference.key}`;
            dom.appendChild(title);
            const metadata = document.createElement("div");
            metadata.className =
              "max-w-xs truncate text-[11px] text-muted-foreground";
            metadata.textContent = label
              ? `${label.kind} · ${label.filePath}:${label.line} · ${label.key}`
              : "Click to choose a replacement";
            dom.appendChild(metadata);
            return { dom };
          },
        };
      },
      { hoverTime: 250, hideOnChange: true },
    );

    const state = EditorState.create({
      doc: currentContent,
      extensions: [
        compileKeymap,
        lineNumbers(),
        // The LaTeX grammar already supplies fold ranges for every environment
        // and for part/chapter/section/subsection/subsubsection, and latex()
        // registers a fold service for comment blocks — none of it was
        // reachable without a gutter to click. foldGutter() pulls in
        // codeFolding() itself.
        foldGutter(),
        drawSelection(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        // Alt-drag column selection, for editing tabular bodies.
        rectangularSelection(),
        crosshairCursor(),
        history(),
        keymap.of([
          ...foldKeymap,
          {
            key: "Tab",
            run: (view) => latexTabCompletion(view) || indentMore(view),
            shift: indentLess,
          },
          // The default Enter binding (insertNewlineAndIndent) picks up the
          // LaTeX language's indent rules, which add a unit of indentation for
          // anything inside an environment — i.e. every line of prose inside
          // \begin{document}. Keep the previous line's indentation instead.
          {
            key: "Enter",
            run: insertNewlineKeepIndent,
            shift: insertNewlineKeepIndent,
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        activeFile?.type === "bib"
          ? bibtex()
          : latex({ enableAutocomplete: false, enableLinting: false }),
        ...(activeFile?.type === "tex"
          ? [
              autocompletion({
                override: [
                  semanticCompletionSource,
                  latexCompletionSource(true),
                ],
              }),
              citationDecorationPlugin,
              citationHover,
              referenceDecorationPlugin,
              referenceHover,
              semanticBlockDecorationPlugin,
              EditorView.domEventHandlers({
                click: (event, view) => {
                  // Source-editing mode: clicks only place the cursor; the
                  // structured editors stay reachable via Alt+Enter.
                  if (!useSettingsStore.getState().inlineEditorsOnClick)
                    return false;
                  const position = view.posAtCoords({
                    x: event.clientX,
                    y: event.clientY,
                  });
                  if (position === null) return false;
                  if (openCitationEditorAt(view, position)) return false;
                  if (openReferenceEditorAt(view, position)) return false;
                  if (openFigureEditorAt(view, position)) return false;
                  if (openTableEditorAt(view, position)) return false;
                  if (openMathEditorAt(view, position)) return false;
                  openEnvironmentEditorAt(view, position);
                  return false;
                },
                paste: (event) => {
                  // Image-only clipboards (screenshots, copied image files)
                  // open the figure dialog; the bytes are written to
                  // figures/ only when the user confirms Insert. Clipboards
                  // carrying text keep CodeMirror's default paste.
                  const file = clipboardImageFile(event.clipboardData);
                  if (!file) return false;
                  event.preventDefault();
                  window.dispatchEvent(
                    new CustomEvent("image-pasted-for-figure", {
                      detail: { file },
                    }),
                  );
                  return true;
                },
              }),
            ]
          : []),
        ...(activeFile?.type === "bib"
          ? [
              bibEntryDecorationPlugin,
              EditorView.domEventHandlers({
                click: (event, view) => {
                  if (!useSettingsStore.getState().inlineEditorsOnClick)
                    return false;
                  const position = view.posAtCoords({
                    x: event.clientX,
                    y: event.clientY,
                  });
                  if (position !== null) openBibEntryEditorAt(view, position);
                  return false;
                },
              }),
            ]
          : []),
        ...(activeFile?.type === "tex"
          ? [
              linter((view) => {
                // Wait until the Lezer parser has fully parsed the document
                // to avoid false positives from incomplete syntax trees
                if (!syntaxTreeAvailable(view.state, view.state.doc.length)) {
                  return [];
                }
                const baseLinter = latexLinter();
                const diagnostics = baseLinter(view);
                const showAiActions =
                  useSettingsStore.getState().aiProvider !== "none";
                const enhancedDiagnostics = diagnostics.map(
                  (d: Diagnostic) => ({
                    ...d,
                    message: friendlyLatexDiagnostic(d.message),
                    actions: [
                      ...(d.actions ?? []),
                      ...(showAiActions
                        ? [
                            {
                              name: "Fix with chat",
                              apply: (
                                v: EditorView,
                                from: number,
                                _to: number,
                              ) => {
                                const line = v.state.doc.lineAt(from);
                                const docState = useDocumentStore.getState();
                                const file = docState.files.find(
                                  (f) => f.id === docState.activeFileId,
                                );
                                const fileName =
                                  file?.relativePath ?? "main.tex";
                                const ctx = `[Lint error in ${fileName}:${line.number}]\n[Error: ${d.message}]`;
                                useAiChatStore
                                  .getState()
                                  .sendPrompt(`${ctx}\n\nFix this lint error.`);
                              },
                            },
                          ]
                        : []),
                    ],
                  }),
                );
                const knownKeys = new Set(
                  bibliographyEntriesRef.current.map((entry) => entry.key),
                );
                const citationDiagnostics: Diagnostic[] = findCitations(
                  view.state.doc.toString(),
                ).flatMap((citation) => {
                  const missingKeys = citation.keys.filter(
                    (key) => !knownKeys.has(key),
                  );
                  if (missingKeys.length === 0) return [];
                  return [
                    {
                      from: citation.from,
                      to: citation.to,
                      severity: "warning",
                      message: `Missing bibliography ${missingKeys.length === 1 ? "entry" : "entries"}: ${missingKeys.join(", ")}`,
                      actions: [
                        {
                          name: "Choose replacement",
                          apply: (editorView: EditorView, from: number) => {
                            openCitationEditorAt(editorView, from);
                          },
                        },
                      ],
                    },
                  ];
                });
                const knownLabels = new Set(
                  labelDefinitionsRef.current.map((label) => label.key),
                );
                const referenceDiagnostics: Diagnostic[] = findReferences(
                  view.state.doc.toString(),
                )
                  .filter((reference) => !knownLabels.has(reference.key))
                  .map((reference) => ({
                    from: reference.from,
                    to: reference.to,
                    severity: "warning",
                    message: `Missing label: ${reference.key}`,
                    actions: [
                      {
                        name: "Choose replacement",
                        apply: (editorView: EditorView, from: number) => {
                          openReferenceEditorAt(editorView, from);
                        },
                      },
                    ],
                  }));
                const packageDiagnostics: Diagnostic[] =
                  findMissingPackageRequirements(
                    view.state.doc.toString(),
                    declaredPackagesRef.current,
                  ).map((requirement) => ({
                    from: requirement.from,
                    to: requirement.to,
                    severity: "warning",
                    message: `${requirement.feature} requires the ${requirement.packageName} package.`,
                    actions: [
                      {
                        name: `Add ${requirement.packageName}`,
                        apply: (editorView: EditorView) => {
                          addPackageToProject(
                            editorView,
                            requirement.packageName,
                          );
                        },
                      },
                    ],
                  }));
                return [
                  ...enhancedDiagnostics,
                  ...citationDiagnostics,
                  ...referenceDiagnostics,
                  ...packageDiagnostics,
                  ...(useSettingsStore.getState().latexStyleHints
                    ? styleDiagnostics(view.state.doc.toString())
                    : []),
                ];
              }),
              lintGutter(),
            ]
          : []),
        themeCompartmentRef.current.of(
          getEditorThemeExtensions(editorHighlightTheme, resolvedTheme),
        ),
        fontSizeCompartmentRef.current.of(
          editorFontSizeTheme(useSettingsStore.getState().editorFontSize),
        ),
        search(),
        highlightSelectionMatches(),
        mergeCompartmentRef.current.of([]),
        vimCompartmentRef.current.of([]),
        lensCompartmentRef.current.of(lensActive ? sourceLensExtension : []),
        updateListener,
        EditorView.lineWrapping,
        scrollPastEnd(),
        EditorView.theme({
          "&": {
            height: "100%",
            color: "var(--foreground)",
            backgroundColor: "var(--background)",
            WebkitBackfaceVisibility: "hidden",
            backfaceVisibility: "hidden",
          },
          ".cm-scroller": {
            overflow: "auto",
            WebkitTransform: "translateZ(0)",
            transform: "translateZ(0)",
          },
          ".cm-gutters": { paddingRight: "4px" },
          ".cm-lineNumbers .cm-gutterElement": {
            paddingLeft: "8px",
            paddingRight: "4px",
          },
          // Fold arrows stay quiet until hovered — a LaTeX document makes
          // almost every environment and section foldable, and full-contrast
          // markers down the whole gutter read as clutter.
          ".cm-foldGutter .cm-gutterElement": {
            color: "var(--muted-foreground)",
            opacity: "0.45",
            transition: "opacity 0.15s ease",
          },
          ".cm-foldGutter .cm-gutterElement:hover": { opacity: "1" },
          // The library default is a hard-coded light grey box, unreadable on
          // dark themes.
          ".cm-foldPlaceholder": {
            backgroundColor:
              "color-mix(in srgb, var(--muted-foreground) 15%, transparent)",
            border:
              "1px solid color-mix(in srgb, var(--muted-foreground) 35%, transparent)",
            color: "var(--muted-foreground)",
          },
          ".cm-content": {
            paddingLeft: "8px",
            paddingRight: "12px",
          },
          ".cm-citation-command": {
            borderBottom:
              "1px dotted color-mix(in srgb, var(--primary) 65%, transparent)",
            borderRadius: "2px",
            cursor: "pointer",
            transition: "background-color 0.15s ease",
          },
          ".cm-citation-command:hover": {
            backgroundColor:
              "color-mix(in srgb, var(--primary) 10%, transparent)",
          },
          ".cm-cross-reference-command": {
            borderBottom:
              "1px dotted color-mix(in srgb, var(--chart-2, var(--primary)) 65%, transparent)",
            borderRadius: "2px",
            cursor: "pointer",
            transition: "background-color 0.15s ease",
          },
          ".cm-cross-reference-command:hover": {
            backgroundColor:
              "color-mix(in srgb, var(--chart-2, var(--primary)) 10%, transparent)",
          },
          ".cm-semantic-block-command": {
            borderBottom:
              "1px dotted color-mix(in srgb, var(--chart-3, var(--primary)) 65%, transparent)",
            borderRadius: "2px",
            cursor: "pointer",
          },
          ".cm-semantic-block-command:hover": {
            backgroundColor:
              "color-mix(in srgb, var(--chart-3, var(--primary)) 10%, transparent)",
          },
          ".cm-bib-entry-key": {
            borderBottom:
              "1px dotted color-mix(in srgb, var(--primary) 65%, transparent)",
            borderRadius: "2px",
            cursor: "pointer",
          },
          ".cm-bib-entry-key:hover": {
            backgroundColor:
              "color-mix(in srgb, var(--primary) 10%, transparent)",
          },
          ".cm-searchMatch": {
            backgroundColor: "#facc15 !important",
            color: "#000 !important",
            borderRadius: "2px",
            boxShadow: "0 0 0 1px #eab308",
          },
          ".cm-searchMatch-selected": {
            backgroundColor: "#f97316 !important",
            color: "#fff !important",
            borderRadius: "2px",
            boxShadow: "0 0 0 2px #ea580c",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "rgba(100, 150, 255, 0.3)",
          },
          ".cm-changedLine": {
            backgroundColor: "rgba(34, 197, 94, 0.08) !important",
          },
          ".cm-deletedChunk": {
            backgroundColor: "rgba(239, 68, 68, 0.12) !important",
            paddingLeft: "6px",
            position: "relative",
          },
          ".cm-insertedLine": {
            backgroundColor: "rgba(34, 197, 94, 0.15) !important",
          },
          ".cm-deletedLine": {
            backgroundColor: "rgba(239, 68, 68, 0.15) !important",
          },
          ".cm-changedText": {
            backgroundColor: "rgba(34, 197, 94, 0.25) !important",
          },
          ".cm-chunkButtons": {
            position: "absolute",
            insetInlineEnd: "5px",
            top: "2px",
            zIndex: "10",
          },
          ".cm-chunkButtons button": {
            border: "none",
            cursor: "pointer",
            color: "white",
            margin: "0 2px",
            borderRadius: "3px",
            padding: "2px 8px",
            fontSize: "12px",
            lineHeight: "1.4",
          },
          ".cm-chunkButtons button[name=accept]": {
            backgroundColor: "#22c55e",
          },
          ".cm-chunkButtons button[name=reject]": {
            backgroundColor: "#ef4444",
          },
          ".cm-changeGutter": { width: "3px", minWidth: "3px" },
          ".cm-changedLineGutter": { backgroundColor: "#22c55e" },
          ".cm-deletedLineGutter": { backgroundColor: "#ef4444" },
          ".cm-diagnostic": {
            padding: "8px 10px",
          },
          ".cm-diagnosticAction": {
            display: "inline-block",
            padding: "4px 12px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: "500",
            cursor: "pointer",
            backgroundColor: "var(--muted, rgba(255,255,255,0.08))",
            color: "var(--foreground, #e5e5e5)",
            border: "1px solid var(--border, rgba(255,255,255,0.1))",
            marginTop: "8px",
            transition: "background-color 0.15s, border-color 0.15s",
          },
          ".cm-diagnosticAction:hover": {
            backgroundColor: "var(--accent, rgba(255,255,255,0.15))",
            borderColor: "var(--foreground, rgba(255,255,255,0.3))",
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    // Restore per-file cursor + scroll from cache
    const cached = editorStateCache.get(activeFileId);
    if (cached) {
      const pos = Math.min(cached.cursor, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos, head: pos } });
      // Scroll restoration needs layout to settle
      requestAnimationFrame(() => {
        view.scrollDOM.scrollTop = cached.scrollTop;
      });
    }

    return () => {
      // Save per-file cursor + scroll before destroying
      editorStateCache.set(activeFileId, {
        cursor: view.state.selection.main.head,
        scrollTop: view.scrollDOM.scrollTop,
      });
      view.destroy();
      viewRef.current = null;
    };
  }, [
    addPackageToProject,
    activeFileId,
    activeFile?.relativePath,
    clearProblemDiagnostics,
    isTextFile,
    openBibEntryEditorAt,
    openCitationEditorAt,
    openEnvironmentEditorAt,
    openFigureEditorAt,
    openMathEditorAt,
    openReferenceEditorAt,
    openTableEditorAt,
    setContent,
    setCursorPosition,
    setProblemDiagnostics,
    setSelectionRange,
  ]);

  useEffect(() => {
    if (!projectRoot || activeFile?.type !== "tex") return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (event.payload.type !== "drop") return;
        const imagePaths = event.payload.paths.filter((path) =>
          /\.(?:png|jpe?g|gif|webp|svg|pdf)$/i.test(path),
        );
        if (imagePaths.length === 0) return;
        const confirmed = window.confirm(
          `${imagePaths.length === 1 ? "Copy this image" : `Copy these ${imagePaths.length} images`} into the project's figures folder? The original files will not be changed.`,
        );
        if (!confirmed) return;
        if (!folders.includes("figures")) await createFolder("figures");
        const imported = await importFiles(imagePaths, "figures");
        const view = viewRef.current;
        if (view) {
          const scaleFactor = await getCurrentWindow().scaleFactor();
          const position = event.payload.position;
          const editorPosition = view.posAtCoords({
            x: position.x / scaleFactor,
            y: position.y / scaleFactor,
          });
          if (editorPosition !== null) {
            view.dispatch({
              selection: { anchor: editorPosition },
              scrollIntoView: true,
            });
            view.focus();
          }
        }
        if (imported[0]) {
          window.dispatchEvent(
            new CustomEvent("image-dropped-for-figure", {
              detail: { path: imported[0] },
            }),
          );
        }
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeFile?.type, createFolder, folders, importFiles, projectRoot]);

  // Dynamically switch workspace-matched and independent editor themes.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        getEditorThemeExtensions(editorHighlightTheme, resolvedTheme),
      ),
    });
  }, [editorHighlightTheme, resolvedTheme]);

  // Apply editor text size changes without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: fontSizeCompartmentRef.current.reconfigure(
        editorFontSizeTheme(editorFontSize),
      ),
    });
  }, [editorFontSize]);

  // Ctrl+scroll (and trackpad pinch, which browsers report as ctrl+wheel)
  // adjusts the editor text size, matching common editor behavior.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isTextFile) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return;
      e.preventDefault();
      const settings = useSettingsStore.getState();
      settings.setEditorFontSize(
        settings.editorFontSize + (e.deltaY < 0 ? 1 : -1),
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isTextFile, activeFileId]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!vimMode) {
      view.dispatch({
        effects: vimCompartmentRef.current.reconfigure([]),
      });
      return;
    }
    import("@replit/codemirror-vim").then(({ vim }) => {
      if (viewRef.current !== view) return;
      view.dispatch({
        effects: vimCompartmentRef.current.reconfigure(vim()),
      });
    });
  }, [vimMode, activeFileId, isTextFile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !isTextFile) return;
    view.dispatch({
      effects: lensCompartmentRef.current.reconfigure(
        lensActive ? sourceLensExtension : [],
      ),
    });
  }, [activeFileId, isTextFile, lensActive]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !isTextFile || isMergeActiveRef.current) return;
    const content = activeFileContent ?? "";
    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
    }
  }, [activeFileContent, isTextFile]);

  // Watch for proposed changes → activate/deactivate/update merge view
  useEffect(() => {
    const view = viewRef.current;
    log.debug("effect fired", {
      hasView: !!view,
      isTextFile,
      activeFileChange: activeFileChange
        ? { id: activeFileChange.id, filePath: activeFileChange.filePath }
        : null,
      isMergeActive: isMergeActiveRef.current,
      pendingId: pendingChangeRef.current?.id,
    });
    if (!view || !isTextFile) return;

    if (activeFileChange && !isMergeActiveRef.current) {
      // Activate merge view: load newContent + enable merge extension in ONE atomic dispatch
      log.debug(`ACTIVATING merge view for: ${activeFileChange.filePath}`);
      pendingChangeRef.current = activeFileChange;
      isMergeActiveRef.current = true;
      try {
        const scrollTop = view.scrollDOM.scrollTop;
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: activeFileChange.newContent,
          },
          effects: mergeCompartmentRef.current.reconfigure(
            unifiedMergeView({
              original: activeFileChange.oldContent,
              highlightChanges: true,
              gutter: true,
              mergeControls: true,
            }),
          ),
          annotations: Transaction.addToHistory.of(false),
        });
        view.scrollDOM.scrollTop = scrollTop;
        log.debug("merge view activated successfully");
        // Auto-scroll to first chunk
        setTimeout(() => goToChunk(0), 50);
      } catch (err) {
        log.error("failed to activate merge view", { error: String(err) });
        isMergeActiveRef.current = false;
        pendingChangeRef.current = null;
      }
    } else if (
      activeFileChange &&
      isMergeActiveRef.current &&
      pendingChangeRef.current?.id !== activeFileChange.id
    ) {
      // Stacked edit: the change was updated while merge was already active.
      // Re-dispatch the merge view with the accumulated diff (original → latest).
      log.debug(
        `UPDATING merge view (stacked edit) for: ${activeFileChange.filePath}`,
      );
      pendingChangeRef.current = activeFileChange;
      try {
        const scrollTop = view.scrollDOM.scrollTop;
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: activeFileChange.newContent,
          },
          effects: mergeCompartmentRef.current.reconfigure(
            unifiedMergeView({
              original: activeFileChange.oldContent,
              highlightChanges: true,
              gutter: true,
              mergeControls: true,
            }),
          ),
          annotations: Transaction.addToHistory.of(false),
        });
        view.scrollDOM.scrollTop = scrollTop;
        log.debug("merge view updated successfully (stacked edit)");
      } catch (err) {
        log.error("failed to update merge view", { error: String(err) });
      }
    } else if (!activeFileChange && isMergeActiveRef.current) {
      // Deactivate merge view (externally resolved)
      log.debug("DEACTIVATING merge view");
      view.dispatch({ effects: mergeCompartmentRef.current.reconfigure([]) });
      isMergeActiveRef.current = false;
      pendingChangeRef.current = null;
    }
  }, [activeFileChange, isTextFile]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || jumpToPosition === null) return;
    view.dispatch({
      selection: { anchor: jumpToPosition },
      effects: EditorView.scrollIntoView(jumpToPosition, { y: "center" }),
    });
    view.focus();
    clearJumpRequest();
  }, [jumpToPosition, clearJumpRequest]);

  // Selection toolbar: compute context label and container-relative position
  const selectionRange = useDocumentStore((s) => s.selectionRange);
  const selectionLabel = useMemo(() => {
    const view = viewRef.current;
    if (!selectionRange || !view || !activeFile) return null;
    try {
      const startLine = view.state.doc.lineAt(selectionRange.start);
      const endLine = view.state.doc.lineAt(selectionRange.end);
      const startCol = selectionRange.start - startLine.from + 1;
      const endCol = selectionRange.end - endLine.from + 1;
      const fileName = activeFile.relativePath;
      return `@${fileName}:${startLine.number}:${startCol}-${endLine.number}:${endCol}`;
    } catch {
      return null;
    }
  }, [selectionRange, activeFile]);

  const toolbarPosition = useMemo(() => {
    if (!selectionCoords || !parentRef.current) return null;
    const parentRect = parentRef.current.getBoundingClientRect();
    const relTop = selectionCoords.top - parentRect.top + 4; // 4px gap below selection
    const relLeft = Math.max(
      8,
      Math.min(
        selectionCoords.left - parentRect.left,
        parentRect.width - 272, // 264px toolbar + 8px margin
      ),
    );
    return { top: relTop, left: relLeft };
  }, [selectionCoords]);

  const citationEditorPosition = useMemo(() => {
    if (!citationEditor || !parentRef.current) return null;
    const parentRect = parentRef.current.getBoundingClientRect();
    const width = Math.min(460, Math.max(280, parentRect.width - 16));
    const left = Math.max(
      8,
      Math.min(
        citationEditor.anchor.left - parentRect.left,
        parentRect.width - width - 8,
      ),
    );
    const below = citationEditor.anchor.bottom - parentRect.top + 6;
    const top = Math.max(8, Math.min(below, parentRect.height - 520));
    return { top, left };
  }, [citationEditor]);

  const dismissCitationEditor = useCallback(() => {
    setCitationEditor(null);
    viewRef.current?.focus();
  }, []);

  const applyCitationEdit = useCallback(
    (draft: CitationDraft) => {
      const view = viewRef.current;
      const currentTarget = citationEditor?.target;
      if (!view || !currentTarget) return;
      const currentSource = view.state.sliceDoc(
        currentTarget.from,
        currentTarget.to,
      );
      if (currentSource !== currentTarget.source) {
        setCitationEditor(null);
        view.focus();
        return;
      }

      const replacement = serializeCitation(draft);
      view.dispatch({
        changes: {
          from: currentTarget.from,
          to: currentTarget.to,
          insert: replacement,
        },
        selection: { anchor: currentTarget.from + replacement.length },
      });
      setCitationEditor(null);
      view.focus();
    },
    [citationEditor],
  );

  const referenceEditorPosition = useMemo(() => {
    if (!referenceEditor || !parentRef.current) return null;
    const parentRect = parentRef.current.getBoundingClientRect();
    const width = Math.min(420, Math.max(280, parentRect.width - 16));
    const left = Math.max(
      8,
      Math.min(
        referenceEditor.anchor.left - parentRect.left,
        parentRect.width - width - 8,
      ),
    );
    const below = referenceEditor.anchor.bottom - parentRect.top + 6;
    const top = Math.max(8, Math.min(below, parentRect.height - 440));
    return { top, left };
  }, [referenceEditor]);

  const dismissReferenceEditor = useCallback(() => {
    setReferenceEditor(null);
    viewRef.current?.focus();
  }, []);

  const applyReferenceEdit = useCallback(
    (draft: ReferenceDraft) => {
      const view = viewRef.current;
      const currentTarget = referenceEditor?.target;
      if (!view || !currentTarget) return;
      const currentSource = view.state.sliceDoc(
        currentTarget.from,
        currentTarget.to,
      );
      if (currentSource !== currentTarget.source) {
        setReferenceEditor(null);
        view.focus();
        return;
      }
      const replacement = serializeReference(draft);
      view.dispatch({
        changes: {
          from: currentTarget.from,
          to: currentTarget.to,
          insert: replacement,
        },
        selection: { anchor: currentTarget.from + replacement.length },
      });
      setReferenceEditor(null);
      view.focus();
    },
    [referenceEditor],
  );

  const figureEditorPosition = useMemo(() => {
    if (!figureEditor || !parentRef.current) return null;
    const parentRect = parentRef.current.getBoundingClientRect();
    const width = Math.min(480, Math.max(280, parentRect.width - 16));
    return {
      top: Math.max(
        8,
        Math.min(
          figureEditor.anchor.bottom - parentRect.top + 6,
          parentRect.height - 430,
        ),
      ),
      left: Math.max(
        8,
        Math.min(
          figureEditor.anchor.left - parentRect.left,
          parentRect.width - width - 8,
        ),
      ),
    };
  }, [figureEditor]);

  const environmentEditorPosition = useMemo(() => {
    if (!environmentEditor || !parentRef.current) return null;
    const parentRect = parentRef.current.getBoundingClientRect();
    const width = Math.min(380, Math.max(280, parentRect.width - 16));
    return {
      top: Math.max(
        8,
        Math.min(
          environmentEditor.anchor.bottom - parentRect.top + 6,
          parentRect.height - 360,
        ),
      ),
      left: Math.max(
        8,
        Math.min(
          environmentEditor.anchor.left - parentRect.left,
          parentRect.width - width - 8,
        ),
      ),
    };
  }, [environmentEditor]);

  const dismissFigureEditor = useCallback(() => {
    setFigureEditor(null);
    viewRef.current?.focus();
  }, []);

  const dismissEnvironmentEditor = useCallback(() => {
    setEnvironmentEditor(null);
    viewRef.current?.focus();
  }, []);

  const applySemanticBlockEdit = useCallback(
    (
      editor: "figure" | "environment",
      target: FigureMatch | EnvironmentMatch,
      replacement: string,
    ) => {
      const view = viewRef.current;
      if (
        !view ||
        view.state.sliceDoc(target.from, target.to) !== target.source
      ) {
        setFigureEditor(null);
        setEnvironmentEditor(null);
        view?.focus();
        return;
      }
      view.dispatch({
        changes: { from: target.from, to: target.to, insert: replacement },
        selection: { anchor: target.from + replacement.length },
      });
      if (editor === "figure") setFigureEditor(null);
      else setEnvironmentEditor(null);
      view.focus();
    },
    [],
  );

  const bibEntryEditorPosition = useMemo(() => {
    if (!bibEntryEditor || !parentRef.current) return null;
    const parentRect = parentRef.current.getBoundingClientRect();
    const width = Math.min(540, Math.max(300, parentRect.width - 16));
    return {
      top: Math.max(
        8,
        Math.min(
          bibEntryEditor.anchor.bottom - parentRect.top + 6,
          parentRect.height - 520,
        ),
      ),
      left: Math.max(
        8,
        Math.min(
          bibEntryEditor.anchor.left - parentRect.left,
          parentRect.width - width - 8,
        ),
      ),
    };
  }, [bibEntryEditor]);

  const dismissBibEntryEditor = useCallback(() => {
    setBibEntryEditor(null);
    viewRef.current?.focus();
  }, []);

  const applyBibEntryEdit = useCallback(
    (replacement: string) => {
      const view = viewRef.current;
      const target = bibEntryEditor?.target;
      if (
        !view ||
        !target ||
        view.state.sliceDoc(target.from, target.to) !== target.source
      ) {
        setBibEntryEditor(null);
        view?.focus();
        return;
      }
      view.dispatch({
        changes: { from: target.from, to: target.to, insert: replacement },
        selection: { anchor: target.from + replacement.length },
      });
      setBibEntryEditor(null);
      view.focus();
    },
    [bibEntryEditor],
  );

  // Snapshot the selected text/label before the toolbar clears selectionRange,
  // so canned prompts and the free-form input still carry the right context.
  const captureSelectionContext = useCallback(():
    | { label: string; filePath: string; selectedText: string }
    | undefined => {
    const view = viewRef.current;
    if (!view || !selectionRange || !activeFile) return undefined;
    const selectedText = view.state.sliceDoc(
      selectionRange.start,
      selectionRange.end,
    );
    if (!selectedText) return undefined;
    return {
      label: selectionLabel ?? activeFile.relativePath,
      filePath: activeFile.relativePath,
      selectedText,
    };
  }, [selectionRange, selectionLabel, activeFile]);

  const handleToolbarSendPrompt = useCallback(
    (prompt: string) => {
      const contextOverride = captureSelectionContext();
      toolbarStickyRef.current = false;
      setSelectionCoords(null);
      setSelectionRange(null);
      useAiChatStore.getState().sendPrompt(prompt, contextOverride);
    },
    [captureSelectionContext, setSelectionRange],
  );

  const editorToolbarActions: ToolbarAction[] = useMemo(() => {
    if (aiProvider === "none") return [];
    const view = viewRef.current;
    const selectedText =
      view && selectionRange
        ? view.state.sliceDoc(selectionRange.start, selectionRange.end)
        : "";
    const wordCount = selectedText.trim()
      ? selectedText.trim().split(/\s+/).length
      : 0;
    const actions: ToolbarAction[] = [
      {
        id: "proofread",
        label: "Proofread",
        icon: <SpellCheckIcon className="size-4" />,
      },
      {
        id: "paraphrase",
        label: "Paraphrase",
        icon: <RefreshCwIcon className="size-4" />,
      },
      {
        id: "shorten",
        label: "Shorten",
        icon: <MinimizeIcon className="size-4" />,
      },
      {
        id: "expand",
        label: "Expand",
        icon: <MaximizeIcon className="size-4" />,
      },
      {
        id: "explain",
        label: "Explain",
        icon: <LightbulbIcon className="size-4" />,
      },
      {
        id: "translate",
        label: "Translate to…",
        icon: <LanguagesIcon className="size-4" />,
        prefill: "Translate this to ",
      },
    ];
    // Web search only makes sense for a short phrase, not a whole paragraph.
    if (wordCount > 0 && wordCount <= 6) {
      actions.push({
        id: "search-web",
        label: "Search the web",
        icon: <SearchIcon className="size-4" />,
      });
    }
    return actions;
  }, [aiProvider, selectionRange]);

  const handleToolbarAction = useCallback(
    (actionId: string) => {
      const contextOverride = captureSelectionContext();
      const selectedText = contextOverride?.selectedText ?? "";
      toolbarStickyRef.current = false;
      setSelectionCoords(null);
      setSelectionRange(null);

      if (actionId === "search-web") {
        if (selectedText.trim()) {
          void openExternalUrl(
            `https://www.google.com/search?q=${encodeURIComponent(selectedText.trim())}`,
          );
        }
        return;
      }

      const cannedPrompts: Record<string, string> = {
        proofread: "Proofread and fix any errors in this text",
        paraphrase: "Paraphrase this text, keeping the same meaning",
        shorten: "Shorten this text while preserving its key meaning",
        expand: "Expand this text with more detail and explanation",
        explain:
          "Explain this text in plain language, including any notation or jargon used",
      };
      const prompt = cannedPrompts[actionId];
      if (prompt) {
        useAiChatStore.getState().sendPrompt(prompt, contextOverride);
      }
    },
    [captureSelectionContext, setSelectionRange],
  );

  const handleToolbarDismiss = useCallback(() => {
    toolbarStickyRef.current = false;
    setSelectionCoords(null);
    setSelectionRange(null);
  }, [setSelectionRange]);

  // History review action handlers
  const handleHistoryRestore = useCallback(async () => {
    if (!reviewingSnapshot || !projectRoot) return;
    useHistoryStore.getState().stopReview();
    await useHistoryStore
      .getState()
      .restoreSnapshot(projectRoot, reviewingSnapshot.id);
    await useDocumentStore.getState().openProject(projectRoot);
    await useHistoryStore.getState().loadSnapshots(projectRoot);
  }, [reviewingSnapshot, projectRoot]);

  const [historyLabelDialogOpen, setHistoryLabelDialogOpen] = useState(false);
  const [historyLabelValue, setHistoryLabelValue] = useState("");

  const handleHistoryAddLabel = useCallback(async () => {
    const label = historyLabelValue.trim();
    if (!label || !reviewingSnapshot || !projectRoot) return;
    await useHistoryStore
      .getState()
      .addLabel(projectRoot, reviewingSnapshot.id, label);
    setHistoryLabelDialogOpen(false);
    setHistoryLabelValue("");
  }, [reviewingSnapshot, projectRoot, historyLabelValue]);

  const handleHistoryCopySha = useCallback(() => {
    if (!reviewingSnapshot) return;
    navigator.clipboard.writeText(reviewingSnapshot.id);
  }, [reviewingSnapshot]);

  const handleHistoryClose = useCallback(() => {
    useHistoryStore.getState().stopReview();
  }, []);

  const isPdf = activeFile?.type === "pdf";
  const isImage = !isTextFile && !isPdf && !!activeFile;
  const contextView = viewRef.current;
  const contextSelection = contextView?.state.selection.main;
  const hasEditorSelection =
    !!contextSelection && contextSelection.from !== contextSelection.to;
  const canUndoEditor = contextView ? undoDepth(contextView.state) > 0 : false;
  const canRedoEditor = contextView ? redoDepth(contextView.state) > 0 : false;

  return (
    <div className="flex h-full flex-col bg-background">
      <EditorTabs />
      {/* Toolbar — adapts to file type */}
      <EditorToolbar
        editorView={viewRef}
        fileType={
          isPdf || isImage
            ? "image"
            : activeFile?.type === "bib"
              ? "bib"
              : undefined
        }
        imageScale={isPdf || isImage ? imageScale : undefined}
        onImageScaleChange={isPdf || isImage ? setImageScale : undefined}
        cropMode={isImage ? cropMode : undefined}
        onCropToggle={isImage ? () => setCropMode((v) => !v) : undefined}
      />
      {/* Text-editor-only panels */}
      {!isPdf && !isImage && !isLargeFileNotLoaded && isSearchOpen && (
        <SearchPanel
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onClose={() => {
            setIsSearchOpen(false);
            setSearchQuery("");
            viewRef.current?.focus();
          }}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          matchCount={matchCount}
          currentMatch={currentMatch}
        />
      )}
      {!isPdf && !isImage && !isLargeFileNotLoaded && reviewingSnapshot && (
        <div className="flex h-9 shrink-0 items-center justify-between border-border border-b bg-amber-500/10 px-3">
          <div className="flex items-center gap-2 text-xs">
            <RotateCcwIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
            <span className="font-medium text-amber-700 dark:text-amber-300">
              Reviewing history
            </span>
            <span className="text-muted-foreground">
              {reviewingSnapshot.message.replace(/^\[.*?\]\s*/, "")} &middot;{" "}
              {reviewingSnapshot.id.slice(0, 7)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={handleHistoryRestore}
            >
              <RotateCcwIcon className="size-3" />
              Restore
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => {
                setHistoryLabelDialogOpen(true);
                setHistoryLabelValue("");
              }}
            >
              <TagIcon className="size-3" />
              Label
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              onClick={handleHistoryCopySha}
            >
              <CopyIcon className="size-3" />
              SHA
            </Button>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={handleHistoryClose}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
      {/* Main content area — single wrapper keeps AiChatDrawer stable */}
      <div
        ref={isPdf || isImage ? undefined : parentRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* PDF content */}
        {isPdf && activeFile && (
          <InlinePdfContent
            file={activeFile}
            imageScale={imageScale}
            onImageScaleChange={setImageScale}
          />
        )}
        {/* Image content */}
        {isImage && activeFile && (
          <ImagePreview
            file={activeFile}
            scale={imageScale}
            onScaleChange={setImageScale}
            cropMode={cropMode}
            onCropModeChange={setCropMode}
          />
        )}
        {/* Large file warning */}
        {isLargeFileNotLoaded && activeFile && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="max-w-md rounded-lg border border-border bg-card/50 p-6 shadow-sm">
              <p className="mb-1 font-medium text-foreground text-sm">
                {activeFile.name}
              </p>
              <p className="mb-4 text-muted-foreground text-xs">
                This file is large (
                {activeFile.fileSize != null
                  ? `${(activeFile.fileSize / (1024 * 1024)).toFixed(1)} MB`
                  : "unknown size"}
                ). Opening it may slow down the editor.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => loadFileContent(activeFile.id)}
              >
                Open Anyway
              </Button>
            </div>
          </div>
        )}
        {/* Text editor content */}
        {!isPdf && !isImage && !isLargeFileNotLoaded && (
          <>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  ref={containerRef}
                  className={reviewingSnapshot ? "hidden" : "absolute inset-0"}
                  onContextMenu={handleEditorContextMenu}
                />
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-60">
                {activeFile?.type === "tex" && (
                  <>
                    <ContextMenuSub>
                      <ContextMenuSubTrigger>
                        <PlusIcon />
                        Add here
                      </ContextMenuSubTrigger>
                      <ContextMenuSubContent className="w-52">
                        <ContextMenuItem
                          onSelect={() =>
                            dispatchEditorAction("insert.section")
                          }
                        >
                          <Heading1Icon />
                          Section
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            dispatchEditorAction("insert.subsection")
                          }
                        >
                          <Heading2Icon />
                          Subsection
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            dispatchEditorAction("insert.list-item")
                          }
                        >
                          <ListIcon />
                          List item
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onSelect={() =>
                            dispatchEditorAction("insert.citation")
                          }
                        >
                          <BookMarkedIcon />
                          Citation…
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            dispatchEditorAction("insert.cross-reference")
                          }
                        >
                          <Link2Icon />
                          Cross-reference…
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => dispatchEditorAction("insert.figure")}
                        >
                          <ImagePlusIcon />
                          Figure…
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => dispatchEditorAction("insert.table")}
                        >
                          <Table2Icon />
                          Table…
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            dispatchEditorAction("insert.equation")
                          }
                        >
                          <SigmaIcon />
                          Equation…
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() =>
                            dispatchEditorAction("insert.environment")
                          }
                        >
                          <BoxesIcon />
                          More structures…
                        </ContextMenuItem>
                      </ContextMenuSubContent>
                    </ContextMenuSub>
                    <ContextMenuSeparator />
                  </>
                )}
                {activeFile?.type === "tex" && (
                  <ContextMenuItem
                    disabled={!projectRoot || !pdfAvailable}
                    onSelect={() => void handleGoToPdf()}
                  >
                    <FileSearchIcon />
                    Go to PDF location
                    {!pdfAvailable && (
                      <ContextMenuShortcut>
                        Compile to enable
                      </ContextMenuShortcut>
                    )}
                  </ContextMenuItem>
                )}
                {structuredContextLabel && (
                  <ContextMenuItem onSelect={editStructuredContext}>
                    <PencilIcon />
                    {structuredContextLabel}
                  </ContextMenuItem>
                )}
                {contextBibEntry && (
                  <ContextMenuItem onSelect={tidyContextBibEntry}>
                    <BrushCleaningIcon />
                    Tidy this reference
                  </ContextMenuItem>
                )}
                {(activeFile?.type === "tex" || structuredContextLabel) && (
                  <ContextMenuSeparator />
                )}
                <ContextMenuItem
                  disabled={!canUndoEditor}
                  onSelect={() => {
                    const view = viewRef.current;
                    if (view) {
                      undo(view);
                      view.focus();
                    }
                  }}
                >
                  <Undo2Icon />
                  Undo
                  <ContextMenuShortcut>Mod+Z</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!canRedoEditor}
                  onSelect={() => {
                    const view = viewRef.current;
                    if (view) {
                      redo(view);
                      view.focus();
                    }
                  }}
                >
                  <Redo2Icon />
                  Redo
                  <ContextMenuShortcut>Mod+Shift+Z</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={!hasEditorSelection}
                  onSelect={() => void cutEditorSelection()}
                >
                  <ScissorsIcon />
                  Cut
                  <ContextMenuShortcut>Mod+X</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={!hasEditorSelection}
                  onSelect={() => void copyEditorSelection()}
                >
                  <CopyIcon />
                  Copy
                  <ContextMenuShortcut>Mod+C</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void pasteIntoEditor()}>
                  <ClipboardPasteIcon />
                  Paste
                  <ContextMenuShortcut>Mod+V</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    const view = viewRef.current;
                    if (view) {
                      selectAll(view);
                      view.focus();
                    }
                  }}
                >
                  <TextSelectIcon />
                  Select all
                  <ContextMenuShortcut>Mod+A</ContextMenuShortcut>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            {citationEditor &&
              citationEditorPosition &&
              !reviewingSnapshot &&
              !isMergeActiveRef.current && (
                <CitationInlineEditor
                  key={`${citationEditor.target.from}:${citationEditor.target.source}`}
                  target={citationEditor.target}
                  position={citationEditorPosition}
                  files={files}
                  citationPackage={citationPackage}
                  onApply={applyCitationEdit}
                  onDismiss={dismissCitationEditor}
                />
              )}
            {referenceEditor &&
              referenceEditorPosition &&
              !reviewingSnapshot &&
              !isMergeActiveRef.current && (
                <CrossReferenceInlineEditor
                  key={`${referenceEditor.target.from}:${referenceEditor.target.source}`}
                  target={referenceEditor.target}
                  labels={labelDefinitions}
                  referencePackage={referencePackage}
                  position={referenceEditorPosition}
                  onApply={applyReferenceEdit}
                  onDismiss={dismissReferenceEditor}
                />
              )}
            {figureEditor &&
              figureEditorPosition &&
              !reviewingSnapshot &&
              !isMergeActiveRef.current && (
                <FigureInlineEditor
                  key={`${figureEditor.target.from}:${figureEditor.target.source}`}
                  target={figureEditor.target}
                  files={files}
                  position={figureEditorPosition}
                  onApply={(source) =>
                    applySemanticBlockEdit(
                      "figure",
                      figureEditor.target,
                      source,
                    )
                  }
                  onDismiss={dismissFigureEditor}
                />
              )}
            {environmentEditor &&
              environmentEditorPosition &&
              !reviewingSnapshot &&
              !isMergeActiveRef.current && (
                <EnvironmentInlineEditor
                  key={`${environmentEditor.target.from}:${environmentEditor.target.source}`}
                  target={environmentEditor.target}
                  position={environmentEditorPosition}
                  onApply={(source) =>
                    applySemanticBlockEdit(
                      "environment",
                      environmentEditor.target,
                      source,
                    )
                  }
                  onDismiss={dismissEnvironmentEditor}
                />
              )}
            {bibEntryEditor &&
              bibEntryEditorPosition &&
              !reviewingSnapshot &&
              !isMergeActiveRef.current && (
                <BibEntryInlineEditor
                  key={`${bibEntryEditor.target.from}:${bibEntryEditor.target.source}`}
                  target={bibEntryEditor.target}
                  position={bibEntryEditorPosition}
                  onApply={applyBibEntryEdit}
                  onDismiss={dismissBibEntryEditor}
                />
              )}
            {reviewingSnapshot && historyDiffResult && (
              <HistoryDiffView diffs={historyDiffResult} />
            )}
            {aiProvider !== "none" &&
              toolbarPosition &&
              selectionLabel &&
              !isMergeActiveRef.current &&
              !isSearchOpen && (
                <SelectionToolbar
                  position={toolbarPosition}
                  contextLabel={selectionLabel}
                  actions={editorToolbarActions}
                  onSendPrompt={handleToolbarSendPrompt}
                  onAction={handleToolbarAction}
                  onDismiss={handleToolbarDismiss}
                />
              )}
            {activeFileChange && mergeChunkInfo.total > 0 && (
              <div className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-lg border border-border bg-background/95 px-2 py-1 shadow-lg backdrop-blur-sm">
                <span className="px-1 font-mono text-muted-foreground text-xs">
                  ±&nbsp;{mergeChunkInfo.current}/{mergeChunkInfo.total}
                </span>
                <div className="mx-0.5 h-4 w-px bg-border" />
                <button
                  onClick={() =>
                    goToChunk(
                      mergeChunkInfo.current <= 1
                        ? mergeChunkInfo.total - 1
                        : mergeChunkInfo.current - 2,
                    )
                  }
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  title="Previous change (Shift+F8)"
                  aria-label="Previous change"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  onClick={() =>
                    goToChunk(
                      mergeChunkInfo.current >= mergeChunkInfo.total
                        ? 0
                        : mergeChunkInfo.current,
                    )
                  }
                  className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                  title="Next change (F8)"
                  aria-label="Next change"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div className="mx-0.5 h-4 w-px bg-border" />
                <button
                  onClick={acceptCurrentChunk}
                  className="rounded p-0.5 text-green-400 transition-colors hover:bg-green-600/20"
                  title="Accept this change (Ctrl+Shift+Y)"
                  aria-label="Accept this change"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <button
                  onClick={rejectCurrentChunk}
                  className="rounded p-0.5 text-red-400 transition-colors hover:bg-red-600/20"
                  title="Reject this change (Ctrl+Shift+N)"
                  aria-label="Reject this change"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
        {/* Chat drawer — shown only when AI provider is configured */}
        {aiProvider !== "none" && <AiChatDrawer />}
      </div>
      {/* Text-editor-only review panels */}
      {!isPdf && !isImage && !isLargeFileNotLoaded && activeFileChange && (
        <ProposedChangesPanel
          change={activeFileChange}
          changeIndex={proposedChanges.findIndex(
            (c) => c.filePath === activeFile?.relativePath,
          )}
          totalChanges={proposedChanges.length}
          onKeep={() => handleKeepAllRef.current()}
          onUndo={() => handleUndoAllRef.current()}
        />
      )}
      {/* History label dialog */}
      <Dialog
        open={historyLabelDialogOpen}
        onOpenChange={setHistoryLabelDialogOpen}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Label</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder="e.g. Draft v1"
              value={historyLabelValue}
              onChange={(e) => setHistoryLabelValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleHistoryAddLabel();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setHistoryLabelDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleHistoryAddLabel}
              disabled={!historyLabelValue.trim()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Inline PDF Content (data loading + MuPDF PdfViewer) ───

function InlinePdfContent({
  file,
  imageScale,
  onImageScaleChange,
}: {
  file: ProjectFile;
  imageScale: number;
  onImageScaleChange: (scale: number) => void;
}) {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitted, setFitted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPdfData(null);
    setError(null);
    setFitted(false);

    readFile(file.absolutePath)
      .then((data) => {
        if (!cancelled) setPdfData(new Uint8Array(data));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [file.absolutePath]);

  const handleFirstPageSize = useCallback(
    (pageWidth: number) => {
      const containerWidth = wrapperRef.current?.clientWidth;
      if (!containerWidth || !onImageScaleChange) return;
      const fitScale = (containerWidth - 32) / pageWidth; // 32px padding
      onImageScaleChange(Math.max(0.25, Math.min(2, fitScale)));
      setFitted(true);
    },
    [onImageScaleChange],
  );

  if (pdfData) {
    return (
      <div
        ref={wrapperRef}
        className="flex min-h-0 flex-1 flex-col"
        style={{ opacity: fitted ? 1 : 0 }}
      >
        <PdfViewer
          data={pdfData}
          scale={imageScale}
          onScaleChange={onImageScaleChange}
          onFirstPageSize={handleFirstPageSize}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Failed to load PDF: {error}
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
      Loading PDF...
    </div>
  );
}

// ─── History Diff View (git-diff style combined view) ───

function HistoryDiffView({ diffs }: { diffs: FileDiff[] }) {
  return (
    <div className="absolute inset-0 overflow-y-auto bg-background font-mono text-xs leading-relaxed">
      {diffs.map((diff) => (
        <div key={diff.file_path} className="border-border border-b">
          {/* File header */}
          <div className="sticky top-0 z-10 flex items-center gap-2 border-border border-b bg-muted/80 px-4 py-1.5 backdrop-blur-sm">
            <span
              className={
                diff.status === "added"
                  ? "font-bold text-green-600 dark:text-green-400"
                  : diff.status === "deleted"
                    ? "font-bold text-red-600 dark:text-red-400"
                    : "font-bold text-blue-600 dark:text-blue-400"
              }
            >
              {diff.status === "added"
                ? "+"
                : diff.status === "deleted"
                  ? "−"
                  : "~"}
            </span>
            <span className="font-medium text-foreground">
              {diff.file_path}
            </span>
            <span className="text-muted-foreground">({diff.status})</span>
          </div>
          {/* Diff lines */}
          <DiffLines diff={diff} />
        </div>
      ))}
      {diffs.length === 0 && (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          No changes in this snapshot
        </div>
      )}
    </div>
  );
}

function DiffLines({ diff }: { diff: FileDiff }) {
  const oldLines = diff.old_content?.split("\n") ?? [];
  const newLines = diff.new_content?.split("\n") ?? [];

  if (diff.status === "added") {
    return (
      <div className="px-1">
        {newLines.map((line, i) => (
          <div key={i} className="flex bg-green-500/10">
            <span className="w-12 shrink-0 select-none pr-2 text-right text-green-500/50">
              {i + 1}
            </span>
            <span className="mr-1 select-none text-green-500/50">+</span>
            <span className="text-green-700 dark:text-green-400">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (diff.status === "deleted") {
    return (
      <div className="px-1">
        {oldLines.map((line, i) => (
          <div key={i} className="flex bg-red-500/10">
            <span className="w-12 shrink-0 select-none pr-2 text-right text-red-500/50">
              {i + 1}
            </span>
            <span className="mr-1 select-none text-red-500/50">−</span>
            <span className="text-red-700 dark:text-red-400">
              {line || " "}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Modified: compute unified diff with context
  const hunks = computeUnifiedHunks(oldLines, newLines, 3);

  return (
    <div className="px-1">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div className="bg-blue-500/10 px-1 text-blue-600 dark:text-blue-400">
            @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount}{" "}
            @@
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className={
                line.type === "del"
                  ? "flex bg-red-500/10"
                  : line.type === "add"
                    ? "flex bg-green-500/10"
                    : "flex"
              }
            >
              <span
                className={`w-12 shrink-0 select-none pr-2 text-right ${
                  line.type === "del"
                    ? "text-red-500/50"
                    : line.type === "add"
                      ? "text-green-500/50"
                      : "text-muted-foreground/50"
                }`}
              >
                {line.type !== "add" ? line.oldNum : ""}
              </span>
              <span
                className={`w-12 shrink-0 select-none pr-2 text-right ${
                  line.type === "del"
                    ? "text-red-500/50"
                    : line.type === "add"
                      ? "text-green-500/50"
                      : "text-muted-foreground/50"
                }`}
              >
                {line.type !== "del" ? line.newNum : ""}
              </span>
              <span
                className={`mr-1 select-none ${
                  line.type === "del"
                    ? "text-red-500/50"
                    : line.type === "add"
                      ? "text-green-500/50"
                      : "text-muted-foreground/30"
                }`}
              >
                {line.type === "del" ? "−" : line.type === "add" ? "+" : " "}
              </span>
              <span
                className={
                  line.type === "del"
                    ? "text-red-700 dark:text-red-400"
                    : line.type === "add"
                      ? "text-green-700 dark:text-green-400"
                      : "text-muted-foreground"
                }
              >
                {line.text || " "}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

interface DiffLine {
  type: "ctx" | "del" | "add";
  text: string;
  oldNum?: number;
  newNum?: number;
}

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

function computeUnifiedHunks(
  oldLines: string[],
  newLines: string[],
  context: number,
): Hunk[] {
  // Simple line-by-line diff to find changed regions
  const ops: {
    type: "eq" | "del" | "add";
    oldIdx?: number;
    newIdx?: number;
    text: string;
  }[] = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    if (
      i < oldLines.length &&
      j < newLines.length &&
      oldLines[i] === newLines[j]
    ) {
      ops.push({ type: "eq", oldIdx: i, newIdx: j, text: oldLines[i] });
      i++;
      j++;
    } else {
      // Find the next matching line
      let foundOld = -1;
      let foundNew = -1;
      const searchLimit = Math.min(
        50,
        Math.max(oldLines.length - i, newLines.length - j),
      );
      for (let look = 1; look <= searchLimit; look++) {
        if (
          i + look < oldLines.length &&
          j < newLines.length &&
          oldLines[i + look] === newLines[j]
        ) {
          foundOld = i + look;
          break;
        }
        if (
          j + look < newLines.length &&
          i < oldLines.length &&
          newLines[j + look] === oldLines[i]
        ) {
          foundNew = j + look;
          break;
        }
      }

      if (foundOld >= 0) {
        // Delete lines from old until match
        while (i < foundOld) {
          ops.push({ type: "del", oldIdx: i, text: oldLines[i] });
          i++;
        }
      } else if (foundNew >= 0) {
        // Add lines from new until match
        while (j < foundNew) {
          ops.push({ type: "add", newIdx: j, text: newLines[j] });
          j++;
        }
      } else {
        // No match found nearby, emit del+add
        if (i < oldLines.length) {
          ops.push({ type: "del", oldIdx: i, text: oldLines[i] });
          i++;
        }
        if (j < newLines.length) {
          ops.push({ type: "add", newIdx: j, text: newLines[j] });
          j++;
        }
      }
    }
  }

  // Group into hunks with context lines
  const changedIndices = new Set<number>();
  ops.forEach((op, idx) => {
    if (op.type !== "eq") {
      for (
        let c = Math.max(0, idx - context);
        c <= Math.min(ops.length - 1, idx + context);
        c++
      ) {
        changedIndices.add(c);
      }
    }
  });

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;

  for (let idx = 0; idx < ops.length; idx++) {
    if (!changedIndices.has(idx)) {
      if (currentHunk) {
        hunks.push(currentHunk);
        currentHunk = null;
      }
      continue;
    }

    const op = ops[idx];
    if (!currentHunk) {
      const oldStart =
        op.type !== "add"
          ? (op.oldIdx ?? 0) + 1
          : (ops[idx + 1]?.oldIdx ?? 0) + 1;
      const newStart =
        op.type !== "del"
          ? (op.newIdx ?? 0) + 1
          : (ops[idx + 1]?.newIdx ?? 0) + 1;
      currentHunk = { oldStart, oldCount: 0, newStart, newCount: 0, lines: [] };
    }

    if (op.type === "eq") {
      currentHunk.lines.push({
        type: "ctx",
        text: op.text,
        oldNum: (op.oldIdx ?? 0) + 1,
        newNum: (op.newIdx ?? 0) + 1,
      });
      currentHunk.oldCount++;
      currentHunk.newCount++;
    } else if (op.type === "del") {
      currentHunk.lines.push({
        type: "del",
        text: op.text,
        oldNum: (op.oldIdx ?? 0) + 1,
      });
      currentHunk.oldCount++;
    } else {
      currentHunk.lines.push({
        type: "add",
        text: op.text,
        newNum: (op.newIdx ?? 0) + 1,
      });
      currentHunk.newCount++;
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  return hunks;
}
