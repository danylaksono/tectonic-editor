import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  CopyIcon,
  FilePlusIcon,
  FolderOpenIcon,
  ImportIcon,
  RefreshCwIcon,
  SearchIcon,
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
  createSkill,
  duplicateSkill,
  ensureProjectSkillsDir,
  ensureUserSkillsDir,
  importSkillFiles,
} from "@/lib/skills/manage";
import type { Skill, SkillSource } from "@/lib/skills/types";
import { rankSkills } from "./skill-picker";
import { getSkillIcon } from "./skill-icon";
import { cn } from "@/lib/utils";

const SOURCE_LABELS: Record<SkillSource, string> = {
  builtin: "Built-in",
  user: "Your skills",
  project: "This project",
};

const SOURCE_ORDER: SkillSource[] = ["project", "user", "builtin"];

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

  const handleNew = (source: SkillSource) =>
    runFileAction("Skill created", async () => {
      const dir =
        source === "project" && projectRoot
          ? await ensureProjectSkillsDir(projectRoot)
          : await ensureUserSkillsDir();
      const { path, name } = await createSkill(dir, source);
      setSelectedName(name);
      return `${path} — edit it, then reload`;
    });

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
      await openPath(dir);
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
      <DialogContent className="flex h-[min(80vh,620px)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
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

          {/* Preview */}
          <div className="flex min-w-0 flex-1 flex-col">
            {!selected ? (
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
      </DialogContent>
    </Dialog>
  );
};
