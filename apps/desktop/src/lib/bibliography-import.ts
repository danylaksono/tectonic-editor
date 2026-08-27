import { invoke } from "@tauri-apps/api/core";
import {
  applyProjectEditTransaction,
  type ProjectTextEdit,
} from "@/lib/project-edit-transaction";
import {
  parseBibEntries,
  parseBibtexSourceEntries,
  replaceBibtexEntryKey,
} from "@/lib/bibtex";
import { tidyBibEntrySource } from "@/lib/bibtex-entries";
import { useDocumentStore, type ProjectFile } from "@/stores/document-store";
import { createFileOnDisk, getUniqueTargetName } from "@/lib/tauri/fs";

export interface CitationCandidate {
  provider: string;
  attribution: string;
  identifier: string;
  entryType: string;
  title: string;
  authors: string[];
  year: string;
  journal: string;
  publisher: string;
  doi: string;
  isbn: string;
  arxivId: string;
  url: string;
  rawMetadata: string;
  fromCache: boolean;
}

/** A pending import: the entry's own key, plus the key it will actually get. */
export interface PreparedBibtexEntry {
  originalKey: string;
  key: string;
  source: string;
  title?: string;
}

/**
 * Parse BibTeX and assign each entry a key that does not collide with
 * `existingKeys` or with an earlier entry in the same batch. Conflicts get a
 * visible numeric suffix rather than silently overwriting anything.
 *
 * Pass `tidy` for machine-generated BibTeX (a Zotero export, say), where
 * matching the project's formatting matters more than preserving the
 * exporter's. Hand-written source is left alone by default.
 */
export function prepareBibtexEntries(
  source: string,
  existingKeys: Iterable<string>,
  { tidy = false }: { tidy?: boolean } = {},
): PreparedBibtexEntry[] {
  const used = new Set(existingKeys);
  return parseBibtexSourceEntries(source).map((entry) => {
    const originalKey = entry.key;
    let key = originalKey;
    let suffix = 2;
    while (used.has(key)) {
      key = `${originalKey}${suffix}`;
      suffix += 1;
    }
    used.add(key);
    const rekeyed =
      key === originalKey ? entry.source : replaceBibtexEntryKey(entry, key);
    return {
      originalKey,
      key,
      source: tidy ? tidyBibEntrySource(rekeyed) : rekeyed,
      title: entry.title,
    };
  });
}

/** Every citation key already defined by the project's .bib files. */
export function collectExistingCitationKeys(files: ProjectFile[]): Set<string> {
  return new Set(
    files
      .filter((file) => file.type === "bib")
      .flatMap((file) =>
        parseBibEntries(file.content ?? "", file.relativePath).map(
          (entry) => entry.key,
        ),
      ),
  );
}

/**
 * The .bib file an import should default to: the one the document actually
 * declares, else the first bibliography, else a new file.
 */
export function defaultBibliographyTarget(files: ProjectFile[]): string {
  const bibFiles = files.filter((file) => file.type === "bib");
  const declared = files
    .filter((file) => file.type === "tex")
    .flatMap((file) => {
      const source = file.content ?? "";
      const values = [
        ...source.matchAll(/\\addbibresource(?:\[[^\]]*\])?\{([^}]+)\}/gi),
        ...source.matchAll(/\\bibliography\{([^}]+)\}/gi),
      ];
      return values.flatMap((match) => match[1].split(","));
    })
    .map((value) => {
      const trimmed = value.trim().replace(/\\/g, "/");
      return trimmed.toLowerCase().endsWith(".bib")
        ? trimmed
        : `${trimmed}.bib`;
    });
  return (
    bibFiles.find((file) =>
      declared.some(
        (path) =>
          file.relativePath.toLowerCase() === path.toLowerCase() ||
          file.name.toLowerCase() === path.toLowerCase(),
      ),
    )?.id ??
    bibFiles[0]?.id ??
    "__new__"
  );
}

export function lookupReference(identifier: string, refresh = false) {
  return invoke<CitationCandidate>("lookup_reference", { identifier, refresh });
}

export function searchReferences(query: string, limit = 5) {
  return invoke<CitationCandidate[]>("search_references", { query, limit });
}

export function clearMetadataCache() {
  return invoke<void>("clear_metadata_cache");
}

function normalizedTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findCandidateDuplicates(
  candidate: CitationCandidate,
  bibliographySource: string,
): string[] {
  const reasons: string[] = [];
  if (
    candidate.doi &&
    bibliographySource.toLowerCase().includes(candidate.doi.toLowerCase())
  )
    reasons.push("same DOI");
  if (
    candidate.isbn &&
    bibliographySource
      .replace(/[-\s]/g, "")
      .includes(candidate.isbn.replace(/[-\s]/g, ""))
  )
    reasons.push("same ISBN");
  if (
    candidate.arxivId &&
    bibliographySource.toLowerCase().includes(candidate.arxivId.toLowerCase())
  )
    reasons.push("same arXiv ID");
  const normalizedSource = normalizedTitle(bibliographySource);
  if (
    candidate.title &&
    candidate.year &&
    normalizedSource.includes(normalizedTitle(candidate.title)) &&
    bibliographySource.includes(candidate.year)
  )
    reasons.push("matching title and year");
  return reasons;
}

export function generateCitationKey(
  candidate: CitationCandidate,
  existingKeys: Iterable<string>,
): string {
  const family =
    candidate.authors[0]
      ?.trim()
      .split(/\s+/)
      .pop()
      ?.replace(/[^a-zA-Z0-9]/g, "") || "source";
  const word =
    normalizedTitle(candidate.title)
      .split(" ")
      .find((value) => value.length > 3) || "work";
  const base = `${family}${candidate.year || "nd"}${word}`.toLowerCase();
  const existing = new Set(existingKeys);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

function bibValue(value: string) {
  return value.replace(/[{}]/g, "").trim();
}

export function serializeCandidate(
  candidate: CitationCandidate,
  key: string,
): string {
  const fields = [
    ["author", candidate.authors.join(" and ")],
    ["title", candidate.title],
    ["year", candidate.year],
    ["journal", candidate.journal],
    ["publisher", candidate.publisher],
    ["doi", candidate.doi],
    ["isbn", candidate.isbn],
    ["eprint", candidate.arxivId],
    ["url", candidate.url],
  ].filter(([, value]) => value);
  return `@${candidate.entryType || "article"}{${key},\n${fields.map(([name, value]) => `  ${name} = {${bibValue(value)}},`).join("\n")}\n}`;
}

export async function appendCandidate(
  fileId: string,
  candidate: CitationCandidate,
  key: string,
): Promise<boolean> {
  const file = useDocumentStore
    .getState()
    .files.find((item) => item.id === fileId);
  if (!file?.content && file?.content !== "") return false;
  const separator = file.content.trim() ? "\n\n" : "";
  const anchorFrom = Math.max(0, file.content.length - 80);
  const anchor = file.content.slice(anchorFrom);
  return applyProjectEditTransaction({
    id: `import-${key}`,
    label: `Import bibliography entry ${key}`,
    edits: [
      {
        fileId,
        from: anchorFrom,
        to: file.content.length,
        expected: anchor,
        insert: `${anchor}${separator}${serializeCandidate(candidate, key)}\n`,
      },
    ],
  });
}

export async function appendBibtexSource(
  fileId: string,
  sources: string[],
  label = "Import pasted BibTeX",
): Promise<boolean> {
  const file = useDocumentStore
    .getState()
    .files.find((item) => item.id === fileId);
  if (!file || file.content === undefined || sources.length === 0) return false;
  const separator = file.content.trim() ? "\n\n" : "";
  const imported = sources.map((source) => source.trim()).join("\n\n");
  const anchorFrom = Math.max(0, file.content.length - 80);
  const anchor = file.content.slice(anchorFrom);
  return applyProjectEditTransaction({
    id: `paste-bibtex-${Date.now()}`,
    label,
    edits: [
      {
        fileId,
        from: anchorFrom,
        to: file.content.length,
        expected: anchor,
        insert: `${anchor}${separator}${imported}\n`,
      },
    ],
  });
}

export async function createBibliographyFromSource(
  requestedName: string,
  sources: string[],
): Promise<string | null> {
  const state = useDocumentStore.getState();
  if (!state.projectRoot || sources.length === 0) return null;
  const safeName =
    requestedName
      .trim()
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.replace(/[^a-zA-Z0-9._-]/g, "-") || "references.bib";
  const withExtension = safeName.toLowerCase().endsWith(".bib")
    ? safeName
    : `${safeName}.bib`;
  const relativePath = await getUniqueTargetName(
    state.projectRoot,
    withExtension,
  );
  await createFileOnDisk(
    state.projectRoot,
    relativePath,
    `${sources.map((source) => source.trim()).join("\n\n")}\n`,
  );
  await state.refreshFiles();
  return relativePath;
}

export async function renameCitationKey(
  oldKey: string,
  newKey: string,
): Promise<boolean> {
  if (!newKey || oldKey === newKey) return false;
  const edits: ProjectTextEdit[] = [];
  for (const file of useDocumentStore.getState().files) {
    if (file.content === undefined) continue;
    const patterns =
      file.type === "bib"
        ? [
            new RegExp(
              `(@[a-zA-Z]+\\s*\\{\\s*)${oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s*,)`,
              "g",
            ),
          ]
        : [
            new RegExp(
              `(\\\\(?:cite|citep|citet|parencite|textcite)\\*?(?:\\[[^\\]]*\\]){0,2}\\{[^}]*?)\\b${oldKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
              "g",
            ),
          ];
    for (const pattern of patterns)
      for (const match of file.content.matchAll(pattern)) {
        const relative = match[0].lastIndexOf(oldKey);
        const from = (match.index ?? 0) + relative;
        edits.push({
          fileId: file.id,
          from,
          to: from + oldKey.length,
          expected: oldKey,
          insert: newKey,
        });
      }
  }
  if (edits.length === 0) return false;
  return applyProjectEditTransaction({
    id: `rename-citation-${oldKey}`,
    label: `Rename citation key to ${newKey}`,
    edits,
  });
}
