# Status

## Where this is

**Built and tested. Nothing committed** (awaiting your review; this is the usual
research-to-docs-then-implement checkpoint, except the tool is already working so you can click
it).

Built:

- `tool/console_store.py` — the file protocol (frontmatter docs + `feed.jsonl`, decision state
  machine, locked feed-seq under concurrency).
- `tool/console.py` — the CLI (the action surface). ruff-clean.
- `tool/console_web.py` — the dashboard + writeback. Runs on port 8799.
- `tool/test_console.py` — 11 plumbing tests, all green.
- `.claude/skills/orchestration-console/SKILL.md` — the skill.
- Edits to `.claude/skills/implement-feature/SKILL.md` and `queue-implement-feature/SKILL.md`
  (console hooks at the phase points; STATUS.md rule now points at the console).
- `TESTING.md` — the three-layer test recipe.

Added after the first cut (from the live design conversation):

- **Threads** — a first-class conversation type. A topic with a running Summary and a Messages
  log the user posts into from the UI. You can open a thread by asking a question in the UI, post
  follow-ups, and the agent replies + refreshes the Summary. Threads promote into tasks
  (`thread promote`), carrying the Summary across as the task Context.
- **Per-task messages** — tasks also carry a Messages log the user can post into.
- The scaffold no longer emits placeholder prose (the artifact where empty tasks showed
  "What this task is and why"). Regression-tested.
- Test suite grew to **17 green**. The `orchestration-console` skill, `design.md`, and the two
  orchestration skills are updated to describe threads.

Verified:

- Layer 1 (plumbing): `uv run tool/test_console.py` → 11 passed, including the concurrent
  feed-seq guarantee (a real bug found and fixed: flush before releasing the lock).
- Layer 2 (web + loop): a simulated UI answer moved the decision `open → answered` on disk and
  showed up in `console pending`. Two-way loop proven.
- Layer 3a (skill conformance): a fresh sub-agent given ONLY the skill + a scenario produced a
  correct board — three tasks with the right statuses, the blocked task wired to its
  `blocked_on` decision, one well-formed decision (read-cold Context, two Options, decisive
  Recommendation), and a summary feed message. See `TESTING.md` §3a for the exact prompt/rubric.

Docs:

- `context.md` — the problem and goals.
- `research.md` — how we orchestrate today, the conventions the console subsumes/links.
- `design.md` — the file protocol, CLI actions, UI, deployment. **Read this first.**
- `skill-integration.md` — the skill + edits to the orchestration skills.
- `plan.md` — six-phase build order.

## The proposal in one line

A file-backed protocol (Markdown + frontmatter + a `feed.jsonl`) that the orchestrator writes
through a small `uv` CLI, rendered by a tiny `uv` FastAPI dashboard with writeback, so the
orchestration phase gets the same async-review affordance the draft PR already gives design and
implementation.

## Open questions for Mahmoud (answer in prose, no menu needed)

1. **Scope of v1.** Is the four-region dashboard (Overview / Needs you / Tasks / Feed) with
   decision writeback the right first cut, or do you want to start even smaller (read-only
   dashboard, add writeback later)?
2. **STATUS.md.** Retire it in favor of the console, or generate it as a fallback flat file
   during rollout? (Lean: generate first, retire once trusted.)
3. **Where it runs / external access.** Dedicated port on the dev box, or a tunnel from this
   machine? Any auth beyond a shared token?
4. **Root location.** `docs/design/agent-workflows/scratch/console/` (git-tracked, PR-able) vs a
   repo-root `.orchestration/` (out of the design tree). Lean: the scratch path, so it's
   consistent with today and reviewable.
5. **Build it now or refine the design more?** Per your usual flow, this is the "research to
   working docs, then implement after you review" checkpoint.

## Decisions locked so far

- Console targets the orchestration phase only; PRs stay the surface for design + code review.
  The console links to PRs, does not mirror diffs.
- Markdown + frontmatter for documents; `feed.jsonl` for the stream. One shared `console_store`
  module for CLI and UI.
- Decision lifecycle `open → answered → locked`; the UI can only move `open → answered`.
- Python `uv` single-file scripts for both CLI and server (no monorepo build, deployable).

## Risks / things to watch

- **Discipline dependency.** The dashboard is only as good as the agent's habit of writing to
  it. The skill edits (phase 5) are what make it stick; until then it's manual.
- **Not a process monitor.** "Running" means agent-reported. If the orchestrator crashes
  mid-task, the task shows `running` until someone corrects it. Acceptable for v1.
- **Two sources of truth during migration.** STATUS.md + console overlap until the migration
  completes. Keep it short.
