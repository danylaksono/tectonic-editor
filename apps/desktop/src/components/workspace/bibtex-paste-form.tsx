import { useEffect, useMemo, useState } from "react";
import { ArrowLeftIcon, CheckIcon, ClipboardPasteIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import type { ProjectFile } from "@/stores/document-store";

interface BibtexPasteFormProps {
  files: ProjectFile[];
  onBack: () => void;
  onImported: (keys: string[]) => void;
}

export function BibtexPasteForm({
  files,
  onBack,
  onImported,
}: BibtexPasteFormProps) {
  const bibFiles = files.filter((file) => file.type === "bib");
  const [source, setSource] = useState("");
  const [targetFile, setTargetFile] = useState(() =>
    defaultBibliographyTarget(files),
  );
  const [newFileName, setNewFileName] = useState("references.bib");
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (
      targetFile !== "__new__" &&
      !bibFiles.some((file) => file.id === targetFile)
    ) {
      setTargetFile(defaultBibliographyTarget(files));
    }
  }, [bibFiles, files, targetFile]);

  const prepared = useMemo(
    () => prepareBibtexEntries(source, collectExistingCitationKeys(files)),
    [files, source],
  );

  const importEntries = async () => {
    if (prepared.length === 0) return;
    setImporting(true);
    try {
      const sources = prepared.map((entry) => entry.source);
      const importedTarget =
        targetFile === "__new__"
          ? await createBibliographyFromSource(newFileName, sources)
          : (await appendBibtexSource(targetFile, sources))
            ? targetFile
            : null;
      if (!importedTarget) throw new Error("The bibliography was not updated");
      toast.success(
        `Imported ${prepared.length} ${prepared.length === 1 ? "reference" : "references"} into ${importedTarget}`,
      );
      onImported(prepared.map((entry) => entry.key));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3 px-4 pb-4">
      <div className="flex items-center gap-2">
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
        <span className="text-muted-foreground text-xs">
          Paste one or more complete BibTeX entries
        </span>
      </div>
      <div className="space-y-1">
        <Label htmlFor="pasted-bibtex">BibTeX</Label>
        <Textarea
          id="pasted-bibtex"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          className="min-h-52 font-mono text-xs"
          placeholder={
            "@article{key,\n  title = {A useful paper},\n  author = {Author, Ada},\n  year = {2026}\n}"
          }
          autoFocus
        />
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="bibtex-target">Bibliography</Label>
          <Select value={targetFile} onValueChange={setTargetFile}>
            <SelectTrigger id="bibtex-target" className="h-9">
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
            <Label htmlFor="new-bibliography-name">File name</Label>
            <Input
              id="new-bibliography-name"
              value={newFileName}
              onChange={(event) => setNewFileName(event.target.value)}
              className="h-9 w-44 font-mono text-xs"
            />
          </div>
        )}
      </div>
      <div className="max-h-32 overflow-y-auto rounded-md border">
        {prepared.length === 0 ? (
          <div className="px-3 py-4 text-center text-muted-foreground text-xs">
            No complete BibTeX entries detected
          </div>
        ) : (
          prepared.map((entry) => (
            <div
              key={`${entry.originalKey}:${entry.key}`}
              className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
            >
              <CheckIcon className="size-3.5 text-emerald-500" />
              <span className="min-w-0 flex-1 truncate text-xs">
                {entry.title || entry.originalKey}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {entry.originalKey === entry.key
                  ? entry.key
                  : `${entry.originalKey} → ${entry.key}`}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="max-w-sm text-[11px] text-muted-foreground">
          Custom fields and formatting are preserved. Conflicting keys receive a
          visible numeric suffix.
        </p>
        <Button
          type="button"
          onClick={() => void importEntries()}
          disabled={
            prepared.length === 0 ||
            importing ||
            (targetFile === "__new__" && !newFileName.trim())
          }
        >
          <ClipboardPasteIcon className="size-4" />
          {importing ? "Importing…" : "Import and select"}
        </Button>
      </div>
    </div>
  );
}
