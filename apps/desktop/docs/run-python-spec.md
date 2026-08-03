# `run_python` — Spec

Give the AI assistant the ability to execute Python in the project's virtual
environment. This unlocks figure generation, data analysis, and the large part
of the Agent Skills ecosystem that assumes a code-executing agent.

This is a bigger change in kind than any previous tool. Every existing tool
either reads, or proposes a change the user reviews. This one *acts*, with the
user's own filesystem access and network. The spec is therefore mostly about
consent and containment, not plumbing — the plumbing already exists.

---

## 1. What already exists

[uv.rs](../src-tauri/src/uv.rs) survived the claude-prism cleanup and is
registered in [lib.rs](../src-tauri/src/lib.rs):

| command | does | called from frontend? |
| --- | --- | --- |
| `check_uv_status` | finds uv, reports version | yes (settings) |
| `install_uv` | installs uv | yes (settings) |
| `setup_project_venv` | creates `<project>/.venv` | yes (settings) |
| `uv_add_packages` | `uv pip install` into the venv | **no** |
| `uv_run_command` | runs a command in the venv | **no** |

So the runtime is real, and roughly 60% wired. Python execution for the AI was
deliberately deprioritised in July 2026, not ruled out.

## 2. Findings that change the design

These came out of reading the existing code and are the reason this needs a
design pass rather than a quick tool definition.

### 2.1 `uv_run_command` is arbitrary command execution

```rust
let parts: Vec<&str> = command.split_whitespace().collect();
let program = parts.first()...;
let mut run_cmd = tokio::process::Command::new(program);
```

It runs *any* program, not Python — `uv_run_command("rm -rf ~", …)` is a valid
call. It is currently unreachable from the UI, which is the only reason this is
not already a live hazard. **It must not be exposed to the model as-is.**

Three further defects in it:

- **Whitespace splitting breaks real invocations.** `python -c "print('a b')"`
  is split into five tokens; quoting is not honoured.
- **No timeout.** `output().await` waits forever, so `while True: pass` hangs
  the call permanently.
- **No output cap.** A script printing gigabytes accumulates in memory — the
  same failure mode as the OOM bug fixed in 1.4.7.
- **No cancellation.** The child is not tracked, so stopping the chat cannot
  kill a running script.

### 2.2 `.venv` is excluded from the file tree but nothing else

`shouldSkipProjectDirectory` skips dotted directories, so `.venv` stays out of
the sidebar. But:

- **Version history**: `history-exclude` lists `.tectonic-editor/`, `.prism/`,
  `.claudeprism/` — **not** `.venv`. A snapshot is taken *before every AI edit*,
  so a 300 MB venv would be committed into history repeatedly.
- **Export**: `EXCLUDED_DIRECTORIES` is `[".git", "node_modules"]` — **not**
  `.venv`. Exported project zips would carry the whole environment.

Both must be fixed **before** anything encourages users to create venvs. This is
independent of the tool itself and can ship first.

## 3. Proposed tool surface

Two tools, mirroring how the existing ten are structured
([tools.ts](../src/lib/ai/tools.ts), dispatched in `executeAiTool`).

### `run_python`

```ts
{
  code: string;          // the script, not a command line
  description: string;   // one line, shown to the user in the approval prompt
}
```

Takes **code, not a command string** — this sidesteps §2.1's quoting bug
entirely and gives the user something readable to approve. Execution writes the
code to `.tectonic-editor/scripts/<hash>.py` and runs the venv's Python against
that path, so there is also an artifact to inspect afterwards.

Returns stdout, stderr, exit code, and a list of files created or modified in
the project (diffed around the run), truncated per §5.

### `install_python_packages`

```ts
{ packages: string[]; reason: string }
```

Wraps `uv_add_packages`. Separate from `run_python` because installing from PyPI
is a distinct trust decision — a typosquatted package name is a supply-chain
compromise, not a script the user can read and judge.

## 4. Consent model

**This is the decision that matters.** The project's stated principle is that
the user stays the author and AI changes are never silent. Executing code is a
larger action than editing a file, so it should be at least as reviewable.

Options considered:

| model | pro | con |
| --- | --- | --- |
| A. Free execution | no friction | incompatible with the review principle |
| B. Per-project opt-in, then free | one decision | a hostile skill runs freely after it |
| C. Approve every run | safest | an 8-round-trip loop needs 8 approvals |
| D. **Propose-and-review, like `propose_edit`** | consistent with the app | some friction |

**Recommendation: D.** `run_python` does not execute; it registers a *pending
script* that appears in the review UI showing the exact code. The user runs it
or rejects it, exactly as they accept or reject a diff. The model is told, as it
already is for edits, that an unapproved script has not run.

Softeners that keep an agent loop usable without giving up the principle:

- Re-running **byte-identical** code already approved in this session does not
  re-prompt. Iterating on a script re-prompts, because the code changed.
- A per-project **"run scripts without asking"** toggle, default off, surfaced
  where the venv is set up. Explicitly a power-user setting.
- Package installs always prompt, and are never covered by the toggle.

## 5. Limits

| limit | value | why |
| --- | --- | --- |
| Wall-clock timeout | 60 s default, configurable | §2.1 has none |
| stdout+stderr returned to model | 32 KB, truncated in the middle | keeps the transcript and token cost bounded |
| Output retained for the user | 1 MB | the panel can show more than the model needs |
| Concurrent scripts | 1 per project | avoids interleaved venv mutation |

Cancelling the chat must kill the child process. This needs the same child-handle
tracking the AI providers use for `ai_cancel`; `uv_run_command` has none today.

## 6. Sandboxing — what this does and does not give

**A venv is dependency isolation, not security isolation.** A script in the venv
can read `~/.ssh`, make network calls, and delete files outside the project.
`current_dir` is set to the project but absolute paths are unaffected.

Real containment differs per platform (Windows job objects/AppContainer, macOS
`sandbox-exec`, Linux bubblewrap/seccomp) and is a substantial cross-platform
project on its own.

**v1 should not claim to sandbox.** The control is user review plus explicit
consent, and the UI should say so plainly at the point of approval — something
like *"Scripts run with your account's access. Only run code you have read."*
Claiming containment we do not have would be worse than having none.

This is also why §7 of the skills spec — no install-from-URL — moves from
prudent to load-bearing the moment this ships.

## 7. Skills integration

With execution available, folder-shaped Agent Skills become usable, which needs:

- **Folder skills**: load `skills/<name>/SKILL.md` alongside the current flat
  `*.md`, keeping `assets/`, `references/`, `scripts/` next to it.
- **Skill-relative reads**: a skill body saying "see `references/foo.md`" needs
  a way to read within its own folder. `read_file` is project-scoped, so this
  is a new, read-only, skill-folder-scoped path — not a widening of `read_file`.
- **`tools:` gains `run_python` / `install_python_packages`**, so a skill can
  opt into execution — and, more importantly, most skills can leave it out.

## 8. Sequencing

1. ~~**Hygiene fixes** (§2.2)~~ **DONE** — `.venv/`, `venv/` and `__pycache__/`
   added to `history-exclude` (with a migration so existing projects pick it up)
   and to export's `EXCLUDED_DIRECTORIES`. Covered by two new Rust tests.
2. ~~**Harden `uv_run_command`**~~ **DONE** — replaced by `uv_run_python`
   (takes `code`, never a command string) plus `uv_cancel_python`. 60 s default
   timeout clamped to 600 s, 32 KB retained per stream with draining continued
   past the cap, child killed on timeout or cancel, script written to
   `.tectonic-editor/scripts/<fnv1a>.py` for inspection. The old command is
   gone, so the arbitrary-execution path no longer exists.
3. ~~**Pending-script store + review UI** (§4)~~ **DONE** —
   `stores/pending-scripts-store.ts` holds the promise gate, the
   already-approved-this-session shortcut and the 5-minute timeout;
   `PendingScriptCard` shows the full script above the composer. Cancelling the
   chat rejects anything still waiting.
4. ~~**`run_python` tool**~~ **DONE** — wired through `executeAiTool`. The call
   blocks on approval (question 1 answered: block the turn), the venv is created
   on first use (question 3), and the network is not restricted but is stated
   plainly at the approval prompt (question 2). Skills declaring it are flagged
   in both the picker and the gallery.
5. ~~**`install_python_packages`**~~ **DONE** — always prompts, never
   covered by the auto-approve toggle or the already-approved-script
   shortcut. Requirement specifiers are validated in both TS and Rust:
   `uv pip install` passes its arguments through, so an entry like
   `--index-url=http://evil.example` would have redirected the package
   index. The approval store was generalised to
   `pending-approvals-store` to carry both kinds.
6. **Folder skills + skill-relative reads** (§7).
7. Docs: skills.md gains an execution section; CHANGELOG.

Steps 1–2 are pure safety work with no user-visible feature, and are worth doing
even if the feature stalls.

## 9. Open questions

1. **Consent model** — is D (propose-and-review) right, or is it too much
   friction for the figure-generation workflow this is meant to enable?
2. **Where does script output go?** Reusing the Problems drawer, a new output
   panel, or inline in the chat transcript.
3. **Does the venv get created automatically** on first `run_python`, or must
   the user set it up in settings first? Automatic is smoother; explicit means
   no surprise 300 MB directory.
4. **Is network access from scripts acceptable in v1?** Many skills fetch from
   public databases, so blocking it removes much of the value — but it is also
   the main exfiltration path.
