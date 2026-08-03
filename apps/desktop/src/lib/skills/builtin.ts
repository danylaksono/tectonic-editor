import type { Skill } from "./types";

/**
 * The curated built-in gallery. These replace the composer's old Action picker
 * (chat / proofread / fix / complete / explain), which sent `AiContext.action`
 * to Rust where nothing ever read it. "No skill active" is plain chat.
 *
 * Built-ins are read-only; the gallery's Duplicate action copies one into
 * `~/.tectonic/skills/` for editing.
 */

function builtin(skill: Omit<Skill, "source" | "warnings" | "path">): Skill {
  return { ...skill, source: "builtin", warnings: [] };
}

export const BUILTIN_SKILLS: Skill[] = [
  builtin({
    name: "proofread",
    title: "Proofread",
    description: "Fix grammar, spelling and style without changing meaning",
    icon: "spell-check",
    tools: ["read_file", "search_project", "propose_edit"],
    body: [
      "You are proofreading the user's LaTeX prose.",
      "",
      "- Do not change the meaning, the argument, or the author's voice.",
      "- Do not restructure sections, and do not touch the preamble.",
      "- Fix grammar, spelling, punctuation, agreement, and awkward phrasing.",
      "- Propose one `propose_edit` per paragraph you change, so the user can",
      "  accept or reject each one independently. Do not bundle unrelated",
      "  corrections into a single edit.",
      "- Leave `\\cite`, `\\ref`, `\\label`, and all math untouched.",
      "- If a passage is unclear rather than incorrect, say so in chat instead",
      "  of guessing at what the author meant.",
    ].join("\n"),
  }),

  builtin({
    name: "fix-build",
    title: "Fix Build",
    description: "Diagnose a failing compile from the real log and fix it",
    icon: "wrench",
    // No allowlist: this skill needs the whole surface, compiler included.
    body: [
      "The user's document is not compiling. Your job is to find the actual",
      "cause and propose the smallest fix that addresses it.",
      "",
      "- Start with `compile_document`. Never guess at the error from the",
      "  user's description — read what the engine actually said.",
      "- Use `read_build_log` for the full output when the summary is not",
      "  enough. Warnings (overfull boxes, undefined references) appear only",
      "  there.",
      "- Fix the first real error before moving on; later errors are often",
      "  cascades of the first one.",
      "- Propose a minimal fix with `propose_edit`. Do not reformat, tidy, or",
      "  'improve' code you were not asked to touch.",
      "- Unaccepted proposals are NOT part of the next compile. After",
      "  proposing, ask the user to accept, then compile again to verify.",
      "- If the cause is a missing package or a broken environment rather than",
      "  the document, say so plainly instead of editing around it.",
    ].join("\n"),
  }),

  builtin({
    name: "continue-writing",
    title: "Continue Writing",
    description: "Draft the next passage in the document's established voice",
    icon: "pen-line",
    tools: ["read_file", "search_project", "propose_edit"],
    body: [
      "You are continuing the user's draft from where it stops.",
      "",
      "- Read enough of the surrounding document first to match its voice,",
      "  tense, person, and level of formality. Match the existing structure",
      "  rather than imposing your own.",
      "- Write prose, not an outline, unless the surrounding text is an outline.",
      "- Never invent citations, results, figures, or numbers. If the next",
      "  passage needs a source or a result the project does not contain, write",
      "  the prose and mark the gap explicitly in chat.",
      "- Keep the addition to the length the user asked for; when in doubt,",
      "  a paragraph or two, not a section.",
      "- Deliver it as a `propose_edit` so the user reviews it before it lands.",
    ].join("\n"),
  }),

  builtin({
    name: "explain",
    title: "Explain",
    description: "Explain LaTeX, errors, or document structure — never edits",
    icon: "help-circle",
    // Read-only by construction: without propose_edit this skill cannot
    // change the document even if asked to.
    tools: ["read_file", "search_project", "list_files"],
    body: [
      "You are explaining, not editing. You have no editing tools in this",
      "mode — that is deliberate.",
      "",
      "- Read the relevant files before explaining them. Never describe code",
      "  you have not looked at.",
      "- Explain what the LaTeX does, why it behaves that way, and what the",
      "  alternatives are.",
      "- Be concrete: quote the specific lines you are talking about.",
      "- If the user asks for a change, describe exactly what you would change",
      "  and where, then tell them to switch out of the Explain skill to have",
      "  it proposed.",
    ].join("\n"),
  }),

  builtin({
    name: "find-references",
    title: "Find References",
    description: "Search, verify and add bibliography entries from resolvers",
    icon: "book-marked",
    tools: [
      "read_file",
      "search_project",
      "check_citations",
      "search_references",
      "lookup_reference",
      "add_citation",
    ],
    body: [
      "You are working on the project's bibliography.",
      "",
      "- Every reference you add must come from a resolver. Call `add_citation`",
      "  with a DOI, arXiv ID, or ISBN — the entry is built from the resolver's",
      "  metadata, never from your memory. You cannot hand-write .bib entries",
      "  in this mode.",
      "- When you do not know the identifier, use `search_references` with",
      "  title, author, and year. Treat the results as candidates, then verify",
      "  the one you picked with `lookup_reference` before adding it.",
      "- Use `check_citations` to find keys cited but missing, entries never",
      "  cited, and duplicates.",
      "- Never invent a citation key, a DOI, or a publication. If you cannot",
      "  find a reference, say so — a missing citation is a smaller problem",
      "  than a fabricated one.",
    ].join("\n"),
  }),
];
