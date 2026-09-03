# Changelog

## [Unreleased]

## [1.5.0] - 2026-09-03

Opal 1.5 is about the work that happens around the writing: reading a draft
critically, and keeping the bibliography honest. PDF review grows into a
working tool — draw on the page, tag and search your notes, see them in the
editor gutter next to the line they are about, export them as something you can
hand a supervisor, and be told when a recompile has moved the text a note was
written about. Zotero stops being a whole-collection import and becomes a
library you browse and search from inside the editor, and every citation key
Opal generates now follows one house style.

### Added

- **Drawing on the PDF**: freehand ink plus line, arrow, box, and ellipse, in
  the same five colours as highlights. A drawing is stored the way every other
  annotation is — page-relative PDF points with a bounding box — so it carries a
  comment thread, tags, a place in the panel, a gutter dot, and a line in the
  exported report without anything else needing to know what a drawing is.
  Strokes are painted into an SVG overlay rather than into the page, so they
  cost no extra PDF memory and no re-render. Long scribbles are thinned to the
  points that carry their shape, because every point kept is JSON in a file
  other reviewers have to pull.
- **Tags on annotations**, normalised so that "Likely Question",
  `#likely-question`, and "likely question" all land on the same chip — a filter
  is only useful when one idea doesn't split across three spellings. A new
  install starts with a viva-prep vocabulary (`likely-question`, `weakness`,
  `defend`, `rewrite`, `cite-check`, `typo`) that you can replace entirely in
  **Settings → PDF Review**. The list is only a set of suggestions; any tag can be
  typed whether or not it is on it. Filter the panel by clicking the chips.
- **Search across your annotations**, over note bodies, the quoted passage, the
  author, and replies — a peer's answer is often where the useful sentence
  lives. Terms are ANDed, so typing more words narrows the list, and a term
  written as `#weakness` matches tags only, which lets `#weakness sample` find
  tagged notes that also mention the sample.
- **Review markers in the editor gutter.** Annotations are made on the PDF but
  they are fixed in the source, and until now the only way to reach one from the
  editor was to go looking for it in the preview. A dot now sits on the line an
  annotation points at, coloured by whether anything there is still open, and
  clicking it reveals that annotation in the PDF. Line numbers come from
  SyncTeX, so markers are mapped through your edits as you type and re-sync to
  the truth at the next compile. Resolved notes keep their marker — a resolved
  note is a record of a decision about that line — but never colour it.
- **Export review notes as Markdown**: document order rather than the panel's
  open-first order, the quoted passage with each note so it stands alone away
  from the PDF, and the source location so every entry is still actionable back
  in the editor. It exports exactly what your filters are showing, and a
  filtered report says so and how much it left out.
- **An anchor check after every compile.** Annotations are positions measured
  against one exact build, so reflowed text leaves them pointing somewhere else.
  Opal now searches the fresh PDF for the text each annotation was written about
  and reports one of four answers: it is still there, it has moved and here is
  where it went, it is gone, or there was nothing to search by — which is not
  evidence either way. Annotations with no text under them fall back to their
  SyncTeX source location. Nothing is ever moved for you: where a note sits is a
  deliberate act by whoever placed it, and a confidently wrong new position is
  worse than a stale one because it looks authoritative. A filter in the panel
  shows just the annotations whose text has moved or gone.
- **Markdown and maths in review comments and replies**, rendered with KaTeX, so
  arguing with yourself about a results chapter can say `$\hat\beta$` instead of
  "the estimator b-hat". This is deliberately not the AI chat's renderer:
  annotations travel between people, so nothing here executes, inserts, or
  fetches anything.
- **Browse a Zotero collection item by item**, paged, with a filter over the
  collection tree that keeps the ancestors of every match so nesting still
  reads. Import single items instead of the whole collection.
- **Search your whole Zotero library** by title, creator, and year — from the
  references panel, or directly from the citation picker while you are writing.
  Items that are already in the project resolve to the key the project already
  cites rather than being imported twice.
- Zotero Desktop's local API can serve collections while failing to serve items
  on some builds. Opal now probes one item read up front and warns you, rather
  than failing halfway through an import.

### Changed

- **One house citation key for every import route**: family name, year, first
  substantial title word, lowercased — `lovelace2025useful`. A project's
  bibliography now reads consistently no matter where an entry came from, and
  imported BibTeX is tidied to match. Collisions take a visible numeric suffix
  instead of silently overwriting. Re-syncing a collection keeps the keys an
  earlier sync already assigned, so a key your document cites is never rewritten
  under it, and hand-written BibTeX you paste in is left exactly as you wrote it.
- SyncTeX lookups for a document's worth of review annotations now resolve in a
  single pass over the SyncTeX file, which for a thesis runs to tens of
  megabytes. Resolving them one at a time is what would make an anchor check
  take minutes rather than a moment.

## [1.4.8] - 2026-08-05

Opal 1.4.8 makes the assistant something you can direct rather than just talk
to: skills you invoke with `/`, each with its own instructions and its own
limits on which tools it may touch, plus the ability to run Python for analysis
and figures under your approval. Alongside that, citations become clickable in
the compiled PDF, the PDF pane gains back/forward navigation, and the editor
points out the LaTeX habits that quietly turn into typographic mistakes.

### Added

- **Style suggestions** while you write: straight quotes that would come out as
  `”text”`, `...` where LaTeX wants `\dots`, `$$…$$` instead of `\[…\]`,
  plain-TeX font switches like `\bf`, `eqnarray`, a heading level skipped in the
  table of contents, and a missing `~` in `Figure \ref{...}` so a reference can
  never start a line. They appear as blue hints, never errors, and most carry a
  one-click fix. Nothing fires inside comments, verbatim blocks, math, URLs, or
  file paths, where that punctuation is deliberate. Turn the whole set off in
  Settings → Editor → Style suggestions.
- The assistant can **run Python** for analysis, computation, and generating
  figures, using the project's own virtual environment (created on first use).
  Every script is shown to you in full and runs only when you approve it —
  re-running the identical script during the same conversation doesn't ask
  again, but any change to the code does. Scripts are killed after 60 seconds by
  default, their output is capped, and stopping the chat stops the script.
  They run with your account's file and network access and are **not**
  sandboxed, which the approval prompt says plainly. Skills that can run code
  are flagged in the skill picker and gallery.
- The assistant can **add Python packages** a script needs. You see the exact
  list and approve it every time — this one is never skipped, because a
  mistyped package name looks perfectly ordinary and cannot be judged by
  reading it. Only package names and version specifiers are accepted; flags,
  paths, and URLs are refused.
- **Skills** for the AI assistant: reusable working modes you invoke by typing
  `/` in the chat. Five are built in — **Proofread**, **Fix Build**, **Continue
  Writing**, **Explain**, and **Find References** — and a skill stays active for
  that chat tab until you clear it, so "now do the next chapter" keeps working.
  A skill can restrict which tools the assistant may use, which is enforced on
  every call, not merely requested: **Explain** has no editing tools at all and
  cannot change your document even if asked to. Skills never bypass review —
  edits still arrive as diffs you accept or reject.
- Six research-workflow skills alongside the five editor ones: **Scientific
  Writing**, **Peer Review**, **Scientific Figures**, **Statistical Analysis**,
  **Literature Review**, and **Research Proposals**. Adapted from the
  MIT-licensed claude-scientific-skills collection and rewritten against Opal's
  own tools — the writing ones cannot run code, and Peer Review cannot reach
  any network tool, so an unpublished manuscript stays local.
- A skills gallery, from the activity rail, the chat drawer, or **Browse all
  skills…** in the `/` picker. It shows each skill's full instructions and
  exactly what tools it can reach before you use it, and lists any skill file
  that failed to load with the reason.
- Your own skills, written as Markdown files with a short frontmatter block, in
  `~/.tectonic/skills/` (yours everywhere) or `<project>/.tectonic/skills/`
  (shared with anyone who clones the project). Create one from a template,
  copy a built-in to customise it, or **Import** a `.md` file you found
  elsewhere — imports are checked and rejected with a reason rather than
  copied if they are not valid skills. See
  [docs/skills.md](apps/desktop/docs/skills.md).

- Citation cards in the PDF. Clicking a citation shows the reference it points
  at — title, authors, year, and venue — with a **DOI** link that opens the
  published record in a browser, **Go to reference** for the jump to the
  bibliography that clicking a citation used to perform, and **Edit entry** to
  open the entry's own `.bib` source in the editor. The card stays up
  until you click elsewhere or press `Esc`. Keys with no matching entry are
  named as such, which makes a stale citation visible while reading or
  reviewing. Requires the `hyperref` package, which links citations in the
  compiled PDF. References are read from the project's `.bib` files, or from a
  `thebibliography` environment when the document has no `.bib` file.
- Back and forward navigation in the PDF pane (`Alt` + `Left` / `Right`, or the
  arrows on the PDF toolbar), which return you to where a jump started. Reading
  position is restored, not just the page. Following a citation to the
  bibliography, opening an outline entry, and typing a page number are all
  undoable this way; stepping page by page is not, since that is closer to
  scrolling.

## [1.4.7] - 2026-07-30

Opal 1.4.7 is an urgent fix for runaway memory growth that could crash the app
("Out of Memory") while a compiled PDF was open. Every release since 1.2.0 is
affected; updating is strongly recommended.

### Fixed

- A ResizeObserver feedback loop kept the PDF preview re-rendering roughly
  twenty times per second whenever a PDF was open — even while idle. The
  churned memory was never reclaimed, so long reading sessions grew by
  gigabytes until the renderer was killed, and even short sessions burned CPU
  and battery. The loop is fixed at its source, and page re-renders no longer
  cascade through every page of the document.
- MuPDF's decoded-image store is now trimmed periodically during rendering
  instead of only when a document closes, so reading a figure-heavy document
  no longer grows the engine's memory without bound.

### Added

- A memory watchdog now monitors the real renderer process from outside the
  WebView. Under sustained pressure it first trims caches and switches to
  Lightweight PDF preview (with a notice); in the unlikely event memory keeps
  climbing it restarts the PDF engine and reopens the document in place —
  a brief re-render instead of a crash.

## [1.4.6] - 2026-07-28

Opal 1.4.6 makes the compiled PDF a first-class thing to read and search, and
repairs PDF text extraction, which had been returning nothing.

### Added

- Find in the PDF (`Ctrl`/`Cmd` + `F` with the PDF pane focused, or the search
  button on the PDF toolbar). Matches are highlighted across the whole
  document, with next/previous navigation and a match counter; results stream
  in as the document is swept, so long documents stay responsive.
- A **PDF** view in the outline panel, listing the compiled document's own
  bookmarks with their page numbers. Clicking an entry jumps the preview to
  that page. This complements the existing source-derived outline, and works
  even when SyncTeX data is stale. Requires the `hyperref` package, which
  writes the bookmarks.
- Word count of the compiled PDF, from the status bar's word counter. Clicking
  it counts what actually reached the page — excluding LaTeX markup, the
  preamble, and comments — which is what thesis and journal word limits mean.
  Words hyphenated across a line break are counted once. Clicking again
  switches back to the LaTeX source count, and recompiling resets it.
- **Copy** on the toolbar that appears when text is selected in the PDF.
- Code folding in the editor, for sections, environments, and comment blocks,
  via the new fold gutter. `.bib` files fold per entry and gained bracket
  matching and auto-closing brackets.
- `Ctrl`/`Cmd` + `D` selects the next occurrence of the current selection, and
  `F3` / `Shift` + `F3` step through matches of the current search. Alt-drag
  makes a rectangular (column) selection.
- Reader mode (`Ctrl`/`Cmd` + `Shift` + `R`, or the button on the PDF pane):
  hides the editor and gives the PDF the full workspace next to the activity
  rail and side panel. Clicking an outline entry jumps the PDF to that section
  via SyncTeX, so the outline works as a table of contents for reading.
  Double-clicking the PDF (or navigating to a source location) brings the
  editor back at the matching line.

### Improved

- Pages now render straight into MuPDF's RGBA output instead of being
  converted pixel by pixel in JavaScript, cutting a few million operations per
  page render.

### Fixed

- Restored text extraction from the compiled PDF. The reader for MuPDF's
  structured-text output still expected an older nested format, so every line
  came back empty — leaving the PDF's selection layer with nothing in it, so
  selecting text, **Copy selected text**, and **Capture & Ask** all returned
  nothing. Text lines are also positioned on their true baseline now instead
  of a descender height too low.
- Fixed `\today` and other date commands rendering as 1 January 1970. Tectonic
  defaults its session clock to the Unix epoch when no build date is supplied,
  so compiles now pass the current time (or `SOURCE_DATE_EPOCH` when it is set
  to a valid timestamp, keeping reproducible builds reproducible).

## [1.4.2] - 2026-07-23

Opal 1.4.2 delivers portable Windows, Linux, and macOS packages built and
verified through the gated release pipeline.

### Added

- Added unsigned macOS builds for Apple Silicon and Intel. Because these are
  not signed with a paid Apple Developer ID, macOS blocks them on first launch;
  run `xattr -cr /Applications/Opal.app` or right-click the app and choose
  **Open** to get past Gatekeeper.

### Fixed

- Linked Tectonic's ICU, HarfBuzz, Graphite2, FreeType, and Fontconfig
  dependencies statically from vcpkg on Linux and macOS so the packages no
  longer depend on library versions from the build machine and run on a clean
  system.
- Restored a working Linux release build after a vcpkg baseline change
  (autotools for the gperf/fontconfig ports, C++17 for the ICU headers, and a
  complete static link closure resolved through pkg-config).
- Corrected the Windows MSI version for prerelease builds, whose non-numeric
  identifiers the installer rejected.

### Release verification

- Native dependency and architecture audits for Linux and macOS release
  binaries, rejecting non-portable dependencies.
- Clean Ubuntu 22.04 and Ubuntu 24.04 checks that install, launch, and compile
  a LaTeX document with both the AppImage and Debian package.
- A local, CI-parity Docker harness (`scripts/ci-linux-repro/`) for
  reproducing the Linux release build without a GitHub Actions run.

### Package availability

- Windows, Linux (AppImage and Debian package), and unsigned macOS are
  included.
- Signed and notarized macOS distribution is deferred until it can be
  sponsored; RPM packaging is deferred until Fedora-native build and test jobs
  are available.

## [1.4.2-rc.1] - 2026-07-23

This prerelease is the first portable Linux-package candidate. It is intended
for compatibility testing before a stable Windows/Linux release.

### Fixed

- Rebuilt Tectonic's ICU, HarfBuzz, Graphite2, FreeType, Fontconfig, and
  OpenSSL dependencies for static linkage so the Debian package no longer
  depends on library versions installed on the build runner.
- Prevented release builds from producing an Ubuntu-built RPM with incomplete
  Fedora dependency metadata.

### Release verification

- Added native dependency and architecture audits for Linux release binaries.
- Added clean Ubuntu 22.04 and Ubuntu 24.04 checks that install, launch, and
  compile a LaTeX document with both the AppImage and Debian package.
- Changed release automation to stage artifacts in a private draft until all
  required verification and updater-manifest steps are complete.

### Package availability

- Windows remains supported and included in the release candidate.
- macOS packaging is deferred until signed and notarized distribution can be
  sponsored.
- RPM packaging is deferred until Fedora-native build and test jobs are
  available.

## [1.4.1] - 2026-07-23

Opal 1.4.1 strengthens compilation, PDF review, and everyday project editing,
with particular attention to large documents and lower-memory systems.

### Added

- Added a draft compilation mode with clearer progress feedback while a
  document is building.
- Added automatic LaTeX formatting on save, plus a manual **Format document**
  action.
- Added direct clipboard-image pasting into the figure workflow, including a
  preview and editable filename before insertion.
- Added contextual file-browser actions, including revealing project items in
  the operating system's file manager.
- Added a lightweight PDF preview option for lower-memory or lower-power
  systems.

### Improved

- Expanded PDF review with reviewer names, coloured highlights, replies,
  improved comment navigation, and review export support.
- Made recent-project discovery and last-modified information more robust.
- Improved compilation diagnostics with clearer explanations and guidance for
  common LaTeX errors.
- Improved main-document resolution and save-to-compile behaviour in
  multi-file projects.
- Reduced PDF rendering memory pressure with safer page limits, leaner
  off-screen rendering, and memory guardrails.
- Widened the Settings dialog to make the growing set of options easier to
  navigate.

### Fixed

- Fixed project-wizard state handling and project-root resolution edge cases.
- Fixed missing compile errors and several preview state inconsistencies.
- Fixed LaTeX onboarding reset behaviour.

## [1.4.0] - 2026-07-20

Opal 1.4 is the first release under the **Opal** name—formerly
TectonicEditor. It brings a calmer identity, a much stronger references
workflow, a gentler path for LaTeX beginners, and more capable editing tools
without changing the core promise: local compilation, no required account,
and optional AI that stays under your control.

Opal remains free and open-source software under the MIT License.

### Highlights

#### Meet Opal

The application now has a new name, icon, package namespace, window identity,
documentation site, and release presentation. Existing project structure and
Opal-managed `.tectonic-editor` data remain compatible.

#### A gentler way to learn LaTeX

A new 15-step **Learn LaTeX** guide starts with the workspace and your first
compile, then introduces document structure, formatting, packages, lists,
figures, tables, equations, citations, and cross-references. Each lesson can
insert an example, but learners can always type it themselves or move ahead at
their own pace.

#### One home for references

The redesigned references workspace can scan bibliographies across a project,
connect to Zotero, link JabRef or other external BibTeX libraries, and refresh
CiteDrive bibliographies. It can also:

- Resolve DOI, ISBN, and arXiv identifiers through Crossref, Open Library, and
  arXiv.
- Find and clean up duplicate bibliography entries.
- Discover missing citations and assist with reference lookup.
- Preserve project copies when working with externally managed `.bib` files.

#### A more fluid writing workspace

- Work across multiple files with editor tabs.
- Use richer context menus for LaTeX and bibliography editing.
- Navigate the project tree by keyboard.
- Build and revise tables with improved row, column, cell, alignment, and
  preview controls.
- Move through a more consistent sidebar, editor toolbar, and PDF preview.
- Review optional LanguageTool grammar and style suggestions in a dedicated
  panel.

#### AI remains optional—and more useful when invited

Opal can now inspect project structure and compile output, apply focused
document changes, help locate missing references, and explain compilation
errors. You still choose the provider, what context to send, and whether to
accept every proposed edit.

### Also included

- A new responsive project landing page with platform-aware downloads.
- Improved onboarding, appearance controls, and beginner-friendly guidance.
- More reliable BibTeX parsing and cleanup for escaped, malformed, or untidy
  entries.
- Corrected split-view behaviour, PDF preview control states, and release
  asset links.

### Download

Choose the installer for your platform from the release assets below. Opal is
available for macOS, Windows, and Linux.

## [1.3.0] - 2026-07-18

### Added

- PDF review mode with a focused proofing layout, persistent text and point
  comments, highlights, comment resolution, and source navigation.
- Context-aware right-click menus for the editor and PDF preview, including
  bidirectional SyncTeX navigation.
- Semantic LaTeX editing tools for tables, figures, mathematics, citations,
  cross-references, environments, and bibliography entries.
- Bibliography import, document health checks, and inline citation and
  cross-reference editing.
- Project-wide search and import from LaTeX ZIP archives or public GitHub
  repositories.
- Overleaf-style Tab completion for common LaTeX commands, with automatic argument braces and navigable fields for multi-argument commands.
- Command palette (`⌘K` / `Ctrl+K`) for compiling, toggling panels, switching files, changing theme, and opening settings.
- Editor status bar showing compile status, error/warning counts, active file, word count, and compiler backend.
- Unified Settings dialog (appearance, editor, AI provider, Python environment), reachable from the launch screen and the workspace activity rail.
- Additional editor themes, resizable dialogs, structured figure and table
  forms, and a guided beginner workspace.
- Bring-your-own-key AI provider configuration, connection testing, and a
  more reliable multi-step tool-calling loop.

### Changed

- Refined the workspace around a calmer editor, activity rail, document
  outline, and optional focused PDF review surface.
- AI is now clearly peripheral: removed the "AI-powered" framing from the launch screen and moved provider configuration into Settings.
- Renamed the internal chat surface from `claude-chat` to `ai-chat` (provider-agnostic; no behavior change).
- Migrated the project build cache from `.prism/build` to `.tectonic-editor/build` (one-time automatic migration on first compile).
- The Python (`uv`) environment is now opt-in and no longer auto-runs on project open.

### Fixed

- Repaired interrupted tool-call history before sending it to OpenAI-compatible APIs such as DeepSeek, preventing 400 errors about missing `tool_call_id` results.
- Improved compile error handling, DeepSeek compatibility, and LaTeX comment
  escaping.

### Removed

- Removed the bundled Claude Code CLI integration (install/login/session management); AI now uses the Anthropic and OpenAI API providers only.
- Removed the scientific-skills and slash-command features inherited from the `claude-prism` fork.
- Removed orphaned fork demo assets and unused platform icons.

## [1.2.0]

### Changed

- Reframed the project as TectonicEditor: an offline-first LaTeX editor with optional pluggable AI providers.
- Renamed packages and release metadata under the `@tectonic-editor` namespace.
