import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FolderIcon,
  ListIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react";
import { Sidebar } from "./sidebar";
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
import { useClaudeChatStore } from "@/stores/claude-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const sidePanelItems: Array<{
  id: WorkspaceSidePanel;
  label: string;
  icon: typeof FolderIcon;
}> = [
  { id: "files", label: "Files", icon: FolderIcon },
  { id: "outline", label: "Outline", icon: ListIcon },
  { id: "citations", label: "Citations", icon: BookOpenIcon },
];

function ActivityRail() {
  const sidePanelOpen = useWorkspaceLayoutStore((s) => s.sidePanelOpen);
  const activeSidePanel = useWorkspaceLayoutStore((s) => s.activeSidePanel);
  const toggleSidePanel = useWorkspaceLayoutStore((s) => s.toggleSidePanel);
  const setSidePanelOpen = useWorkspaceLayoutStore((s) => s.setSidePanelOpen);

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

      <div className="flex flex-1 flex-col items-center gap-1 px-1 py-2">
        {sidePanelItems.map((item) => {
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
          useClaudeChatStore
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
                    useClaudeChatStore
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
  const sidePanelOpen = useWorkspaceLayoutStore((s) => s.sidePanelOpen);
  const activeSidePanel = useWorkspaceLayoutStore((s) => s.activeSidePanel);

  // Cmd+\ / Ctrl+\ toggles the PDF preview pane.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        togglePreview();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePreview]);

  if (!initialized) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background">
      <ActivityRail />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1">
          {sidePanelOpen && (
            <>
              <Panel defaultSize={18} minSize={12} maxSize={32}>
                <Sidebar activePanel={activeSidePanel} />
              </Panel>

              <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />
            </>
          )}

          <Panel defaultSize={previewVisible ? 42.5 : 85} minSize={25}>
            <div className="relative h-full">
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
            </div>
          </Panel>

          {previewVisible && (
            <>
              <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring" />

              <Panel defaultSize={42.5} minSize={25}>
                <PdfPreview />
              </Panel>
            </>
          )}
        </PanelGroup>

        <WorkspaceProblemsDrawer />
      </div>
    </div>
  );
}
