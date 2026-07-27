import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  ImageIcon,
  PlusIcon,
  Trash2Icon,
  PencilIcon,
  UploadIcon,
  RefreshCwIcon,
  ListTreeIcon,
  HashIcon,
  BookOpenIcon,
  Table2Icon,
  SigmaIcon,
  BookMarkedIcon,
  GithubIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  FileCodeIcon,
  PanelTopIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FolderOpenIcon,
  CopyIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  useDocumentStore,
  resolveTexRoot,
  hasDocumentclass,
  hasPdfData,
  type ProjectFile,
} from "@/stores/document-store";
import { usePdfOutline } from "@/hooks/use-pdf-outline";
import type { PdfOutlineItem } from "@/lib/mupdf/types";
import { useHistoryStore } from "@/stores/history-store";
import { usePreviewStore } from "@/stores/preview-store";
import {
  useWorkspaceLayoutStore,
  type WorkspaceSidePanel,
} from "@/stores/workspace-layout-store";
import { synctexView } from "@/lib/latex-compiler";
import { parseProjectOutline, type OutlineItem } from "@/lib/document-outline";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useProjectStore } from "@/stores/project-store";
import {
  ReferencesHeader,
  ReferencesPanel,
} from "@/components/workspace/references-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createLogger } from "@/lib/debug/logger";
import { GrammarPanel } from "@/components/workspace/grammar-panel";
import { HealthPanel } from "@/components/workspace/health-panel";
import { TutorialGuide } from "@/components/workspace/tutorial-guide";
import { ProjectSearchPanel } from "@/components/workspace/project-search-panel";

const log = createLogger("sidebar");

// ─── System file manager integration ───

/** Platform-appropriate name for the OS file manager, used in menu labels. */
const FILE_MANAGER_NAME = navigator.platform.startsWith("Mac")
  ? "Finder"
  : navigator.platform.startsWith("Win")
    ? "File Explorer"
    : "File Manager";

/** Show a file selected (or a folder opened) in the OS file manager. */
function revealInFileManager(absolutePath: string) {
  invoke("reveal_in_file_manager", { path: absolutePath }).catch((err) =>
    log.warn(`Reveal in ${FILE_MANAGER_NAME} failed: ${String(err)}`),
  );
}

/** Open a file with its OS default application. */
function openWithDefaultApp(absolutePath: string) {
  invoke("open_with_default_app", { path: absolutePath }).catch((err) =>
    log.warn(`Open with default app failed: ${String(err)}`),
  );
}

function copyToClipboard(text: string) {
  navigator.clipboard
    .writeText(text)
    .catch((err) => log.warn(`Clipboard write failed: ${String(err)}`));
}

// ─── Document Outline ───

/** part/chapter/appendix render as bold group starts with a book icon. */
const CHAPTER_LIKE = new Set(["part", "chapter", "appendix"]);

const STRUCTURE_TEXT_STYLES: Record<string, string> = {
  part: "font-semibold",
  chapter: "font-semibold",
  appendix: "font-semibold",
  section: "font-medium",
  subsection: "text-muted-foreground",
  subsubsection: "text-muted-foreground",
};

function OutlineObjectIcon({ kind }: { kind: OutlineItem["kind"] }) {
  if (kind === "figure") {
    return (
      <ImageIcon className="size-3 shrink-0 text-sky-600 dark:text-sky-400" />
    );
  }
  if (kind === "table") {
    return (
      <Table2Icon className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
    );
  }
  if (kind === "equation") {
    return (
      <SigmaIcon className="size-3 shrink-0 text-amber-600 dark:text-amber-400" />
    );
  }
  if (kind === "bibliography") {
    return (
      <BookMarkedIcon className="size-3 shrink-0 text-rose-600 dark:text-rose-400" />
    );
  }
  return <HashIcon className="size-3 shrink-0 text-muted-foreground/70" />;
}

function OutlineGroupHeader({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-sidebar px-3 pt-2 pb-1">
      <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="h-px flex-1 bg-sidebar-border" />
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  );
}

// ─── File Tree Builder ───

interface TreeNode {
  name: string;
  relativePath: string;
  type: "folder" | "file";
  file?: ProjectFile;
  children: TreeNode[];
}

function buildFileTree(files: ProjectFile[], folders: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const folderMap = new Map<string, TreeNode>();

  function getOrCreateFolder(path: string): TreeNode[] {
    if (!path) return root;
    if (folderMap.has(path)) return folderMap.get(path)!.children;

    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join("/");
    const parentChildren = getOrCreateFolder(parentPath);

    const folder: TreeNode = {
      name,
      relativePath: path,
      type: "folder",
      children: [],
    };
    folderMap.set(path, folder);
    parentChildren.push(folder);
    return folder.children;
  }

  // Ensure all known folders exist as nodes (including empty ones)
  for (const folderPath of folders) {
    getOrCreateFolder(folderPath);
  }

  for (const file of files) {
    const parts = file.relativePath.split("/");
    const fileName = parts[parts.length - 1];
    const folderPath = parts.slice(0, -1).join("/");
    const parentChildren = getOrCreateFolder(folderPath);

    parentChildren.push({
      name: fileName,
      relativePath: file.relativePath,
      type: "file",
      file,
      children: [],
    });
  }

  // Sort: folders first, then alphabetical
  function sortNodes(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.type === "folder") sortNodes(node.children);
    }
  }
  sortNodes(root);

  return root;
}

// ─── File Icon ───

function getFileIcon(file: ProjectFile) {
  if (file.type === "image") return <ImageIcon className="size-4 shrink-0" />;
  if (file.type === "pdf")
    return <FileSpreadsheetIcon className="size-4 shrink-0" />;
  if (file.type === "style")
    return <FileCodeIcon className="size-4 shrink-0" />;
  if (file.type === "other") return <FileIcon className="size-4 shrink-0" />;
  return <FileTextIcon className="size-4 shrink-0" />;
}

// ─── App Version (resolved once from Tauri) ───

let _appVersion = "";
getVersion().then((v) => {
  _appVersion = v;
});
function useAppVersion() {
  const [version, setVersion] = useState(_appVersion);
  useEffect(() => {
    if (!version) getVersion().then(setVersion);
  }, [version]);
  return version || "…";
}

// ─── Sidebar ───

interface SidebarProps {
  activePanel: WorkspaceSidePanel;
}

export function Sidebar({ activePanel }: SidebarProps) {
  const appVersion = useAppVersion();
  const files = useDocumentStore((s) => s.files);
  const activeFileId = useDocumentStore((s) => s.activeFileId);
  const setActiveFile = useDocumentStore((s) => s.setActiveFile);
  const openFileInTab = useDocumentStore((s) => s.openFileInTab);
  const deleteFile = useDocumentStore((s) => s.deleteFile);
  const deleteFolder = useDocumentStore((s) => s.deleteFolder);
  const renameFile = useDocumentStore((s) => s.renameFile);
  const createNewFile = useDocumentStore((s) => s.createNewFile);
  const createFolder = useDocumentStore((s) => s.createFolder);
  const importFiles = useDocumentStore((s) => s.importFiles);
  const activeFileName = useDocumentStore((s) => {
    const active = s.files.find((f) => f.id === s.activeFileId);
    return active?.relativePath ?? "No file selected";
  });
  const cursorPosition = useDocumentStore((s) => s.cursorPosition);
  const requestJumpToPosition = useDocumentStore(
    (s) => s.requestJumpToPosition,
  );
  const _insertAtCursor = useDocumentStore((s) => s.insertAtCursor);
  const moveFile = useDocumentStore((s) => s.moveFile);
  const moveFolder = useDocumentStore((s) => s.moveFolder);
  const refreshFiles = useDocumentStore((s) => s.refreshFiles);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const folders = useDocumentStore((s) => s.folders);
  const readerMode = useWorkspaceLayoutStore((s) => s.readerMode);
  const requestPdfLocation = usePreviewStore((s) => s.requestLocation);
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const lastModified = projectRoot
    ? recentProjects.find((p) => p.path === projectRoot)?.lastModified
    : undefined;
  // Re-render periodically so the "modified X ago" label stays fresh.
  const [, forceRelativeTimeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceRelativeTimeTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  // ─── Native OS file drop (Tauri onDragDropEvent) ───
  const sidebarFilesRef = useRef<HTMLDivElement>(null);
  const nativeDropTargetRef = useRef<string | null>(null);
  const [nativeDragOver, setNativeDragOver] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        if (cancelled) return;
        const { type } = event.payload;

        if (type === "over" || type === "enter") {
          const payload = event.payload as {
            position: { x: number; y: number };
          };
          const { x, y } = payload.position;
          // Tauri reports physical pixels; elementFromPoint expects logical (CSS) pixels
          const logicalX = x / window.devicePixelRatio;
          const logicalY = y / window.devicePixelRatio;

          const el = document.elementFromPoint(logicalX, logicalY);
          const filesArea = sidebarFilesRef.current;

          if (!filesArea || !el || !filesArea.contains(el)) {
            // Not over the sidebar file tree
            if (nativeDropTargetRef.current !== null) {
              nativeDropTargetRef.current = null;
              setNativeDragOver(null);
            }
            return;
          }

          // Walk up from the hovered element to find the closest drop-folder target
          const folderEl = el.closest(
            "[data-drop-folder]",
          ) as HTMLElement | null;
          const folder = folderEl?.dataset.dropFolder ?? "__root__";
          nativeDropTargetRef.current = folder;
          setNativeDragOver(folder);
        } else if (type === "drop") {
          const payload = event.payload as {
            paths: string[];
            position: { x: number; y: number };
          };
          const { paths, position } = payload;
          const logicalX = position.x / window.devicePixelRatio;
          const logicalY = position.y / window.devicePixelRatio;

          const el = document.elementFromPoint(logicalX, logicalY);
          const filesArea = sidebarFilesRef.current;

          if (!filesArea || !el || !filesArea.contains(el)) {
            setNativeDragOver(null);
            nativeDropTargetRef.current = null;
            return;
          }

          const targetFolder =
            nativeDropTargetRef.current === "__root__"
              ? undefined
              : (nativeDropTargetRef.current ?? undefined);

          // Mark as handled so chat-composer doesn't also process it
          (window as any).__sidebarHandledDrop = true;
          setTimeout(() => {
            (window as any).__sidebarHandledDrop = false;
          }, 200);

          try {
            await importFiles(paths, targetFolder);
          } catch (err) {
            log.error("Native drop import failed", { error: String(err) });
          }

          setNativeDragOver(null);
          nativeDropTargetRef.current = null;
        } else if (type === "leave") {
          setNativeDragOver(null);
          nativeDropTargetRef.current = null;
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Not in Tauri environment (dev mode)
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importFiles]);

  // Track selected folder for paste target
  const [pasteTargetFolder, setPasteTargetFolder] = useState<
    string | undefined
  >();

  // ─── Cmd+V paste files from OS clipboard ───
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "v") return;

      // Don't intercept paste in text inputs / editor (contentEditable)
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          (active as HTMLElement).isContentEditable)
      )
        return;

      try {
        const paths = await invoke<string[]>("read_clipboard_file_paths");
        if (paths.length > 0) {
          e.preventDefault();
          await importFiles(paths, pasteTargetFolder);
        }
      } catch (err) {
        log.error("Read clipboard failed", { error: String(err) });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [importFiles, pasteTargetFolder]);

  // dnd-kit drag-and-drop (uses PointerSensor — works in Tauri WKWebView)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  const [activeDrag, setActiveDrag] = useState<{
    id: string;
    type: "file" | "folder";
    name: string;
  } | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { type, name } = event.active.data.current as {
      type: "file" | "folder";
      name: string;
    };
    setActiveDrag({ id: event.active.id as string, type, name });
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const draggedPath = active.id as string;
      const draggedType = (active.data.current as { type: string }).type;
      const targetId = over.id as string;
      const targetFolder = targetId === "__root__" ? null : targetId;

      // Don't move if same parent
      const draggedParent = draggedPath.includes("/")
        ? draggedPath.substring(0, draggedPath.lastIndexOf("/"))
        : null;
      if (targetFolder === draggedParent) return;

      // Don't move folder into itself or descendant
      if (draggedType === "folder" && targetFolder) {
        if (
          targetFolder === draggedPath ||
          targetFolder.startsWith(`${draggedPath}/`)
        )
          return;
      }

      try {
        if (draggedType === "file") await moveFile(draggedPath, targetFolder);
        else await moveFolder(draggedPath, targetFolder);
      } catch (err) {
        log.error("DnD move failed", { error: String(err) });
      }
    },
    [moveFile, moveFolder],
  );

  // Dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogFolder, setAddDialogFolder] = useState<string | undefined>();
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogParent, setFolderDialogParent] = useState<
    string | undefined
  >();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [newFolderName, setNewFolderName] = useState("");

  // Folder expand/collapse
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const tree = useMemo(() => buildFileTree(files, folders), [files, folders]);

  // Auto-expand parent folders of the active file so it stays visible
  useEffect(() => {
    if (!activeFileId) return;
    const parts = activeFileId.split("/");
    if (parts.length <= 1) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (let i = 1; i < parts.length; i++) {
        const folder = parts.slice(0, i).join("/");
        if (!next.has(folder)) {
          next.add(folder);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeFileId]);

  const toggleFolder = useCallback((path: string) => {
    setPasteTargetFolder(path);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Arrow-key navigation over the visible tree rows (ARIA tree pattern).
  // Enter/Space activate rows natively since every row is a <button>.
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const navKeys = [
        "ArrowDown",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ];
      if (!navKeys.includes(e.key)) return;
      const rows = Array.from(
        e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]"),
      );
      if (rows.length === 0) return;
      const idx = rows.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      const focusRow = (i: number) =>
        rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus();

      if (e.key === "ArrowDown") return focusRow(idx + 1);
      if (e.key === "ArrowUp") return focusRow(idx <= 0 ? 0 : idx - 1);
      if (e.key === "Home") return focusRow(0);
      if (e.key === "End") return focusRow(rows.length - 1);

      if (idx < 0) return focusRow(0);
      const row = rows[idx];
      const path = row.dataset.treePath ?? "";
      const isFolder = row.dataset.treeFolder === "true";
      const isExpanded = row.getAttribute("aria-expanded") === "true";

      if (e.key === "ArrowRight" && isFolder) {
        if (!isExpanded) toggleFolder(path);
        else focusRow(idx + 1); // into first child
      }
      if (e.key === "ArrowLeft") {
        if (isFolder && isExpanded) {
          toggleFolder(path);
        } else if (path.includes("/")) {
          const parent = path.slice(0, path.lastIndexOf("/"));
          rows
            .find(
              (r) =>
                r.dataset.treePath === parent &&
                r.dataset.treeFolder === "true",
            )
            ?.focus();
        }
      }
    },
    [toggleFolder],
  );

  // Outline — project-wide, Overleaf-style: resolve the root document and
  // flatten \input/\include'd files into a single outline.
  const outlineRootId = useMemo(() => {
    const active = files.find((f) => f.id === activeFileId);
    if (active?.type === "tex") return resolveTexRoot(activeFileId, files);
    // Non-tex file active (image, bib, …): fall back to the project's main doc
    const isRootDoc = (f: ProjectFile) =>
      f.type === "tex" && !!f.content && hasDocumentclass(f.content);
    const wellKnown = files.find(
      (f) =>
        (f.name === "main.tex" || f.name === "document.tex") && isRootDoc(f),
    );
    return wellKnown?.id ?? files.find(isRootDoc)?.id ?? activeFileId;
  }, [activeFileId, files]);
  const outlineItems = useMemo(
    () => parseProjectOutline(outlineRootId, files),
    [outlineRootId, files],
  );
  const outlineFileCount = useMemo(
    () => new Set(outlineItems.map((item) => item.file)).size,
    [outlineItems],
  );
  const structureItems = useMemo(
    () => outlineItems.filter((item) => item.group === "structure"),
    [outlineItems],
  );
  const objectItems = useMemo(
    () => outlineItems.filter((item) => item.group === "objects"),
    [outlineItems],
  );

  // The PDF's own bookmarks — the compiled structure with real page numbers,
  // which is what reader mode wants as a table of contents. Only fetched while
  // that view is selected.
  const [outlineSource, setOutlineSource] = useState<"source" | "pdf">(
    "source",
  );
  const pdfRevision = useDocumentStore((state) => state.pdfRevision);
  const pdfAvailable = useMemo(() => hasPdfData(), [pdfRevision]);
  const showingPdfOutline = outlineSource === "pdf" && pdfAvailable;
  const { items: pdfOutlineItems, loading: pdfOutlineLoading } =
    usePdfOutline(showingPdfOutline);
  const minPdfOutlineLevel = useMemo(
    () => pdfOutlineItems.reduce((min, item) => Math.min(min, item.level), 9),
    [pdfOutlineItems],
  );

  const handlePdfOutlineClick = useCallback(
    (item: PdfOutlineItem) => {
      if (item.page == null) return;
      // A bookmark resolves to a page, not a rectangle, so ask for the page
      // without the SyncTeX highlight flash.
      requestPdfLocation({
        page: item.page,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        highlight: false,
      });
    },
    [requestPdfLocation],
  );
  // Normalize indentation to the shallowest heading present, so article-class
  // documents (sections only) start flush left instead of pre-indented
  const minStructureLevel = useMemo(
    () => structureItems.reduce((min, item) => Math.min(min, item.level), 9),
    [structureItems],
  );
  // "You are here": the structure item the cursor currently sits under
  const activeCursorLine = useMemo(() => {
    const content = files.find((f) => f.id === activeFileId)?.content;
    if (!content) return 0;
    let line = 1;
    const upTo = Math.min(cursorPosition, content.length);
    for (let i = 0; i < upTo; i++) {
      if (content.charCodeAt(i) === 10) line++;
    }
    return line;
  }, [files, activeFileId, cursorPosition]);
  const currentStructureIndex = useMemo(() => {
    let current = -1;
    structureItems.forEach((item, index) => {
      if (item.file === activeFileId && item.line <= activeCursorLine) {
        current = index;
      }
    });
    return current;
  }, [structureItems, activeFileId, activeCursorLine]);
  const handleTocClick = useCallback(
    (item: OutlineItem) => {
      const targetId = item.file ?? activeFileId;
      const targetFile = files.find((f) => f.id === targetId);
      if (!targetFile) return;

      const lines = (targetFile.content ?? "").split("\n");
      let position = 0;
      for (let i = 0; i < item.line - 1 && i < lines.length; i++) {
        position += lines[i].length + 1;
      }

      if (targetId !== activeFileId) {
        setActiveFile(targetId);
        // Let the editor swap documents before jumping
        setTimeout(() => requestJumpToPosition(position), 100);
      } else {
        requestJumpToPosition(position);
      }

      // In reader mode the editor is hidden, so the outline browses the PDF:
      // forward-search the heading's line and scroll the preview to it.
      if (readerMode && projectRoot) {
        void synctexView(projectRoot, targetFile.relativePath, item.line).then(
          (location) => {
            if (location) {
              requestPdfLocation(location);
            } else {
              toast.error("Could not find this section in the PDF", {
                description:
                  "Recompile the document to refresh its SyncTeX data.",
              });
            }
          },
        );
      }
    },
    [
      activeFileId,
      files,
      setActiveFile,
      requestJumpToPosition,
      readerMode,
      projectRoot,
      requestPdfLocation,
    ],
  );

  // Check if a name already exists in the given folder
  // Case-insensitive on macOS/Windows (default case-insensitive filesystems)
  const isCaseInsensitiveFs =
    navigator.platform.startsWith("Mac") ||
    navigator.platform.startsWith("Win");
  const nameExistsIn = useCallback(
    (name: string, folder?: string) => {
      const targetPath = folder ? `${folder}/${name}` : name;
      const cmp = (a: string, b: string) =>
        isCaseInsensitiveFs ? a.toLowerCase() === b.toLowerCase() : a === b;
      const existsAsFile = files.some((f) => cmp(f.relativePath, targetPath));
      const existsAsFolder = folders.some((f) => cmp(f, targetPath));
      return existsAsFile || existsAsFolder;
    },
    [files, folders, isCaseInsensitiveFs],
  );

  // Reveal a folder (or the project root, for `null`) in the OS file manager.
  // Files carry their own absolutePath; folders only exist as relative paths.
  const revealRelative = useCallback(
    async (relativePath: string | null) => {
      if (!projectRoot) return;
      const abs = relativePath
        ? await join(projectRoot, relativePath)
        : projectRoot;
      revealInFileManager(abs);
    },
    [projectRoot],
  );

  // Handlers
  const [nameError, setNameError] = useState("");

  const handleAddFile = () => {
    const name = newFileName.trim();
    if (!name) return;
    if (nameExistsIn(name, addDialogFolder)) {
      setNameError("A file or folder with this name already exists");
      return;
    }
    // Auto-append .tex if no extension provided
    const finalName = /\.\w+$/.test(name) ? name : `${name}.tex`;
    const lower = finalName.toLowerCase();
    const type: "tex" | "image" = /\.(png|jpg|jpeg|gif|svg|bmp|webp)$/.test(
      lower,
    )
      ? "image"
      : "tex";
    createNewFile(finalName, type, addDialogFolder);
    setNewFileName("");
    setNameError("");
    setAddDialogOpen(false);
    setAddDialogFolder(undefined);
  };

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (nameExistsIn(name, folderDialogParent)) {
      setNameError("A file or folder with this name already exists");
      return;
    }
    createFolder(name, folderDialogParent);
    setNewFolderName("");
    setNameError("");
    setFolderDialogOpen(false);
    setFolderDialogParent(undefined);
  };

  const handleImport = async (targetFolder?: string) => {
    const selected = await openDialog({
      multiple: true,
      filters: [
        {
          name: "All Files",
          extensions: [
            "tex",
            "bib",
            "sty",
            "cls",
            "bst",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "svg",
            "bmp",
            "webp",
            "pdf",
            "txt",
            "md",
          ],
        },
      ],
    });
    if (selected && projectRoot) {
      const paths = Array.isArray(selected) ? selected : [selected];
      await importFiles(paths, targetFolder);
    }
  };

  const openRenameDialog = (id: string, name: string) => {
    setRenameFileId(id);
    setRenameValue(name);
    setNameError("");
    setRenameDialogOpen(true);
  };

  const handleRename = () => {
    const name = renameValue.trim();
    if (!renameFileId || !name) return;
    // Check duplicate: find the parent folder of the file being renamed
    const file = files.find((f) => f.id === renameFileId);
    const parentFolder = file?.relativePath.includes("/")
      ? file.relativePath.substring(0, file.relativePath.lastIndexOf("/"))
      : undefined;
    const isSameName = isCaseInsensitiveFs
      ? name.toLowerCase() === file?.name.toLowerCase()
      : name === file?.name;
    if (nameExistsIn(name, parentFolder) && !isSameName) {
      setNameError("A file or folder with this name already exists");
      return;
    }
    renameFile(renameFileId, name);
    setRenameDialogOpen(false);
    setRenameFileId(null);
    setRenameValue("");
    setNameError("");
  };

  const openNewFileDialog = (folder?: string) => {
    setAddDialogFolder(folder);
    setNewFileName("");
    setNameError("");
    setAddDialogOpen(true);
  };

  const openNewFolderDialog = (parent?: string) => {
    setFolderDialogParent(parent);
    setNewFolderName("");
    setNameError("");
    setFolderDialogOpen(true);
  };

  // ─── Render ───

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Header — padded top for macOS overlay titlebar */}
      <div className="relative flex h-[calc(48px+var(--titlebar-height))] items-center justify-center border-sidebar-border border-b px-6 pt-[var(--titlebar-height)]">
        <div className="flex max-w-full flex-col items-center overflow-hidden">
          <span
            className="max-w-full truncate font-semibold text-sm"
            title={projectRoot ?? undefined}
          >
            {projectRoot?.split(/[/\\]/).pop() || "Opal"}
          </span>
          <span className="text-muted-foreground text-xs">
            {lastModified
              ? `Modified ${formatRelativeTime(lastModified)}`
              : "No changes yet"}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {activePanel === "learn" && <TutorialGuide />}
        {activePanel === "files" && (
          <div
            ref={sidebarFilesRef}
            className="flex h-full flex-col"
            data-sidebar-files
          >
            <div className="relative flex h-8 shrink-0 items-center justify-center border-sidebar-border border-b px-3">
              <div className="flex items-center gap-2">
                <FolderIcon className="size-3.5 text-muted-foreground" />
                <span className="font-medium text-xs">Files</span>
              </div>
              <div className="absolute right-3 flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  title="Refresh"
                  onClick={() => refreshFiles()}
                >
                  <RefreshCwIcon className="size-3" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5"
                      title="Add"
                    >
                      <PlusIcon className="size-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openNewFileDialog()}>
                      <FileTextIcon className="mr-2 size-4" />
                      New LaTeX File
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openNewFolderDialog()}>
                      <FolderPlusIcon className="mr-2 size-4" />
                      New Folder
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleImport()}>
                      <UploadIcon className="mr-2 size-4" />
                      Import File
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <DroppableRoot
                    nativeDragOver={nativeDragOver === "__root__"}
                    onKeyDown={handleTreeKeyDown}
                  >
                    {tree.map((node) => (
                      <FileTreeNode
                        key={node.relativePath}
                        node={node}
                        depth={0}
                        activeFileId={activeFileId}
                        expandedFolders={expandedFolders}
                        onToggleFolder={toggleFolder}
                        onSelectFile={(id: string) => {
                          const parent = id.includes("/")
                            ? id.substring(0, id.lastIndexOf("/"))
                            : undefined;
                          setPasteTargetFolder(parent);
                          setActiveFile(id);
                        }}
                        onOpenInTab={(id: string) => {
                          const parent = id.includes("/")
                            ? id.substring(0, id.lastIndexOf("/"))
                            : undefined;
                          setPasteTargetFolder(parent);
                          useHistoryStore.getState().stopReview();
                          openFileInTab(id);
                        }}
                        onNewFile={openNewFileDialog}
                        onNewFolder={openNewFolderDialog}
                        onImport={handleImport}
                        onRename={openRenameDialog}
                        onDelete={deleteFile}
                        onDeleteFolder={deleteFolder}
                        onReveal={revealRelative}
                        fileCount={files.length}
                        nativeDragOver={nativeDragOver}
                      />
                    ))}
                  </DroppableRoot>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => openNewFileDialog()}>
                    <FileTextIcon className="mr-2 size-4" />
                    New File
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => openNewFolderDialog()}>
                    <FolderPlusIcon className="mr-2 size-4" />
                    New Folder
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleImport()}>
                    <UploadIcon className="mr-2 size-4" />
                    Import File
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => revealRelative(null)}>
                    <FolderOpenIcon className="mr-2 size-4" />
                    Reveal Project in {FILE_MANAGER_NAME}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              <DragOverlay dropAnimation={null}>
                {activeDrag && (
                  <div className="flex items-center gap-2 rounded-md bg-sidebar px-2 py-1 text-sm shadow-lg ring-1 ring-ring">
                    {activeDrag.type === "folder" ? (
                      <FolderIcon className="size-4 shrink-0" />
                    ) : (
                      <FileTextIcon className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{activeDrag.name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </div>
        )}
        {activePanel === "search" && <ProjectSearchPanel />}

        {activePanel === "outline" && (
          <div className="flex h-full flex-col">
            <div className="flex h-11 shrink-0 items-center gap-2 border-sidebar-border border-b px-3">
              <ListTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-xs">Outline</span>
                  {(showingPdfOutline
                    ? pdfOutlineItems.length
                    : outlineItems.length) > 0 && (
                    <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-accent-foreground">
                      {showingPdfOutline
                        ? pdfOutlineItems.length
                        : outlineItems.length}
                    </span>
                  )}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {showingPdfOutline
                    ? "PDF bookmarks"
                    : (files.find((f) => f.id === outlineRootId)
                        ?.relativePath ?? activeFileName)}
                  {!showingPdfOutline &&
                    outlineFileCount > 1 &&
                    ` · ${outlineFileCount} files`}
                </div>
              </div>
              {/* Source vs. compiled structure. Only offered once a PDF
                  exists, since bookmarks come from the build. */}
              {pdfAvailable && (
                <div className="flex shrink-0 items-center rounded-md bg-sidebar-accent/60 p-0.5">
                  {(["source", "pdf"] as const).map((source) => (
                    <button
                      key={source}
                      type="button"
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                        outlineSource === source
                          ? "bg-sidebar text-sidebar-foreground shadow-sm"
                          : "text-muted-foreground hover:text-sidebar-foreground",
                      )}
                      onClick={() => setOutlineSource(source)}
                      title={
                        source === "source"
                          ? "Outline parsed from the LaTeX source"
                          : "The compiled PDF's own bookmarks, with page numbers"
                      }
                    >
                      {source === "source" ? "Source" : "PDF"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1 pb-3">
              {showingPdfOutline ? (
                pdfOutlineItems.length > 0 ? (
                  pdfOutlineItems.map((item, index) => (
                    <button
                      key={`${item.page}-${item.level}-${item.title}-${index}`}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-sidebar-accent/50",
                        item.level === minPdfOutlineLevel &&
                          "mt-1.5 font-medium first:mt-0",
                        item.page == null && "opacity-50",
                      )}
                      style={{
                        paddingLeft: `${Math.max(0, item.level - minPdfOutlineLevel) * 12 + 8}px`,
                      }}
                      disabled={item.page == null}
                      title={
                        item.page == null
                          ? "This bookmark has no resolvable destination"
                          : `Page ${item.page}`
                      }
                      onClick={() => handlePdfOutlineClick(item)}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.title || "Untitled"}
                      </span>
                      {item.page != null && (
                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                          {item.page}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                    <ListTreeIcon className="size-6 text-muted-foreground/40" />
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {pdfOutlineLoading
                        ? "Reading the PDF's bookmarks…"
                        : "This PDF has no bookmarks. Load the hyperref package to have LaTeX write them."}
                    </p>
                  </div>
                )
              ) : outlineItems.length > 0 ? (
                <>
                  {structureItems.length > 0 && (
                    <>
                      <OutlineGroupHeader
                        label="Structure"
                        count={structureItems.length}
                      />
                      {structureItems.map((item, index) => {
                        const isChapterLike = CHAPTER_LIKE.has(item.kind);
                        const indent = Math.max(
                          0,
                          item.level - minStructureLevel,
                        );
                        const isCurrent = index === currentStructureIndex;
                        return (
                          <button
                            key={`${item.file}-${item.line}-${item.kind}-${index}`}
                            className={cn(
                              "relative flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors",
                              STRUCTURE_TEXT_STYLES[item.kind],
                              isChapterLike && "mt-1.5 text-[13px] first:mt-0",
                              isCurrent
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "hover:bg-sidebar-accent/50",
                            )}
                            style={{ paddingLeft: `${indent * 12 + 8}px` }}
                            title={
                              item.file
                                ? `${item.file}:${item.line}`
                                : undefined
                            }
                            onClick={() => handleTocClick(item)}
                          >
                            {isCurrent && (
                              <span className="absolute inset-y-1 left-0.5 w-0.5 rounded-full bg-sidebar-primary" />
                            )}
                            {isChapterLike && (
                              <BookOpenIcon className="size-3.5 shrink-0 text-sidebar-primary" />
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {item.title || "Untitled"}
                            </span>
                          </button>
                        );
                      })}
                    </>
                  )}

                  {objectItems.length > 0 && (
                    <>
                      <OutlineGroupHeader
                        label="Objects"
                        count={objectItems.length}
                      />
                      {objectItems.map((item, index) => (
                        <button
                          key={`${item.file}-${item.line}-${item.kind}-${item.title}-${index}`}
                          className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-sidebar-accent/50"
                          style={{
                            paddingLeft: `${Math.max(0, item.level - 1) * 12 + 8}px`,
                          }}
                          title={
                            item.file ? `${item.file}:${item.line}` : undefined
                          }
                          onClick={() => handleTocClick(item)}
                        >
                          <OutlineObjectIcon kind={item.kind} />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              item.kind === "label" &&
                                "font-mono text-[11px] text-muted-foreground",
                            )}
                          >
                            {item.title || "Untitled"}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <ListTreeIcon className="size-6 text-muted-foreground/40" />
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Add sections, figures, or tables to your document to build
                    an outline.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === "citations" && (
          <div className="flex h-full flex-col">
            <div className="flex h-8 shrink-0 items-center border-sidebar-border border-b">
              <ReferencesHeader />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ReferencesPanel />
            </div>
          </div>
        )}
        {activePanel === "grammar" && <GrammarPanel />}
        {activePanel === "health" && <HealthPanel />}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-sidebar-border border-t px-3 py-2 text-muted-foreground text-xs">
        <span className="truncate">Opal v{appVersion}</span>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="size-6" asChild>
            <a
              href="https://github.com/danylaksono/opal-editor"
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
            >
              <GithubIcon className="size-3.5" />
            </a>
          </Button>
        </div>
      </div>

      {/* New File Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              New File{addDialogFolder ? ` in ${addDialogFolder}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Input
              placeholder="filename.tex"
              value={newFileName}
              onChange={(e) => {
                setNewFileName(e.target.value);
                setNameError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddFile();
              }}
              autoFocus
            />
            {nameError && (
              <p className="text-destructive text-xs">{nameError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddFile} disabled={!newFileName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              New Folder{folderDialogParent ? ` in ${folderDialogParent}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Input
              placeholder="folder name"
              value={newFolderName}
              onChange={(e) => {
                setNewFolderName(e.target.value);
                setNameError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
              }}
              autoFocus
            />
            {nameError && (
              <p className="text-destructive text-xs">{nameError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFolderDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Input
              value={renameValue}
              onChange={(e) => {
                setRenameValue(e.target.value);
                setNameError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
              autoFocus
            />
            {nameError && (
              <p className="text-destructive text-xs">{nameError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── File Tree Node ───

// ─── dnd-kit helpers ───

function DroppableRoot({
  children,
  nativeDragOver,
  className,
  ref,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  nativeDragOver?: boolean;
  ref?: React.Ref<HTMLDivElement>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "__root__" });
  return (
    // Rest props must be spread onto the div: ContextMenuTrigger asChild
    // delivers its onContextMenu/ref through them, and dropping them silently
    // kills the empty-area right-click menu.
    <div
      ref={(el) => {
        setNodeRef(el);
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      data-drop-folder="__root__"
      role="tree"
      aria-label="Project files"
      className={cn(
        "min-h-0 flex-1 overflow-y-auto p-1",
        (isOver || nativeDragOver) && "bg-accent/30",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

function DroppableFolder({
  id,
  children,
  nativeDragOver,
}: {
  id: string;
  children: React.ReactNode;
  nativeDragOver?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      data-drop-folder={id}
      className={cn((isOver || nativeDragOver) && "rounded-md bg-accent/30")}
    >
      {children}
    </div>
  );
}

// ─── File Tree Node ───

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
  activeFileId: string;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (id: string) => void;
  onOpenInTab: (id: string) => void;
  onNewFile: (folder?: string) => void;
  onNewFolder: (parent?: string) => void;
  onImport: (folder?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  /** Reveal a folder (`null` = project root) in the OS file manager. */
  onReveal: (relativePath: string | null) => void;
  fileCount: number;
  nativeDragOver?: string | null;
}

function FileTreeNode({
  node,
  depth,
  activeFileId,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  onOpenInTab,
  onNewFile,
  onNewFolder,
  onImport,
  onRename,
  onDelete,
  onDeleteFolder,
  onReveal,
  fileCount,
  nativeDragOver,
}: FileTreeNodeProps) {
  const isExpanded = expandedFolders.has(node.relativePath);

  if (node.type === "folder") {
    return (
      <DroppableFolder
        id={node.relativePath}
        nativeDragOver={nativeDragOver === node.relativePath}
      >
        <DraggableItem id={node.relativePath} type="folder" name={node.name}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-sidebar-accent/50 focus-visible:outline-2 focus-visible:outline-sidebar-ring"
                style={{ paddingLeft: `${depth * 16 + 4}px` }}
                onClick={() => onToggleFolder(node.relativePath)}
                role="treeitem"
                aria-expanded={isExpanded}
                data-tree-row
                data-tree-folder="true"
                data-tree-path={node.relativePath}
              >
                {isExpanded ? (
                  <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <FolderIcon className="size-4 shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onNewFile(node.relativePath)}>
                <FileTextIcon className="mr-2 size-4" />
                New File Here
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onNewFolder(node.relativePath)}>
                <FolderPlusIcon className="mr-2 size-4" />
                New Folder
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onImport(node.relativePath)}>
                <UploadIcon className="mr-2 size-4" />
                Import File Here
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onReveal(node.relativePath)}>
                <FolderOpenIcon className="mr-2 size-4" />
                Reveal in {FILE_MANAGER_NAME}
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => copyToClipboard(node.relativePath)}
              >
                <CopyIcon className="mr-2 size-4" />
                Copy Relative Path
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => onRename(node.relativePath, node.name)}
              >
                <PencilIcon className="mr-2 size-4" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onClick={() => onDeleteFolder(node.relativePath)}
              >
                <Trash2Icon className="mr-2 size-4" />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </DraggableItem>
        {isExpanded &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.relativePath}
              node={child}
              depth={depth + 1}
              activeFileId={activeFileId}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFile={onSelectFile}
              onOpenInTab={onOpenInTab}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onImport={onImport}
              onRename={onRename}
              onDelete={onDelete}
              onDeleteFolder={onDeleteFolder}
              onReveal={onReveal}
              fileCount={fileCount}
              nativeDragOver={nativeDragOver}
            />
          ))}
      </DroppableFolder>
    );
  }

  // File node
  const file = node.file!;
  return (
    <DraggableItem id={file.relativePath} type="file" name={node.name}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-sidebar-ring",
              file.id === activeFileId
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "hover:bg-sidebar-accent/50",
            )}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            onClick={() => {
              useHistoryStore.getState().stopReview();
              onSelectFile(file.id);
            }}
            role="treeitem"
            aria-selected={file.id === activeFileId}
            data-tree-row
            data-tree-path={file.relativePath}
          >
            {getFileIcon(file)}
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            {file.isDirty && (
              <span
                className="ml-auto size-2 shrink-0 rounded-full bg-blue-500"
                title="Modified"
              />
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onOpenInTab(file.id)}>
            <PanelTopIcon className="mr-2 size-4" />
            Open in New Tab
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => openWithDefaultApp(file.absolutePath)}
          >
            <ExternalLinkIcon className="mr-2 size-4" />
            Open in Default App
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => revealInFileManager(file.absolutePath)}
          >
            <FolderOpenIcon className="mr-2 size-4" />
            Reveal in {FILE_MANAGER_NAME}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => copyToClipboard(file.absolutePath)}>
            <CopyIcon className="mr-2 size-4" />
            Copy Path
          </ContextMenuItem>
          <ContextMenuItem onClick={() => copyToClipboard(file.relativePath)}>
            <CopyIcon className="mr-2 size-4" />
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onRename(file.id, file.name)}>
            <PencilIcon className="mr-2 size-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => onDelete(file.id)}
            disabled={fileCount <= 1}
          >
            <Trash2Icon className="mr-2 size-4" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </DraggableItem>
  );
}

// ─── Draggable wrapper ───

function DraggableItem({
  id,
  type,
  name,
  children,
}: {
  id: string;
  type: "file" | "folder";
  name: string;
  children: React.ReactNode;
}) {
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type, name },
  });

  // Wrap listeners to log pointer events
  const wrappedListeners = listeners
    ? Object.fromEntries(
        Object.entries(listeners).map(([key, handler]) => [
          key,
          (e: React.PointerEvent) => {
            (handler as (e: React.PointerEvent) => void)(e);
          },
        ]),
      )
    : {};

  // dnd-kit `attributes` are intentionally not spread: they make every wrapper
  // div focusable (tabIndex=0, role="button"), doubling tab stops in the tree.
  // Only the PointerSensor is used, so keyboard drag attributes add nothing.
  return (
    <div
      ref={setNodeRef}
      {...wrappedListeners}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      {children}
    </div>
  );
}
