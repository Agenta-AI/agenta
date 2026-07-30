---
name: implement-feature
description: Drive a researched and planned feature to a landed, tested change. Use after plan-feature has produced a docs/design/<project>/ workspace and the user says "implement it", "build the plan", "run the plan", or "let's ship this". Orchestrates refresh-plan, implement, review, a debug-local-deployment loop, and a test loop across the daytona / local-pi / claude x SDK / UI matrix, then documentation and a GitButler stacked branch. The orchestrator stays in the loop and spins narrow subagents for each phase.
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, Agent, Task
user-invocable: true
---

# Skill: Implement a Planned Feature

This is the step after `plan-feature`. Research is done and a plan exists. Your job is to
turn that plan into a change that builds, runs end to end, and stays green, then to write it
up and put it on a branch.

You are the orchestrator. You do not write the whole feature yourself in one pass. You drive
the feature through phases and spin a narrow subagent for each phase, handing it full
context. You stay in the loop between phases, read each result, update the plan, and decide
the next move. This mirrors the subagent discipline in the `agent-workflows-qa` skill: every
fixer is followed by a reviewer, and every fix is followed by a retest.

## Precondition: a plan workspace exists

The feature must already have a planning workspace from `plan-feature`:

- `docs/design/<project>/` with at least `README.md`, `context.md`, `plan.md`,
  `status.md`, and `research.md`.

If there is no such workspace, stop. Run `plan-feature` first. Do not improvise a plan inside
this skill. `status.md` is the source of truth for progress and stays current through every
phase below.

## The chain at a glance

```
plan-feature  ->  [ implement-feature ]  ->  write-pr-description (when you open the PR)
                        |
   Phase 0  refresh the plan (status.md is truth)
   Phase 1  implement        (implementer subagent: smallest correct change)
   Phase 2  review           (reviewer subagent: root cause, no regression)
   Phase 3  debug end to end (debug subagent, loop)   -> debug-local-deployment skill
   Phase 4  tests            (test subagent, loop)     -> agent-workflows-qa + agent-replay-test
   Phase 5  document + PR draft (docs subagent)        -> write-docs + write-pr-description (Context + Scope/risk + How to QA)
   Phase 6  stacked branch   (GitButler)               -> but (publish Phase 5 PR body on push)
```

## Keep the orchestration console current (when the effort has one)

If this work is tracked in an `orchestration-console` project (see the `orchestration-console`
skill), mirror progress to the console as you go, so the user reads status and answers decisions
from the dashboard instead of chat. The console never replaces the PR review flow; it links to
it. The hooks map onto the phases above:

- **Start of every turn:** `console pending --project <p>` and act on the user's answers and
  notes first, then `console decision lock` each one you acted on.
- **Phase 0:** `console task add` one task per slice; `console message` what this run attempts.
- **Phase 1:** `console task set <slice> --status running --owner <impl-agent>`.
- **Phase 2:** on changes requested, a `console message --ref task:<slice>`.
- **Phase 3-4:** when a debug/test loop stalls and you would escalate to the user, raise a
  `console decision add` (the stuck state + options + your rec) instead of burying it in chat.
  This is the highest-value hook: it is exactly the "route / debug" decision that gets lost today.
- **Phase 5:** `console task set <slice> --status in-review --pr <url>`.
- **Phase 6:** on push, `console message` with the PR link.

## Phase 0: Refresh the plan

Before any code changes, re-read the workspace and reconcile it with the code as it stands
now. Plans rot. The repo may have moved since the plan was written.

1. Read `context.md`, `plan.md`, `research.md`, and `status.md`.
2. Verify the plan's file and symbol citations still exist. Where the code drifted, correct
   the plan, do not code against a stale map.
3. Cut the plan into the smallest shippable slices, each one independently reviewable and
   testable. Record the slice list and the acceptance check for each in `plan.md`.
4. Update `status.md`: what is done, what this run will attempt, known blockers.

End Phase 0 with a concrete slice to build and a written acceptance check for it.

## Phase 1: Implement

Spin an implementer subagent per slice. Keep it narrow and give it everything it needs to
work cold:

- the slice goal and its acceptance check from `plan.md`,
- the exact files and symbols to touch (from the refreshed plan),
- the repo conventions that apply (the relevant `AGENTS.md`, the area skills),
- the rule: make the smallest correct change, match the surrounding code, do not refactor
  next door, do not commit.

When the slice defines or changes an interface or contract — API params, wire fields, config
schema, tool definition, event payload — apply the `design-interfaces` skill first: classify
each field by its semantic role (data, config, policy, credentials, routing, metadata,
protocol context), not the feature it touches, and fix the shape before it ships. The
reviewer in Phase 2 checks the same lens on any contract the slice moved.

When the slice spans the API or SDK, the subagent runs `ruff format` then `ruff check --fix`
before reporting done. For frontend slices it runs `pnpm lint-fix` in `web/`. The subagent
returns a short diff summary and a self-check against the acceptance criterion. You read it.
You do not trust "done" without the check.

## Phase 2: Review

Every implementation is followed by a review. Spin a reviewer subagent and hand it the diff
plus the slice goal. Its job is to confirm the change actually solves the slice, find
regressions, and catch the class of mistake a fixer working alone misses (a Dockerfile `CMD`
overridden by a compose `command:`, a default that looks right but is read from the wrong
layer, an edit that the dev stack will not hot-reload).

The reviewer reports: root cause addressed yes or no, regressions, and required changes. If it
asks for changes, loop back to Phase 1 with its notes. Do not advance with an open review.

Note on `/code-review` (ultrareview): the heavy cloud review is user-triggered and billed, and
you cannot launch it from here. When the change is large or risky, finish the subagent review,
then tell the user they can run `/code-review ultra` on the branch for a deeper pass.

## Phase 3: Debug end to end (loop until it works)

A slice is not done when it compiles. It is done when it runs against the live stack. Spin a
debug subagent that drives the running deployment with the `debug-local-deployment` skill:
find the live port and compose project, reproduce the path through the playground UI and the
backend API, read the container logs, and confirm the slice does what the acceptance check
says.

Loop: run, observe, fix, re-run. Each iteration is a debug subagent that reports what it saw
and what it changed, followed by a reviewer when it changes code (Phase 2 still applies inside
the loop). Watch dev-mode reload rules: backend and frontend source hot-reload, but a changed
`@agenta/*` package or a new dependency needs a restart or rebuild. See
`debug-local-deployment` for the exact commands.

Exit the loop when the slice works end to end against the live stack. See the loop discipline
section below for when to stop trying and escalate instead.

## Phase 4: Tests (loop until green across the matrix)

Now make it stay working. Spin a test subagent that improves coverage and runs the suite,
then loops until green. Use the real project test targets, never throwaway scripts.

For agent-workflows changes, the bar is the QA matrix from the `agent-workflows-qa` skill.
"Test with daytona / local pi / claude, using both the SDK and the UI" maps to its axes:

- **Environment**: `E1` service + in-process Pi, `E2` service + Rivet local, `E3` service +
  Rivet Daytona, `E4` local SDK script. E3 is the daytona cell. E1 or E2 is the local-pi
  cell. E4 is the SDK path.
- **Harness**: `pi`, `agenta`, `claude`. The claude cell needs an `anthropic` provider key in
  the target project's vault, and claude always forces the Rivet backend.
- **Surface**: the SDK (E4, a script that pulls config and runs on the host) and the UI (the
  playground, driven with the `mcp__chrome-devtools__*` tools against the live deployment).

Force each capability with a token the model cannot guess (a constant inside a code tool, a
value from `uname -m`, a record only the MCP server has) so a pass proves the capability ran,
not just that the agent answered. Consult `qa/matrix.md` for which cells are valid before
testing one. Do not test cells that cannot exist.

When a matrix cell is green and worth keeping green, pin it with the `agent-replay-test` skill:
capture one real `/run`, redact the volatile fields, and write a replay test that exercises
the real SDK and service code against the recorded runner response with no live LLM. These run
cost-free in the default CI lane.

Loop until the suite is green and the targeted matrix cells pass. A capability that is
advertised but never actually invoked is a fail.

## Phase 5: Document and pre-draft the PR body

When the feature works and stays green, write it up. Spin a docs subagent.

- Update `status.md` to "landed" with what shipped and what was deferred.
- Update the living docs under `docs/design/<project>/` and, when the feature changes how a
  user runs or configures the agent, the agent-workflows `documentation/` pages. Use the
  `write-docs` skill for Agenta voice and structure.
- If the slice moved an interface, wire field, endpoint, config field, default, harness/backend
  value, or runtime behavior, run the `keep-docs-in-sync` skill: it maps the change to every
  doc that describes it (the `documentation/` pages, the interface inventory page AND its index
  row, the relevant `AGENTS.md`, skills) and enforces one source of truth. A contract change and
  its docs land in the same PR. Do this inside the same docs subagent.
- Run a clarity pass with the `style-editing` skill (Williams' principles: real characters as
  subjects, active voice, old-before-new, cut the throat-clearing, land the strong word last).
- Carry anything you could not finish into `defer-todo` format so it is not lost.
- Draft the PR body now, while the change is fresh. Use the `write-pr-description` skill. The body MUST include: a **Context** section (the symptom + why), a **Scope / risk** section (what was not touched, what could regress), and a **How to QA** section with prerequisites, numbered steps, expected result, the exact test command to run, and edge cases. These are the things reviewers always ask for — they belong in the first draft, not after a review round.

## Phase 6: Stacked branch (GitButler)

Put the work on its own lane. This repo runs GitButler, so use `but`, not raw git, and follow
the repo's gotchas.

1. `but oplog snapshot -m "before <feature> branch"` first. The workspace is usually dirty
   with other lanes' work, so protect it.
2. `but status` to see the lanes and pick the parent to stack on.
3. `but branch new <type>/<feature> --anchor <parent>` to stack on that parent.
4. Stage only this feature's files to the new lane with `but rub <path> <branch>`, then
   `but commit <branch> --only -m "..."`. Never run a bare `but commit`, which sweeps every
   unassigned change in the workspace into the lane.
5. Stop there unless the user asks to push. When they do, `but push <branch>` then
   `gh pr create --head <branch> --base <parent-or-main>`. Use the PR body drafted in Phase 5
   (via the `write-pr-description` skill). Confirm it includes Context, Scope / risk, and the
   full How to QA section (prerequisites, steps, expected result, test command, edge cases)
   before creating the PR. End commit messages and PR bodies with the session footer the repo
   conventions require.

If a file is gitignored (a personal `.claude/skills/*` skill, for example), it will not enter
the lane. Commit the tracked deliverables and say plainly which files stayed local.

## Multi-agent coordination (when others work in parallel)

This repo often has several agents in one GitButler working tree at once. To avoid tangling
GitButler and to keep local and remote in sync:

- Read `docs/design/agent-workflows/scratch/agent-coordination.md` first and claim a dated row
  for your task. Re-read it to see which files other lanes already own.
- Serialize every `but` write behind the board's BUT-LOCK: take it, write, release it. Never
  let two `but` mutations run at once across agents.
- Stage ONLY your task's files to your lane (`but rub <path> <lane>`), then
  `but commit <lane> --only`. Never a bare `but commit` — it sweeps every unassigned change in
  the shared tree into your lane. Leave the shared `agent-coordination.md` edits unassigned.
- Do not edit a file another active agent is mid-change on. If your work and theirs must touch
  the same file, sequence (let theirs land first); the board serializes commits, not live
  edits, so concurrent same-file edits corrupt each other.
- Commit in small, frequent chunks and keep local and remote in sync: push your lane
  (`but push <lane>`) when a slice is done so origin matches your working tree, and update the
  PR. Always leave a short "what changed" note (a PR comment, or a board row update) so the
  next agent and the reviewer are not left re-diffing.
- Merge into the integration branch (`big-agents`) only when explicitly told.

## Subagent discipline

- Keep each subagent narrow and hand it full context: the goal, the files, the acceptance
  check, the conventions. A subagent that has to guess produces work you have to redo.
- Every implementer or fixer is followed by a reviewer. Every fix is followed by a retest. No
  exceptions.
- Run independent subagents in parallel (several review dimensions, several matrix cells), but
  put a barrier where the next phase needs all of the prior results.
- You synthesize. Subagents return findings, you decide. Do not hand the wheel to a subagent
  for a design call.

## Loop discipline (do not spin forever)

The debug loop and the test loop can run away. Bound them.

- Set a cap before you start (for example three rounds). If a round makes no progress, stop
  looping.
- When stuck, triage with the `agent-workflows-qa` tree: fix-now only for a small change with
  an obvious home and no design question; otherwise **defer** (write a `defer-todo` finding
  with a clean repro) or **escalate** to the user (a repo restructure, a security surface, a
  new config the user must decide). When in doubt between fix-now and defer, defer.
- Keep `status.md` current at every turn so the next session, or the next agent, can pick up
  cold.

## Quick reference

| Phase | Skill it leans on |
|---|---|
| 0 Refresh plan | `plan-feature` workspace (`docs/design/<project>/`) |
| 1 Implement | area `AGENTS.md`, area skills; `design-interfaces` (contract changes); `ruff` / `pnpm lint-fix` |
| 2 Review | reviewer subagent; optional user-run `/code-review ultra` |
| 3 Debug e2e | `debug-local-deployment` |
| 4 Tests | `agent-workflows-qa`, `agent-replay-test` |
| 5 Document + PR draft | `keep-docs-in-sync` (contract/interface changes), `write-docs`, `style-editing`, `defer-todo`, `write-pr-description` (with Context + Scope/risk + How to QA) |
| 6 Branch | `but` (GitButler); publish the Phase 5 PR body on push |
