# Skills v1 — Spec

> **Status: implemented.** All seven steps in §8 have shipped. This document is
> kept as the design record — where it and the code disagree, the code is right.
> For how to *write* a skill, see [skills.md](skills.md).
>
> Deviations from the spec as written, and why, are noted inline: `name` became
> optional (§1), `resolve_system_prompt` takes owned `Option<String>`s (§5.2),
> and `lib/ai/tool-names.ts` was added (§5.1). Two things went beyond it:
> out-of-allowlist tool calls are blocked at execution rather than only omitted
> from the request, and the gallery gained file management (new / duplicate /
> import) so skills can be added without leaving the app.

Roadmap item 6. Goal: reusable, user-authored working modes for the AI chat,
invoked with `/` in the composer, browsable in a gallery, shippable as plain
Markdown files.

Guiding constraint (unchanged): **the user stays the author**. A skill is prompt
text plus metadata. It can never apply an edit — `propose_edit` still routes
through the merge-view review flow. A skill can *narrow* the tool set, never
extend it.

---

## 1. What a skill is

A Markdown file with YAML-ish frontmatter:

```md
---
name: proofread
title: Proofread
description: Fix grammar, spelling and style without changing meaning
icon: spell-check          # optional, lucide icon name
tools: [read_file, search_project, propose_edit]   # optional allowlist
model: claude-sonnet-5     # optional suggested model
---

You are proofreading the user's LaTeX prose.

- Do not change the meaning, argument, or voice.
- Do not restructure sections or touch the preamble.
- Propose one `propose_edit` per paragraph you change, so each can be
  accepted or rejected independently.
- Leave `\cite`, `\ref`, and math untouched.
```

The body is appended to the base system prompt for every turn while the skill
is active (including tool-loop continuations).

Field rules:

| field | required | notes |
| --- | --- | --- |
| `name` | no | kebab-case, unique within a source; the `/name` invocation token. Defaults to the file stem, so `proofread.md` needs no `name:` line |
| `title` | no | defaults to `name` prettified |
| `description` | yes | one line, shown in picker + gallery |
| `icon` | no | lucide name; falls back to `SparklesIcon` |
| `tools` | no | subset of `AI_TOOL_DEFINITIONS` names; unknown names = parse warning |
| `model` | no | pre-selects a model when the skill is activated; user can override |

Everything after the closing `---` is the body. Empty body = invalid.

## 2. Where skills live

Three sources, precedence **project > user > built-in** (same `name` wins by
precedence; the shadowed one is still listed in the gallery, greyed, labelled
"overridden by project").

| source | location | notes |
| --- | --- | --- |
| built-in | bundled TS in `lib/skills/builtin.ts` | no disk I/O, always available |
| user | `~/.tectonic/skills/*.md` | sits next to the existing `~/.tectonic/.env` ([lib.rs:580](apps/desktop/src-tauri/src/lib.rs#L580)) |
| project | `<project>/.tectonic/skills/*.md` | committed with the project, shared with collaborators |

**Directory choice, flagged:** the roadmap note said `.tectonic/skills`, and I
think that's right *and* worth stating explicitly, because the repo already has
`.tectonic-editor/`. The split becomes:

- `.tectonic-editor/` = machine-local state (build cache, version history) — it
  is auto-added to `.gitignore` ([history.rs:133](apps/desktop/src-tauri/src/history.rs#L133))
  and stripped from export zips ([export.rs:132](apps/desktop/src-tauri/src/export.rs#L132)).
- `.tectonic/` = shareable project config, committed.

Skills are authored content that a co-author should get on clone, so they must
not live in the gitignored dir. Both are dot-dirs, so both stay hidden from the
file tree ([latex.rs:506](apps/desktop/src-tauri/src/latex.rs#L506) filters
hidden dirs).

Subdirectories are not scanned in v1 (flat glob only).

## 3. Invocation

### 3.1 `/` picker in the composer

- Trigger: `/` typed at position 0 of an empty-or-whitespace composer (mirrors
  the existing `@` mention trigger at [chat-composer.tsx:570](apps/desktop/src/components/ai-chat/chat-composer.tsx#L570),
  but stricter — `/` mid-sentence is literal text, since LaTeX prose is full of
  slashes).
- Renders the same dropdown shell as the `@` mention list (Arrow/Enter/Tab/Esc
  handling already exists at [chat-composer.tsx:517-538](apps/desktop/src/components/ai-chat/chat-composer.tsx#L517-L538)).
- Fuzzy-ranked. The scoring functions already exist, orphaned, inside
  [fuzzy-search.test.ts](apps/desktop/src/lib/fuzzy-search.test.ts) — that file
  is a leftover from the deleted `claude-prism` slash picker (`f0706ea`) and
  currently tests a *copy* of functions that no longer have a home. Promote them
  to `lib/fuzzy-search.ts` and have the test import them. Free, and it repairs a
  broken test file.
- Selecting a skill: strips the `/query` text and sets the tab's active skill.

### 3.2 Active-skill chip

The active skill shows as a chip in the composer toolbar row, next to the model
picker, with an `x` to clear. It is **sticky per tab** — a skill is a working
mode, not a one-shot message decorator, and stickiness is what makes
"proofread this chapter, now the next one" work without re-invoking.

### 3.3 Gallery

Entry points: a button in the chat drawer header, and a "Browse all…" footer row
in the `/` picker.

Panel contents:

- List grouped by source (Built-in / User / Project) with title, description, icon.
- Preview pane showing the **full rendered body** — required, because activating
  a skill is accepting instructions into the system prompt. Nothing gets
  activated from a one-line description alone.
- Actions: `Activate`, `Duplicate to user skills`, `Duplicate to project skills`,
  `Open folder` (reveal in OS), `New skill` (writes a commented template),
  `Reload`.
- Built-ins are read-only; `Duplicate` is how you customise one.

## 4. Built-in skills (v1 set)

These replace the composer's **Action picker**, which is dead UI today —
`AiContext.action` is sent to Rust but never read ([types.ts:17](apps/desktop/src/lib/ai/types.ts#L17),
picker at [chat-composer.tsx:739-790](apps/desktop/src/components/ai-chat/chat-composer.tsx#L739-L790)).
Deleting it is part of this change; "no skill" = plain chat.

| name | replaces | tools |
| --- | --- | --- |
| `proofread` | action: proofread | read_file, search_project, propose_edit |
| `fix-build` | action: fix | all (needs compile_document, read_build_log) |
| `continue-writing` | action: complete | read_file, search_project, propose_edit |
| `explain` | action: explain | read_file, search_project *(read-only — cannot propose)* |
| `find-references` | — | search_references, lookup_reference, check_citations, add_citation |

`explain` being unable to propose edits is the clearest demonstration of why the
`tools` allowlist earns its place.

**Not touched:** the Scope picker. `AiContext.scope` is equally unread by Rust,
but wiring scope into real context assembly is its own task; skills do not
declare scope in v1. Left as a known gap.

## 5. Implementation

### 5.1 New files

| file | contents |
| --- | --- |
| `lib/skills/types.ts` | `Skill`, `SkillSource`, `SkillParseError` |
| `lib/skills/parse.ts` | frontmatter parser + validation |
| `lib/skills/builtin.ts` | the five built-ins as literals |
| `lib/skills/load.ts` | disk scan of the two dirs, precedence merge |
| `lib/ai/tool-names.ts` | tool-name list, split out so `parse.ts` need not import `tools.ts` (and the store chain behind it); a test asserts the two stay in sync |
| `lib/fuzzy-search.ts` | promoted from the orphan test |
| `stores/skills-store.ts` | `skills`, `errors`, `loadSkills()`, `isLoading` |
| `components/ai-chat/skill-picker.tsx` | the `/` dropdown |
| `components/ai-chat/skill-gallery.tsx` | the gallery panel |

**No YAML dependency.** `apps/desktop/package.json` has none, and the frontmatter
subset needed (bare strings, quoted strings, inline `[a, b]` arrays) is ~60 lines
of hand-rolled parsing with unit tests — cheaper and safer than adding a parser
for five fields.

### 5.2 Wiring the prompt

`AiRequest.systemPrompt` already flows to both providers, but it **replaces** the
base prompt ([anthropic.rs:68](apps/desktop/src-tauri/src/ai/providers/anthropic.rs#L68),
[openai.rs:52](apps/desktop/src-tauri/src/ai/providers/openai.rs#L52)). Sending a
skill through it would drop all the propose_edit / citation / compile-loop rules
in [providers/mod.rs:8](apps/desktop/src-tauri/src/ai/providers/mod.rs#L8), or
force the frontend to duplicate that text and let the two drift.

So: **add an appended field rather than reusing `systemPrompt`.**

```rust
// ai/mod.rs — AiRequest (already #[serde(rename_all = "camelCase")])
pub skill_prompt: Option<String>,

// providers/mod.rs
pub fn resolve_system_prompt(
    system_prompt: Option<String>,
    skill_prompt: Option<String>,
) -> String { /* base, then the skill appended under an "# Active skill" header */ }
```

It takes the two `Option<String>`s by value rather than `&AiRequest`: both
providers have already moved `request.model` out by that point, so borrowing the
whole struct would not compile. Moving two more fields out does, and the later
`&request.tools` borrow is unaffected.

Both providers call
`resolve_system_prompt(request.system_prompt, request.skill_prompt)`. That is the
entire Rust surface. Everything else is TypeScript.

### 5.3 Store changes

`TabState` ([ai-chat-store.ts:217](apps/desktop/src/stores/ai-chat-store.ts#L217))
gains `activeSkillName: string | null`. Both request builders must include the
resolved skill body and tool set:

- `sendPrompt` — [ai-chat-store.ts:533-560](apps/desktop/src/stores/ai-chat-store.ts#L533-L560)
- `_handleTurnComplete` continuation — [ai-chat-store.ts:851-858](apps/desktop/src/stores/ai-chat-store.ts#L851-L858)

Extract one `buildAiRequest()` helper used by both, so a skill cannot silently
vanish mid-agent-loop. Tool filtering:

```ts
const tools = skill?.tools
  ? AI_TOOL_DEFINITIONS.filter((t) => skill.tools!.includes(t.name))
  : AI_TOOL_DEFINITIONS;
```

Resolution is by `name` at send time, so editing a skill file and reloading takes
effect on the next message without re-activating.

### 5.4 Loading

- On app start and on project open.
- On gallery open and on `/` picker open (a few dozen small files; no watcher).
- Malformed file → listed in the gallery with an error badge and the parse
  message, not activatable. Never silently dropped.

## 6. Security

Skill files are untrusted text and are a prompt-injection surface — a project
cloned from elsewhere can carry `.tectonic/skills/*.md`.

v1 mitigations:

- **No remote install.** No URL fetch, no registry, no import-from-link. Built-in
  plus local files only.
- Full body shown in the gallery preview before activation.
- Activation is always explicit and user-initiated; a project skill never
  auto-activates on project open.
- Skills cannot add tools, only remove them.
- The injected header (5.2) states the skill operates *within* the base rules.

Not solved in v1, worth stating: a hostile skill body can still try to talk the
model into pushing bad edits. The proposal-review flow is the backstop — every
edit still lands as a reviewable diff.

## 7. Tests

- `lib/skills/parse.test.ts` — valid, missing `description`, empty body, unknown
  tool name, CRLF, unicode, no frontmatter.
- `lib/fuzzy-search.test.ts` — existing file, re-pointed at the real module.
- `lib/skills/load.test.ts` — precedence, name collisions, malformed file does
  not break the batch.
- `stores/ai-chat-skills.test.ts` — `skillPrompt` present in the initial request
  *and* in the tool-loop continuation; tool filtering applied; clearing works.

Existing suites to keep green: `ai-chat-agent-loop.test.ts`,
`ai-chat-send-prompt.test.ts`.

## 8. Sequencing

1. `lib/fuzzy-search.ts` promotion + test repair *(isolated, mergeable alone)*
2. Types, parser, built-ins, loader, store + tests *(no UI)*
3. Rust `skill_prompt` + `resolve_system_prompt`
4. `buildAiRequest()` extraction and skill wiring in `ai-chat-store`
5. `/` picker; delete the Action picker
6. Gallery panel
7. Docs: AGENTS.md note + CHANGELOG

Steps 1–4 are shippable without any user-visible change, which makes them
reviewable on their own.

## 9. Explicitly out of scope

- Skill marketplace / remote install
- Skills that run code or define new tools
- Per-skill conversation presets (temperature, max tokens)
- Auto-activation by file type or context
- Nested skill directories
- Wiring `AiContext.scope` into real context assembly
