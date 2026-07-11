# Skill integration — teaching the orchestrator to use the console

Two pieces of skill work: a **new skill** that documents the console, and **surgical edits** to
the existing orchestration skills so they call it at the natural hook points.

## New skill: `orchestration-console`

`.agents/skills/orchestration-console/SKILL.md` (symlinked into `.claude/skills/`). Its job is
to make the console the orchestrator's default communication channel for the "in between" work.

Contents:

- **When to open a project.** At the start of any non-trivial multi-thread effort: a feature
  breakdown, a route/architecture exploration, a debugging session, a research sweep. Anything
  that would otherwise scatter across many chat threads. One-shot tasks don't need it.
- **The discipline (the core of the skill):**
  - Every sub-agent you dispatch → a **task** (`console task add`, then `task set --status
    running`; flip to `blocked` / `in-review` / `done` as it moves).
  - Every question that needs Mahmoud's call → a **decision** (`console decision add` with a
    real Context/Options/Recommendation body). **Never leave a decision only in chat.** If it
    also belongs on a code diff, add the "🔸 Decision needed" PR comment too and put the PR link
    on the decision.
  - Every meaningful state change → a **feed message** (`console message`). This replaces the
    "spin a Sonnet subagent to update STATUS.md" ritual.
  - Keep the bodies read-cold: the person opening this in the morning has no chat context.
- **The start-of-turn ritual.** Before doing work, run `console pending --project P`. Consume
  the user's `answered` decisions and `inbox` notes first. Act on them, then `console decision
  lock` each with the outcome. This is what lets Mahmoud answer in the UI instead of chat.
- **Writing style.** Feed messages and decision prose follow the user-facing style (no em
  dashes, active voice, short sentences); use `style-editing` for anything dense.
- **What stays on GitHub.** Design docs and code still land as PRs and are reviewed there. The
  console links to them; it does not duplicate diffs or inline code review.
- **The CLI reference** — the command list from `design.md` §2, with one worked example
  (open a project, add two tasks, raise a decision, lock it after the user answers).

## Edits to `implement-feature`

Map to its phases 0–6 (from the skill digest). The edits are thin "also record it in the
console" lines, not a rewrite:

- **Phase 0 (refresh plan / cut slices):** after cutting slices, `console task add` one task per
  slice; `console message` that the run is starting and what it will attempt. (Today this goes
  into `status.md`; keep `status.md` for the deep plan, mirror the headline to the feed.)
- **Phase 1 (implement):** `console task set <slice> --status running --owner <impl-agent>`.
- **Phase 2 (review):** on "changes requested", a `console message` under the task's ref; the
  task stays `running`.
- **Phase 3–4 (debug / test loops):** `console message` per loop round is optional (noise), but
  the **escalate branch is mandatory**: when a loop stops making progress and the skill says
  "escalate to the user", that becomes a `console decision add` (the stuck state + the options),
  not a buried chat line. This is the single most valuable hook — it's exactly the "route /
  debugging decision" the user loses in chat today.
- **Phase 5 (docs + PR draft):** `console task set <slice> --status in-review --pr <url>` and a
  `console message`. Mirrors the `needs-review` label.
- **Phase 6 (branch/push):** on push, `console message` with the PR link; `pr_opened` event.

## Edits to `queue-implement-feature`

This skill is the coordination wrapper. Its edits are about the **queue and status surfaces**
the digest found:

- Replace the "**update `STATUS.md`** (spin a Sonnet subagent) whenever state changes" rule with
  "**update the console** (`console message` / `console task set`); the console's project view is
  the plain-language status the user reads." (STATUS.md becomes a generated view, or is
  retired in favor of the console — see the migration note below.)
- The `implementation-queue.md` / `merge-queue.md` lists become **console tasks** filtered by
  status. A task in `in-review` with a `pr` is the merge queue; `running` tasks are the impl
  queue. Keep the scratch files during migration; the console reads the same facts.
- Keep the **`agent-coordination.md`** board as-is (it serializes `but` writes — a different
  concern). The console may surface it read-only later; not required for v1.
- The "🔸 Decision needed" PR-comment rule stays. Add: "also `console decision add` so it shows
  in the one dashboard; put the PR link on the decision."

## Migration of the existing `STATUS.md` convention

`scratch/STATUS.md` and the console's `project.md` + feed serve the same purpose (plain-language
status the user skims, the agent writes).

**Decided (2026-07-01, `status-md-migration`): retire `STATUS.md`.** The console `project.md` +
feed *are* the status. No parallel STATUS.md, not even a generated fallback. When the effort is
tracked in a console project, the agent stops writing STATUS.md. Read status from the dashboard,
or from `console status --project P` (which prints the whole board to the terminal with no server
running, so status is always reachable without the web app).

## Rollout as a skill sequence (what the user asked for)

The user's stated plan: build the console → write a skill about how to use it → modify the
orchestration skill to use it. This doc encodes exactly that order:

1. Ship the protocol + CLI + UI (`plan.md` phases 1–3).
2. Write `orchestration-console/SKILL.md` (phase 4).
3. Edit `implement-feature` / `queue-implement-feature` to call it (phase 5).

Each step is independently useful: the CLI + UI alone already give a dashboard the orchestrator
can drive by hand before the skills are updated.
