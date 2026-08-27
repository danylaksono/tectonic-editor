import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  BookOpenIcon,
  CheckIcon,
  CloudIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderIcon,
  LibraryIcon,
  LoaderIcon,
  LogOutIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ServerIcon,
  SettingsIcon,
  SparklesIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import {
  buildMissingCitationSearchPrompt,
  buildProjectReferenceIndex,
  filterProjectReferences,
  isMissingProjectReference,
  type MissingProjectReference,
  type ProjectReference,
  type ReferenceFilter,
  type ReferenceIssueFilter,
} from "@/lib/project-references";
import {
  resolveProjectReferenceScope,
  selectProjectReferenceFiles,
} from "@/lib/project-reference-scope";
import type { ZoteroCollection } from "@/lib/zotero-api";
import { useZoteroStore, type CollectionSyncInfo } from "@/stores/zotero-store";
import { resolveTexRoot, useDocumentStore } from "@/stores/document-store";
import { cn } from "@/lib/utils";
import { ExternalBibliographySources } from "@/components/workspace/external-bibliography-sources";
import { ZoteroCollectionBrowser } from "@/components/workspace/zotero-collection-browser";
import { DuplicateBibliographyDialog } from "@/components/workspace/duplicate-bibliography-dialog";
import {
  buildSmartDuplicateCleanupPrompt,
  groupDuplicateBibliographyEntries,
  keepDuplicateBibliographyEntry,
} from "@/lib/duplicate-bibliography";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const MYLIB_KEY = "__my_library__";

function storeKeyFor(collectionKey: string | null): string {
  return collectionKey ?? MYLIB_KEY;
}

export function ReferencesPanel() {
  return (
    <Tabs defaultValue="project" className="h-full gap-0">
      <TabsList className="mx-2 mt-2 grid h-7 grid-cols-2 rounded-md p-0.5">
        <TabsTrigger className="h-6 px-2 text-[11px]" value="project">
          Project
        </TabsTrigger>
        <TabsTrigger className="h-6 px-2 text-[11px]" value="libraries">
          Libraries
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="project"
        className="mt-0 min-h-0 flex-1 overflow-hidden"
      >
        <ProjectReferencesView />
      </TabsContent>
      <TabsContent
        value="libraries"
        className="mt-0 min-h-0 flex-1 overflow-hidden"
      >
        <LibrarySourcesView />
      </TabsContent>
    </Tabs>
  );
}

export function ReferencesHeader() {
  const openImport = () =>
    window.dispatchEvent(new CustomEvent("open-bibliography-import"));

  return (
    <div className="relative flex w-full items-center justify-center px-3">
      <div className="flex items-center gap-2">
        <BookOpenIcon className="size-3.5 text-muted-foreground" />
        <span className="font-medium text-xs">References</span>
      </div>
      <button
        type="button"
        className="absolute right-3 rounded p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={openImport}
        title="Add reference"
        aria-label="Add reference"
      >
        <PlusIcon className="size-3.5" />
      </button>
    </div>
  );
}

function ProjectReferencesView() {
  const files = useDocumentStore((state) => state.files);
  const activeFileId = useDocumentStore((state) => state.activeFileId);
  const setActiveFile = useDocumentStore((state) => state.setActiveFile);
  const requestJumpToPosition = useDocumentStore(
    (state) => state.requestJumpToPosition,
  );
  const aiProvider = useSettingsStore((state) => state.aiProvider);
  const aiStreaming = useAiChatStore((state) => state.isStreaming);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReferenceFilter>("all");
  const [issueFilter, setIssueFilter] = useState<ReferenceIssueFilter>("all");
  const [bibliographyScope, setBibliographyScope] = useState<
    "document" | "all"
  >("document");
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateDialogTarget, setDuplicateDialogTarget] = useState<{
    key: string;
    renameEntry?: ProjectReference;
  } | null>(null);
  const [repairingDuplicate, setRepairingDuplicate] = useState(false);
  const rootFileId = useMemo(() => {
    const seed =
      files.find((file) => file.id === activeFileId && file.type === "tex")
        ?.id ??
      files.find((file) => file.type === "tex")?.id ??
      activeFileId;
    return resolveTexRoot(seed, files);
  }, [activeFileId, files]);
  const projectScope = useMemo(
    () => resolveProjectReferenceScope(files, rootFileId),
    [files, rootFileId],
  );
  const indexedFiles = useMemo(
    () =>
      selectProjectReferenceFiles(
        files,
        projectScope,
        bibliographyScope === "all",
      ),
    [bibliographyScope, files, projectScope],
  );
  const index = useMemo(
    () => buildProjectReferenceIndex(indexedFiles),
    [indexedFiles],
  );
  const allBibliographyCount = files.filter(
    (file) => file.type === "bib",
  ).length;
  const documentBibliographyNames = files
    .filter((file) => projectScope.bibliographyFileIds.has(file.id))
    .map((file) => file.relativePath);
  const duplicateGroups = useMemo(
    () => groupDuplicateBibliographyEntries(index.entries),
    [index.entries],
  );
  const duplicateGroupsByKey = useMemo(
    () => new Map(duplicateGroups.map((group) => [group.key, group])),
    [duplicateGroups],
  );
  const references = useMemo(
    () => filterProjectReferences(index, filter, query, issueFilter),
    [filter, index, issueFilter, query],
  );
  const duplicateEntryCount = index.entries.filter(
    (entry) => entry.isDuplicate,
  ).length;
  const issueCount = index.missing.length + duplicateGroups.length;

  const jumpTo = (fileId: string, from: number) => {
    setActiveFile(fileId);
    setTimeout(() => requestJumpToPosition(from), 50);
  };

  const openDuplicateDialog = (
    entry?: ProjectReference,
    renameEntry = false,
  ) => {
    setDuplicateDialogTarget(
      entry
        ? {
            key: entry.key,
            ...(renameEntry ? { renameEntry: entry } : {}),
          }
        : null,
    );
    setDuplicateDialogOpen(true);
  };

  const keepDuplicate = async (entry: ProjectReference) => {
    const group = duplicateGroupsByKey.get(entry.key);
    if (!group) return;
    setRepairingDuplicate(true);
    try {
      if (!(await keepDuplicateBibliographyEntry(group, entry))) {
        toast.error("The bibliography changed before it could be updated");
      }
    } finally {
      setRepairingDuplicate(false);
    }
  };

  const smartCleanup = (groups = duplicateGroups) => {
    if (aiProvider === "none" || groups.length === 0 || aiStreaming) return;
    const files = Array.from(
      new Set(
        groups.flatMap((group) => group.entries.map((entry) => entry.filePath)),
      ),
    );
    setDuplicateDialogOpen(false);
    setDuplicateDialogTarget(null);
    void useAiChatStore
      .getState()
      .sendPrompt(buildSmartDuplicateCleanupPrompt(groups), undefined, {
        scope: "bibliography",
        files,
        action: "explain",
      });
  };

  const findMissingCitationWithAi = (
    reference: MissingProjectReference,
  ): void => {
    if (aiProvider === "none") {
      toast.info("Connect an AI provider to investigate missing citations");
      return;
    }
    if (aiStreaming) return;

    const relevantFileIds = new Set(reference.uses.map((use) => use.fileId));
    const relevantFiles = indexedFiles
      .filter(
        (file) =>
          relevantFileIds.has(file.id) ||
          file.name.toLowerCase().endsWith(".bib"),
      )
      .map((file) => file.relativePath);

    void useAiChatStore
      .getState()
      .sendPrompt(
        buildMissingCitationSearchPrompt(reference, indexedFiles),
        undefined,
        {
          scope: "bibliography",
          files: relevantFiles,
          action: "explain",
        },
      );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-sidebar-border border-b px-2 py-2">
        {allBibliographyCount > 1 &&
          !projectScope.fallbackToAllBibliographyFiles && (
            <div className="space-y-1">
              <div
                className="grid grid-cols-2 rounded-md bg-muted p-0.5"
                role="group"
                aria-label="Bibliography file scope"
              >
                <BibliographyScopeButton
                  active={bibliographyScope === "document"}
                  label={`Document ${projectScope.bibliographyFileIds.size}`}
                  onClick={() => setBibliographyScope("document")}
                />
                <BibliographyScopeButton
                  active={bibliographyScope === "all"}
                  label={`All .bib ${allBibliographyCount}`}
                  onClick={() => setBibliographyScope("all")}
                />
              </div>
              <p
                className="truncate px-0.5 text-[9px] text-muted-foreground"
                title={documentBibliographyNames.join(", ")}
              >
                Document uses {documentBibliographyNames.join(", ")}
              </p>
            </div>
          )}
        {allBibliographyCount > 1 &&
          projectScope.fallbackToAllBibliographyFiles && (
            <p className="px-0.5 text-[9px] text-muted-foreground">
              No bibliography declaration resolved; showing all .bib files
            </p>
          )}
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              if (nextQuery.trim()) {
                setFilter("all");
                setIssueFilter("all");
              }
            }}
            className="h-7 pl-7 text-xs"
            placeholder="Search keys, metadata, DOI, or BibTeX"
            aria-label="Search project references"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          <ReferenceFilterButton
            active={filter === "all"}
            label={`All ${index.entries.length}`}
            onClick={() => setFilter("all")}
          />
          <ReferenceFilterButton
            active={filter === "cited"}
            label={`Cited ${index.entries.filter((entry) => entry.citationCount > 0).length}`}
            onClick={() => setFilter("cited")}
          />
          <ReferenceFilterButton
            active={filter === "unused"}
            label={`Unused ${index.entries.filter((entry) => entry.citationCount === 0).length}`}
            onClick={() => setFilter("unused")}
          />
          <ReferenceFilterButton
            active={filter === "issues"}
            label={`Issues ${issueCount}`}
            onClick={() => setFilter("issues")}
            hasIssue={issueCount > 0}
          />
        </div>
        {filter === "issues" && issueCount > 0 && (
          <div className="space-y-1">
            <div
              className="flex items-center gap-1 overflow-x-auto"
              role="group"
              aria-label="Filter reference issues"
            >
              <IssueFilterTag
                active={issueFilter === "all"}
                label={`All ${issueCount}`}
                onClick={() => setIssueFilter("all")}
              />
              <IssueFilterTag
                active={issueFilter === "duplicates"}
                label={`Duplicate keys ${duplicateGroups.length}`}
                onClick={() => setIssueFilter("duplicates")}
              />
              <IssueFilterTag
                active={issueFilter === "missing"}
                label={`Missing ${index.missing.length}`}
                onClick={() => setIssueFilter("missing")}
              />
            </div>
            {duplicateGroups.length > 0 && issueFilter !== "missing" && (
              <p className="px-0.5 text-[9px] text-muted-foreground">
                {duplicateEntryCount} bibliography copies across{" "}
                {duplicateGroups.length} duplicate{" "}
                {duplicateGroups.length === 1 ? "key" : "keys"}
              </p>
            )}
          </div>
        )}
        {duplicateGroups.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full justify-start text-xs"
            onClick={() => openDuplicateDialog()}
          >
            <WrenchIcon className="size-3" />
            Review / bulk fix {duplicateGroups.length} duplicate{" "}
            {duplicateGroups.length === 1 ? "key" : "keys"}
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {index.entries.length === 0 && index.missing.length === 0 ? (
          <EmptyProjectReferences />
        ) : references.length === 0 ? (
          <div className="px-3 py-8 text-center text-muted-foreground text-xs">
            No matching references
          </div>
        ) : (
          references.map((reference) => {
            if (isMissingProjectReference(reference)) {
              return (
                <div
                  key={`missing:${reference.key}`}
                  className="group flex w-full items-start hover:bg-sidebar-accent/60"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    onClick={() => jumpTo(reference.fileId, reference.from)}
                  >
                    <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-xs">
                        Missing: {reference.key}
                      </span>
                      <span className="block text-[10px] text-destructive">
                        Cited {formatUseCount(reference.citationCount)}, no
                        bibliography entry
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="m-1 shrink-0 rounded p-1 text-muted-foreground opacity-70 transition-colors hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
                    aria-label={`Find missing citation ${reference.key} with AI`}
                    title={
                      aiProvider === "none"
                        ? "Connect an AI provider to find this citation"
                        : aiStreaming
                          ? "AI is currently busy"
                          : "Find with AI"
                    }
                    disabled={aiProvider === "none" || aiStreaming}
                    onClick={() => findMissingCitationWithAi(reference)}
                  >
                    <SparklesIcon className="size-3.5" />
                  </button>
                </div>
              );
            }

            return (
              <ProjectReferenceRow
                key={`${reference.fileId}:${reference.from}:${reference.key}`}
                reference={reference}
                onClick={() => jumpTo(reference.fileId, reference.from)}
                duplicateGroup={duplicateGroupsByKey.get(reference.key)}
                repairDisabled={repairingDuplicate}
                onReviewDuplicate={() => openDuplicateDialog(reference)}
                onRenameDuplicate={() => openDuplicateDialog(reference, true)}
                onKeepDuplicate={() => void keepDuplicate(reference)}
                onSmartCleanup={() => {
                  const group = duplicateGroupsByKey.get(reference.key);
                  if (group) smartCleanup([group]);
                }}
                smartCleanupAvailable={aiProvider !== "none" && !aiStreaming}
              />
            );
          })
        )}
      </div>

      <div className="border-sidebar-border border-t px-2 py-1.5 text-[10px] text-muted-foreground">
        {query.trim() ? (
          <>
            {references.length} global search{" "}
            {references.length === 1 ? "result" : "results"}
          </>
        ) : filter === "issues" ? (
          <>
            {issueCount} distinct {issueCount === 1 ? "issue" : "issues"} ·{" "}
            {references.length} matching{" "}
            {references.length === 1 ? "item" : "items"}
          </>
        ) : (
          <>
            {index.entries.length}{" "}
            {index.entries.length === 1 ? "reference" : "references"} ·{" "}
            {index.citationCount}{" "}
            {index.citationCount === 1 ? "citation" : "citations"}
          </>
        )}
      </div>

      <DuplicateBibliographyDialog
        open={duplicateDialogOpen}
        onOpenChange={(open) => {
          setDuplicateDialogOpen(open);
          if (!open) setDuplicateDialogTarget(null);
        }}
        groups={duplicateGroups}
        existingKeys={index.entries.map((entry) => entry.key)}
        initialQuery={duplicateDialogTarget?.key}
        initialRenameEntry={duplicateDialogTarget?.renameEntry}
        onSmartCleanup={() => smartCleanup()}
        smartCleanupAvailable={aiProvider !== "none"}
        smartCleanupBusy={aiStreaming}
        onOpenEntry={(entry) => {
          setDuplicateDialogOpen(false);
          jumpTo(entry.fileId, entry.from);
        }}
      />
    </div>
  );
}

function ReferenceFilterButton({
  active,
  label,
  onClick,
  hasIssue = false,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  hasIssue?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
        hasIssue && !active && "text-destructive",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function BibliographyScopeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded px-2 py-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-background font-medium text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function IssueFilterTag({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[9px] transition-colors",
        active
          ? "border-primary/40 bg-primary/10 font-medium text-foreground"
          : "border-sidebar-border bg-background text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function ProjectReferenceRow({
  reference,
  onClick,
  duplicateGroup,
  repairDisabled = false,
  onReviewDuplicate,
  onRenameDuplicate,
  onKeepDuplicate,
  onSmartCleanup,
  smartCleanupAvailable = false,
}: {
  reference: ProjectReference;
  onClick: () => void;
  duplicateGroup?: ReturnType<typeof groupDuplicateBibliographyEntries>[number];
  repairDisabled?: boolean;
  onReviewDuplicate?: () => void;
  onRenameDuplicate?: () => void;
  onKeepDuplicate?: () => void;
  onSmartCleanup?: () => void;
  smartCleanupAvailable?: boolean;
}) {
  const source =
    reference.journal ??
    reference.booktitle ??
    reference.publisher ??
    reference.filePath;

  const row = (
    <button
      type="button"
      className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onClick}
      title={`Open ${reference.key} in ${reference.filePath}`}
    >
      <FileTextIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-xs">
          {reference.title ?? reference.key}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {[reference.author, reference.year, source]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="truncate font-mono text-[9px] text-muted-foreground">
            {reference.key}
          </span>
          {reference.isDuplicate ? (
            <span className="shrink-0 text-[9px] text-destructive">
              Duplicate key
            </span>
          ) : reference.citationCount > 0 ? (
            <span className="shrink-0 text-[9px] text-muted-foreground">
              cited {formatUseCount(reference.citationCount)}
            </span>
          ) : (
            <span className="shrink-0 text-[9px] text-muted-foreground/70">
              unused
            </span>
          )}
        </span>
      </span>
    </button>
  );

  if (!duplicateGroup) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        <ContextMenuItem onSelect={onReviewDuplicate}>
          <WrenchIcon />
          Review duplicate key…
        </ContextMenuItem>
        <ContextMenuItem onSelect={onRenameDuplicate} disabled={repairDisabled}>
          <PencilIcon />
          Rename this copy…
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={onSmartCleanup}
          disabled={!smartCleanupAvailable || repairDisabled}
        >
          <SparklesIcon />
          Smart cleanup this key
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={onKeepDuplicate}
          disabled={repairDisabled}
        >
          <CheckIcon />
          Keep this; remove other copies
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function EmptyProjectReferences() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <FileTextIcon className="size-6 text-muted-foreground/40" />
      <div>
        <p className="font-medium text-xs">No project references</p>
        <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
          Add a reference, create a .bib file, or import a library collection.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() =>
          window.dispatchEvent(new CustomEvent("open-bibliography-import"))
        }
      >
        <PlusIcon className="size-3" />
        Add reference
      </Button>
    </div>
  );
}

function formatUseCount(count: number) {
  return `${count} ${count === 1 ? "time" : "times"}`;
}

/** A collection the user drilled into, shown item by item. */
interface BrowseTarget {
  key: string | null;
  name: string;
  syncedBibFileName?: string;
}

function LibrarySourcesView() {
  const isAuthenticated = useZoteroStore((state) => state.isAuthenticated);
  const connectionMode = useZoteroStore((state) => state.connectionMode);
  const desktopStatus = useZoteroStore((state) => state.desktopStatus);
  const checkDesktop = useZoteroStore((state) => state.checkDesktop);
  const revalidate = useZoteroStore((state) => state.revalidate);
  const [browsing, setBrowsing] = useState<BrowseTarget | null>(null);

  useEffect(() => {
    if (connectionMode) {
      revalidate();
    } else if (desktopStatus === "unknown") {
      checkDesktop();
    }
  }, [checkDesktop, connectionMode, desktopStatus, revalidate]);

  useEffect(() => {
    if (!isAuthenticated) setBrowsing(null);
  }, [isAuthenticated]);

  if (isAuthenticated && browsing) {
    return (
      <ZoteroCollectionBrowser
        collectionKey={browsing.key}
        name={browsing.name}
        syncedBibFileName={browsing.syncedBibFileName}
        onBack={() => setBrowsing(null)}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {isAuthenticated ? (
        <ConnectedZoteroView onBrowse={setBrowsing} />
      ) : (
        <ConnectLibraryView />
      )}
      <ExternalBibliographySources />
    </div>
  );
}

function ConnectLibraryView() {
  const desktopStatus = useZoteroStore((state) => state.desktopStatus);
  const isValidating = useZoteroStore((state) => state.isValidating);
  const error = useZoteroStore((state) => state.error);
  const checkDesktop = useZoteroStore((state) => state.checkDesktop);
  const connectWithDesktop = useZoteroStore(
    (state) => state.connectWithDesktop,
  );
  const connectWithOAuth = useZoteroStore((state) => state.connectWithOAuth);
  const cancelConnect = useZoteroStore((state) => state.cancelConnect);
  const [apiDialogOpen, setApiDialogOpen] = useState(false);

  const desktopAvailable = desktopStatus === "available";
  const desktopChecking =
    desktopStatus === "checking" || (isValidating && !apiDialogOpen);

  return (
    <div className="space-y-3 p-2">
      <section className="rounded-md border border-sidebar-border bg-sidebar-accent/20 p-2.5">
        <div className="flex items-start gap-2">
          <ServerIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="font-medium text-xs">Zotero Desktop</h3>
              <DesktopStatus status={desktopStatus} />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground leading-relaxed">
              Connect to the Zotero library on this computer. Works offline and
              does not require an API key.
            </p>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {desktopAvailable ? (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={connectWithDesktop}
              disabled={isValidating}
            >
              {isValidating ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : (
                <CheckIcon className="size-3" />
              )}
              Connect
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={checkDesktop}
              disabled={desktopChecking}
            >
              <RefreshCwIcon
                className={cn("size-3", desktopChecking && "animate-spin")}
              />
              {desktopStatus === "unknown" ? "Detect Zotero" : "Check again"}
            </Button>
          )}
          {isValidating && (
            <button
              type="button"
              className="text-[10px] text-muted-foreground underline"
              onClick={cancelConnect}
            >
              Cancel
            </button>
          )}
        </div>
        {desktopStatus === "disabled" && (
          <p className="mt-2 text-[10px] text-destructive leading-relaxed">
            Enable “Allow other applications on this computer to communicate
            with Zotero” in Zotero Settings → Advanced.
          </p>
        )}
      </section>

      <section>
        <h3 className="px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
          Other connection options
        </h3>
        <button
          type="button"
          className="mt-1 flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={connectWithOAuth}
          disabled={isValidating}
        >
          <CloudIcon className="mt-0.5 size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-xs">Zotero Cloud</span>
            <span className="block text-[10px] text-muted-foreground">
              Connect your online library through Zotero.
            </span>
          </span>
          <ExternalLinkIcon className="mt-0.5 size-3 text-muted-foreground" />
        </button>
        <button
          type="button"
          className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setApiDialogOpen(true)}
        >
          <SettingsIcon className="mt-0.5 size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-xs">Zotero API key</span>
            <span className="block text-[10px] text-muted-foreground">
              Connect manually with an existing key.
            </span>
          </span>
        </button>
      </section>

      {error && (
        <div className="rounded bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
          {error}
        </div>
      )}

      <ZoteroApiKeyDialog
        open={apiDialogOpen}
        onOpenChange={setApiDialogOpen}
      />
    </div>
  );
}

function DesktopStatus({
  status,
}: {
  status: ReturnType<typeof useZoteroStore.getState>["desktopStatus"];
}) {
  const label = {
    unknown: "Not checked",
    checking: "Checking…",
    available: "Found",
    unavailable: "Not found",
    disabled: "Access disabled",
  }[status];

  return (
    <span
      className={cn(
        "rounded px-1 py-0.5 text-[9px]",
        status === "available"
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : status === "disabled"
            ? "bg-destructive/10 text-destructive"
            : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function ConnectedZoteroView({
  onBrowse,
}: {
  onBrowse: (target: BrowseTarget) => void;
}) {
  const connectionMode = useZoteroStore((state) => state.connectionMode);
  const username = useZoteroStore((state) => state.username);
  const isLoadingCollections = useZoteroStore(
    (state) => state.isLoadingCollections,
  );
  const isSyncing = useZoteroStore((state) => state.isSyncing);
  const syncProgress = useZoteroStore((state) => state.syncProgress);
  const collections = useZoteroStore((state) => state.collections);
  const error = useZoteroStore((state) => state.error);
  const loadCollections = useZoteroStore((state) => state.loadCollections);
  const disconnect = useZoteroStore((state) => state.disconnect);
  const connectWithDesktop = useZoteroStore(
    (state) => state.connectWithDesktop,
  );
  const connectWithOAuth = useZoteroStore((state) => state.connectWithOAuth);
  const importCollectionToBib = useZoteroStore(
    (state) => state.importCollectionToBib,
  );
  const syncCollectionBib = useZoteroStore((state) => state.syncCollectionBib);
  const removeCollection = useZoteroStore((state) => state.removeCollection);
  const projectRoot = useDocumentStore((state) => state.projectRoot);
  const allSyncedCollections = useZoteroStore(
    (state) => state.syncedCollections,
  );
  const syncedCollections = projectRoot
    ? (allSyncedCollections[projectRoot] ?? {})
    : {};
  const desktopItemsAvailable = useZoteroStore(
    (state) => state.desktopItemsAvailable,
  );
  const [collectionQuery, setCollectionQuery] = useState("");
  const flattenedCollections = useMemo(
    () => flattenCollections(collections),
    [collections],
  );
  const visibleCollections = useMemo(
    () => filterCollectionTree(flattenedCollections, collectionQuery),
    [collectionQuery, flattenedCollections],
  );
  const showMyLibrary =
    !collectionQuery.trim() ||
    "my library".includes(collectionQuery.trim().toLowerCase());
  const desktopItemsBroken =
    connectionMode === "desktop" && desktopItemsAvailable === false;

  const browseCollection = (key: string | null, name: string) =>
    onBrowse({
      key,
      name,
      syncedBibFileName: syncedCollections[storeKeyFor(key)]?.bibFileName,
    });

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-sidebar-border border-b px-2 py-2">
        {connectionMode === "desktop" ? (
          <ServerIcon className="size-4 text-muted-foreground" />
        ) : (
          <CloudIcon className="size-4 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-xs">
            {connectionMode === "desktop" ? "Zotero Desktop" : "Zotero Cloud"}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {connectionMode === "desktop"
              ? "Local library"
              : username || "Online library"}
          </p>
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={loadCollections}
          title="Refresh collections"
          aria-label="Refresh collections"
        >
          <RefreshCwIcon
            className={cn("size-3.5", isLoadingCollections && "animate-spin")}
          />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Library connection settings"
            >
              <SettingsIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {connectionMode === "cloud" ? (
              <DropdownMenuItem onClick={connectWithDesktop}>
                <ServerIcon className="mr-2 size-3.5" />
                Use Zotero Desktop
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={connectWithOAuth}>
                <CloudIcon className="mr-2 size-3.5" />
                Use Zotero Cloud
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={disconnect}>
              <LogOutIcon className="mr-2 size-3.5" />
              Disconnect source
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {desktopItemsBroken && (
        <div className="mx-2 mt-2 space-y-1.5 rounded bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 leading-relaxed dark:text-amber-400">
          <p className="flex items-start gap-1">
            <AlertCircleIcon className="mt-px size-3 shrink-0" />
            <span>
              Zotero Desktop is listing collections but returns HTTP 500 for
              item data, so importing a bibliography will fail. Restart or
              update Zotero, or connect Zotero Cloud instead.
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={connectWithOAuth}
          >
            <CloudIcon className="size-3" />
            Use Zotero Cloud
          </Button>
        </div>
      )}
      {error && (
        <div className="mx-2 mt-2 rounded bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
          {error}
        </div>
      )}
      {isSyncing && (
        <div className="mx-2 mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <LoaderIcon className="size-3 animate-spin" />
          {syncProgress
            ? `Syncing ${syncProgress.loaded}/${syncProgress.total}`
            : "Syncing bibliography…"}
        </div>
      )}

      <div className="px-2 pt-2">
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={collectionQuery}
            onChange={(event) => setCollectionQuery(event.target.value)}
            className="h-7 pl-7 text-xs"
            placeholder="Filter collections"
            aria-label="Filter Zotero collections"
          />
          {collectionQuery && (
            <button
              type="button"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setCollectionQuery("")}
              aria-label="Clear collection filter"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="py-1">
        {showMyLibrary && (
          <CollectionRow
            name="My Library"
            icon={<LibraryIcon className="size-3.5" />}
            syncInfo={syncedCollections[MYLIB_KEY]}
            isSyncing={isSyncing === MYLIB_KEY}
            onOpen={() => browseCollection(null, "My Library")}
            onImport={() => importCollectionToBib(null, "My Library")}
            onSync={() => syncCollectionBib(null)}
            onRemove={() => removeCollection(null)}
            disabled={!!isSyncing}
          />
        )}
        {isLoadingCollections ? (
          <div className="flex items-center gap-1 px-2 py-2 text-muted-foreground text-xs">
            <LoaderIcon className="size-3 animate-spin" />
            Loading collections…
          </div>
        ) : (
          visibleCollections.map(({ collection, depth }) => (
            <CollectionRow
              key={collection.key}
              name={collection.name}
              icon={<FolderIcon className="size-3.5" />}
              itemCount={collection.itemCount}
              depth={depth}
              syncInfo={syncedCollections[collection.key]}
              isSyncing={isSyncing === collection.key}
              onOpen={() => browseCollection(collection.key, collection.name)}
              onImport={() =>
                importCollectionToBib(collection.key, collection.name)
              }
              onSync={() => syncCollectionBib(collection.key)}
              onRemove={() => removeCollection(collection.key)}
              disabled={!!isSyncing}
            />
          ))
        )}
        {!isLoadingCollections &&
          !showMyLibrary &&
          visibleCollections.length === 0 && (
            <p className="px-2 py-2 text-[10px] text-muted-foreground">
              No collection matches “{collectionQuery.trim()}”
            </p>
          )}
      </div>
    </div>
  );
}

export function flattenCollections(
  collections: ZoteroCollection[],
): Array<{ collection: ZoteroCollection; depth: number }> {
  const children = new Map<string | false, ZoteroCollection[]>();
  for (const collection of collections) {
    const siblings = children.get(collection.parentKey) ?? [];
    siblings.push(collection);
    children.set(collection.parentKey, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }

  const flattened: Array<{ collection: ZoteroCollection; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (collection: ZoteroCollection, depth: number) => {
    if (visited.has(collection.key)) return;
    visited.add(collection.key);
    flattened.push({ collection, depth });
    for (const child of children.get(collection.key) ?? []) {
      visit(child, depth + 1);
    }
  };
  for (const collection of children.get(false) ?? []) visit(collection, 0);
  for (const collection of collections) {
    if (!visited.has(collection.key)) visit(collection, 0);
  }
  return flattened;
}

/**
 * Narrow the flattened tree to collections matching `query`, keeping the
 * ancestors of every match so nesting still reads correctly.
 */
export function filterCollectionTree(
  flattened: Array<{ collection: ZoteroCollection; depth: number }>,
  query: string,
): Array<{ collection: ZoteroCollection; depth: number }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return flattened;

  const keep = new Set<string>();
  const ancestors: ZoteroCollection[] = [];
  for (const { collection, depth } of flattened) {
    ancestors.length = depth;
    ancestors[depth] = collection;
    if (collection.name.toLowerCase().includes(needle)) {
      for (const ancestor of ancestors) {
        if (ancestor) keep.add(ancestor.key);
      }
    }
  }
  return flattened.filter(({ collection }) => keep.has(collection.key));
}

function CollectionRow({
  name,
  icon,
  itemCount,
  depth = 0,
  syncInfo,
  isSyncing,
  onOpen,
  onImport,
  onSync,
  onRemove,
  disabled,
}: {
  name: string;
  icon: React.ReactNode;
  itemCount?: number;
  depth?: number;
  syncInfo?: CollectionSyncInfo;
  isSyncing: boolean;
  onOpen: () => void;
  onImport: () => void;
  onSync: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const isSynced = !!syncInfo;

  return (
    <div
      className="group flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <button
        type="button"
        className="min-w-0 flex-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
        title={`Browse ${name} in Zotero`}
      >
        <div className="flex items-center gap-1">
          <span className="truncate text-foreground text-xs group-hover:underline">
            {name}
          </span>
          {isSynced && (
            <CheckIcon className="size-2.5 shrink-0 text-muted-foreground" />
          )}
        </div>
        <p className="truncate text-[10px] text-muted-foreground leading-none">
          {isSynced
            ? syncInfo.bibFileName
            : itemCount === undefined
              ? "Whole library"
              : `${itemCount} ${itemCount === 1 ? "item" : "items"}`}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {isSynced ? (
          <>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-30"
              onClick={onSync}
              disabled={disabled}
              title="Sync bibliography"
              aria-label={`Sync ${name}`}
            >
              {isSyncing ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3" />
              )}
            </button>
            <button
              type="button"
              className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-30"
              onClick={onRemove}
              disabled={disabled}
              title="Stop syncing"
              aria-label={`Stop syncing ${name}`}
            >
              <XIcon className="size-3" />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground disabled:opacity-30"
            onClick={onImport}
            disabled={disabled}
            title="Import as bibliography"
            aria-label={`Import ${name} as bibliography`}
          >
            <DownloadIcon className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function ZoteroApiKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const connect = useZoteroStore((state) => state.connectWithApiKey);
  const isValidating = useZoteroStore((state) => state.isValidating);
  const error = useZoteroStore((state) => state.error);

  const handleConnect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    const success = await connect(key);
    if (success) {
      onOpenChange(false);
      setApiKey("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect with a Zotero API key</DialogTitle>
          <DialogDescription>
            API keys connect to Zotero Cloud. Zotero Desktop does not require
            one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Input
            type="password"
            placeholder="Zotero API key"
            aria-label="Zotero API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleConnect();
            }}
            autoFocus
          />
          {error && <p className="text-destructive text-xs">{error}</p>}
          <p className="text-muted-foreground text-xs">
            Create a key at{" "}
            <a
              href="https://www.zotero.org/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              zotero.org/settings/keys
            </a>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleConnect}
            disabled={!apiKey.trim() || isValidating}
          >
            {isValidating ? "Validating…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
