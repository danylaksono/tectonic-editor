import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { EditorHighlightTheme, WorkspacePalette } from "@/lib/appearance";
import { DEFAULT_LANGUAGETOOL_URL } from "@/lib/language-tool";

type CompilerBackend = "tectonic" | "texlive";
type AiProvider = "none" | "anthropic" | "openai";

export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 28;

export function clampEditorFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(
    MAX_EDITOR_FONT_SIZE,
    Math.max(MIN_EDITOR_FONT_SIZE, Math.round(size)),
  );
}

interface SettingsState {
  compilerBackend: CompilerBackend;
  setCompilerBackend: (backend: CompilerBackend) => void;
  /** Auto-compile: recompile automatically ~2s after the last edit (Overleaf-style).
   *  Off by default — every rebuild is a full LaTeX pass, which can be heavy
   *  on large projects. */
  autoCompile: boolean;
  setAutoCompile: (enabled: boolean) => void;
  vimMode: boolean;
  setVimMode: (enabled: boolean) => void;
  lensExperimental: boolean;
  setLensExperimental: (enabled: boolean) => void;
  workspacePalette: WorkspacePalette;
  setWorkspacePalette: (palette: WorkspacePalette) => void;
  editorHighlightTheme: EditorHighlightTheme;
  setEditorHighlightTheme: (theme: EditorHighlightTheme) => void;
  aiProvider: AiProvider;
  setAiProvider: (provider: AiProvider) => void;
  /** When false, clicking tables/citations/figures/etc. never auto-opens the
   *  structured editors — the click just places the cursor for source editing.
   *  Alt+Enter still opens the editor for the element at the cursor. */
  inlineEditorsOnClick: boolean;
  setInlineEditorsOnClick: (enabled: boolean) => void;
  /** Editor text size in px, clamped to [MIN_EDITOR_FONT_SIZE, MAX_EDITOR_FONT_SIZE]. */
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  /** LanguageTool v2 endpoint — public API by default, self-hosted for offline. */
  languageToolUrl: string;
  setLanguageToolUrl: (url: string) => void;
  /** Language code (e.g. "en-US") or "auto". */
  languageToolLanguage: string;
  setLanguageToolLanguage: (language: string) => void;
  /** Enable LanguageTool's stricter "picky" rules. */
  languageToolPicky: boolean;
  setLanguageToolPicky: (picky: boolean) => void;
  /** Author name stamped on PDF review comments and replies. Empty means
   *  "resolve automatically" (git user.name, then OS username). */
  reviewerName: string;
  setReviewerName: (name: string) => void;
  /** Run tex-fmt on the active .tex file when saving with Ctrl+S. */
  formatLatexOnSave: boolean;
  setFormatLatexOnSave: (enabled: boolean) => void;
  /** Typography and modern-command suggestions (straight quotes, "..." for
   *  \dots, $$…$$, plain-TeX font switches). Advisory only — they show up as
   *  info markers and never block a compile. */
  latexStyleHints: boolean;
  setLatexStyleHints: (enabled: boolean) => void;
  /** Last-used PDF review highlighter colour (token, not hex — see
   *  REVIEW_HIGHLIGHT_COLORS). Each annotation stores its own colour; this is
   *  just the default for the next highlight. */
  reviewHighlightColor: string;
  setReviewHighlightColor: (color: string) => void;
  /** Lightweight PDF preview for low-memory / low-power machines: renders
   *  pages at standard resolution (no DPR upscaling, lower pixel cap), skips
   *  the text-selection and link layers, prerenders fewer offscreen pages,
   *  and drops page shadows. Double-click sync and review tools still work. */
  simplePdfPreview: boolean;
  setSimplePdfPreview: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      compilerBackend: "tectonic",
      setCompilerBackend: (backend) => set({ compilerBackend: backend }),
      autoCompile: false,
      setAutoCompile: (enabled) => set({ autoCompile: enabled }),
      vimMode: false,
      setVimMode: (enabled) => set({ vimMode: enabled }),
      lensExperimental: false,
      setLensExperimental: (enabled) => set({ lensExperimental: enabled }),
      workspacePalette: "paper",
      setWorkspacePalette: (workspacePalette) => set({ workspacePalette }),
      editorHighlightTheme: "match",
      setEditorHighlightTheme: (editorHighlightTheme) =>
        set({ editorHighlightTheme }),
      aiProvider: "none",
      setAiProvider: (provider) => set({ aiProvider: provider }),
      inlineEditorsOnClick: true,
      setInlineEditorsOnClick: (enabled) =>
        set({ inlineEditorsOnClick: enabled }),
      editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
      setEditorFontSize: (size) =>
        set({ editorFontSize: clampEditorFontSize(size) }),
      languageToolUrl: DEFAULT_LANGUAGETOOL_URL,
      setLanguageToolUrl: (url) => set({ languageToolUrl: url.trim() }),
      languageToolLanguage: "auto",
      setLanguageToolLanguage: (language) =>
        set({ languageToolLanguage: language }),
      languageToolPicky: false,
      setLanguageToolPicky: (picky) => set({ languageToolPicky: picky }),
      reviewerName: "",
      setReviewerName: (name) => set({ reviewerName: name.trim() }),
      formatLatexOnSave: true,
      setFormatLatexOnSave: (enabled) => set({ formatLatexOnSave: enabled }),
      latexStyleHints: true,
      setLatexStyleHints: (enabled) => set({ latexStyleHints: enabled }),
      reviewHighlightColor: "yellow",
      setReviewHighlightColor: (color) => set({ reviewHighlightColor: color }),
      simplePdfPreview: false,
      setSimplePdfPreview: (enabled) => set({ simplePdfPreview: enabled }),
    }),
    {
      name: "tectonic-editor-settings",
      version: 3,
      // Coerce the removed "claude-cli" provider (and any unknown value) to "none"
      // for users upgrading from a build that still had the Claude CLI provider.
      migrate: (state) => {
        const s = state as Partial<SettingsState> | undefined;
        if (s && s.aiProvider !== "anthropic" && s.aiProvider !== "openai") {
          s.aiProvider = "none";
        }
        if (s && !s.workspacePalette) s.workspacePalette = "paper";
        if (s && !s.editorHighlightTheme) s.editorHighlightTheme = "match";
        if (s && typeof s.inlineEditorsOnClick !== "boolean") {
          s.inlineEditorsOnClick = true;
        }
        if (s && typeof s.languageToolUrl !== "string") {
          s.languageToolUrl = DEFAULT_LANGUAGETOOL_URL;
        }
        if (s && typeof s.languageToolLanguage !== "string") {
          s.languageToolLanguage = "auto";
        }
        if (s && typeof s.languageToolPicky !== "boolean") {
          s.languageToolPicky = false;
        }
        if (s && typeof s.autoCompile !== "boolean") {
          s.autoCompile = false;
        }
        if (s && typeof s.reviewerName !== "string") {
          s.reviewerName = "";
        }
        if (s && typeof s.formatLatexOnSave !== "boolean") {
          s.formatLatexOnSave = true;
        }
        if (s && typeof s.latexStyleHints !== "boolean") {
          s.latexStyleHints = true;
        }
        if (s && typeof s.reviewHighlightColor !== "string") {
          s.reviewHighlightColor = "yellow";
        }
        if (s && typeof s.simplePdfPreview !== "boolean") {
          s.simplePdfPreview = false;
        }
        return s as SettingsState;
      },
    },
  ),
);
