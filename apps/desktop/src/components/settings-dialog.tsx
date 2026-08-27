import { useEffect, useState } from "react";
import {
  DEFAULT_REVIEW_TAGS,
  MAX_SUGGESTED_REVIEW_TAGS,
  parseReviewTags,
} from "@/lib/review-tags";
import { listen } from "@tauri-apps/api/event";
import {
  BookTypeIcon,
  FileCogIcon,
  TerminalIcon,
  DownloadIcon,
  Loader2Icon,
  CheckCircle2Icon,
  CircleIcon,
  InfoIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { DEFAULT_LANGUAGETOOL_URL } from "@/lib/language-tool";
import { useSettingsStore } from "@/stores/settings-store";
import { useUvSetupStore } from "@/stores/uv-setup-store";
import { useDocumentStore } from "@/stores/document-store";
import { AiSettings } from "@/components/ai-settings";
import { UvSetupDialog } from "@/components/uv-setup";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useResizableDialog } from "@/hooks/use-resizable-dialog";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { style: widthStyle, handle: resizeHandle } = useResizableDialog({
    storageKey: "tectonic-editor-settings-dialog-width",
    minWidth: 420,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
        style={widthStyle}
      >
        {resizeHandle}
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure the editor and optional AI assistance. Appearance options
            live in the palette icon on the activity rail.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          <EditorSection />
          <ReviewSection />
          <GrammarSection />
          <AiSettings />
          <PythonSection />
          <div className="space-y-2">
            <SectionHeading icon={InfoIcon} title="About" />
            <p className="text-muted-foreground text-xs">
              Bibliography metadata imported from arXiv is provided by arXiv and
              is subject to arXiv's API terms. DOI metadata may be provided by
              Crossref; ISBN metadata by Open Library.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeading({
  icon: Icon,
  title,
}: {
  icon: typeof FileCogIcon;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h3 className="font-medium text-sm">{title}</h3>
    </div>
  );
}

function EditorSection() {
  const compilerBackend = useSettingsStore((s) => s.compilerBackend);
  const setCompilerBackend = useSettingsStore((s) => s.setCompilerBackend);
  const vimMode = useSettingsStore((s) => s.vimMode);
  const setVimMode = useSettingsStore((s) => s.setVimMode);
  const lensExperimental = useSettingsStore((s) => s.lensExperimental);
  const setLensExperimental = useSettingsStore((s) => s.setLensExperimental);
  const autoCompile = useSettingsStore((s) => s.autoCompile);
  const setAutoCompile = useSettingsStore((s) => s.setAutoCompile);
  const inlineEditorsOnClick = useSettingsStore((s) => s.inlineEditorsOnClick);
  const setInlineEditorsOnClick = useSettingsStore(
    (s) => s.setInlineEditorsOnClick,
  );
  const formatLatexOnSave = useSettingsStore((s) => s.formatLatexOnSave);
  const setFormatLatexOnSave = useSettingsStore((s) => s.setFormatLatexOnSave);
  const latexStyleHints = useSettingsStore((s) => s.latexStyleHints);
  const setLatexStyleHints = useSettingsStore((s) => s.setLatexStyleHints);
  const simplePdfPreview = useSettingsStore((s) => s.simplePdfPreview);
  const setSimplePdfPreview = useSettingsStore((s) => s.setSimplePdfPreview);

  return (
    <div className="space-y-3">
      <SectionHeading icon={FileCogIcon} title="Editor" />

      <div className="space-y-1.5">
        <span className="text-muted-foreground text-xs">Compiler backend</span>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["tectonic", "Tectonic", "Embedded, offline"],
              ["texlive", "TeX Live", "System install"],
            ] as const
          ).map(([id, label, detail]) => {
            const active = compilerBackend === id;
            return (
              <button
                key={id}
                type="button"
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-ring bg-accent/50"
                    : "border-border hover:bg-muted/50",
                )}
                onClick={() => setCompilerBackend(id)}
              >
                <span className="font-medium text-sm">{label}</span>
                <span className="text-muted-foreground text-xs">{detail}</span>
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Vim mode</div>
          <div className="text-muted-foreground text-xs">
            Modal editing keybindings
          </div>
        </div>
        <input
          type="checkbox"
          checked={vimMode}
          onChange={(e) => setVimMode(e.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Open editors on click</div>
          <div className="text-muted-foreground text-xs">
            Clicking a table, citation, or figure opens its structured editor.
            When off, clicks just place the cursor — Alt+Enter opens editors.
          </div>
        </div>
        <input
          type="checkbox"
          checked={inlineEditorsOnClick}
          onChange={(event) => setInlineEditorsOnClick(event.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Format LaTeX on save</div>
          <div className="text-muted-foreground text-xs">
            Tidy indentation and environment layout with tex-fmt when saving a
            .tex file (Ctrl+S). Never re-wraps your prose. "Format document" in
            the editor's More menu works regardless.
          </div>
        </div>
        <input
          type="checkbox"
          checked={formatLatexOnSave}
          onChange={(event) => setFormatLatexOnSave(event.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Style suggestions</div>
          <div className="text-muted-foreground text-xs">
            Mark typography and plain-TeX carry-overs as you write: straight
            quotes, "..." instead of \dots, $$…$$, \bf and friends, and missing
            ties before \ref. Advisory only — each one is a hint with a
            one-click fix, never a compile error.
          </div>
        </div>
        <input
          type="checkbox"
          checked={latexStyleHints}
          onChange={(event) => setLatexStyleHints(event.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Source Lens (experimental)</div>
          <div className="text-muted-foreground text-xs">
            Source-preserving visual summaries for recognised LaTeX
          </div>
        </div>
        <input
          type="checkbox"
          checked={lensExperimental}
          onChange={(event) => setLensExperimental(event.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Lightweight PDF preview</div>
          <div className="text-muted-foreground text-xs">
            Reduce preview memory and CPU on low-power machines: standard
            resolution rendering, fewer prerendered pages, no text
            selection/clickable links in the PDF, flat page styling.
            Double-click sync and review tools keep working.
          </div>
        </div>
        <input
          type="checkbox"
          checked={simplePdfPreview}
          onChange={(event) => setSimplePdfPreview(event.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Auto-compile (experimental)</div>
          <div className="text-muted-foreground text-xs">
            Rebuild automatically after you stop typing, paced by how long the
            last build took. Not recommended for large projects with slow builds
            — Ctrl+S and Compile always work regardless.
          </div>
        </div>
        <input
          type="checkbox"
          checked={autoCompile}
          onChange={(event) => setAutoCompile(event.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
    </div>
  );
}

function ReviewSection() {
  const reviewerName = useSettingsStore((s) => s.reviewerName);
  const setReviewerName = useSettingsStore((s) => s.setReviewerName);
  const reviewTags = useSettingsStore((s) => s.reviewTags);
  const setReviewTags = useSettingsStore((s) => s.setReviewTags);
  // Edited as free text so a tag can be typed in peace; normalising on every
  // keystroke would eat the space bar halfway through "cite check".
  const [tagDraft, setTagDraft] = useState(reviewTags.join(", "));
  useEffect(() => {
    setTagDraft(reviewTags.join(", "));
  }, [reviewTags]);
  const commitTags = () =>
    setReviewTags(parseReviewTags(tagDraft, MAX_SUGGESTED_REVIEW_TAGS));

  return (
    <div className="space-y-3">
      <SectionHeading icon={MessageSquareTextIcon} title="PDF Review" />
      <div className="space-y-1.5">
        <label
          htmlFor="reviewer-name"
          className="text-muted-foreground text-xs"
        >
          Reviewer name
        </label>
        <input
          id="reviewer-name"
          type="text"
          value={reviewerName}
          onChange={(e) => setReviewerName(e.target.value)}
          placeholder="Auto (git user.name or OS username)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-muted-foreground leading-snug">
          Stamped on PDF review comments, highlights, and replies stored in the
          project's <span className="font-mono">review/</span> folder, so peers
          can tell who wrote what.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="review-tags" className="text-muted-foreground text-xs">
          Suggested tags
        </label>
        <input
          id="review-tags"
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={commitTags}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTags();
            }
          }}
          placeholder={DEFAULT_REVIEW_TAGS.join(", ")}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {reviewTags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {reviewTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground leading-snug">
          Offered as one-click suggestions when tagging an annotation. Separate
          with commas; any other tag can still be typed on the annotation
          itself.{" "}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setReviewTags([...DEFAULT_REVIEW_TAGS])}
          >
            Reset to defaults
          </button>
        </p>
      </div>
    </div>
  );
}

const LANGUAGETOOL_LANGUAGES = [
  ["auto", "Auto-detect"],
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["de-DE", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["nl", "Dutch"],
  ["pt-BR", "Portuguese (BR)"],
  ["it", "Italian"],
] as const;

function GrammarSection() {
  const url = useSettingsStore((s) => s.languageToolUrl);
  const setUrl = useSettingsStore((s) => s.setLanguageToolUrl);
  const language = useSettingsStore((s) => s.languageToolLanguage);
  const setLanguage = useSettingsStore((s) => s.setLanguageToolLanguage);
  const picky = useSettingsStore((s) => s.languageToolPicky);
  const setPicky = useSettingsStore((s) => s.setLanguageToolPicky);

  return (
    <div className="space-y-3">
      <SectionHeading icon={BookTypeIcon} title="Grammar (LanguageTool)" />

      <div className="space-y-1.5">
        <label
          htmlFor="languagetool-url"
          className="text-muted-foreground text-xs"
        >
          Server URL
        </label>
        <input
          id="languagetool-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={DEFAULT_LANGUAGETOOL_URL}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-muted-foreground leading-snug">
          The public API is rate-limited and requires internet. For offline or
          private checking, run a local LanguageTool server (e.g.{" "}
          <span className="font-mono">http://localhost:8081</span>) and point
          this at it.
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="languagetool-language"
          className="text-muted-foreground text-xs"
        >
          Language
        </label>
        <select
          id="languagetool-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          {LANGUAGETOOL_LANGUAGES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <div className="font-medium text-sm">Picky mode</div>
          <div className="text-muted-foreground text-xs">
            Enable stricter style and typography rules
          </div>
        </div>
        <input
          type="checkbox"
          checked={picky}
          onChange={(e) => setPicky(e.target.checked)}
          className="size-4 accent-primary"
        />
      </label>
    </div>
  );
}

function PythonSection() {
  const uvStatus = useUvSetupStore((s) => s.status);
  const uvVersion = useUvSetupStore((s) => s.version);
  const uvInstalling = useUvSetupStore((s) => s.isInstalling);
  const checkUv = useUvSetupStore((s) => s.checkStatus);
  const installUv = useUvSetupStore((s) => s.install);
  const finishUvInstall = useUvSetupStore((s) => s._finishInstall);
  const venvReady = useUvSetupStore((s) => s.venvReady);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const [showUvDialog, setShowUvDialog] = useState(false);

  useEffect(() => {
    checkUv();
  }, [checkUv]);

  useEffect(() => {
    const unlisten = listen<boolean>("uv-install-complete", (event) => {
      finishUvInstall(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [finishUvInstall]);

  const ready = uvStatus === "ready";
  const detail = uvInstalling
    ? "Installing…"
    : ready
      ? (uvVersion ?? "Installed")
      : uvStatus === "checking"
        ? "Checking…"
        : "Not installed";

  return (
    <div className="space-y-3">
      <SectionHeading icon={TerminalIcon} title="Python Environment" />
      <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
        {ready ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-emerald-500" />
        ) : (
          <CircleIcon className="size-4 shrink-0 text-muted-foreground/40" />
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">uv</div>
          <div className="truncate text-muted-foreground text-xs">{detail}</div>
        </div>
        {uvStatus === "not-installed" && !uvInstalling && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={installUv}
          >
            <DownloadIcon className="mr-1 size-3" />
            Install
          </Button>
        )}
        {uvInstalling && (
          <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {ready && projectRoot && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setShowUvDialog(true)}
        >
          {venvReady
            ? "Manage project environment"
            : "Set up project environment"}
        </Button>
      )}
      <p className="text-muted-foreground/70 text-xs">
        Optional. Enables running Python scripts and generating plots from
        within a project.
      </p>
      <UvSetupDialog
        open={showUvDialog}
        onClose={() => setShowUvDialog(false)}
      />
    </div>
  );
}
