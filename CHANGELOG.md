# Changelog

## [Unreleased]

### Added

- Citation cards in the PDF. Clicking a citation shows the reference it points
  at — title, authors, year, and venue — with a **DOI** link that opens the
  published record in a browser, and **Go to reference** for the jump to the
  bibliography that clicking a citation used to perform. The card stays up
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
