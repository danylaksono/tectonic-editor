import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";

describe("useWorkspaceLayoutStore", () => {
  beforeEach(() => {
    useWorkspaceLayoutStore.setState({
      sidePanelOpen: true,
      activeSidePanel: "files",
      problemsDrawerOpen: false,
      focusMode: false,
    });
  });

  it("toggles focus mode without changing side panel state", () => {
    const store = useWorkspaceLayoutStore.getState();

    store.setActiveSidePanel("outline");
    store.toggleFocusMode();

    expect(useWorkspaceLayoutStore.getState()).toMatchObject({
      focusMode: true,
      sidePanelOpen: true,
      activeSidePanel: "outline",
    });

    useWorkspaceLayoutStore.getState().toggleFocusMode();
    expect(useWorkspaceLayoutStore.getState().focusMode).toBe(false);
  });

  it("sets focus mode explicitly", () => {
    useWorkspaceLayoutStore.getState().setFocusMode(true);
    expect(useWorkspaceLayoutStore.getState().focusMode).toBe(true);

    useWorkspaceLayoutStore.getState().setFocusMode(false);
    expect(useWorkspaceLayoutStore.getState().focusMode).toBe(false);
  });
});
