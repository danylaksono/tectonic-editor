import { describe, it, expect, beforeEach, vi } from "vitest";
import { exists, readDir, readTextFile } from "@tauri-apps/plugin-fs";
import { useSkillsStore } from "@/stores/skills-store";
import { BUILTIN_SKILLS } from "./builtin";

const mockExists = vi.mocked(exists);
const mockReadDir = vi.mocked(readDir);
const mockReadTextFile = vi.mocked(readTextFile);

beforeEach(() => {
  vi.clearAllMocks();
  mockExists.mockResolvedValue(false);
  mockReadDir.mockResolvedValue([]);
  mockReadTextFile.mockResolvedValue("");
  useSkillsStore.setState({
    skills: [],
    shadowed: [],
    errors: [],
    isLoading: false,
    loadedProjectRoot: null,
  });
});

describe("skills store", () => {
  it("loads the built-in catalog", async () => {
    await useSkillsStore.getState().loadSkills(null);
    const state = useSkillsStore.getState();
    expect(state.skills).toHaveLength(BUILTIN_SKILLS.length);
    expect(state.isLoading).toBe(false);
    expect(state.loadedProjectRoot).toBeNull();
  });

  it("resolves a skill by name", async () => {
    await useSkillsStore.getState().loadSkills(null);
    expect(useSkillsStore.getState().getSkill("proofread")?.title).toBe(
      "Proofread",
    );
    expect(useSkillsStore.getState().getSkill("nope")).toBeUndefined();
    expect(useSkillsStore.getState().getSkill(null)).toBeUndefined();
  });

  it("ensureLoaded does not reload for the same project", async () => {
    await useSkillsStore.getState().ensureLoaded("/proj");
    const callsAfterFirst = mockExists.mock.calls.length;
    await useSkillsStore.getState().ensureLoaded("/proj");
    expect(mockExists.mock.calls.length).toBe(callsAfterFirst);
  });

  it("ensureLoaded reloads when the project changes", async () => {
    await useSkillsStore.getState().ensureLoaded("/proj-a");
    const callsAfterFirst = mockExists.mock.calls.length;
    await useSkillsStore.getState().ensureLoaded("/proj-b");
    expect(mockExists.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(useSkillsStore.getState().loadedProjectRoot).toBe("/proj-b");
  });

  it("clears isLoading even when the filesystem throws", async () => {
    mockExists.mockRejectedValue(new Error("disk on fire"));
    await useSkillsStore.getState().loadSkills("/proj");
    expect(useSkillsStore.getState().isLoading).toBe(false);
    // The built-ins must still be available with the disk unreadable.
    expect(useSkillsStore.getState().skills.length).toBe(BUILTIN_SKILLS.length);
  });
});
