import type { StructuredTextData } from "@/lib/mupdf/types";

export interface PdfWordCount {
  words: number;
  characters: number;
  pages: number;
}

/** A token counts as a word only if it contains a letter or a digit, so
 * standalone punctuation, bullets, and rule glyphs don't inflate the total. */
const WORD_LIKE = /[\p{L}\p{N}]/u;

/**
 * Rejoin words that LaTeX hyphenated across a line break.
 *
 * Justified LaTeX text hyphenates heavily, and the PDF's text layer preserves
 * the break, so counting lines independently would report "hyphen-" and
 * "ation" as two words. Only a lowercase continuation is rejoined — an
 * uppercase one is far more likely to be a genuine compound spanning the break
 * ("Fourier-\nTransform") or the start of a new sentence.
 */
export function joinPageLines(lines: string[]): string {
  let joined = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    const hyphenated =
      next !== undefined && /[\p{Ll}]-$/u.test(line) && /^[\p{Ll}]/u.test(next);
    joined += hyphenated ? line.slice(0, -1) : `${line} `;
  }
  return joined;
}

/** Count words in already-joined page text. */
export function countWords(text: string): number {
  const tokens = text.split(/\s+/);
  let count = 0;
  for (const token of tokens) {
    if (token !== "" && WORD_LIKE.test(token)) count++;
  }
  return count;
}

/** Flatten one page's structured text into its lines, in reading order. */
export function pageLines(page: StructuredTextData): string[] {
  const lines: string[] = [];
  for (const block of page.blocks) {
    if (block.type !== "text") continue;
    for (const line of block.lines) {
      lines.push(line.text);
    }
  }
  return lines;
}

export interface PdfWordCountOptions {
  /** Polled between pages so an abandoned count stops early. */
  isCancelled?: () => boolean;
  onProgress?: (pagesCounted: number, pageCount: number) => void;
}

/**
 * Count the words actually rendered in the compiled PDF.
 *
 * This is what journals and thesis regulations mean by a word count: it
 * excludes LaTeX markup, preamble, and comments, and includes only text that
 * reached the page. `getPageText` is injected so the sweep is testable without
 * the WASM worker.
 */
export async function countPdfWords(
  getPageText: (pageIndex: number) => Promise<StructuredTextData>,
  pageCount: number,
  options: PdfWordCountOptions = {},
): Promise<PdfWordCount> {
  let words = 0;
  let characters = 0;
  let pagesCounted = 0;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    if (options.isCancelled?.()) break;

    let page: StructuredTextData;
    try {
      page = await getPageText(pageIndex);
    } catch {
      // A page whose text can't be extracted is skipped rather than failing
      // the whole count.
      continue;
    }

    const text = joinPageLines(pageLines(page));
    words += countWords(text);
    characters += text.replace(/\s+/g, "").length;
    pagesCounted++;
    options.onProgress?.(pagesCounted, pageCount);
  }

  return { words, characters, pages: pagesCounted };
}
