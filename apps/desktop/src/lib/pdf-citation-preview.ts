import { parseBibtexSourceEntries, type BibCitation } from "@/lib/bibtex";
import type { ProjectFile } from "@/stores/document-store";

/** A bibliography entry, located precisely enough to open it in the editor. */
export interface CitationEntry extends BibCitation {
  /** Project file the entry is written in. */
  fileId: string;
  /** Character offset of the entry within that file. */
  from: number;
}

/** A bibliography entry resolved from a citation link in the compiled PDF. */
export interface CitationPreview {
  key: string;
  entry: CitationEntry | null;
  /** Absolute https URL for the entry's DOI or url field, when it has one. */
  link: string | null;
  /** Where `link` came from, so the card can label it. */
  linkKind: "doi" | "url" | null;
}

/**
 * The destination name hyperref writes for a citation anchor. `\cite{a,b}`
 * emits one link per key, so a hovered link always maps to a single entry.
 */
const CITE_DEST_PREFIX = "cite.";

/** Extract the BibTeX key from a PDF destination name, or null if the
 * destination is not a citation (a section, figure, or footnote anchor). */
export function citationKeyFromDest(
  dest: string | null | undefined,
): string | null {
  if (!dest || !dest.startsWith(CITE_DEST_PREFIX)) return null;
  const key = dest.slice(CITE_DEST_PREFIX.length).trim();
  return key || null;
}

/** Build an https URL from a DOI written in any of the usual BibTeX forms:
 * bare (`10.1/x`), prefixed (`doi:10.1/x`), or already a resolver URL. */
export function doiUrl(doi: string | undefined): string | null {
  if (!doi) return null;
  let value = doi.trim().replace(/\s+/g, "");
  if (!value) return null;
  value = value.replace(/^doi:/i, "");
  value = value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  if (!value.startsWith("10.")) return null;
  return `https://doi.org/${encodeURI(value)}`;
}

/** A plain http(s) link from the entry's url field, used when there is no DOI. */
function entryUrl(url: string | undefined): string | null {
  if (!url) return null;
  const value = url.trim().replace(/^\\url\{(.*)\}$/, "$1");
  return /^https?:\/\//i.test(value) ? value : null;
}

export function buildCitationPreview(
  key: string,
  entry: CitationEntry | null,
): CitationPreview {
  const doi = doiUrl(entry?.doi);
  if (doi) return { key, entry, link: doi, linkKind: "doi" };
  const url = entryUrl(entry?.url);
  if (url) return { key, entry, link: url, linkKind: "url" };
  return { key, entry, link: null, linkKind: null };
}

/** Longest reference text kept for a `\bibitem`; anything beyond this is an
 * annotation the card has no room for. */
const MAX_BIBITEM_TEXT = 400;

/** Reduce the LaTeX in a `\bibitem` body to the text a reader sees in the
 * compiled bibliography. This is display-only: unknown macros are unwrapped
 * rather than expanded, which is right for the common bibliography commands
 * (`\textit`, `\emph`, `\href`) and harmless for the rest. */
function bibItemText(body: string): string {
  let text = body
    .replace(/(^|[^\\])%.*$/gm, "$1")
    .replace(/\\newblock/g, " ")
    .replace(/\\bibinfo\s*\{[^}]*\}/g, "")
    .replace(/\\href\s*\{[^}]*\}\s*\{([^}]*)\}/g, "$1")
    .replace(/\\(?:url|doi)\s*\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\s*/g, " ")
    .replace(/[{}]/g, "")
    .replace(/``|''/g, '"')
    .replace(/~/g, " ")
    .replace(/---?/g, "–")
    .replace(/\\([#$%&_])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MAX_BIBITEM_TEXT) {
    text = `${text.slice(0, MAX_BIBITEM_TEXT).trimEnd()}…`;
  }
  return text;
}

/** Pull a DOI or plain link out of a `\bibitem` body, which has no fields to
 * read it from. */
function bibItemLink(body: string): { doi?: string; url?: string } {
  const doi = body.match(
    /\b(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[^\s{}",]+)/i,
  );
  if (doi) return { doi: doi[1] };
  const url = body.match(/https?:\/\/[^\s{}",]+/);
  return url ? { url: url[0] } : {};
}

/** Entries from a `thebibliography` environment written directly in the
 * source, which many templates use instead of a `.bib` file. */
function parseBibItemEntries(file: ProjectFile): CitationEntry[] {
  const content = file.content ?? "";
  const entries: CitationEntry[] = [];
  const pattern = /\\bibitem(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;

  for (const match of content.matchAll(pattern)) {
    const key = match[1].trim();
    if (!key) continue;
    const start = match.index + match[0].length;
    const next = content
      .slice(start)
      .search(/\\bibitem|\\end\s*\{thebibliography\}/);
    const body = content.slice(start, next === -1 ? undefined : start + next);
    entries.push({
      key,
      type: "bibitem",
      title: bibItemText(body) || key,
      ...bibItemLink(body),
      filePath: file.relativePath,
      fileId: file.id,
      from: match.index,
    });
  }

  return entries;
}

/**
 * Index every bibliography entry in the project by citation key.
 *
 * `.tex` files are scanned too so documents that inline a `thebibliography`
 * environment instead of using a `.bib` file still resolve.
 */
export function buildCitationIndex(
  files: ProjectFile[],
): Map<string, CitationEntry> {
  const index = new Map<string, CitationEntry>();

  for (const file of files) {
    if (!file.content) continue;
    const name = file.name.toLowerCase();
    const entries: CitationEntry[] = name.endsWith(".bib")
      ? parseBibtexSourceEntries(file.content, file.relativePath).map(
          (entry) => ({ ...entry, fileId: file.id, from: entry.from }),
        )
      : name.endsWith(".tex")
        ? parseBibItemEntries(file)
        : [];
    for (const entry of entries) {
      // First definition wins, matching how BibTeX resolves a duplicated key.
      if (!index.has(entry.key)) index.set(entry.key, entry);
    }
  }

  return index;
}

/** Venue line for the card: whichever container field the entry type uses. */
export function citationVenue(entry: BibCitation): string | undefined {
  return entry.journal ?? entry.booktitle ?? entry.publisher;
}
