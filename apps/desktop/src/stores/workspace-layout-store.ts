import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WorkspaceSidePanel =
  | "learn"
  | "files"
  | "search"
  | "outline"
  | "citations"
  | "grammar"
  | "health";

interface WorkspaceLayoutState {
  sidePanelOpen: boolean;
  activeSidePanel: WorkspaceSidePanel;
  problemsDrawerOpen: boolean;
  focusMode: boolean;
  /** Reader mode: the editor is hidden and the PDF fills the workspace next to
   *  the activity rail and side panel, so the outline can drive PDF browsing. */
  readerMode: boolean;
  reviewMode: boolean;
  setSidePanelOpen: (open: boolean) => void;
  setActiveSidePanel: (panel: WorkspaceSidePanel) => void;
  toggleSidePanel: (panel: WorkspaceSidePanel) => void;
  setProblemsDrawerOpen: (open: boolean) => void;
  toggleProblemsDrawer: () => void;
  setFocusMode: (open: boolean) => void;
  toggleFocusMode: () => void;
  setReaderMode: (open: boolean) => void;
  toggleReaderMode: () => void;
  setReviewMode: (open: boolean) => void;
  toggleReviewMode: () => void;
}

/** Entering reader mode: no editor to focus or report problems for, and the
 *  outline is the panel that makes the mode useful, so surface it. */
const readerModeEntryState = {
  readerMode: true,
  focusMode: false,
  problemsDrawerOpen: false,
  sidePanelOpen: true,
  activeSidePanel: "outline" as WorkspaceSidePanel,
};

export const useWorkspaceLayoutStore = create<WorkspaceLayoutState>()(
  persist(
    (set) => ({
      sidePanelOpen: true,
      activeSidePanel: "files",
      problemsDrawerOpen: false,
      focusMode: false,
      readerMode: false,
      reviewMode: false,
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
      // Focus mode (editor only) and reader mode (PDF only) are opposites —
      // turning one on always turns the other off.
      setFocusMode: (open) =>
        set({ focusMode: open, ...(open ? { readerMode: false } : {}) }),
      toggleFocusMode: () =>
        set((state) => ({
          focusMode: !state.focusMode,
          ...(!state.focusMode ? { readerMode: false } : {}),
        })),
      setReaderMode: (open) =>
        set(open ? readerModeEntryState : { readerMode: false }),
      toggleReaderMode: () =>
        set((state) =>
          state.readerMode ? { readerMode: false } : readerModeEntryState,
        ),
      setReviewMode: (open) =>
        set({
          reviewMode: open,
          ...(open ? { problemsDrawerOpen: false } : {}),
        }),
      toggleReviewMode: () =>
        set((state) => ({
          reviewMode: !state.reviewMode,
          ...(!state.reviewMode ? { problemsDrawerOpen: false } : {}),
        })),
    }),
    {
      name: "tectonic-editor-workspace-layout",
    },
  ),
);
