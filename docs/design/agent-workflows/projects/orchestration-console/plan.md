# Plan — building the console

Build order is chosen so each phase is independently useful. The protocol + CLI + UI give a
working dashboard the orchestrator can drive by hand before any skill changes.

## Phase 1 — the file protocol + `console_store.py`

- Write `console_store.py`: parse/write frontmatter, scaffold task/decision bodies, append to
  `feed.jsonl` under an advisory lock with a monotonic `seq`, read `pending`.
- Freeze the schema from `design.md` §1 (this is the contract; review it with
  `design-interfaces` before writing code).
- Acceptance: unit tests for round-trip (write task → read back), feed seq monotonicity under
  concurrent appends, and the decision state machine (`open → answered → locked`).

## Phase 2 — the CLI (`console`)

- A `uv` single-file script (PEP 723 inline deps) exposing the subcommands in `design.md` §2,
  all delegating to `console_store.py`.
- Acceptance: a shell script that opens a project, adds two tasks, raises a decision, simulates a
  UI answer, runs `console pending` (sees the answer), and locks it — asserting the files and
  feed end in the right state.

## Phase 3 — the web app (`console-web`)

- A `uv` FastAPI single-file server: Home (project list + unread badge), Project view (Overview
  / Needs you / Tasks / Feed), Markdown-rendered bodies, htmx feed polling, writeback endpoints
  (answer a decision, post a note), token gate from `CONSOLE_TOKEN`.
- Pick a port that does not collide with the app stack (the dev stack uses 8280/8480/8790 etc.);
  propose **8799**. Bind `0.0.0.0`; document the tunnel/dev-box exposure in the README.
- Acceptance: run it against the Phase 2 fixture project and click through — read a decision's
  context, submit an answer, see the feed update, confirm the file changed on disk.

## Phase 4 — the skill

- Write `.agents/skills/orchestration-console/SKILL.md` per `skill-integration.md`: when to open
  a project, the task/decision/message discipline, the start-of-turn `console pending` ritual,
  the CLI reference, one worked example. Symlink into `.claude/skills/`.

## Phase 5 — wire into the orchestration skills

- Apply the thin edits in `skill-integration.md` to `implement-feature` (phase hooks) and
  `queue-implement-feature` (queue/status surfaces, STATUS.md migration option 2 → 1).
- Migrate one live project (e.g. the current follow-up work) to the console as the shadow test.

## Phase 6 — dogfood + iterate

- Run one real orchestration effort through the console end to end. Capture friction (missing
  fields, awkward commands, UI gaps) as `defer-todo` findings and fold the cheap ones in.

## Open build questions (see `status.md`)

- Exact root path and port; how external access is exposed (dedicated dev-box port vs tunnel).
- STATUS.md migration option 1 vs 2.
- Whether v1 needs the `agent-coordination.md` read-only panel (lean: no).
- Whether the feed needs per-project or global unread tracking (lean: per-project, per-browser).
