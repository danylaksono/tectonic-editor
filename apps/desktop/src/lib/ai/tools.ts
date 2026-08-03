import { useDocumentStore, type ProjectFile } from "@/stores/document-store";
import { useProposedChangesStore } from "@/stores/proposed-changes-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  compileLatex,
  formatCompileError,
  resolveCompileTarget,
} from "@/lib/latex-compiler";
import { readTexFileContent, join } from "@/lib/tauri/fs";
import {
  findCandidateDuplicates,
  generateCitationKey,
  lookupReference,
  searchReferences,
  serializeCandidate,
  type CitationCandidate,
} from "@/lib/bibliography-import";
import { findBibEntries } from "@/lib/bibtex-entries";
import { usePendingScriptsStore } from "@/stores/pending-scripts-store";
import { invoke } from "@tauri-apps/api/core";
import type { AiToolDefinition } from "./types";

/**
 * The AI assistant's tool surface. All tools run in the frontend against the
 * in-memory document store, so they see unsaved editor changes. `propose_edit`
 * never touches the buffer or disk directly — it registers a ProposedChange
 * that the user reviews (accept/reject) in the editor's merge view.
 */

const TEXT_FILE_TYPES = new Set(["tex", "bib", "style", "other"]);
const MAX_FILE_CHARS = 120_000;
const MAX_SEARCH_RESULTS = 50;
const MAX_LOG_CHARS = 40_000;

export const AI_TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: "list_files",
    description:
      "List all files in the LaTeX project with their types. " +
      "Use this to discover the project structure before reading files.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description:
      "Read the current content of a project file, including unsaved editor " +
      "changes and pending proposed edits. Always read a file before " +
      "proposing edits to it.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Project-relative file path, e.g. 'main.tex' or 'chapters/intro.tex'",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "search_project",
    description:
      "Search all text files in the project for a literal string " +
      "(case-insensitive). Returns matching lines as 'path:line: text'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text to search for" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_edit",
    description:
      "Propose a change to a project file. `search` must be copied verbatim " +
      "from the file (including whitespace) and match exactly one location; " +
      "include enough surrounding context to make it unique. The edit is NOT " +
      "applied directly — the user reviews it as a diff in the editor and " +
      "accepts or rejects it. Make one propose_edit call per logical change.",
    input_schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Project-relative path of the file to edit",
        },
        search: {
          type: "string",
          description: "Exact text to replace (must be unique in the file)",
        },
        replace: { type: "string", description: "Replacement text" },
        reason: {
          type: "string",
          description: "One-line explanation of the change",
        },
      },
      required: ["path", "search", "replace"],
      additionalProperties: false,
    },
  },
  {
    name: "compile_document",
    description:
      "Compile the project's root .tex file. Saves all unsaved editor changes " +
      "first, then runs the LaTeX engine and updates the user's PDF preview. " +
      "On failure, returns the error category, summary, and source location. " +
      "NOTE: proposed edits the user has not yet accepted are NOT included in " +
      "the compile — after proposing a fix, ask the user to accept it before " +
      "compiling again to verify.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "check_citations",
    description:
      "Cross-check every \\cite command in the project against the .bib " +
      "files. Reports citation keys with no bibliography entry (with file " +
      "and line), bibliography entries that are never cited, and duplicate " +
      "keys. Runs locally on the current buffers — no network needed.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "search_references",
    description:
      "Search Crossref for scholarly works using a title, author, year, or " +
      "other bibliographic clues. Returns candidate metadata and DOIs. Search " +
      "results are leads, not proof: compare them with the project context, " +
      "then call lookup_reference with the best DOI before proposing an " +
      "addition. Requires network access.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Focused bibliographic query, ideally title words plus author or year",
        },
        limit: {
          type: "number",
          description:
            "Number of candidates to return, from 1 to 10 (default 5)",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_reference",
    description:
      "Resolve a DOI, arXiv ID, ISBN, or URL against Crossref/arXiv/Open " +
      "Library and return the authoritative metadata plus the BibTeX entry " +
      "that add_citation would create. Use it to verify an existing .bib " +
      "entry against the real publication record, or to preview a new " +
      "reference before adding it. Requires network access.",
    input_schema: {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description:
            "DOI (e.g. '10.1000/xyz'), arXiv ID (e.g. '2101.00001'), ISBN, or a doi.org/arxiv.org URL",
        },
      },
      required: ["identifier"],
      additionalProperties: false,
    },
  },
  {
    name: "add_citation",
    description:
      "Add a new bibliography entry for a DOI, arXiv ID, or ISBN. The entry " +
      "is built from the resolver's metadata — never write .bib entries by " +
      "hand or from memory, and never use propose_edit to add references. " +
      "The entry is proposed for user review like any edit (not applied " +
      "silently). Refuses identifiers already present in the bibliography. " +
      "Returns the citation key to use in \\cite once accepted.",
    input_schema: {
      type: "object",
      properties: {
        identifier: {
          type: "string",
          description: "DOI, arXiv ID, ISBN, or a doi.org/arxiv.org URL",
        },
        key: {
          type: "string",
          description:
            "Optional citation key to use; a key is generated from the metadata when omitted",
        },
        bib_file: {
          type: "string",
          description:
            "Optional project-relative .bib file to add the entry to; required only when the project has more than one .bib file",
        },
      },
      required: ["identifier"],
      additionalProperties: false,
    },
  },
  {
    name: "read_build_log",
    description:
      "Read the LaTeX engine log from the most recent compile — the full " +
      "output including warnings (overfull boxes, missing references, font " +
      "substitutions) that compile_document's summary omits. Use it to " +
      "diagnose cryptic compile errors or to find quality warnings.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "run_python",
    description:
      "Run a Python script in the project's virtual environment and return " +
      "its output. Use it for analysis, computation, and generating figures " +
      "to include in the document. The user is shown the code and must " +
      "approve it before it runs — say what the script will do before " +
      "calling this. Scripts run with the user's own file and network " +
      "access, so keep them minimal and never destructive. The working " +
      "directory is the project root, so write figures to 'figures/'.",
    input_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The complete Python script to run.",
        },
        description: {
          type: "string",
          description:
            "One line, shown to the user in the approval prompt, e.g. " +
            "'Plot the convergence data from results.csv'.",
        },
        timeout_secs: {
          type: "number",
          description: "Optional wall-clock limit, default 60, maximum 600.",
        },
      },
      required: ["code", "description"],
      additionalProperties: false,
    },
  },
];

interface PythonRunResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  cancelled: boolean;
  truncated: boolean;
  script_path: string;
}

export interface ToolExecutionResult {
  content: string;
  isError?: boolean;
}

function ok(content: string): ToolExecutionResult {
  return { content };
}

function err(content: string): ToolExecutionResult {
  return { content, isError: true };
}

function findFile(path: string): ProjectFile | undefined {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return useDocumentStore
    .getState()
    .files.find((f) => f.relativePath === normalized);
}

/**
 * The content the user currently sees for a file: a pending proposed change's
 * newContent if one exists, otherwise the editor buffer.
 */
function effectiveContent(file: ProjectFile): string | null {
  const pending = useProposedChangesStore
    .getState()
    .getChangeForFile(file.relativePath);
  return pending?.newContent ?? file.content ?? null;
}

function listFiles(): ToolExecutionResult {
  const { files, projectRoot } = useDocumentStore.getState();
  if (!projectRoot) return err("No project is open.");
  if (files.length === 0) return ok("The project contains no files.");
  const lines = files.map((f) => `${f.relativePath} (${f.type})`);
  return ok(lines.join("\n"));
}

function readFile(input: any): ToolExecutionResult {
  const path = typeof input?.path === "string" ? input.path : "";
  if (!path) return err("Missing required parameter: path");
  const file = findFile(path);
  if (!file) {
    return err(
      `File not found: ${path}. Call list_files to see available files.`,
    );
  }
  if (!TEXT_FILE_TYPES.has(file.type)) {
    return err(`${path} is a ${file.type} file and cannot be read as text.`);
  }
  const content = effectiveContent(file);
  if (content == null) {
    return err(`${path} is not loaded in the editor (file may be too large).`);
  }
  if (content.length > MAX_FILE_CHARS) {
    return ok(
      `${content.slice(0, MAX_FILE_CHARS)}\n\n[Truncated — file is ${content.length} characters long]`,
    );
  }
  return ok(content);
}

function searchProject(input: any): ToolExecutionResult {
  const query = typeof input?.query === "string" ? input.query : "";
  if (!query) return err("Missing required parameter: query");
  const { files, projectRoot } = useDocumentStore.getState();
  if (!projectRoot) return err("No project is open.");

  const needle = query.toLowerCase();
  const results: string[] = [];
  let truncated = false;

  for (const file of files) {
    if (!TEXT_FILE_TYPES.has(file.type)) continue;
    const content = effectiveContent(file);
    if (content == null) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        if (results.length >= MAX_SEARCH_RESULTS) {
          truncated = true;
          break;
        }
        results.push(`${file.relativePath}:${i + 1}: ${lines[i].trim()}`);
      }
    }
    if (truncated) break;
  }

  if (results.length === 0) return ok(`No matches found for "${query}".`);
  return ok(
    results.join("\n") +
      (truncated
        ? `\n[More matches exist — showing first ${MAX_SEARCH_RESULTS}]`
        : ""),
  );
}

function proposeEdit(input: any, toolUseId: string): ToolExecutionResult {
  const path = typeof input?.path === "string" ? input.path : "";
  const search = typeof input?.search === "string" ? input.search : "";
  const replace = typeof input?.replace === "string" ? input.replace : "";
  if (!path) return err("Missing required parameter: path");
  if (!search) return err("Missing required parameter: search");

  const file = findFile(path);
  if (!file) {
    return err(
      `File not found: ${path}. Call list_files to see available files.`,
    );
  }
  if (!TEXT_FILE_TYPES.has(file.type)) {
    return err(`${path} is a ${file.type} file and cannot be edited as text.`);
  }
  const base = effectiveContent(file);
  if (base == null) {
    return err(`${path} is not loaded in the editor (file may be too large).`);
  }

  // Count occurrences of the literal search text
  let count = 0;
  let idx = base.indexOf(search);
  while (idx !== -1) {
    count++;
    idx = base.indexOf(search, idx + 1);
    if (count > 1) break;
  }
  if (count === 0) {
    return err(
      `The search text was not found in ${path}. The file content may differ from what you expect — call read_file and copy the text verbatim.`,
    );
  }
  if (count > 1) {
    return err(
      `The search text matches more than one location in ${path}. Include more surrounding lines to make it unique.`,
    );
  }

  const at = base.indexOf(search);
  const newContent =
    base.slice(0, at) + replace + base.slice(at + search.length);

  useProposedChangesStore.getState().addChange({
    id: toolUseId,
    filePath: file.relativePath,
    absolutePath: file.absolutePath,
    oldContent: base,
    newContent,
    toolName: "propose_edit",
  });

  return ok(
    `Proposed edit to ${path}. The user will review it in the editor and accept or reject it — do not assume it has been applied.`,
  );
}

async function compileDocument(): Promise<ToolExecutionResult> {
  const state = useDocumentStore.getState();
  if (!state.projectRoot) return err("No project is open.");
  if (state.isCompiling) {
    return err(
      "A compile is already in progress. Wait for it to finish before compiling again.",
    );
  }
  const target = resolveCompileTarget(state.activeFileId, state.files);
  if (!target) return err("The project has no compilable .tex file.");

  await state.saveAllFiles();
  state.setIsCompiling(true);
  try {
    const useTexlive =
      useSettingsStore.getState().compilerBackend === "texlive";
    const pdf = await compileLatex(
      state.projectRoot,
      target.targetPath,
      useTexlive,
    );
    state.setPdfData(pdf, target.rootId);
    return ok(
      `Compile succeeded for ${target.targetPath}. The user's PDF preview has been updated. ` +
        "Call read_build_log if you need to check for warnings (overfull boxes, undefined references).",
    );
  } catch (e) {
    const failure = formatCompileError(e);
    state.setCompileError(failure, target.rootId);
    const location =
      failure.sourceFile || failure.sourceLine
        ? `\nLocation: ${failure.sourceFile ?? target.targetPath}${
            failure.sourceLine ? `:${failure.sourceLine}` : ""
          }`
        : "";
    const diagnostics = failure.relatedDiagnostics
      .map(
        (d) =>
          `- ${d.file ?? ""}${d.line != null ? `:${d.line}` : ""} ${d.message}`,
      )
      .join("\n");
    return err(
      `Compile failed (${failure.category}) for ${target.targetPath}.\n` +
        `Summary: ${failure.summary}${location}\n` +
        (diagnostics ? `Diagnostics:\n${diagnostics}\n` : "") +
        "Call read_build_log for the full engine output if the cause is unclear.",
    );
  } finally {
    useDocumentStore.getState().setIsCompiling(false);
  }
}

/**
 * Run a Python script, gated on the user's approval.
 *
 * Unlike `propose_edit`, this waits: the model needs the script's output to
 * carry on, so the tool call blocks until the user decides. `pending-scripts-
 * store` handles the waiting, the session-level "already approved this exact
 * code" shortcut, and the timeout.
 */
async function runPython(
  input: unknown,
  toolUseId: string,
): Promise<ToolExecutionResult> {
  const { code, description, timeout_secs } = (input ?? {}) as {
    code?: string;
    description?: string;
    timeout_secs?: number;
  };

  if (!code?.trim()) return err("run_python requires `code`.");
  if (!description?.trim()) {
    return err(
      "run_python requires `description` — the user sees it when deciding whether to run the script.",
    );
  }

  const projectPath = useDocumentStore.getState().projectRoot;
  if (!projectPath) return err("No project is open.");

  const decision = await usePendingScriptsStore.getState().request({
    id: toolUseId,
    code,
    description,
    createdAt: Date.now(),
  });

  if (decision === "rejected") {
    return err(
      "The user declined to run this script. Do not run it again unchanged — ask what they would prefer.",
    );
  }
  if (decision === "timeout") {
    return err(
      "The user did not respond to the approval prompt. The script did not run.",
    );
  }

  // Approved. Create the environment on first use rather than making the user
  // find a setting — it is excluded from history and export, so it costs
  // nothing but disk.
  try {
    await invoke("setup_project_venv", { projectPath });
  } catch (e) {
    return err(
      `Python environment could not be prepared: ${String(e)}. ` +
        "Ask the user to check that uv is installed (Settings → Python).",
    );
  }

  let result: PythonRunResult;
  try {
    result = await invoke<PythonRunResult>("uv_run_python", {
      code,
      projectPath,
      runId: toolUseId,
      timeoutSecs: timeout_secs,
    });
  } catch (e) {
    return err(`Failed to run the script: ${String(e)}`);
  }

  const parts: string[] = [];
  if (result.timed_out) {
    parts.push(
      "The script was killed for exceeding its time limit. Its output up to that point:",
    );
  } else if (result.cancelled) {
    parts.push("The user stopped the script. Partial output:");
  } else {
    parts.push(`Exit code: ${result.exit_code}`);
  }
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  if (!result.stdout && !result.stderr) parts.push("(no output)");
  if (result.truncated) {
    parts.push("[output was truncated — have the script print less]");
  }

  const failed = result.timed_out || result.cancelled || result.exit_code !== 0;
  return failed ? err(parts.join("\n\n")) : ok(parts.join("\n\n"));
}

async function readBuildLog(): Promise<ToolExecutionResult> {
  const state = useDocumentStore.getState();
  if (!state.projectRoot) return err("No project is open.");
  const target = resolveCompileTarget(state.activeFileId, state.files);
  if (!target) return err("The project has no compilable .tex file.");

  const stem = (target.targetPath.split("/").pop() ?? "").replace(
    /\.[^.]+$/,
    "",
  );
  try {
    const logPath = await join(
      state.projectRoot,
      `.tectonic-editor/build/${stem}.log`,
    );
    const content = await readTexFileContent(logPath);
    if (!content.trim()) {
      return err("The build log is empty. Run compile_document first.");
    }
    if (content.length > MAX_LOG_CHARS) {
      return ok(
        `[Log truncated — showing the last ${MAX_LOG_CHARS} of ${content.length} characters]\n…` +
          content.slice(-MAX_LOG_CHARS),
      );
    }
    return ok(content);
  } catch {
    // No log on disk (e.g. engine failed before writing one) — fall back to
    // the raw engine output captured from the last failed compile.
    const failure =
      state.compileErrorCache.get(target.rootId) ?? state.compileError;
    if (failure != null) {
      const raw =
        typeof failure === "string" ? failure : failure.rawEngineOutput;
      if (raw) {
        return ok(
          `[No log file found — showing the last compile's engine output]\n${raw}`,
        );
      }
    }
    return err("No build log found. Run compile_document first.");
  }
}

/** \cite / \citep / \parencite / … including starred and optioned variants. */
const CITE_COMMAND_RE =
  /\\(?:no)?cite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g;

function collectBibKeys(): Map<string, string> {
  // key → bib file path (first definition wins; duplicates reported separately)
  const keys = new Map<string, string>();
  for (const file of useDocumentStore.getState().files) {
    if (file.type !== "bib") continue;
    const content = effectiveContent(file);
    if (content == null) continue;
    for (const entry of findBibEntries(content)) {
      if (!keys.has(entry.key)) keys.set(entry.key, file.relativePath);
    }
  }
  return keys;
}

function checkCitations(): ToolExecutionResult {
  const { files, projectRoot } = useDocumentStore.getState();
  if (!projectRoot) return err("No project is open.");

  const bibFiles = files.filter((f) => f.type === "bib");
  const bibKeys = collectBibKeys();

  // Duplicate keys across all bib files
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const file of bibFiles) {
    const content = effectiveContent(file);
    if (content == null) continue;
    for (const entry of findBibEntries(content)) {
      if (seen.has(entry.key)) duplicated.add(entry.key);
      else seen.add(entry.key);
    }
  }

  // Cited keys with first-use location
  const citedAt = new Map<string, string>();
  for (const file of files) {
    if (file.type !== "tex") continue;
    const content = effectiveContent(file);
    if (content == null) continue;
    for (const match of content.matchAll(CITE_COMMAND_RE)) {
      const line = content.slice(0, match.index ?? 0).split("\n").length;
      for (const rawKey of match[1].split(",")) {
        const key = rawKey.trim();
        if (!key || key === "*" || citedAt.has(key)) continue;
        citedAt.set(key, `${file.relativePath}:${line}`);
      }
    }
  }

  const undefinedKeys = [...citedAt.entries()].filter(
    ([key]) => !bibKeys.has(key),
  );
  const uncitedEntries = [...bibKeys.entries()].filter(
    ([key]) => !citedAt.has(key),
  );

  const sections: string[] = [
    `${citedAt.size} distinct keys cited, ${bibKeys.size} bibliography entries in ${bibFiles.length} .bib file(s).`,
  ];
  if (undefinedKeys.length > 0) {
    sections.push(
      `Cited but MISSING from the bibliography (${undefinedKeys.length}):\n` +
        undefinedKeys
          .map(([key, loc]) => `- ${key} (first cited at ${loc})`)
          .join("\n"),
    );
  }
  if (duplicated.size > 0) {
    sections.push(
      `Duplicate bibliography keys (${duplicated.size}):\n` +
        [...duplicated].map((key) => `- ${key}`).join("\n"),
    );
  }
  if (uncitedEntries.length > 0) {
    sections.push(
      `Bibliography entries never cited (${uncitedEntries.length}):\n` +
        uncitedEntries.map(([key, path]) => `- ${key} (${path})`).join("\n"),
    );
  }
  if (undefinedKeys.length === 0 && duplicated.size === 0) {
    sections.push("No missing or duplicate citation keys found.");
  }
  return ok(sections.join("\n\n"));
}

function describeCandidate(candidate: CitationCandidate): string {
  const lines = [
    `Provider: ${candidate.provider}${candidate.fromCache ? " (cached)" : ""}`,
    `Title: ${candidate.title}`,
    `Authors: ${candidate.authors.join("; ") || "—"}`,
    `Year: ${candidate.year || "—"}`,
  ];
  if (candidate.journal) lines.push(`Journal: ${candidate.journal}`);
  if (candidate.publisher) lines.push(`Publisher: ${candidate.publisher}`);
  if (candidate.doi) lines.push(`DOI: ${candidate.doi}`);
  if (candidate.arxivId) lines.push(`arXiv: ${candidate.arxivId}`);
  if (candidate.isbn) lines.push(`ISBN: ${candidate.isbn}`);
  return lines.join("\n");
}

async function searchReferencesTool(input: any): Promise<ToolExecutionResult> {
  const query = typeof input?.query === "string" ? input.query.trim() : "";
  if (!query) return err("Missing required parameter: query");
  const requestedLimit =
    typeof input?.limit === "number" ? Math.trunc(input.limit) : 5;
  const limit = Math.min(Math.max(requestedLimit, 1), 10);
  let candidates: CitationCandidate[];
  try {
    candidates = await searchReferences(query, limit);
  } catch (e) {
    return err(
      `Could not search Crossref for "${query}": ${String(e)}. ` +
        "The network or scholarly metadata service may be unavailable.",
    );
  }
  if (candidates.length === 0) {
    return ok(`Crossref returned no matches for "${query}".`);
  }
  return ok(
    `Crossref candidates for "${query}" (verify before use):\n\n${candidates
      .map(
        (candidate, index) =>
          `${index + 1}. ${describeCandidate(candidate)}${
            candidate.url ? `\nURL: ${candidate.url}` : ""
          }`,
      )
      .join("\n\n")}`,
  );
}

async function lookupReferenceTool(input: any): Promise<ToolExecutionResult> {
  const identifier =
    typeof input?.identifier === "string" ? input.identifier.trim() : "";
  if (!identifier) return err("Missing required parameter: identifier");
  let candidate: CitationCandidate;
  try {
    candidate = await lookupReference(identifier);
  } catch (e) {
    return err(
      `Could not resolve "${identifier}": ${String(e)}. ` +
        "Check the identifier, or the network may be unavailable.",
    );
  }
  const key = generateCitationKey(candidate, collectBibKeys().keys());
  return ok(
    `${describeCandidate(candidate)}\n\nBibTeX that add_citation would create (key: ${key}):\n${serializeCandidate(candidate, key)}`,
  );
}

async function addCitation(
  input: any,
  toolUseId: string,
): Promise<ToolExecutionResult> {
  const identifier =
    typeof input?.identifier === "string" ? input.identifier.trim() : "";
  if (!identifier) return err("Missing required parameter: identifier");
  const requestedKey =
    typeof input?.key === "string"
      ? input.key.trim().replace(/[^a-zA-Z0-9_:-]/g, "")
      : "";
  const requestedBibFile =
    typeof input?.bib_file === "string" ? input.bib_file : "";

  const { files, projectRoot } = useDocumentStore.getState();
  if (!projectRoot) return err("No project is open.");

  const bibFiles = files.filter((f) => f.type === "bib");
  if (bibFiles.length === 0) {
    return err(
      "The project has no .bib file. Ask the user to create one (e.g. references.bib) first.",
    );
  }
  let target = bibFiles[0];
  if (requestedBibFile) {
    const found = findFile(requestedBibFile);
    if (!found || found.type !== "bib") {
      return err(
        `${requestedBibFile} is not a .bib file in this project. Available: ${bibFiles.map((f) => f.relativePath).join(", ")}`,
      );
    }
    target = found;
  } else if (bibFiles.length > 1) {
    return err(
      `The project has multiple .bib files — pass bib_file to choose one: ${bibFiles.map((f) => f.relativePath).join(", ")}`,
    );
  }

  let candidate: CitationCandidate;
  try {
    candidate = await lookupReference(identifier);
  } catch (e) {
    return err(
      `Could not resolve "${identifier}": ${String(e)}. ` +
        "Only add references that resolve to a real publication record.",
    );
  }

  // Refuse duplicates across all bib files
  for (const file of bibFiles) {
    const content = effectiveContent(file);
    if (content == null) continue;
    const reasons = findCandidateDuplicates(candidate, content);
    if (reasons.length > 0) {
      return err(
        `This reference already appears to be in ${file.relativePath} (${reasons.join(", ")}). Cite the existing entry instead — use check_citations or read the .bib file to find its key.`,
      );
    }
  }

  const existingKeys = collectBibKeys();
  if (requestedKey && existingKeys.has(requestedKey)) {
    return err(
      `The key "${requestedKey}" already exists in ${existingKeys.get(requestedKey)}. Choose another key or omit it.`,
    );
  }
  const key =
    requestedKey || generateCitationKey(candidate, existingKeys.keys());
  const entry = serializeCandidate(candidate, key);

  const base = effectiveContent(target);
  if (base == null) {
    return err(`${target.relativePath} is not loaded in the editor.`);
  }
  const separator = base.trim() ? "\n\n" : "";
  useProposedChangesStore.getState().addChange({
    id: toolUseId,
    filePath: target.relativePath,
    absolutePath: target.absolutePath,
    oldContent: base,
    newContent: `${base}${separator}${entry}\n`,
    toolName: "add_citation",
  });

  return ok(
    `Proposed adding "${candidate.title}" (${candidate.year}) to ${target.relativePath} with key "${key}" — metadata from ${candidate.provider}. ` +
      `The user must accept the proposal before \\cite{${key}} will resolve.`,
  );
}

export async function executeAiTool(
  name: string,
  input: unknown,
  toolUseId: string,
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case "list_files":
        return listFiles();
      case "read_file":
        return readFile(input);
      case "search_project":
        return searchProject(input);
      case "propose_edit":
        return proposeEdit(input, toolUseId);
      case "compile_document":
        return await compileDocument();
      case "read_build_log":
        return await readBuildLog();
      case "check_citations":
        return checkCitations();
      case "search_references":
        return await searchReferencesTool(input);
      case "lookup_reference":
        return await lookupReferenceTool(input);
      case "add_citation":
        return await addCitation(input, toolUseId);
      case "run_python":
        return await runPython(input, toolUseId);
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(`Tool execution failed: ${String(e)}`);
  }
}
