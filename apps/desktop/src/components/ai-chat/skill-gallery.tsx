import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CopyIcon,
  FilePlusIcon,
  FolderOpenIcon,
  ImportIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  SearchIcon,
  ShieldAlertIcon,
  Trash2Icon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSkillsStore } from "@/stores/skills-store";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useDocumentStore } from "@/stores/document-store";
import {
  NEW_SKILL_TEMPLATE,
  duplicateSkill,
  ensureProjectSkillsDir,
  ensureUserSkillsDir,
  importSkillFiles,
  deleteSkill,
  saveSkillFile,
  writeSkillFile,
} from "@/lib/skills/manage";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { Skill, SkillSource } from "@/lib/skills/types";
import { rankSkills, skillCanExecute } from "./skill-picker";
import { getSkillIcon } from "./skill-icon";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: "Built-in",
  user: "Your skills",
  project: "This project",
};

const SOURCE_ORDER: SkillSource[] = ["project", "user", "builtin"];

// Resizable dialog. Persisted so a size you chose once survives reopening.
const SIZE_STORAGE_KEY = "tectonic-editor-skill-gallery-size";
const DEFAULT_SIZE = { width: 960, height: 640 };
const MIN_SIZE = { width: 560, height: 360 };

function clampToViewport(size: { width: number; height: number }) {
  return {
    width: Math.max(
      MIN_SIZE.width,
      Math.min(size.width, window.innerWidth - 32),
    ),
    height: Math.max(
      MIN_SIZE.height,
      Math.min(size.height, window.innerHeight - 32),
    ),
  };
}

function loadSize() {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return DEFAULT_SIZE;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.width === "number" &&
      typeof parsed?.height === "number"
    ) {
      return clampToViewport(parsed);
    }
  } catch {
    // Corrupt or unavailable storage — fall back to the default size
  }
  return DEFAULT_SIZE;
}

interface SkillGalleryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SkillGallery: FC<SkillGalleryProps> = ({ open, onOpenChange }) => {
  const skills = useSkillsStore((s) => s.skills);
  const shadowed = useSkillsStore((s) => s.shadowed);
  const errors = useSkillsStore((s) => s.errors);
  const loadSkills = useSkillsStore((s) => s.loadSkills);
  const projectRoot = useDocumentStore((s) => s.projectRoot);
  const activeSkillName = useAiChatStore((s) => s.activeSkillName);
  const setActiveSkill = useAiChatStore((s) => s.setActiveSkill);

  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState(DEFAULT_SIZE);

  /** Raw-markdown editor. `path: null` means the file has not been written yet. */
  const [editor, setEditor] = useState<{
    path: string | null;
    source: SkillSource;
    fileName: string;
    text: string;
    error: string | null;
  } | null>(null);

  // Read the stored size when the dialog opens, and re-clamp it: the window may
  // have been made smaller since, which would otherwise strand the corner grip
  // off-screen.
  useEffect(() => {
    if (open) setSize(clampToViewport(loadSize()));
  }, [open]);

  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const start = size;

      const onMove = (move: PointerEvent) => {
        // The dialog is centred with a -50% translate, so it grows from both
        // edges — a given pointer travel changes each side by half of it.
        setSize(
          clampToViewport({
            width: start.width + (move.clientX - startX) * 2,
            height: start.height + (move.clientY - startY) * 2,
          }),
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setSize((current) => {
          try {
            localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(current));
          } catch {
            // Storage unavailable — the size still applies for this session
          }
          return current;
        });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [size],
  );

  const matched = useMemo(() => rankSkills(query, skills), [query, skills]);
  const selected = useMemo(
    () => matched.find((s) => s.name === selectedName) ?? matched[0],
    [matched, selectedName],
  );

  // Show the active skill when the gallery opens, so it opens on context
  useEffect(() => {
    if (open) setSelectedName(activeSkillName);
  }, [open, activeSkillName]);

  const reload = useCallback(async () => {
    await loadSkills(projectRoot);
  }, [loadSkills, projectRoot]);

  const runFileAction = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setBusy(true);
      try {
        const message = await action();
        await reload();
        toast.success(label, { description: message });
      } catch (err) {
        toast.error(`${label} failed`, { description: String(err) });
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  // Opens the editor without writing anything: cancelling a new skill should
  // not leave a stray file behind.
  const handleNew = (source: SkillSource) =>
    setEditor({
      path: null,
      source,
      fileName: "new-skill",
      text: NEW_SKILL_TEMPLATE,
      error: null,
    });

  const handleEdit = async (skill: Skill) => {
    if (!skill.path) return;
    setBusy(true);
    try {
      const text = await readTextFile(skill.path);
      setEditor({
        path: skill.path,
        source: skill.source,
        fileName: skill.path.split(/[\\/]/).pop() ?? skill.name,
        text,
        error: null,
      });
    } catch (err) {
      toast.error("Could not open the skill file", {
        description: String(err),
      });
    } finally {
      setBusy(false);
    }
  };

  /** Two-step delete: the second click within the card confirms. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  useEffect(() => setConfirmDelete(null), [selectedName]);

  const handleDelete = (skill: Skill) =>
    runFileAction("Skill deleted", async () => {
      const removed = await deleteSkill(skill);
      setConfirmDelete(null);
      setSelectedName(null);
      return removed;
    });

  const handleSaveEditor = async () => {
    if (!editor) return;
    setBusy(true);
    try {
      const result = editor.path
        ? await saveSkillFile(editor.path, editor.text, editor.source)
        : await writeSkillFile(
            editor.source === "project" && projectRoot
              ? await ensureProjectSkillsDir(projectRoot)
              : await ensureUserSkillsDir(),
            editor.fileName,
            editor.text,
            editor.source,
          );
      await reload();
      setSelectedName(result.name);
      setEditor(null);
      toast.success("Skill saved", { description: result.path });
    } catch (err) {
      // Validation failures belong next to the text, not in a toast that
      // disappears while the user is still fixing the file.
      setEditor((e) => (e ? { ...e, error: String(err) } : e));
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = (skill: Skill) =>
    runFileAction("Skill duplicated", async () => {
      const dir = await ensureUserSkillsDir();
      const { path, name } = await duplicateSkill(skill, dir, "user");
      setSelectedName(name);
      return path;
    });

  const handleImport = () =>
    runFileAction("Skills imported", async () => {
      const picked = await openFileDialog({
        multiple: true,
        title: "Import skill files",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      if (paths.length === 0) throw new Error("Nothing selected");

      const dir = await ensureUserSkillsDir();
      const { imported, rejected } = await importSkillFiles(paths, dir, "user");

      // Rejected files are never written — say which and why
      if (rejected.length > 0) {
        toast.warning(`${rejected.length} file(s) were not skills`, {
          description: rejected
            .map((r) => `${r.fileName}: ${r.message}`)
            .join("\n"),
        });
      }
      if (imported.length === 0) throw new Error("No valid skill files");
      setSelectedName(imported[0].name);
      return `${imported.length} imported — review the body before using it`;
    });

  const handleRevealFolder = (skill?: Skill) =>
    runFileAction("Opened folder", async () => {
      const dir = skill?.path
        ? skill.path.replace(/[\\/][^\\/]+$/, "")
        : await ensureUserSkillsDir();
      // Not plugin-shell's `open`: that is scoped to URLs (mailto/tel/http)
      // and rejects filesystem paths. This command exists for exactly this.
      await invoke("reveal_in_file_manager", { path: dir });
      return dir;
    });

  const grouped = useMemo(() => {
    return SOURCE_ORDER.map((source) => ({
      source,
      items: matched.filter((s) => s.source === source),
    })).filter((g) => g.items.length > 0);
  }, [matched]);

  const isShadowing = (skill: Skill) =>
    shadowed.some((s) => s.name === skill.name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `sm:max-w-*` must be overridden explicitly: DialogContent's own
          `sm:max-w-lg` is a different Tailwind variant, so `cn` keeps both and
          the narrower one wins on any screen wider than 640px. */}
      <DialogContent
        className="flex max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        style={{ width: size.width, height: size.height }}
      >
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle>Skills</DialogTitle>
          <DialogDescription>
            Reusable working modes for the assistant. Type{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">/</code> in
            the chat to use one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* List */}
          <div className="flex w-64 shrink-0 flex-col border-border border-r">
            <div className="relative border-border border-b p-2">
              <SearchIcon className="absolute top-4.5 left-4 size-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search skills..."
                className="w-full rounded-md border border-input bg-background py-1 pr-2 pl-7 text-sm outline-none focus:border-ring"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1">
              {grouped.length === 0 && (
                <div className="px-2 py-3 text-muted-foreground text-sm">
                  No skills match.
                </div>
              )}
              {grouped.map((group) => (
                <div key={group.source} className="mb-2">
                  <div className="px-2 py-1 font-medium text-muted-foreground text-xs uppercase">
                    {SOURCE_LABELS[group.source]}
                  </div>
                  {group.items.map((skill) => {
                    const Icon = getSkillIcon(skill.icon);
                    const isSelected = selected?.name === skill.name;
                    return (
                      <button
                        key={`${skill.source}:${skill.name}`}
                        type="button"
                        onClick={() => setSelectedName(skill.name)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                          isSelected
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted",
                        )}
                      >
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {skill.title}
                        </span>
                        {activeSkillName === skill.name && (
                          <span className="shrink-0 rounded-sm bg-violet-500/15 px-1 text-[10px] text-violet-600 uppercase dark:text-violet-400">
                            Active
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}

              {errors.length > 0 && (
                <div className="mb-2">
                  <div className="px-2 py-1 font-medium text-amber-600 text-xs uppercase dark:text-amber-400">
                    Not loaded ({errors.length})
                  </div>
                  {errors.map((err) => (
                    <div
                      key={err.path}
                      className="px-2 py-1 text-muted-foreground text-xs"
                      title={err.message}
                    >
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <AlertTriangleIcon className="size-3 shrink-0" />
                        <span className="truncate">{err.fileName}</span>
                      </span>
                      <span className="line-clamp-2 block">{err.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-1 border-border border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => handleNew("user")}
              >
                <FilePlusIcon className="size-3.5" /> New
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={handleImport}
              >
                <ImportIcon className="size-3.5" /> Import
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={busy}
                onClick={() => void reload()}
              >
                <RefreshCwIcon className="size-3.5" /> Reload
              </Button>
            </div>
          </div>

          {/* Preview, or the raw-markdown editor when one is open */}
          <div className="flex min-w-0 flex-1 flex-col">
            {editor ? (
              <>
                <div className="flex items-center gap-2 border-border border-b px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm">
                      {editor.path ? "Edit skill" : "New skill"}
                    </h3>
                    {editor.path ? (
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {editor.path}
                      </p>
                    ) : (
                      <label className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
                        File name
                        <input
                          value={editor.fileName}
                          onChange={(e) =>
                            setEditor((current) =>
                              current
                                ? { ...current, fileName: e.target.value }
                                : current,
                            )
                          }
                          className="w-48 rounded-md border border-input bg-background px-2 py-0.5 font-mono text-foreground text-xs outline-none focus:border-ring"
                        />
                        <span>.md</span>
                      </label>
                    )}
                  </div>
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={busy}
                    onClick={() => void handleSaveEditor()}
                  >
                    <SaveIcon className="size-3.5" /> Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    disabled={busy}
                    onClick={() => setEditor(null)}
                  >
                    Cancel
                  </Button>
                </div>

                {editor.error && (
                  <div className="mx-5 mt-3 flex items-start gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1.5 text-destructive text-xs">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>{editor.error}</span>
                  </div>
                )}

                <textarea
                  value={editor.text}
                  onChange={(e) =>
                    setEditor((current) =>
                      current
                        ? { ...current, text: e.target.value, error: null }
                        : current,
                    )
                  }
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none bg-transparent px-5 py-4 font-mono text-xs leading-relaxed outline-none"
                />

                <div className="border-border border-t px-5 py-2 text-[11px] text-muted-foreground">
                  The frontmatter block sets the name, description and tools —
                  see the fields table in the docs. Saving checks the file
                  parses first.
                </div>
              </>
            ) : !selected ? (
              <div className="flex flex-1 items-center justify-center p-6 text-center text-muted-foreground text-sm">
                Select a skill to see exactly what it tells the assistant to do.
              </div>
            ) : (
              <>
                <div className="border-border border-b px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium">{selected.title}</h3>
                      <p className="text-muted-foreground text-sm">
                        {selected.description}
                      </p>
                    </div>
                    {activeSkillName === selected.name ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setActiveSkill(null)}
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setActiveSkill(selected.name);
                          onOpenChange(false);
                        }}
                      >
                        Use skill
                      </Button>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                      /{selected.name}
                    </span>
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
                      {SOURCE_LABELS[selected.source]}
                    </span>
                    {selected.model && (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {selected.model}
                      </span>
                    )}
                    {isShadowing(selected) && (
                      <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-400">
                        overrides a lower-precedence skill
                      </span>
                    )}
                  </div>

                  <div className="mt-2 text-muted-foreground text-xs">
                    {selected.tools === undefined ? (
                      <>Can use every tool the assistant has.</>
                    ) : selected.tools.length === 0 ? (
                      <>Cannot use any tools — chat replies only.</>
                    ) : (
                      <>
                        Limited to:{" "}
                        <span className="font-mono">
                          {selected.tools.join(", ")}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Execution is called out on its own rather than left as one
                      entry in the tool list: running code is categorically
                      different from reading files, and this is the screen where
                      a skill from someone else gets judged. */}
                  {skillCanExecute(selected) && (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-amber-700 text-xs dark:text-amber-400">
                      <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
                      <span>
                        This skill can run Python on your computer. Each script
                        is shown to you for approval before it runs, and runs
                        with your account's file and network access.
                      </span>
                    </div>
                  )}

                  {selected.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {selected.warnings.map((w) => (
                        <li
                          key={w}
                          className="flex items-center gap-1 text-amber-600 text-xs dark:text-amber-400"
                        >
                          <AlertTriangleIcon className="size-3 shrink-0" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* The full body: activating a skill accepts these instructions
                    into the system prompt, so it is always shown in full. */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <div className="mb-2 font-medium text-muted-foreground text-xs uppercase">
                    Instructions
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                    {selected.body}
                  </pre>
                </div>

                <div className="flex items-center gap-1 border-border border-t px-3 py-2">
                  {selected.path && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled={busy}
                        onClick={() => void handleEdit(selected)}
                      >
                        <PencilIcon className="size-3.5" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-7 px-2 text-xs",
                          confirmDelete === selected.name &&
                            "text-destructive hover:text-destructive",
                        )}
                        disabled={busy}
                        onClick={() =>
                          confirmDelete === selected.name
                            ? handleDelete(selected)
                            : setConfirmDelete(selected.name)
                        }
                      >
                        <Trash2Icon className="size-3.5" />
                        {confirmDelete === selected.name
                          ? selected.dir
                            ? "Delete folder?"
                            : "Delete?"
                          : "Delete"}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => handleDuplicate(selected)}
                  >
                    <CopyIcon className="size-3.5" />
                    {selected.source === "builtin"
                      ? "Copy to your skills"
                      : "Duplicate"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => handleRevealFolder(selected)}
                  >
                    <FolderOpenIcon className="size-3.5" /> Open folder
                  </Button>
                  {selected.path && (
                    <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
                      {selected.path}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Resize grip. Sits above the dialog's own close button's corner but
            below it in the stacking order, so both stay clickable. */}
        <div
          onPointerDown={startResize}
          role="separator"
          aria-label="Resize dialog"
          className="absolute right-0 bottom-0 z-10 flex size-4 cursor-nwse-resize items-end justify-end p-0.5"
        >
          <svg
            viewBox="0 0 10 10"
            className="size-2.5 text-muted-foreground/60"
            aria-hidden="true"
          >
            <title>Resize</title>
            <path
              d="M9 1 1 9M9 5 5 9"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </DialogContent>
    </Dialog>
  );
};
