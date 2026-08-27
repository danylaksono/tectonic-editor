import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  LoaderIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  appendBibtexSource,
  collectExistingCitationKeys,
  createBibliographyFromSource,
  defaultBibliographyTarget,
  prepareBibtexEntries,
} from "@/lib/bibliography-import";
import type { ZoteroSearchResult } from "@/lib/zotero-api";
import { useZoteroStore } from "@/stores/zotero-store";
import { useDocumentStore } from "@/stores/document-store";
import { cn } from "@/lib/utils";

interface ZoteroCollectionBrowserProps {
  collectionKey: string | null;
  name: string;
  /** The .bib this collection already syncs to, preferred as the import target. */
  syncedBibFileName?: string;
  onBack: () => void;
}

const PAGE_SIZE = 50;

function matchesItem(item: ZoteroSearchResult, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    item.title,
    item.creators,
    item.year,
    item.publication,
    item.citekey,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return needle.split(/\s+/).every((part) => haystack.includes(part));
}

export function ZoteroCollectionBrowser({
  collectionKey,
  name,
  syncedBibFileName,
  onBack,
}: ZoteroCollectionBrowserProps) {
  const browse = useZoteroStore((state) => state.browseCollection);
  const files = useDocumentStore((state) => state.files);
  const bibFiles = files.filter((file) => file.type === "bib");

  const [items, setItems] = useState<ZoteroSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [targetFile, setTargetFile] = useState(() => {
    const synced = syncedBibFileName
      ? files.find((file) => file.name === syncedBibFileName)
      : undefined;
    return synced?.id ?? defaultBibliographyTarget(files);
  });
  const [newFileName, setNewFileName] = useState("references.bib");

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await browse(collectionKey, 0, PAGE_SIZE);
      setItems(page.items);
      setTotal(page.total);
    } catch (cause) {
      setItems([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [browse, collectionKey]);

  useEffect(() => {
    setItems([]);
    setSelectedKeys([]);
    setQuery("");
    void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    if (
      targetFile !== "__new__" &&
      !bibFiles.some((file) => file.id === targetFile)
    ) {
      setTargetFile(defaultBibliographyTarget(files));
    }
  }, [bibFiles, files, targetFile]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await browse(collectionKey, items.length, PAGE_SIZE);
      setItems((current) => [...current, ...page.items]);
      setTotal(page.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingMore(false);
    }
  };

  const existingKeys = useMemo(
    () => collectExistingCitationKeys(files),
    [files],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => matchesItem(item, query)),
    [items, query],
  );
  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.includes(item.key)),
    [items, selectedKeys],
  );
  const prepared = useMemo(() => {
    const incoming = selectedItems
      .filter((item) => !existingKeys.has(item.citekey))
      .map((item) => item.bibtex)
      .join("\n\n");
    return prepareBibtexEntries(incoming, existingKeys, { tidy: true });
  }, [existingKeys, selectedItems]);

  const selectableVisible = visibleItems.filter(
    (item) => !existingKeys.has(item.citekey),
  );
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((item) => selectedKeys.includes(item.key));

  const toggleItem = (key: string) => {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const toggleAllVisible = () => {
    setSelectedKeys((current) => {
      if (allVisibleSelected) {
        const visible = new Set(selectableVisible.map((item) => item.key));
        return current.filter((key) => !visible.has(key));
      }
      const next = new Set(current);
      for (const item of selectableVisible) next.add(item.key);
      return Array.from(next);
    });
  };

  const importSelection = async () => {
    if (prepared.length === 0) return;
    setImporting(true);
    try {
      const sources = prepared.map((entry) => entry.source);
      const importedTarget =
        targetFile === "__new__"
          ? await createBibliographyFromSource(newFileName, sources)
          : (await appendBibtexSource(
                targetFile,
                sources,
                "Import from Zotero",
              ))
            ? targetFile
            : null;
      if (!importedTarget) throw new Error("The bibliography was not updated");
      toast.success(
        `Added ${prepared.length} ${
          prepared.length === 1 ? "reference" : "references"
        } from ${name}`,
      );
      setSelectedKeys([]);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-sidebar-border border-b px-2 py-2">
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onBack}
          aria-label="Back to collections"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-xs">{name}</p>
          <p className="truncate text-[10px] text-muted-foreground">
            {loading
              ? "Loading items…"
              : `${items.length}${
                  total > items.length ? ` of ${total}` : ""
                } ${total === 1 ? "item" : "items"} · newest first`}
          </p>
        </div>
      </div>

      <div className="px-2 pt-2">
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-7 pl-7 text-xs"
            placeholder="Filter loaded items"
            aria-label={`Filter items in ${name}`}
          />
          {query && (
            <button
              type="button"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setQuery("")}
              aria-label="Clear item filter"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mx-2 mt-2 rounded bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive leading-relaxed">
          {error}
        </p>
      )}

      {selectableVisible.length > 0 && (
        <div className="flex items-center justify-between px-2 pt-2">
          <button
            type="button"
            className="text-[10px] text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={toggleAllVisible}
          >
            {allVisibleSelected ? "Clear selection" : "Select all shown"}
          </button>
          {selectedKeys.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {selectedKeys.length} selected
            </span>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {loading ? (
          <div className="flex items-center gap-1 px-2 py-3 text-muted-foreground text-xs">
            <LoaderIcon className="size-3 animate-spin" />
            Loading items…
          </div>
        ) : visibleItems.length === 0 ? (
          <p className="px-2 py-3 text-[10px] text-muted-foreground">
            {items.length === 0
              ? "This collection has no citable items."
              : `Nothing loaded matches “${query.trim()}”`}
          </p>
        ) : (
          <>
            {visibleItems.map((item) => {
              const selected = selectedKeys.includes(item.key);
              const inProject = existingKeys.has(item.citekey);
              return (
                <button
                  key={item.key}
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-1.5 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60",
                    selected && "bg-sidebar-accent",
                    inProject && "opacity-70",
                  )}
                  onClick={() => !inProject && toggleItem(item.key)}
                  disabled={inProject}
                  title={
                    inProject ? "Already in your bibliography" : item.title
                  }
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border border-border",
                      selected &&
                        "border-primary bg-primary text-primary-foreground",
                      inProject && "border-transparent bg-transparent",
                    )}
                  >
                    {(selected || inProject) && (
                      <CheckIcon
                        className={cn(
                          "size-2.5",
                          inProject && !selected && "text-muted-foreground",
                        )}
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] text-foreground leading-tight">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground leading-tight">
                      {[item.creators, item.year, item.citekey]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              );
            })}
            {total > items.length && !query.trim() && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-6 w-full text-[10px]"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : null}
                Load {Math.min(PAGE_SIZE, total - items.length)} more
              </Button>
            )}
          </>
        )}
      </div>

      <div className="space-y-1.5 border-sidebar-border border-t px-2 py-2">
        <Select value={targetFile} onValueChange={setTargetFile}>
          <SelectTrigger
            size="sm"
            className="h-7! w-full text-[11px]"
            aria-label="Bibliography to import into"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bibFiles.map((file) => (
              <SelectItem key={file.id} value={file.id}>
                {file.relativePath}
              </SelectItem>
            ))}
            <SelectItem value="__new__">Create a new bibliography</SelectItem>
          </SelectContent>
        </Select>
        {targetFile === "__new__" && (
          <Input
            value={newFileName}
            onChange={(event) => setNewFileName(event.target.value)}
            className="h-7 font-mono text-[11px]"
            aria-label="New bibliography file name"
          />
        )}
        <Button
          size="sm"
          className="h-7 w-full text-xs"
          onClick={() => void importSelection()}
          disabled={
            prepared.length === 0 ||
            importing ||
            (targetFile === "__new__" && !newFileName.trim())
          }
        >
          {importing ? (
            <LoaderIcon className="size-3 animate-spin" />
          ) : (
            <PlusIcon className="size-3" />
          )}
          {prepared.length === 0
            ? "Add selected"
            : `Add ${prepared.length} to bibliography`}
        </Button>
        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Entries are reformatted to match your bibliography. References already
          in the project are ticked and cannot be added twice.
        </p>
      </div>
    </div>
  );
}
