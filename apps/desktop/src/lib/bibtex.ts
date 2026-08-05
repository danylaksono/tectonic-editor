export interface BibCitation {
  key: string;
  type: string;
  title?: string;
  author?: string;
  year?: string;
  journal?: string;
  booktitle?: string;
  publisher?: string;
  doi?: string;
  url?: string;
  filePath: string;
}

export interface ParsedBibtexEntry extends BibCitation {
  source: string;
  from: number;
  to: number;
}

function findEntryEnd(content: string, start: number, opener: "{" | "(") {
  const closer = opener === "{" ? "}" : ")";
  let depth = 0;
  let braceDepth = 0;
  let inQuote = false;
  let escaped = false;

  for (let i = start; i < content.length; i++) {
    const char = content[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (
      char === '"' &&
      (inQuote || (depth === 1 && (opener === "{" || braceDepth === 0)))
    ) {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) continue;
    if (opener === "(") {
      if (char === "{") {
        braceDepth++;
        continue;
      }
      if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        continue;
      }
      if (braceDepth > 0) continue;
    }
    if (char === opener) depth++;
    if (char === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function splitFields(body: string) {
  const fields: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let inQuote = false;
  let escaped = false;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"' && (inQuote || (braceDepth === 0 && parenDepth === 0))) {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote) {
      if (char === "{") braceDepth++;
      if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
      if (char === "(") parenDepth++;
      if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    }
    if (char === "," && !inQuote && braceDepth === 0 && parenDepth === 0) {
      fields.push(body.slice(start, i));
      start = i + 1;
    }
  }
  fields.push(body.slice(start));
  return fields;
}

function cleanValue(value: string) {
  let output = value.trim();
  while (
    (output.startsWith("{") && output.endsWith("}")) ||
    (output.startsWith('"') && output.endsWith('"'))
  ) {
    output = output.slice(1, -1).trim();
  }

  return output
    .replace(/[{}]/g, "")
    .replace(/\\&/g, "&")
    .replace(/\\([#$%&_])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFields(body: string) {
  const fields: Record<string, string> = {};
  for (const field of splitFields(body)) {
    const eq = field.indexOf("=");
    if (eq === -1) continue;
    const name = field.slice(0, eq).trim().toLowerCase();
    const value = cleanValue(field.slice(eq + 1));
    if (name && value) fields[name] = value;
  }
  return fields;
}

function compactAuthor(author?: string) {
  if (!author) return undefined;
  return author
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
}

export function parseBibEntries(
  content: string,
  filePath = "references.bib",
): BibCitation[] {
  const entries: BibCitation[] = [];
  let index = 0;

  while (index < content.length) {
    const at = content.indexOf("@", index);
    if (at === -1) break;

    const header = content.slice(at).match(/^@([a-zA-Z]+)\s*([{(])/);
    if (!header) {
      index = at + 1;
      continue;
    }

    const type = header[1].toLowerCase();
    if (type === "comment" || type === "preamble" || type === "string") {
      index = at + header[0].length;
      continue;
    }

    const opener = header[2] as "{" | "(";
    const entryStart = at + header[0].length - 1;
    const entryEnd = findEntryEnd(content, entryStart, opener);
    if (entryEnd === -1) break;

    const inner = content.slice(entryStart + 1, entryEnd);
    const keyEnd = inner.indexOf(",");
    if (keyEnd === -1) {
      index = entryEnd + 1;
      continue;
    }

    const key = inner.slice(0, keyEnd).trim();
    if (!key) {
      index = entryEnd + 1;
      continue;
    }

    const fields = parseFields(inner.slice(keyEnd + 1));
    entries.push({
      key,
      type,
      title: fields.title,
      author: compactAuthor(fields.author ?? fields.editor),
      year: fields.year ?? fields.date?.slice(0, 4),
      journal: fields.journal,
      booktitle: fields.booktitle,
      publisher: fields.publisher,
      doi: fields.doi,
      url: fields.url,
      filePath,
    });

    index = entryEnd + 1;
  }

  return entries;
}

/**
 * Parse complete BibTeX entries while retaining their original source.
 * Unknown fields and formatting are intentionally preserved for safe imports.
 */
export function parseBibtexSourceEntries(
  content: string,
  filePath = "pasted BibTeX",
): ParsedBibtexEntry[] {
  const entries: ParsedBibtexEntry[] = [];
  let index = 0;

  while (index < content.length) {
    const at = content.indexOf("@", index);
    if (at === -1) break;
    const header = content.slice(at).match(/^@([a-zA-Z]+)\s*([{(])/);
    if (!header) {
      index = at + 1;
      continue;
    }
    const type = header[1].toLowerCase();
    const opener = header[2] as "{" | "(";
    const entryStart = at + header[0].length - 1;
    const entryEnd = findEntryEnd(content, entryStart, opener);
    if (entryEnd === -1) break;
    if (type === "comment" || type === "preamble" || type === "string") {
      index = entryEnd + 1;
      continue;
    }

    const inner = content.slice(entryStart + 1, entryEnd);
    const keyEnd = inner.indexOf(",");
    if (keyEnd !== -1) {
      const key = inner.slice(0, keyEnd).trim();
      if (key) {
        const fields = parseFields(inner.slice(keyEnd + 1));
        entries.push({
          key,
          type,
          title: fields.title,
          author: compactAuthor(fields.author ?? fields.editor),
          year: fields.year ?? fields.date?.slice(0, 4),
          journal: fields.journal,
          booktitle: fields.booktitle,
          publisher: fields.publisher,
          doi: fields.doi,
          url: fields.url,
          filePath,
          source: content.slice(at, entryEnd + 1).trim(),
          from: at,
          to: entryEnd + 1,
        });
      }
    }
    index = entryEnd + 1;
  }
  return entries;
}

export function replaceBibtexEntryKey(
  entry: ParsedBibtexEntry,
  key: string,
): string {
  const header = entry.source.match(/^(@[a-zA-Z]+\s*[{(]\s*)([^,\s]+)(\s*,)/);
  if (!header) return entry.source;
  return `${header[1]}${key}${header[3]}${entry.source.slice(header[0].length)}`;
}

/** Parse classic thebibliography entries so citation tools also work without a .bib file. */
export function parseBibItems(
  content: string,
  filePath = "main.tex",
): BibCitation[] {
  const entries: BibCitation[] = [];
  const pattern = /\\bibitem(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g;
  for (const match of content.matchAll(pattern)) {
    const key = match[2].trim();
    if (!key) continue;
    entries.push({
      key,
      type: "bibitem",
      title: match[1]?.trim() || key,
      filePath,
    });
  }
  return entries;
}
