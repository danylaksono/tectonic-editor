import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  CheckIcon,
  CloudIcon,
  LibraryIcon,
  LoaderIcon,
  SearchIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  appendBibtexSource,
  collectProjectCitations,
  createBibliographyFromSource,
  defaultBibliographyTarget,
  findExistingCitationKey,
  prepareBibtexEntries,
  previewHouseCitationKey,
} from "@/lib/bibliography-import";
import type { ZoteroSearchResult } from "@/lib/zotero-api";
import { useZoteroStore } from "@/stores/zotero-store";
import type { ProjectFile } from "@/stores/document-store";
import { cn } from "@/lib/utils";

interface ZoteroSearchFormProps {
  files: ProjectFile[];
  onBack: () => void;
  onImported: (keys: string[]) => void;
}

const SEARCH_DEBOUNCE_MS = 350;

function humanizeItemType(itemType: string): string {
  if (!itemType) return "";
  const spaced = itemType.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function resultSubtitle(result: ZoteroSearchResult): string {
  return [result.creators, result.year, result.publication]
    .filter(Boolean)
    .join(" · ");
}

export function ZoteroSearchForm({
  files,
  onBack,
  onImported,
}: ZoteroSearchFormProps) {
  const isAuthenticated = useZoteroStore((state) => state.isAuthenticated);
  const connectionMode = useZoteroStore((state) => state.connectionMode);
  const username = useZoteroStore((state) => state.username);
  const desktopItemsAvailable = useZoteroStore(
    (state) => state.desktopItemsAvailable,
  );
  const searchLibrary = useZoteroStore((state) => state.searchLibrary);
  const connectWithOAuth = useZoteroStore((state) => state.connectWithOAuth);

  const bibFiles = files.filter((file) => file.type === "bib");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ZoteroSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [targetFile, setTargetFile] = useState(() =>
    defaultBibliographyTarget(files),
  );
  const [newFileName, setNewFileName] = useState("references.bib");
  const [importing, setImporting] = useState(false);
  /** Guards against an earlier search resolving after a later one. */
  const requestId = useRef(0);

  useEffect(() => {
    if (
      targetFile !== "__new__" &&
      !bibFiles.some((file) => file.id === targetFile)
    ) {
      setTargetFile(defaultBibliographyTarget(files));
    }
  }, [bibFiles, files, targetFile]);

  const runSearch = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      const id = requestId.current + 1;
      requestId.current = id;
      if (!trimmed) {
        setResults([]);
        setSearching(false);
        setSearchError(null);
        return;
      }
      setSearching(true);
      setSearchError(null);
      try {
        const found = await searchLibrary(trimmed);
        if (requestId.current !== id) return;
        setResults(found);
      } catch (error) {
        if (requestId.current !== id) return;
        setResults([]);
        setSearchError(error instanceof Error ? error.message : String(error));
      } finally {
        if (requestId.current === id) setSearching(false);
      }
    },
    [searchLibrary],
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [isAuthenticated, query, runSearch]);

  const citations = useMemo(() => collectProjectCitations(files), [files]);
  const found = useMemo(
    () =>
      results.map((result) => {
        const citekey = previewHouseCitationKey(result.bibtex);
        return {
          result,
          citekey,
          existingKey: findExistingCitationKey(citations, {
            key: citekey,
            title: result.title,
          }),
        };
      }),
    [citations, results],
  );
  const selectedResults = useMemo(
    () => found.filter((entry) => selectedItemKeys.includes(entry.result.key)),
    [found, selectedItemKeys],
  );
  const reusedKeys = selectedResults.flatMap((entry) =>
    entry.existingKey ? [entry.existingKey] : [],
  );
  const prepared = useMemo(() => {
    const incoming = selectedResults
      .filter((entry) => !entry.existingKey)
      .map((entry) => entry.result.bibtex)
      .join("\n\n");
    return prepareBibtexEntries(incoming, citations.keys, {
      tidy: true,
      rekey: true,
    });
  }, [citations, selectedResults]);

  const toggleResult = (key: string) => {
    setSelectedItemKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const importSelection = async () => {
    if (selectedResults.length === 0) return;
    setImporting(true);
    try {
      if (prepared.length > 0) {
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
        if (!importedTarget)
          throw new Error("The bibliography was not updated");
        toast.success(
          `Added ${prepared.length} ${
            prepared.length === 1 ? "reference" : "references"
          } from Zotero`,
        );
      } else {
        toast.info("Already in your bibliography");
      }
      onImported([...prepared.map((entry) => entry.key), ...reusedKeys]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  const backButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2"
      onClick={onBack}
    >
      <ArrowLeftIcon className="size-3.5" />
      References
    </Button>
  );

  if (!isAuthenticated) {
    return (
      <div className="space-y-3 px-4 pb-4">
        {backButton}
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 text-center">
          <LibraryIcon className="size-8 text-muted-foreground/60" />
          <div className="font-medium text-sm">No Zotero library connected</div>
          <p className="max-w-xs text-muted-foreground text-xs leading-relaxed">
            Connect a library from the References panel, under Libraries, to
            search Zotero without leaving the editor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 pb-4">
      <div className="flex items-center gap-2">
        {backButton}
        <span className="truncate text-muted-foreground text-xs">
          Searching{" "}
          {connectionMode === "desktop"
            ? "Zotero Desktop"
            : username || "Zotero Cloud"}
        </span>
      </div>

      {connectionMode === "desktop" && desktopItemsAvailable === false && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 leading-relaxed dark:text-amber-400">
          <AlertCircleIcon className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            Zotero Desktop is returning HTTP 500 for item data, so searching it
            will fail. Connect Zotero Cloud to search your library.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 text-[10px]"
            onClick={connectWithOAuth}
          >
            <CloudIcon className="size-3" />
            Use Cloud
          </Button>
        </div>
      )}

      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch(query);
            }
          }}
          className="h-9 pl-8 text-sm"
          placeholder="Search your Zotero library by title, author, or year"
          aria-label="Search Zotero library"
          autoFocus
        />
        {searching && (
          <LoaderIcon className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="max-h-64 min-h-40 overflow-y-auto rounded-md border">
        {searchError ? (
          <div className="px-3 py-6 text-center text-destructive text-xs leading-relaxed">
            {searchError}
          </div>
        ) : !query.trim() ? (
          <div className="px-3 py-6 text-center text-muted-foreground text-xs">
            Type to search every item in your library, including collections you
            have not synced.
          </div>
        ) : results.length === 0 ? (
          <div className="px-3 py-6 text-center text-muted-foreground text-xs">
            {searching
              ? "Searching…"
              : `Nothing in Zotero matches “${query.trim()}”`}
          </div>
        ) : (
          found.map((entry) => {
            const { result, citekey, existingKey } = entry;
            const selected = selectedItemKeys.includes(result.key);
            const inProject = existingKey !== null;
            return (
              <button
                key={result.key}
                type="button"
                className={cn(
                  "flex w-full items-start gap-2 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/60",
                  selected && "bg-muted",
                )}
                onClick={() => toggleResult(result.key)}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border border-border",
                    selected &&
                      "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {selected && <CheckIcon className="size-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-xs">
                    {result.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {resultSubtitle(result) ||
                      humanizeItemType(result.itemType)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="max-w-32 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {existingKey ?? citekey ?? result.key}
                  </span>
                  {inProject && (
                    <span className="text-[9px] text-muted-foreground">
                      In bibliography
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="zotero-target">Bibliography</Label>
          <Select value={targetFile} onValueChange={setTargetFile}>
            <SelectTrigger id="zotero-target" className="h-9">
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
        </div>
        {targetFile === "__new__" && (
          <div className="space-y-1">
            <Label htmlFor="zotero-new-bibliography">File name</Label>
            <Input
              id="zotero-new-bibliography"
              value={newFileName}
              onChange={(event) => setNewFileName(event.target.value)}
              className="h-9 w-44 font-mono text-xs"
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="max-w-sm text-[11px] text-muted-foreground">
          {selectedResults.length === 0
            ? "Select the references you want to cite."
            : `${selectedResults.length} selected · ${prepared.length} to add${
                reusedKeys.length > 0
                  ? `, ${reusedKeys.length} already in your bibliography`
                  : ""
              }`}
        </p>
        <Button
          type="button"
          onClick={() => void importSelection()}
          disabled={
            selectedResults.length === 0 ||
            importing ||
            (targetFile === "__new__" &&
              prepared.length > 0 &&
              !newFileName.trim())
          }
        >
          <LibraryIcon className="size-4" />
          {importing ? "Adding…" : "Add and select"}
        </Button>
      </div>
    </div>
  );
}
