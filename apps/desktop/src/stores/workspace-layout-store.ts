import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WorkspaceSidePanel = "files" | "outline" | "citations";

interface WorkspaceLayoutState {
  sidePanelOpen: boolean;
  activeSidePanel: WorkspaceSidePanel;
  problemsDrawerOpen: boolean;
  focusMode: boolean;
  setSidePanelOpen: (open: boolean) => void;
  setActiveSidePanel: (panel: WorkspaceSidePanel) => void;
  toggleSidePanel: (panel: WorkspaceSidePanel) => void;
  setProblemsDrawerOpen: (open: boolean) => void;
  toggleProblemsDrawer: () => void;
  setFocusMode: (open: boolean) => void;
  toggleFocusMode: () => void;
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      sidePanelOpen: true,
      activeSidePanel: "files",
      problemsDrawerOpen: false,
      focusMode: false,
      setSidePanelOpen: (open) => set({ sidePanelOpen: open }),
      setActiveSidePanel: (panel) =>
        set({ activeSidePanel: panel, sidePanelOpen: true }),
      toggleSidePanel: (panel) =>
        set((state) => {
          if (state.sidePanelOpen && state.activeSidePanel === panel) {
            return { sidePanelOpen: false };
          }
          return { activeSidePanel: panel, sidePanelOpen: true };
        }),
      setProblemsDrawerOpen: (open) => set({ problemsDrawerOpen: open }),
      toggleProblemsDrawer: () =>
        set((state) => ({ problemsDrawerOpen: !state.problemsDrawerOpen })),
      setFocusMode: (open) => set({ focusMode: open }),
      toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
    }),
    {
      name: "tectonic-editor-workspace-layout",
    },
  ),
);
