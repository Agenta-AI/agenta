# Milestone 1 report: Codex runs in the playground with a managed key

Date: 2026-07-24. Audience: Mahmoud. Companion artifacts: `m1-playground-qa.mp4`
(the recording of the flow below) and `m1-implementation-notes.md` (full build log,
every implementation task, test commands, QA transcripts).

## What you can do right now

Open the worktree deployment at http://<dev-host>:8180, create an agent, and
pick **Codex** in the harness dialog. It appears between Pi and Claude Code with its
provider and five models listed, streams answers in the playground, and keeps
context across turns in a session. The recording shows the whole flow: harness
picked, model Luna selected, a two-turn conversation with the second turn correctly
recalling the first. Zero browser console errors through the session.

## What was built

Codex (gpt-5.6-sol) wrote the code task by task; Opus reviewed every diff; the
desloppify workflow and a simplify pass closed the milestone. Five local commits on
the worktree branch, nothing pushed.

- **SDK**: the Codex harness type and identity, the adapter mirroring the Claude
  one, a settings renderer that emits `.codex/config.toml` only when an author
  configures something (nothing rendered means no file, same rule as Claude), the
  capabilities entry, a curated model catalog for the current generation (Sol as
  default, Luna as cheapest, plus Terra, 5.5, and 5.2; the deprecated 5.1 family is
  excluded on purpose), a golden wire fixture, and the unit tests mirroring
  Claude's.
- **Runner**: credential preparation that writes the vault key into the session's
  `.codex/auth.json` with the same hygiene as the existing Pi assets (restrictive
  permissions, create-if-absent, delete-only-if-created plus a destroy backstop),
  the home-directory environment wiring, and an up-front rejection of Codex
  subscription runs with a message pointing to the later milestone, so nothing
  fails silently.

## The one real incident, and what it taught us

The first durable-session run hung. Root cause: Codex keeps internal state as
SQLite databases inside its home directory, and durable sessions put that home on
the S3-backed mount, which cannot support SQLite's write-ahead mode. The fix came
from probing rather than guessing: Codex has a supported switch
(`CODEX_SQLITE_HOME`) that relocates exactly the SQLite files, and a resume
experiment proved session continuity rides plain transcript files that are safe on
the mount (the same class of writes Claude's transcripts already do there). So the
approved layout stayed, one environment variable moved the state to local disk, and
the re-run passed: two turns on a real durable session, the codeword recalled, no
sqlite files on the mount. The residual worry (Codex runs a git operation in a
scratch folder on the mount) proved benign: git logs a warning about hard links and
degrades gracefully. The lesson is in the playbook: validate a harness's state
directory on the real mount filesystem, not a local temp dir.

## Test and quality status

- Python SDK: 680 agent unit tests green; ruff format and lint clean.
- Runner: 1,218 tests green across 78 files; typecheck clean.
- Desloppify (full scan, blind review, triage, execute, rescan) over the milestone
  diff: one actionable finding (a type-annotation drift from the Claude sibling),
  fixed; everything else scanned clean. Skips were deliberate and documented
  (Milestone 3 forward-structure, and no cross-harness deduplication, which stays
  out of scope).

## Observations handed to later milestones

- Cost shows $0.00 despite 12.4K tokens on a turn: the curated Codex catalog needs
  pricing entries; folded into Milestone 2 since it is catalog work.
- Cosmetic, collected for the polish list: no Codex avatar in the flat-layout
  picker map; model-summary label format differs between Pi (raw id) and Codex
  (friendly label); the model dropdown's search box does not filter; a spurious
  "Some files couldn't be loaded" suffix on the empty Files panel of a brand-new
  agent (pre-existing, not Codex-related).

## Next

Milestone 2 starts now: Agenta tools delivered over the internal MCP server, tool
events traced, a live tool call pinned as a replay regression test, plus the
catalog pricing fix. Same closing discipline, next report after.
