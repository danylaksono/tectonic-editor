<p align="center">
  <img src="./apps/desktop/src-tauri/icons/icon.png" width="120" height="120" alt="TectonicEditor" />
</p>

<h1 align="center">TectonicEditor</h1>

<p align="center">
  A beautiful, offline-first LaTeX editor.<br/>
  Compile locally. Add AI when you want it. No accounts required.
</p>

---

TectonicEditor compiles LaTeX documents offline with an embedded [Tectonic](https://tectonic-typesetting.github.io/) engine — no TeX Live required. AI is **optional** and pluggable: bring your own API key for Anthropic, OpenAI (or any compatible endpoint like Hermes), or use the Claude Code CLI.

## Why?

The editor is designed for **researchers, scientists, and academics** who want a **beautiful, offline-first LaTeX editor** with optional AI assistance. It is **cross-platform** (macOS, Windows, Linux) and **open-source**. It was forked from [Claude-prism](delibae/claude-prism) which blends Claude Code with a LaTeX editor. I want to have the same editor experience but with optional AI assistance, so that users can compile LaTeX offline without needing an account or internet connection.

## Features

**Editor** — CodeMirror 6 with LaTeX/BibTeX highlighting, real-time linting, regex search, vim mode, dark/light themes, auto-save.

**PDF Preview** — Native MuPDF rendering with SyncTeX. Click in the PDF to jump to the source line. Zoom, select, capture.

**Offline Compilation** — Tectonic is embedded. Packages download once, then everything runs without internet.

**Version History** — Every save creates a Git snapshot. Label checkpoints, browse diffs, restore any version.

**AI Assistant** *(optional)* — Choose your provider, then pick a **scope** (selection, file, chapter, project) and **action** (chat, proofread, fix, complete, explain). The AI only sees what you send.

**Python Environment** — Built-in [uv](https://docs.astral.sh/uv/) setup. One click creates a `.venv`. Run scripts, generate plots, process data without leaving the app.

**More** — Zotero integration, template gallery (paper, thesis, slides, poster, letter), slash commands, capture & ask, external editor support (VS Code, Cursor, Zed, Sublime).

## AI Providers

| Provider | Setup |
|---|---|
| None | Default — editor works standalone |
| Anthropic API | Set `ANTHROPIC_API_KEY` |
| OpenAI API | Set `OPENAI_API_KEY` + optional `OPENAI_BASE_URL` |
| Claude Code CLI | Install the `claude` CLI locally |

## Install

Download from [GitHub Releases](https://github.com/danylaksono/tectonic-editor/releases).

## Develop

```bash
# Prerequisites: pnpm 10+, Rust stable, Tectonic system deps
# macOS:   brew install icu4c harfbuzz pkg-config
# Linux:   apt install libicu-dev libgraphite2-dev libharfbuzz-dev libfreetype-dev libfontconfig-dev
# Windows: see scripts/build-windows.ps1

pnpm install
pnpm dev:desktop       # dev mode (Vite + Tauri)
pnpm build:desktop     # production build
pnpm lint              # Biome linter
pnpm --filter @tectonic-editor/desktop test   # Vitest
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
        ├── zotero.rs       # Zotero OAuth integration
        └── lib.rs          # Tauri command registration
```

New AI providers implement the `AiProvider` trait. See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## Acknowledgments

Forked from [Claude-prism](https://github.com/delibae/claude-prism) by [delibae](https://github.com/delibae). The project itself is inspired by [Open Prism](https://github.com/assistant-ui/open-prism) by [assistant-ui](https://github.com/assistant-ui).

## License

[MIT](./LICENSE)
