import { useEffect, useMemo, useState } from "react";
import {
  BookMarkedIcon,
  CheckIcon,
  ClipboardPasteIcon,
  FileTextIcon,
  LibraryIcon,
  SearchIcon,
} from "lucide-react";
import type { ProjectFile } from "@/stores/document-store";
import { parseBibEntries, parseBibItems, type BibCitation } from "@/lib/bibtex";
import {
  detectCitationPackage,
  getCitationStyleOptions,
  getDefaultCitationCommand,
  type CitationCommand,
  type CitationDraft,
} from "@/lib/latex-citations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BibtexPasteForm } from "@/components/workspace/bibtex-paste-form";
import { ZoteroSearchForm } from "@/components/workspace/zotero-search-form";
import { useZoteroStore } from "@/stores/zotero-store";
import { useResizableDialog } from "@/hooks/use-resizable-dialog";

interface CitationPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: ProjectFile[];
  onInsert: (citation: CitationDraft) => void;
}

function getCitationEntries(files: ProjectFile[]) {
  return files.flatMap((file) => {
    if (!file.content) return [];
    if (file.name.toLowerCase().endsWith(".bib")) {
      return parseBibEntries(file.content, file.relativePath);
    }
    if (file.name.toLowerCase().endsWith(".tex")) {
      return parseBibItems(file.content, file.relativePath);
    }
    return [];
  });
}

function entrySource(entry: BibCitation) {
  return entry.journal ?? entry.booktitle ?? entry.publisher ?? entry.filePath;
}

function matchesEntry(entry: BibCitation, query: string) {
  if (!query.trim()) return true;
  const haystack = [
    entry.key,
    entry.title,
    entry.author,
    entry.year,
    entry.journal,
    entry.booktitle,
    entry.publisher,
    entry.filePath,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((part) => haystack.includes(part));
}

export function CitationPicker({
  open,
  onOpenChange,
  files,
  onInsert,
}: CitationPickerProps) {
  const [query, setQuery] = useState("");
  const { style: widthStyle, handle: resizeHandle } = useResizableDialog({
    storageKey: "tectonic-editor-citation-picker-width",
  });
  const citationPackage = useMemo(
    () =>
      detectCitationPackage(
        files
          .filter((file) => file.name.toLowerCase().endsWith(".tex"))
          .map((file) => file.content ?? ""),
      ),
    [files],
  );
  const styleOptions = useMemo(
    () => getCitationStyleOptions(citationPackage),
    [citationPackage],
  );
  const [command, setCommand] = useState<CitationCommand>(
    getDefaultCitationCommand(citationPackage),
  );
  const [prefix, setPrefix] = useState("");
  const [locator, setLocator] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [mode, setMode] = useState<"references" | "paste" | "zotero">(
    "references",
  );
  const zoteroConnected = useZoteroStore((state) => state.isAuthenticated);

  useEffect(() => {
    if (open) setCommand(getDefaultCitationCommand(citationPackage));
  }, [open, citationPackage]);

  const entries = useMemo(() => getCitationEntries(files), [files]);
  const filtered = useMemo(
    () => entries.filter((entry) => matchesEntry(entry, query)).slice(0, 80),
    [entries, query],
  );

  const toggleKey = (key: string) => {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const insertSelection = (keys = selectedKeys) => {
    if (keys.length === 0) return;
    onInsert({ command, keys, prefix, locator });
    setQuery("");
    setPrefix("");
    setLocator("");
    setSelectedKeys([]);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
          setQuery("");
          setPrefix("");
          setLocator("");
          setSelectedKeys([]);
          setMode("references");
        }
      }}
    >
      <DialogContent className="gap-3 p-0 sm:max-w-2xl" style={widthStyle}>
        {resizeHandle}
        <DialogHeader className="flex-row items-center justify-between border-border border-b px-4 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <BookMarkedIcon className="size-4 text-muted-foreground" />
            {mode === "paste"
              ? "Add reference from BibTeX"
              : mode === "zotero"
                ? "Search Zotero library"
                : "Insert Citation"}
          </DialogTitle>
          {mode === "references" && (
            <div className="flex items-center gap-2">
              {zoteroConnected && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => setMode("zotero")}
                >
                  <LibraryIcon className="size-3.5" />
                  Search Zotero
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => setMode("paste")}
              >
                <ClipboardPasteIcon className="size-3.5" />
                Paste BibTeX
              </Button>
            </div>
          )}
        </DialogHeader>

        {mode === "paste" ? (
          <BibtexPasteForm
            files={files}
            onBack={() => setMode("references")}
            onImported={(keys) => {
              setSelectedKeys(keys);
              setMode("references");
            }}
          />
        ) : mode === "zotero" ? (
          <ZoteroSearchForm
            files={files}
            onBack={() => setMode("references")}
            onImported={(keys) => {
              setSelectedKeys(keys);
              setMode("references");
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 px-4">
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (selectedKeys.length > 0) insertSelection();
                      else if (filtered[0]) insertSelection([filtered[0].key]);
                    }
                  }}
                  className="h-8 pl-8 text-sm"
                  placeholder="Search title, author, year, or key"
                  autoFocus
                />
              </div>
              <Select
                value={command}
                onValueChange={(value) => setCommand(value as CitationCommand)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Citation style"
                  className="h-8! w-48 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {styleOptions.map((style) => (
                    <SelectItem key={style.command} value={style.command}>
                      {style.label} — {style.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2 px-4">
              <div className="space-y-1 text-muted-foreground text-xs">
                <label htmlFor="citation-prefix">Prefix (optional)</label>
                <Input
                  id="citation-prefix"
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                  className="h-8 text-sm"
                  placeholder="e.g. see, compare"
                />
              </div>
              <div className="space-y-1 text-muted-foreground text-xs">
                <label htmlFor="citation-locator">
                  Pages or chapter (optional)
                </label>
                <Input
                  id="citation-locator"
                  value={locator}
                  onChange={(event) => setLocator(event.target.value)}
                  className="h-8 text-sm"
                  placeholder="e.g. pp. 23--25, ch. 2"
                />
              </div>
            </div>

            <div className="min-h-80 overflow-hidden px-2">
              {entries.length === 0 ? (
                <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
                  <FileTextIcon className="size-8 text-muted-foreground/60" />
                  <div className="font-medium text-sm">
                    No bibliography found
                  </div>
                  <p className="max-w-xs text-muted-foreground text-xs leading-relaxed">
                    Add a .bib file or import a library collection to search and
                    insert citations from the editor.
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-muted-foreground text-sm">
                  No matching citations
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto py-1">
                  {filtered.map((entry) => {
                    const selected = selectedKeys.includes(entry.key);
                    return (
                      <button
                        key={`${entry.filePath}:${entry.key}`}
                        type="button"
                        className={cn(
                          "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60",
                          selected && "bg-muted",
                        )}
                        onClick={() => toggleKey(entry.key)}
                        onDoubleClick={() => insertSelection([entry.key])}
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
                          <span className="block truncate font-medium text-sm">
                            {entry.title ?? entry.key}
                          </span>
                          <span className="mt-0.5 block truncate text-muted-foreground text-xs">
                            {[entry.author, entry.year, entrySource(entry)]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                        <span className="max-w-32 shrink-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {entry.key}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-border border-t px-4 py-3">
              <span className="text-muted-foreground text-xs">
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
                {selectedKeys.length > 0 &&
                  ` · ${selectedKeys.length} selected`}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={selectedKeys.length === 0}
                  onClick={() => insertSelection()}
                >
                  Insert
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
