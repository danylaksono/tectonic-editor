import { create } from "zustand";
import { loadAllSkills } from "@/lib/skills/load";
import type { Skill, SkillParseError } from "@/lib/skills/types";

interface SkillsState {
  /** Effective skills, precedence applied, sorted by title. */
  skills: Skill[];
  /** Skills overridden by a higher-precedence skill of the same name. */
  shadowed: Skill[];
  /** Files that failed to parse — listed in the gallery, never silently dropped. */
  errors: SkillParseError[];
  isLoading: boolean;
  /** Project the current catalog was loaded for, so a project switch reloads. */
  loadedProjectRoot: string | null;

  loadSkills: (projectRoot: string | null) => Promise<void>;
  /** Reload only if the project changed or nothing has been loaded yet. */
  ensureLoaded: (projectRoot: string | null) => Promise<void>;
  getSkill: (name: string | null | undefined) => Skill | undefined;
}

export const useSkillsStore = create<SkillsState>()((set, get) => ({
  skills: [],
  shadowed: [],
  errors: [],
  isLoading: false,
  loadedProjectRoot: null,

  loadSkills: async (projectRoot) => {
    set({ isLoading: true });
    try {
      const catalog = await loadAllSkills(projectRoot);
      set({
        skills: catalog.skills,
        shadowed: catalog.shadowed,
        errors: catalog.errors,
        loadedProjectRoot: projectRoot,
        isLoading: false,
      });
    } catch {
      // loadAllSkills already swallows per-file failures; this is a last resort
      // so a broken environment cannot leave the picker stuck loading.
      set({ isLoading: false });
    }
  },

  ensureLoaded: async (projectRoot) => {
    const s = get();
    if (s.isLoading) return;
    if (s.skills.length > 0 && s.loadedProjectRoot === projectRoot) return;
    await s.loadSkills(projectRoot);
  },

  getSkill: (name) => {
    if (!name) return undefined;
    return get().skills.find((s) => s.name === name);
  },
}));
