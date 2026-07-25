import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "next-themes";
import {
  PlayIcon,
  SaveIcon,
  PanelRightIcon,
  MaximizeIcon,
  BookOpenTextIcon,
  PanelLeftIcon,
  SettingsIcon,
  SunIcon,
  MoonIcon,
  MonitorIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { useDocumentStore } from "@/stores/document-store";
import { usePreviewStore } from "@/stores/preview-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useProjectStore } from "@/stores/project-store";
import { getEditorActions } from "@/lib/editor-actions";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { setTheme } = useTheme();

  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const files = useDocumentStore((s) => s.files);
  const setActiveFile = useDocumentStore((s) => s.setActiveFile);
  const recentProjects = useProjectStore((s) => s.recentProjects);
  const addRecentProject = useProjectStore((s) => s.addRecentProject);
  const openProject = useDocumentStore((s) => s.openProject);

  const openProjectByPath = (path: string) => {
    // Only record it as "recent" once it has actually loaded, so the
    // recent-projects list doesn't reorder itself before the switch is real.
    openProject(path)
      .then(() => addRecentProject(path))
      .catch((err) => console.error("Failed to open project", err));
  };

  useEffect(() => {
    const handler = () => setOpen((v) => !v);
    window.addEventListener("toggle-command-palette", handler);
    return () => window.removeEventListener("toggle-command-palette", handler);
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    // Defer so the dialog closes before the action runs (avoids focus fights).
    setTimeout(fn, 0);
  };

  const textFiles = files.filter((f) => f.type !== "image" && f.type !== "pdf");
  const activeFile = files.find(
    (file) => file.id === useDocumentStore.getState().activeFileId,
  );
  const sharedActions = getEditorActions({
    projectOpen: Boolean(projectRoot),
    activeFileType: activeFile?.type,
  });

  const otherRecentProjects = recentProjects.filter(
    (project) => project.path !== projectRoot,
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search files and projects…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {otherRecentProjects.length > 0 && (
          <CommandGroup heading="Projects">
            {otherRecentProjects.map((project) => (
              <CommandItem
                key={project.path}
                value={`project ${project.name} ${project.path}`}
                onSelect={() => run(() => openProjectByPath(project.path))}
              >
                <FolderOpenIcon />
                <span className="truncate">{project.name}</span>
                <span className="ml-auto max-w-[45%] truncate text-muted-foreground text-xs">
                  {project.path}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sharedActions.length > 0 && (
          <CommandGroup heading="Insert & Help">
            {sharedActions.map((action) => (
              <CommandItem
                key={action.id}
                value={`${action.label} ${action.keywords.join(" ")}`}
                onSelect={() => run(() => action.run())}
              >
                <FilePlusIcon />
                <span>{action.label}</span>
                {action.shortcut && (
                  <CommandShortcut>{action.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {projectRoot && (
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() =>
                run(() =>
                  window.dispatchEvent(new CustomEvent("trigger-compile")),
                )
              }
            >
              <PlayIcon />
              Compile document
              <CommandShortcut>⌘↵</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => {
                  const state = useDocumentStore.getState();
                  state.setIsSaving(true);
                  state
                    .saveCurrentFile()
                    .finally(() =>
                      setTimeout(() => state.setIsSaving(false), 500),
                    );
                })
              }
            >
              <SaveIcon />
              Save file
              <CommandShortcut>⌘S</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => run(() => usePreviewStore.getState().toggle())}
            >
              <PanelRightIcon />
              Toggle PDF preview
              <CommandShortcut>⌘\</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => useWorkspaceLayoutStore.getState().toggleFocusMode())
              }
            >
              <MaximizeIcon />
              Toggle focus mode
              <CommandShortcut>⌘⇧F</CommandShortcut>
            </CommandItem>
            <CommandItem
              value="toggle reader mode pdf only hide editor outline"
              onSelect={() =>
                run(() => useWorkspaceLayoutStore.getState().toggleReaderMode())
              }
            >
              <BookOpenTextIcon />
              Toggle reader mode (PDF only)
              <CommandShortcut>⌘⇧R</CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => {
                  const s = useWorkspaceLayoutStore.getState();
                  s.setSidePanelOpen(!s.sidePanelOpen);
                })
              }
            >
              <PanelLeftIcon />
              Toggle side panel
            </CommandItem>
          </CommandGroup>
        )}

        <CommandGroup heading="General">
          <CommandItem
            onSelect={() =>
              run(() => invoke("create_new_window").catch(console.error))
            }
          >
            <FilePlusIcon />
            New window
            <CommandShortcut>⌘⇧N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => window.dispatchEvent(new CustomEvent("open-settings")))
            }
          >
            <SettingsIcon />
            Open settings
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Appearance">
          <CommandItem onSelect={() => run(() => setTheme("light"))}>
            <SunIcon />
            Light theme
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("dark"))}>
            <MoonIcon />
            Dark theme
          </CommandItem>
          <CommandItem onSelect={() => run(() => setTheme("system"))}>
            <MonitorIcon />
            System theme
          </CommandItem>
        </CommandGroup>

        {projectRoot && textFiles.length > 0 && (
          <CommandGroup heading="Files">
            {textFiles.map((file) => (
              <CommandItem
                key={file.id}
                value={`file ${file.relativePath}`}
                onSelect={() => run(() => setActiveFile(file.id))}
              >
                <FileTextIcon />
                <span className="truncate">{file.relativePath}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
