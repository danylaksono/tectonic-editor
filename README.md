<p align="center">
  <img src="./apps/desktop/src-tauri/icons/icon.png" width="120" height="120" alt="Opal" />
</p>

<h1 align="center">Opal</h1>

<p align="center">
  A beautiful, offline-first LaTeX editor<br/>
  Compile locally. Add AI when you want it. No accounts required.
</p>

<p align="center"><sub><em>Formerly Tectonic Editor.</em></sub></p>

---

Opal compiles LaTeX documents offline with an embedded [Tectonic](https://tectonic-typesetting.github.io/) engine. AI is **optional** and pluggable: bring your own API key for Anthropic, OpenAI, or any OpenAI-compatible endpoint.

**You stay the author.** Opal never writes, cites, or restructures on its own. Every AI edit, citation, and reference is yours to approve, change, or reject before anything lands in your document. Leave the assistant switched off entirely and Opal is simply a fast, focused LaTeX editor. New to LaTeX? A built-in guide eases you in one construct at a time.

## Why?

The editor is designed for **researchers, scientists, and academics** who want a **beautiful, offline-first LaTeX editor** with optional AI assistance. It is **cross-platform** (macOS, Windows, Linux) and **open-source**. It was forked from [Claude-prism](https://github.com/delibae/claude-prism), which blends Claude Code with a LaTeX editor — Opal keeps the offline editing experience but makes AI assistance fully optional, so you can compile LaTeX without an account or an internet connection.

## Features

**Editor** — CodeMirror 6 with LaTeX/BibTeX highlighting, real-time linting, multi-file tabs, regex and project-wide search, vim mode, dark/light themes, auto-save.

**PDF Preview** — Native MuPDF rendering with SyncTeX. Click in the PDF to jump to the source line, and back. Zoom, select, capture regions.

**Offline Compilation** — Tectonic is embedded. Packages download once, then everything compiles without internet. Compile errors are surfaced inline — and can be explained by the AI on request.

**Writing tools** — A visual **table editor**, an **equation editor**, and one-click pickers for **citations**, **cross-references**, and **figures** — insert the right markup without memorizing it.

**Learn LaTeX** _(for newcomers)_ — A built-in guided track that teaches one construct at a time — document structure, figures, tables, maths, citations — building up a sample document as you follow along. It can insert each piece for you, but you're always free to type it yourself; the guide never blocks your progress.

**Grammar & style** _(optional)_ — Built-in [LanguageTool](https://languagetool.org/) integration flags grammar and style issues in a dedicated panel.

**References** — Manage your bibliography with duplicate detection, import from Zotero, paste raw BibTeX, or pull entries from external sources (Crossref, arXiv, Open Library).

**Version History** — Saving takes a Git snapshot (and the AI snapshots before it edits). Label checkpoints, browse diffs, and restore any version.

**AI Assistant** _(optional)_ — Choose your provider, then pick a **scope** (selection, file, chapter, project) and **action** (chat, proofread, fix, complete, explain). The AI only sees what you send, and you always stay the author.

**Python Environment** _(optional)_ — Set it up from Settings when you need it: a one-click [uv](https://docs.astral.sh/uv/) install creates a `.venv` so you can run scripts, generate plots, and process data without leaving the app.

**Project Import** — Open Overleaf downloads and other LaTeX ZIP archives, or import the default branch of a public GitHub repository.

**More** — Project health checks; a template gallery (research paper, IEEE/ACM, thesis, Beamer slides, poster, CV, letter, book, and more); capture & ask; and open-in external editor support (VS Code, Cursor, Zed, Sublime Text).

## AI Providers

| Provider      | Setup                                             |
| ------------- | ------------------------------------------------- |
| None          | Default — editor works standalone                 |
| Anthropic API | Set `ANTHROPIC_API_KEY`                           |
| OpenAI API    | Set `OPENAI_API_KEY` + optional `OPENAI_BASE_URL` |

## Install

Download from [GitHub Releases](https://github.com/danylaksono/opal-editor/releases).

## Develop

```bash
# Prerequisites: pnpm 10+, Rust stable, Tectonic system deps
# macOS:   brew install icu4c harfbuzz pkg-config
# Linux:   apt install libicu-dev libgraphite2-dev libharfbuzz-dev libfreetype-dev libfontconfig-dev

pnpm install
pnpm dev:desktop       # dev mode (Vite + Tauri)
pnpm build:desktop     # production build
pnpm lint              # Biome linter
pnpm --filter @opal/desktop test   # Vitest
```

On Windows, run the setup once:

```powershell
.\scripts\build-windows.ps1 -SetupOnly
```

Then use the launcher, which configures the native Tectonic environment for the current process:

```powershell
.\scripts\dev-windows.ps1
```

## Architecture

```
apps/desktop/
├── src/                    # React + TypeScript frontend
│   ├── lib/ai/             # AI provider types, SSE parser
│   ├── stores/             # Zustand state management
│   ├── hooks/              # Custom hooks
│   └── components/         # UI components
└── src-tauri/              # Rust backend (Tauri 2)
    └── src/
        ├── ai/             # AiProvider trait + registry + providers
        ├── latex.rs        # Tectonic compilation & SyncTeX
        ├── history.rs      # Git version history
        ├── reference_sources.rs # Crossref / arXiv / Open Library lookup
        ├── metadata.rs     # Bibliography metadata resolution & cache
        ├── project_import.rs # ZIP and public GitHub project import
        ├── zotero.rs       # Zotero OAuth integration
        └── lib.rs          # Tauri command registration
```

New AI providers implement the `AiProvider` trait. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## Author

**Dany Laksono** — [@danylaksono](https://github.com/danylaksono), based upon the work of Claude-prism's contributors.

## Acknowledgments

Forked from [Claude-prism](https://github.com/delibae/claude-prism) by [delibae](https://github.com/delibae). The project itself is inspired by [Open Prism](https://github.com/assistant-ui/open-prism) by [assistant-ui](https://github.com/assistant-ui).

## License

[MIT](./LICENSE)
