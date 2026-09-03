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
 * Pass `tidy` and `rekey` for machine-generated BibTeX (a Zotero export, say),
 * where matching the project's conventions matters more than preserving the
 * exporter's. Hand-written source is left alone by default.
 */
export function prepareBibtexEntries(
  source: string,
  existingKeys: Iterable<string>,
  { tidy = false, rekey = false }: { tidy?: boolean; rekey?: boolean } = {},
): PreparedBibtexEntry[] {
  const used = new Set(existingKeys);
  return parseBibtexSourceEntries(source).map((entry) => {
    const originalKey = entry.key;
    const baseKey = rekey ? houseCitationKey(entry) : originalKey;
    let key = baseKey;
    let suffix = 2;
    while (used.has(key)) {
      key = `${baseKey}${suffix}`;
      suffix += 1;
    }
    used.add(key);
    const withKey =
      key === originalKey ? entry.source : replaceBibtexEntryKey(entry, key);
    return {
      originalKey,
      key,
      source: tidy ? tidyBibEntrySource(withKey) : withKey,
      title: entry.title,
    };
  });
}

/** A library entry with the house key it was given. */
export interface KeyedBibtexEntry {
  itemKey: string;
  citekey: string;
  source: string;
}

/**
 * Give a batch of exported entries house-style keys and formatting.
 *
 * `previousKeys` maps a library item to the key an earlier sync already gave
 * it. Those are kept verbatim: re-syncing a collection must never rewrite a
 * key the document already cites. Only items new to the batch are keyed.
 */
export function applyHouseKeys(
  entries: { itemKey: string; bibtex: string }[],
  previousKeys: Record<string, string> = {},
): KeyedBibtexEntry[] {
  const used = new Set(Object.values(previousKeys));
  const keyed: KeyedBibtexEntry[] = [];

  for (const { itemKey, bibtex } of entries) {
    const [parsed] = parseBibtexSourceEntries(bibtex);
    if (!parsed) continue;

    const kept = previousKeys[itemKey];
    let citekey = kept ?? houseCitationKey(parsed);
    if (!kept) {
      let suffix = 2;
      const base = citekey;
      while (used.has(citekey)) {
        citekey = `${base}${suffix}`;
        suffix += 1;
      }
      used.add(citekey);
    }

    const withKey =
      citekey === parsed.key
        ? parsed.source
        : replaceBibtexEntryKey(parsed, citekey);
    keyed.push({ itemKey, citekey, source: tidyBibEntrySource(withKey) });
  }

  return keyed;
}

/** What the project already cites, by key and by normalised title. */
export interface ProjectCitationIndex {
  keys: Set<string>;
  keyByTitle: Map<string, string>;
}

export function collectProjectCitations(
  files: ProjectFile[],
): ProjectCitationIndex {
  const keys = new Set<string>();
  const keyByTitle = new Map<string, string>();
  for (const file of files) {
    if (file.type !== "bib") continue;
    for (const entry of parseBibEntries(
      file.content ?? "",
      file.relativePath,
    )) {
      keys.add(entry.key);
      const title = normalizedTitle(entry.title ?? "");
      if (title && !keyByTitle.has(title)) keyByTitle.set(title, entry.key);
    }
  }
  return { keys, keyByTitle };
}

/**
 * The key this reference already has in the project, or null. Matching on
 * title as well as key catches a work imported earlier under a different
 * key — from a DOI lookup, say — so it is never added twice.
 */
export function findExistingCitationKey(
  index: ProjectCitationIndex,
  reference: { key?: string; title?: string },
): string | null {
  if (reference.key && index.keys.has(reference.key)) return reference.key;
  const title = normalizedTitle(reference.title ?? "");
  return (title && index.keyByTitle.get(title)) || null;
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

/** First author's family name, from either "Doe, Jane" or "Jane Doe". */
function familyName(author: string): string {
  const first = author.split(/\s+and\s+/i)[0]?.trim() ?? "";
  const family = first.includes(",")
    ? first.split(",")[0]
    : (first.split(/\s+/).pop() ?? "");
  return family.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Opal's house citation key: family name, year, first substantial title word,
 * lowercased — `lovelace2025useful`. Every import route generates keys this
 * way so one project's bibliography reads consistently no matter where an
 * entry came from. Collisions take a numeric suffix.
 */
export function houseCitationKey(
  reference: { author?: string; title?: string; year?: string },
  existingKeys: Iterable<string> = [],
): string {
  const family = familyName(reference.author ?? "") || "source";
  const word =
    normalizedTitle(reference.title ?? "")
      .split(" ")
      .find((value) => value.length > 3) || "work";
  const base = `${family}${reference.year || "nd"}${word}`.toLowerCase();
  const existing = new Set(existingKeys);
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/** The key a BibTeX entry would get on import, before collision handling. */
export function previewHouseCitationKey(bibtex: string): string {
  const [entry] = parseBibtexSourceEntries(bibtex);
  return entry ? houseCitationKey(entry) : "";
}

export function generateCitationKey(
  candidate: CitationCandidate,
  existingKeys: Iterable<string>,
): string {
  return houseCitationKey(
    {
      author: candidate.authors[0],
      title: candidate.title,
      year: candidate.year,
    },
    existingKeys,
  );
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
