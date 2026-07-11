# Research — how we orchestrate today

All findings are from the current repo (2026-07-01). This is workflow research, not code
research. Sources: the `pr-4936-followup/` folder, the `scratch/` conventions, and the
`plan-feature` / `implement-feature` / `queue-implement-feature` skills.

## The three-phase model and its surfaces

| Phase | Artifact | Async review surface | State |
|---|---|---|---|
| Design | design docs under `docs/design/<project>/` | **draft PR** + top comment + inline pointers + `needs-review` | works |
| Implementation | code diff | **PR** + changes-made comment + inline pointers + `needs-review` | works |
| Orchestration (in between) | decisions, breakdowns, routes, debug findings, task status | **chat only** (or ad-hoc scratch MD) | broken |

The console targets row 3. It must **link to** rows 1 and 2, not replace them.

## The information model already in use (pr-4936-followup)

This folder is the de-facto schema. Mapping its parts to types:

- **Project overview** = the README intro + `00-overview.md` ("the problem we're solving",
  written to be read cold). → a **project** with a goal statement.
- **Thread** = each numbered file (`01`…`08`), one per sub-feature / work unit, with
  **Context / Explanations / History**, and links to a design doc and a PR. → a **task**.
- **Open decision thread** = the `Dn` blocks inside a thread (options a/b/c, "My
  recommendation", "Your decision") **and** the README "Open decisions" table
  (`# | Where | Decision | My rec`). → a **decision**.
- **What needs your review NOW / In flight / Decided (locked)** = the README's attention and
  history sections. → the **feed** (a time-ordered event stream) plus decision status.

The decision lifecycle is already visible in the README: **"Open decisions still pending your
call"** vs **"Decided (locked)"**. That's a two-state machine (`open` → `locked`) with an
intermediate the folder doesn't yet name: the user has answered but the agent hasn't acted /
recorded it yet. The console makes that explicit: `open` → `answered` → `locked`.

## Existing scratch conventions the console subsumes or links

From the skills digest and the scratch tree:

- **`scratch/STATUS.md`** — "plain-language status the user (only) reads; the assistant updates
  it, the user never edits it. Update it (spin a Sonnet subagent) whenever feedback is given or
  state changes." This is a proto-console with no structure and no UI. **The console's project
  view replaces STATUS.md**; the update discipline moves to CLI calls.
- **`scratch/implementation-queue.md`** and **`scratch/merge-queue.md`** — the running-task
  and merge lists. **These map onto console tasks** (a task carries `status` and a `pr` link;
  the merge queue is a filtered view of tasks in `in-review`/`ready`).
- **`scratch/agent-coordination.md`** — the GitButler lease board (who's editing which files,
  BUT-LOCK). This stays as-is (it's about serializing `but` writes, a different concern), but
  the console can surface it read-only as a "who's touching what" panel.
- **`scratch/open-issues.md`** (the `defer-todo` format) — deferred work with provenance
  (`Status / Added / Commit / Project / Source` + "The problem / Why deferred / What to
  decide"). **Deferred decisions link here**; the console shows them as a backlog lane.
- **GitHub PRs + `needs-review` label + "🔸 Decision needed" comments** — the design-decision
  and code-review surface. The console **links** to these and mirrors their status; a decision
  that belongs on a diff still lives on the PR, but appears in the console's "needs me" list so
  there is one place to see everything.

## Where the orchestration skills would call the console (hook points)

From the digest of `implement-feature` (phases 0–6) and `queue-implement-feature`:

- **Dispatch a sub-agent for a slice/phase** → `task add` / `task set --status running`.
- **Phase 0 refresh / plan cut into slices** → feed message; tasks created per slice.
- **Phase 2 review asks for changes / Phase 3–4 loop** → feed messages; a stuck loop that
  escalates → a `decision` (this is exactly the "escalate to the user" branch, lines 221–223).
- **Phase 5 docs + PR draft / Phase 6 branch + push** → `task set --status in-review --pr …`,
  feed message; mirrors the `needs-review` label.
- **A design decision the user must make** → a `decision` in the console **and** (when it
  belongs on a diff) the existing "🔸 Decision needed" PR comment; the console decision carries
  the PR link. Keeps today's rule ("decisions go on a PR, never only in chat") while adding one
  dashboard that aggregates them.
- **`STATUS.md` updates** (today: spin a Sonnet subagent on every state change) → become CLI
  calls (`console message`, `console task set`), which the UI renders. Same discipline, now
  structured and visible.

## Constraints that shape the design

- **Git-native.** Everything is files in the repo tree, so the same content is diffable,
  greppable, PR-reviewable, and survives across sessions/agents (cold resume, like `status.md`
  does today).
- **Cheap for the agent to read back.** The orchestrator reloads state constantly. A machine
  -readable index (frontmatter + a JSONL feed) makes "reload the board" one cheap command, not
  a re-read of prose.
- **One writer discipline already exists.** The repo serializes GitButler writes; the console
  writes are plain file appends/edits to a per-project directory, independent of `but`, so they
  don't need the BUT-LOCK. Concurrent appends to the feed are the only race (handled by
  append-only writes + advisory file lock).
- **Standalone scripts run via `uv run` with PEP 723 inline deps** (global rule). The CLI and
  the UI server are Python, single-purpose, no repo build step — "simple and deployable."
- **User-facing text style** — no em dashes, active voice, short sentences (baked into the
  skill so the agent's feed messages read cleanly).
