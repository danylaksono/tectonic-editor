# Writing skills

A **skill** is a reusable working mode for the AI assistant: a Markdown file
whose instructions are added to the assistant's prompt while the skill is
active, plus a little metadata.

Type `/` at the start of the chat box to pick one. The active skill stays on for
that chat tab until you clear it, so a follow-up like "now the next chapter"
still works. Clear it with the `x` on the chip next to the model picker.

A skill is text, not code. It cannot edit your document by itself and it cannot
bypass review — the assistant's edits still arrive as diffs you accept or
reject, one chunk at a time.

## Where skills live

| Location | Applies to | Committed with your project? |
| --- | --- | --- |
| Built-in | Always available | — |
| `~/.tectonic/skills/` | You, in every project | No |
| `<project>/.tectonic/skills/` | This project | Yes |

Two layouts work in either location:

- **A single file** — `proofread.md`.
- **A folder** — `proofread/SKILL.md`, which may also carry `references/`,
  `scripts/` and `assets/`. This is the layout used by the open Agent Skills
  standard, so a skill written for another tool can be dropped in as-is.

If two skills share a name, the project one wins, then yours, then the built-in.
The gallery marks a skill that is overriding another.

`.tectonic/` is not the same directory as `.tectonic-editor/`. The latter holds
machine-local state (build cache, version history), is gitignored, and is
stripped from exported archives — skills go in `.tectonic/` so that cloning the
project brings them along.

## File format

````markdown
---
description: Fix grammar, spelling and style without changing meaning
icon: spell-check
tools: [read_file, search_project, propose_edit]
---

You are proofreading the user's LaTeX prose.

- Do not change the meaning, the argument, or the author's voice.
- Do not restructure sections, and do not touch the preamble.
- Propose one edit per paragraph you change, so each can be accepted
  or rejected independently.
- Leave `\cite`, `\ref`, and all math untouched.
````

Everything after the closing `---` is the instruction body, and it is the whole
point of the file — write it as if briefing a careful collaborator.

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `description` | **yes** | One line, shown in the picker and gallery |
| `name` | no | The `/name` you type. Defaults to the filename, so `proofread.md` needs no `name:` |
| `title` | no | Display name. Defaults to the name prettified (`fix-build` → "Fix Build") |
| `icon` | no | One of `spell-check`, `wrench`, `pen-line`, `help-circle`, `book-marked`, `sparkles` |
| `tools` | no | Which tools the assistant may use. Omit for all of them |
| `model` | no | Model to switch to when the skill is activated. You can still change it |

Names are lowercase kebab-case (`fix-build`). Values may be quoted; `#` starts a
comment unless the value is quoted. Lists work inline (`[a, b]`) or as a block:

```yaml
tools:
  - read_file
  - propose_edit
```

### Restricting tools

`tools:` is an allowlist — a skill can only ever *narrow* what the assistant can
do, never widen it. Calls to anything outside the list are blocked when they are
attempted, not merely omitted from the request, so the restriction holds even if
the model tries.

| Tool | What it does |
| --- | --- |
| `list_files` | List the project's files |
| `read_file` | Read a file, including unsaved edits |
| `search_project` | Search all text files |
| `propose_edit` | Propose a change for you to review |
| `compile_document` | Compile and report the result |
| `read_build_log` | Read the full engine log |
| `check_citations` | Cross-check `\cite` keys against `.bib` entries |
| `search_references` | Search for a reference by title/author/year |
| `lookup_reference` | Verify a DOI, arXiv ID, or ISBN |
| `add_citation` | Add a resolver-verified `.bib` entry |
| `run_python` | Run a Python script in the project's environment — **you approve each script before it runs** |
| `install_python_packages` | Add Python dependencies a script needs — **you approve the exact list every time** |
| `read_skill_file` | Read a file bundled with the skill itself (folder skills only) |

Two useful shapes:

- **Read-only advice:** `tools: [read_file, search_project, list_files]` — no
  `propose_edit`, so the skill cannot change anything. This is how the built-in
  **Explain** works.
- **No tools at all:** `tools: []` — chat replies only.

A `tools:` list naming only unknown tools resolves to *no* tools rather than all
of them: a typo must never quietly widen a skill's reach. The gallery shows a
warning when this happens.

### Skills that run code

`run_python` is different in kind from the others: it acts outside the document.
A skill that declares it — or that declares no `tools:` at all, and so gets
everything — is marked with an amber shield in the `/` picker and carries a
warning in the gallery.

Every script is shown to you in full and runs only when you click **Run**. It
then runs with your account's file and network access; a virtual environment
isolates *dependencies*, not access, and Opal does not sandbox it. Approving a
script means you have read it.

If a skill does not need to compute anything, leave `run_python` out. Most
writing skills should.

### Bundled files

A folder skill can ship reference documents and example scripts beside its
`SKILL.md`. Their paths are appended to the skill's instructions automatically,
so the assistant knows what exists, and it reads them with `read_skill_file`.

Reads are confined to the skill's own folder: relative paths only, no `..`, no
absolute paths. `read_skill_file` cannot see project files and `read_file`
cannot see skill files — the two scopes stay separate.

## What's built in

Eleven skills ship with Opal. Five cover the editor itself — **Proofread**,
**Fix Build**, **Continue Writing**, **Explain**, **Find References** — and six
cover research workflow: **Scientific Writing**, **Peer Review**, **Scientific
Figures**, **Statistical Analysis**, **Literature Review**, and **Research
Proposals**.

The research set is adapted from the MIT-licensed
[claude-scientific-skills](https://github.com/K-Dense-AI/claude-scientific-skills)
collection, rewritten against Opal's own tools. That collection has around 158
skills, most of them wrappers around a specific Python library. If you want one
of those, download its folder and use **Import** — the loader understands the
`SKILL.md` layout they use.

## Adding a skill

From the gallery (activity rail, the chat drawer's library button, or **Browse
all skills…** in the `/` picker):

- **New** — opens an editor with a starter template. Set the file name, write
  the skill, then **Save**. Nothing is written until you save, so cancelling
  leaves no stray file.
- **Edit** — opens any of your own skills for editing, right in the gallery.
  Saving checks the file still parses and refuses with the reason if not, so a
  slip in the frontmatter cannot silently remove a skill.
- **Delete** — removes one of your own skills. Click once to arm, once to
  confirm. For a folder skill the whole folder goes, bundled files included.
- **Copy to your skills** — duplicates a built-in so you can customise it.
  Built-ins are read-only, so this is how you change one.
- **Import** — pick `.md` files from disk.
- **Open folder** — drop files in yourself, then **Reload**.

### Using a skill you found online

Download the `.md` file, then **Import** it. Read the instructions in the
gallery's preview before you use it — that is what the preview is for.

There is deliberately no install-from-URL. A skill body is instructions given to
an assistant holding editing and citation tools, so a one-click install from a
link is not a step worth having; downloading and looking at the file first is.
Import checks that a file really is a skill and refuses it with a reason rather
than copying it, so a stray README cannot end up in your skills folder.

What a hostile skill cannot do: edit files without your review, run a script or
install a package without your approval, or grant itself tools it was not given.
What it could still try: talk the assistant into proposing changes you did not
ask for, or into writing a script that does something you would not want.
Reading what you approve — diffs, scripts, package lists — is the protection.

That last point matters more for a skill that declares `run_python`. An edit you
accept can be undone from version history; a script you run cannot.

## Troubleshooting

**My skill does not appear.** Press **Reload** in the gallery. If the file
failed to parse it is listed under **Not loaded** with the reason — a missing
`description`, an empty body, or a line the parser could not read.

**The chip says "(missing)".** The active skill's file was deleted or renamed.
Messages are being sent as ordinary chat. Clear the chip or reload.

**`/` does not open the picker.** It only triggers at the very start of an empty
message, with no spaces yet — otherwise every slash in your LaTeX would open it.
