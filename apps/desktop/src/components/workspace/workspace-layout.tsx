import { Fragment, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BookOpenIcon,
  BookOpenTextIcon,
  BookTypeIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderIcon,
  GraduationCapIcon,
  HomeIcon,
  ListIcon,
  Maximize2Icon,
  Minimize2Icon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  PackageIcon,
  LibraryIcon,
  SearchIcon,
  SettingsIcon,
  CircleHelpIcon,
  StethoscopeIcon,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Sidebar } from "./sidebar";
import { AppearancePopover } from "./appearance-popover";
import { StatusBar } from "./status-bar";
import { SettingsDialog } from "@/components/settings-dialog";
import { LatexEditor } from "./editor/latex-editor";
import { ProblemsPanel } from "./editor/problems-panel";
import { PdfPreview } from "./preview/pdf-preview";
import { useDocumentStore } from "@/stores/document-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useProblemsStore } from "@/stores/problems-store";
import {
  useWorkspaceLayoutStore,
  type WorkspaceSidePanel,
} from "@/stores/workspace-layout-store";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PackageChangeDialog } from "./package-change-dialog";
import { BibliographyImportDialog } from "./bibliography-import-dialog";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { TUTORIAL_STEPS } from "@/lib/tutorial-steps";

const sidePanelItems: Array<{
  id: WorkspaceSidePanel;
  label: string;
  icon: typeof FolderIcon;
}> = [
  { id: "files", label: "Files", icon: FolderIcon },
  { id: "search", label: "Search", icon: SearchIcon },
  { id: "outline", label: "Outline", icon: ListIcon },
  { id: "citations", label: "References", icon: BookOpenIcon },
  { id: "grammar", label: "Grammar", icon: BookTypeIcon },
  { id: "health", label: "Project health", icon: StethoscopeIcon },
];

const DOCUMENTATION_URL = "https://opal-latex.pages.dev/documentation.html";

function ActivityRail() {
  const sidePanelOpen = useWorkspaceLayoutStore((s) => s.sidePanelOpen);
  const activeSidePanel = useWorkspaceLayoutStore((s) => s.activeSidePanel);
  const toggleSidePanel = useWorkspaceLayoutStore((s) => s.toggleSidePanel);
  const setSidePanelOpen = useWorkspaceLayoutStore((s) => s.setSidePanelOpen);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const closeProject = useDocumentStore((s) => s.closeProject);
  const tutorialProject = useOnboardingStore((s) => s.tutorialProject);
  const [showSettings, setShowSettings] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Pack sources + review/ + compiled PDF into a zip for sharing with peers.
  const handleExportProject = async () => {
    if (!projectRoot || exporting) return;
    const projectName =
      projectRoot
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop() || "project";
    const destination = await save({
      title: "Export project",
      defaultPath: `${projectName}.zip`,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (!destination) return;
    setExporting(true);
    try {
      const result = await invoke<{ fileCount: number; zipPath: string }>(
        "export_project_zip",
        { projectRoot, destination },
      );
      toast.success("Project exported", {
        description: `${result.fileCount} files packed into ${result.zipPath}`,
      });
    } catch (error) {
      toast.error("Export failed", { description: String(error) });
    } finally {
      setExporting(false);
    }
  };
  const visiblePanelItems =
    projectRoot && projectRoot === tutorialProject
      ? [
          {
            id: "learn" as const,
            label: "Learn LaTeX",
            icon: GraduationCapIcon,
          },
          ...sidePanelItems,
        ]
      : sidePanelItems;

  // Allow the command palette to open Settings.
  useEffect(() => {
    const handler = () => setShowSettings(true);
    window.addEventListener("open-settings", handler);
    return () => window.removeEventListener("open-settings", handler);
  }, []);

  return (
    <div className="flex w-12 shrink-0 flex-col items-center border-sidebar-border border-r bg-sidebar pt-[var(--titlebar-height)] text-sidebar-foreground">
      <div className="flex h-12 items-center justify-center">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setSidePanelOpen(!sidePanelOpen)}
          title={sidePanelOpen ? "Collapse side panel" : "Open side panel"}
        >
          {sidePanelOpen ? (
            <PanelLeftCloseIcon className="size-4" />
          ) : (
            <PanelLeftOpenIcon className="size-4" />
          )}
        </Button>
      </div>

      <div className="flex h-12 items-center justify-center border-sidebar-border border-b">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={closeProject}
          title="Home"
        >
          <HomeIcon className="size-4" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center gap-1 px-1 py-2">
        {visiblePanelItems.map((item) => {
          const Icon = item.icon;
          const active = sidePanelOpen && activeSidePanel === item.id;
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="icon"
              className={cn(
                "size-9 rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                active && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              onClick={() => toggleSidePanel(item.id)}
              title={item.label}
              aria-pressed={active}
            >
              <Icon className="size-4" />
            </Button>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 px-1 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => void open(DOCUMENTATION_URL)}
          title="Help & documentation"
          aria-label="Help & documentation"
        >
          <CircleHelpIcon className="size-4" />
        </Button>
        {projectRoot && (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => void handleExportProject()}
            disabled={exporting}
            title="Export project as zip (sources, review annotations, PDF)"
            aria-label="Export project as zip"
          >
            <PackageIcon
              className={cn("size-4", exporting && "animate-pulse")}
            />
          </Button>
        )}
        {/* Opens the gallery in the chat drawer rather than a side panel:
            skills act on the assistant, which lives on the other side. */}
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("open-skill-gallery"))
          }
          title="AI skills"
          aria-label="AI skills"
        >
          <LibraryIcon className="size-4" />
        </Button>
        <AppearancePopover />
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          <SettingsIcon className="size-4" />
        </Button>
      </div>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}

function WorkspaceProblemsDrawer() {
  const diagnostics = useProblemsStore((s) => s.diagnostics);
  const fileName = useProblemsStore((s) => s.fileName);
  const requestJumpToPosition = useDocumentStore(
    (s) => s.requestJumpToPosition,
  );
  const aiProvider = useSettingsStore((s) => s.aiProvider);
  const problemsDrawerOpen = useWorkspaceLayoutStore(
    (s) => s.problemsDrawerOpen,
  );
  const toggleProblemsDrawer = useWorkspaceLayoutStore(
    (s) => s.toggleProblemsDrawer,
  );

  if (diagnostics.length === 0) return null;

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter(
    (d) => d.severity === "warning",
  ).length;

  const onFixAllWithChat =
    aiProvider !== "none"
      ? () => {
          const errorList = diagnostics
            .map((d) => `- ${fileName}:${d.line} - ${d.message}`)
            .join("\n");
          useAiChatStore
            .getState()
            .sendPrompt(
              `[Lint errors in ${fileName}]\n${errorList}\n\nFix all these lint errors.`,
            );
        }
      : undefined;

  return (
    <div className="shrink-0 border-border border-t bg-background">
      {problemsDrawerOpen ? (
        <div className="max-h-48 overflow-hidden">
          <ProblemsPanel
            className="border-t-0"
            diagnostics={diagnostics}
            fileName={fileName}
            onNavigate={requestJumpToPosition}
            onFixWithChat={
              aiProvider !== "none"
                ? (message, line) => {
                    const ctx = `[Lint error in ${fileName}:${line}]\n[Error: ${message}]`;
                    useAiChatStore
                      .getState()
                      .sendPrompt(`${ctx}\n\nFix this lint error.`);
                  }
                : undefined
            }
            onFixAllWithChat={onFixAllWithChat}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={toggleProblemsDrawer}
          className="flex h-8 w-full items-center gap-2 px-3 text-left text-muted-foreground text-xs transition-colors hover:bg-muted/50 hover:text-foreground"
          title="Open problems"
        >
          <ChevronUpIcon className="size-3.5" />
          <span className="font-medium text-foreground">Problems</span>
          {errorCount > 0 && (
            <span className="flex items-center gap-1">
              <AlertCircleIcon className="size-3.5 text-red-400" />
              <span>{errorCount}</span>
            </span>
          )}
          {warningCount > 0 && (
            <span className="flex items-center gap-1">
              <AlertTriangleIcon className="size-3.5 text-yellow-400" />
              <span>{warningCount}</span>
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{fileName}</span>
        </button>
      )}

      {problemsDrawerOpen && (
        <button
          type="button"
          onClick={toggleProblemsDrawer}
          className="absolute right-3 bottom-2 z-10 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Collapse problems"
        >
          <ChevronDownIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function WorkspaceLayout() {
  const initialized = useDocumentStore((s) => s.initialized);
  const previewVisible = usePreviewStore((s) => s.visible);
  const togglePreview = usePreviewStore((s) => s.toggle);
  const setPreviewVisible = usePreviewStore((s) => s.setVisible);
  const sidePanelOpen = useWorkspaceLayoutStore((s) => s.sidePanelOpen);
  const activeSidePanel = useWorkspaceLayoutStore((s) => s.activeSidePanel);
  const setActiveSidePanel = useWorkspaceLayoutStore(
    (s) => s.setActiveSidePanel,
  );
  const focusMode = useWorkspaceLayoutStore((s) => s.focusMode);
  const toggleFocusMode = useWorkspaceLayoutStore((s) => s.toggleFocusMode);
  const readerMode = useWorkspaceLayoutStore((s) => s.readerMode);
  const toggleReaderMode = useWorkspaceLayoutStore((s) => s.toggleReaderMode);
  const reviewMode = useWorkspaceLayoutStore((s) => s.reviewMode);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const tutorialProject = useOnboardingStore((s) => s.tutorialProject);
  const tutorialStep = useOnboardingStore((s) => s.currentStep);
  const openedTutorialProject = useRef<string | null>(null);

  // While the Learn LaTeX guide is visible, softly spotlight the pane the
  // current step talks about ("the editor on the left", "the PDF preview").
  const guideVisible =
    !focusMode &&
    !reviewMode &&
    sidePanelOpen &&
    activeSidePanel === "learn" &&
    projectRoot !== null &&
    projectRoot === tutorialProject;
  const paneHighlight = guideVisible
    ? TUTORIAL_STEPS[Math.min(tutorialStep, TUTORIAL_STEPS.length - 1)]
        ?.highlight
    : undefined;
  const highlightEditor =
    paneHighlight === "editor" || paneHighlight === "both";
  const highlightPreview =
    paneHighlight === "preview" || paneHighlight === "both";

  // When the Learn LaTeX project is (re)opened, surface the guide panel so the
  // learner can pick up where they left off.
  useEffect(() => {
    if (
      projectRoot &&
      projectRoot === tutorialProject &&
      openedTutorialProject.current !== projectRoot
    ) {
      openedTutorialProject.current = projectRoot;
      setActiveSidePanel("learn");
    }
    if (projectRoot !== tutorialProject) openedTutorialProject.current = null;
  }, [tutorialProject, projectRoot, setActiveSidePanel]);

  // Reader mode shows the PDF regardless of the preview flag; keep the flag
  // set so leaving the mode lands back on the editor + preview split.
  useEffect(() => {
    if (readerMode) setPreviewVisible(true);
  }, [readerMode, setPreviewVisible]);

  // Cmd+\ / Ctrl+\ toggles the PDF preview pane.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        // In reader mode there is no split to collapse — "hide the preview"
        // can only sensibly mean "bring the editor back".
        if (readerMode) toggleReaderMode();
        else togglePreview();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        toggleFocusMode();
      }
      // Cmd+Shift+R / Ctrl+Shift+R toggles reader mode (PDF + side panel).
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "r"
      ) {
        e.preventDefault();
        toggleReaderMode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePreview, toggleFocusMode, toggleReaderMode, readerMode]);

  if (!initialized) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background">
      <PackageChangeDialog />
      <BibliographyImportDialog />
      {!focusMode && !reviewMode && <ActivityRail />}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
          {!reviewMode && !focusMode && sidePanelOpen && (
            <>
              <Panel
                id="sidebar"
                order={1}
                defaultSize={18}
                minSize={12}
                maxSize={32}
              >
                <Sidebar activePanel={activeSidePanel} />
              </Panel>

              <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />
            </>
          )}

          {!reviewMode && !readerMode && (
            <Panel
              key="latex-editor"
              id="latex-editor"
              order={2}
              defaultSize={previewVisible ? 42.5 : 85}
              minSize={25}
            >
              <div
                className={cn(
                  "relative h-full",
                  highlightEditor && "tutorial-highlight",
                )}
              >
                <LatexEditor />
                <button
                  type="button"
                  onClick={togglePreview}
                  title={
                    previewVisible
                      ? "Hide PDF preview (Cmd+\\)"
                      : "Show PDF preview (Cmd+\\)"
                  }
                  className="absolute right-3 bottom-3 z-40 rounded-md border bg-background/85 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
                >
                  {previewVisible ? (
                    <PanelRightCloseIcon className="size-4" />
                  ) : (
                    <PanelRightOpenIcon className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={toggleFocusMode}
                  title={
                    focusMode
                      ? "Exit focus mode (Cmd+Shift+F)"
                      : "Enter focus mode (Cmd+Shift+F)"
                  }
                  className="absolute bottom-3 left-3 z-40 rounded-md border bg-background/85 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
                >
                  {focusMode ? (
                    <Minimize2Icon className="size-4" />
                  ) : (
                    <Maximize2Icon className="size-4" />
                  )}
                </button>
              </div>
            </Panel>
          )}

          {(reviewMode || readerMode || previewVisible) && (
            <Fragment key="pdf-preview">
              {!reviewMode && !readerMode && (
                <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />
              )}

              <Panel
                id="pdf-preview"
                order={3}
                defaultSize={reviewMode ? 100 : readerMode ? 82 : 42.5}
                minSize={25}
              >
                <div
                  className={cn(
                    "relative h-full",
                    highlightPreview && "tutorial-highlight",
                  )}
                >
                  <PdfPreview />
                  {/* Reader mode toggle — mirrors the editor's focus-mode
                      button, and is the only way back to the editor when the
                      editor pane itself is hidden. */}
                  {!reviewMode && (
                    <button
                      type="button"
                      onClick={toggleReaderMode}
                      title={
                        readerMode
                          ? "Show editor (Cmd+Shift+R)"
                          : "Hide editor — read the PDF with the outline (Cmd+Shift+R)"
                      }
                      aria-label="Reader mode"
                      aria-pressed={readerMode}
                      className="absolute bottom-3 left-3 z-40 rounded-md border bg-background/85 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {readerMode ? (
                        <PanelLeftOpenIcon className="size-4" />
                      ) : (
                        <BookOpenTextIcon className="size-4" />
                      )}
                    </button>
                  )}
                </div>
              </Panel>
            </Fragment>
          )}
        </PanelGroup>

        {/* Problems point into the editor, so they're only useful when it's
            on screen; the status bar stays for page/compile state. */}
        {!focusMode && !reviewMode && !readerMode && (
          <WorkspaceProblemsDrawer />
        )}
        {!focusMode && !reviewMode && <StatusBar />}
      </div>
    </div>
  );
}
