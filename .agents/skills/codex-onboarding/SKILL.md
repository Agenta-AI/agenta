---
name: codex-onboarding
description: Onboarding for Codex (and any non-Claude agent) working on documentation or implementation in this repo. Read this FIRST, before touching code, docs, or git. Distills the working agreements that otherwise live in Claude's session memory - GitButler-only version control, the design-first PR workflow, PR bases and labels, writing style, testing, and coordination with the other agents on the big-agents trunk.
---

# Codex Onboarding

You are one of several AI agents working in this repo alongside Mahmoud (the user) and
his co-workers' agents. This skill captures the working agreements that are NOT in the
code or in AGENTS.md. Read `AGENTS.md` at the repo root as well; it holds the repo map,
area conventions, and the full GitButler reference. This file holds the rules learned
from experience and the workflow Mahmoud expects.

## The one-paragraph version

All work happens on GitButler lanes over the `big-agents` integration branch, never on
raw git branches and never in worktrees. Non-trivial work is design-first: a design-doc
PR that the user reviews on GitHub, then implementation only after he approves. Every PR
targets `big-agents`, carries the right label (`needs-review` / `implementing`), and gets
a comment signed as the AI agent. Verify with the real test suites and a live-stack
check, not ad-hoc scripts. Write everything in plain, short, active-voice English with no
em dashes.

## 1. Version control: GitButler only (hard rules)

The workspace is in GitButler mode (branch `gitbutler/workspace`). The full command
reference is in root `AGENTS.md`. The non-negotiable rules:

- **Use `but` for every branch, commit, and push.** Never `git commit`, `git branch`,
  `git stash`, or `git checkout` for workspace operations. Parallel lanes ARE GitButler
  (`but branch new <name>` with no anchor); never describe or attempt anything as
  "skipping GitButler".
- **Never create a git worktree.** No exceptions, including "read-only" or "QA-only"
  worktrees. If a task seems to need one (e.g. testing a PR branch), stop and ask; the
  answer is applying the branch as a lane.
- **Never push a stack that contains a branch you don't own.** `but push` force-pushes
  EVERY series in the stack, including a co-worker's base branch, and will clobber their
  work. If the stack base is someone else's branch, push only your own series with
  `git push origin <your-branch> --force-with-lease` (raw git is allowed for pushes,
  not for commits).
- **`but push` prints nothing on success.** Always verify:
  `git rev-parse <branch>` must equal `git ls-remote --heads origin <branch>`.
- **Never revert or delete working-tree files you did not create.** They may hold the
  user's own uncommitted edits, which `git checkout` destroys irrecoverably. Diff first;
  if in doubt, ask.
- One lane at a time: assign exactly one lane's files, `but commit <lane> --only`,
  verify with `git show --stat <lane>`, then move to the next lane. Details and failure
  modes are in root `AGENTS.md`; recovery procedures are in the
  `gitbutler-workspace-recovery` skill.

## 2. Coordination with other agents

Several agents (Mahmoud's, Arda's, JP's) work this workspace and the `big-agents` trunk
concurrently.

- **The coordination board** is
  `docs/design/agent-workflows/scratch/agent-coordination.md`, section
  "STANDING COORDINATION PROTOCOL" (everything above it is historical log).
- **Take the BUT-LOCK before any `but` write** (stage/commit/push/branch): set it to
  `LOCKED <agent> <UTC ISO8601>` on the board, set it back to `FREE` when done. A lock
  older than 15 minutes is stale; take it with a fresh timestamp. Concurrent `but`
  writes corrupt the workspace. `but status` (read-only) needs no lock.
- Board rows older than 2 days are stale. Live `but status` plus open PRs are the real
  source of truth.
- When merging into `big-agents`, post a merge-sync comment on PR #4791 (the
  big-agents to main integration PR): a bold `**Merged: X**` header, plain-language
  what-changed, and implications (new/removed routes, wire/schema changes, branches
  that should rebase). The other agents read #4791 to stay in sync.

## 3. The design-first workflow

For any non-trivial feature or fix, do NOT jump to implementation.

1. **Research first.** Investigate thoroughly and write findings into a design
   workspace under `docs/design/<project>/`: `README.md` (index), `context.md` (why,
   goals, non-goals), `research.md` (codebase findings, gotchas), `plan.md` (the
   design and phases), `status.md` (live progress). A lone README is not a design doc.
2. **Open a draft PR containing the design docs only, never implementation code.**
   The PR is where the user reviews and steers; he works from GitHub, not from chat.
3. Add the `needs-review` label and post a specific comment saying exactly what
   feedback you need (never a generic "check it out").
4. **Implement only after the user approves** ("implement it", "lgtm", or PR comments
   plus "fix them" all count as approval). Swap the label to `implementing` while you
   build, back to `needs-review` when the implementation is ready.
5. Decisions the user must make (a transport, a default, a name, A-vs-B) go ON a PR as
   a "🔸 Decision needed" comment with concrete options and your recommendation. A
   decision left only in chat is a decision he will never see.

Trivial, mechanical, or explicitly-ordered changes can go straight to a lane and PR.

## 4. Pull requests

- **Base every lane PR on `big-agents`, never `main`.** Lanes branch off `big-agents`;
  a PR based on main shows all of big-agents' unmerged work and is blocked by main's
  review ruleset. For stacked PRs, base each PR on the branch directly below it.
- Title format: `[issue-id] <type>(<area>): <Title>` where type is fix/feat/chore/ci/
  doc/test and area is API, SDK, frontend, docs, and so on.
- **Description quality bar** (full procedure in the `write-pr-description` skill):
  lead with the concrete symptom from the user's point of view, then the fix in plain
  words with a before/after example. Open with 2-4 full sentences of background so a
  reader with zero session context can follow. Define terms of art on first use.
  Include a "How to review" section walking the diff in reading order. No padded
  bullets, no checkbox theater.
- `gh pr edit` is broken in this repo (classic-Projects GraphQL bug). Edit title/body
  via REST: `gh api repos/Agenta-AI/agenta/pulls/<n> -X PATCH -f title="..."
  -F body=@/tmp/body.md`. Add labels via
  `gh api --method POST repos/Agenta-AI/agenta/issues/<n>/labels -f "labels[]=needs-review"`.
  Retarget a wrong base the same way (`-f base=big-agents`).
- **Sign every GitHub comment as the AI agent.** `gh` is authenticated as Mahmoud, so
  an unsigned comment reads as if he wrote it. Prefix comments with
  `🤖 _The AI agent says:_`. Sign as "the AI agent", not as a model name.
- After pushing a revision that addresses review comments, always post a PR comment
  mapping each review comment to what changed. Never a silent force-push.
- Label lifecycle: the user applies `lgtm` when he approves; you apply `needs-review`
  whenever a PR is ready for (or again needs) his review; `implementing` while building
  an approved design. Keep labels accurate at every transition; he filters GitHub by
  them.
- When a PR is ready, trigger the bot review by commenting `@coderabbitai review`
  (CodeRabbit skips drafts, so mark ready first), then come back later and address its
  comments.
- If you reuse a design PR's branch for the implementation, rename the title and
  rewrite the body so it reads as the implementation, not the old plan.

## 5. Writing style (all user-facing text)

Applies to PR descriptions, comments, commit messages, docs, design docs, issues.

- **Never use em dashes.** Replace with a period, parentheses, or a semicolon. This is
  an absolute rule.
- Active voice, short sentences, 11th grade English except unavoidable technical
  terms. Complete sentences. Sparing bold and bullets; prefer prose.
- No engineering slang ("soak", "greenfield", "yak-shaving"). Precise technical terms
  (TTL, JSON-RPC) are fine.
- In code and interfaces, prefer full words over abbreviations (`operation`, not `op`;
  `config`, not `cfg`) unless the short form is a universal convention (`id`, `url`,
  `db`).
- Design docs additionally require: current-state context before the change, every
  decision with options and trade-offs and why, worked examples, and no meta text in
  the body ("updated after review" belongs in PR comments or status.md, never in the
  doc). See the `write-docs` skill for docs pages and the `write-pr-description`
  skill for PR bodies.

## 6. Verification and testing

- **Run the real test suites, never ad-hoc scripts.** A throwaway python snippet is
  not verification. Canonical targets (from the repo root; details in
  `docs/designs/testing/README.md`):
  - Python areas: `cd <area> && py-run-tests` where area is `sdks/python`, `api`, or
    `services` (`py-run-tests` = `uv sync --locked && uv run --no-sync python
    run-tests.py`).
  - Web: `cd web && pnpm install`, then from `web/tests/` run `pnpm test:smoke` or
    `pnpm test:acceptance`.
- Before committing: `ruff format` + `ruff check --fix` for Python; `pnpm lint-fix` in
  `web/` for frontend.
- **Green unit tests do not mean the live stack works.** After merges or between
  milestones, verify the local deployment actually serves (login loads, playground
  renders, chat works, model can be changed). The dev loop (load-env + run.sh pairs)
  is in root `AGENTS.md`.
- CI hygiene: after merging, sweep CI and fix what broke. The short API/unit/lint/
  contract checks must be green before merging; the slow web tests may be skipped. A
  red check is acceptable only if the reason is documented as explicitly deferred.

## 7. Architecture guardrails

- **Fix agent-guidance problems at the SDK layer, never in core platform surfaces.**
  When a builder agent misuses a platform tool, the fix ladder is: (1) typed input
  schema on the operation in the SDK op catalog, (2) the operation description,
  (3) a skill reference file with a complete example call. Changes to the workflows
  service or harness adapters need a design doc and explicit approval first; harnesses
  stay neutral.
- Frontend/backend shape mismatches are fixed on the frontend read path, not by
  changing the backend.
- When an env var or flag switch achieves the goal, use it instead of editing frontend
  code. But never add `NEXT_PUBLIC_AGENT_*` feature flags or debug knobs to the
  `web/entrypoint.sh` `__env.js` runtime-injection block; those are dev-mode-only.
- API config goes through `api/oss/src/utils/env.py` and the shared `env` object,
  never direct `os.getenv` calls.
- System constants are reserved `__ag__*` static workflows (the static catalog
  pattern), not bespoke endpoints.

## 8. Sibling skills worth reading

All in `.agents/skills/`:

- `write-pr-description` - PR title and body procedure with a worked example.
- `write-docs` - style and structure for pages under `docs/` (Diátaxis types).
- `design-interfaces` - classify interface fields by semantic role before adding any
  API/wire/config field.
- `write-issue` - Linear/GitHub issue format.
- `agenta-package-practices` - frontend package-vs-app placement and `@agenta/*` usage.
- `write-template-playbooks` - authoring build-an-agent template playbooks.
- `gitbutler-workspace-recovery` - when a `but` operation scrambles the workspace, or
  the workspace looks wedged (see the freeze rule below).

## 9. When in doubt

Research and write findings before changing code. Ask before anything destructive or
irreversible. If a `but` operation errors about hunk locking or conflicts, stop and
report rather than improvising raw-git surgery; `but oplog list` / `but oplog restore`
exist but a human should decide. Surface open questions on the PR, one clear question
at a time.

**If the workspace looks wedged, freeze.** Signs: a failed `but pull` integration,
`Could not find branch CLI id '' in IdMap`, or a conflict attributed to a lane that
cannot conflict (e.g. one with no commits). Run no `but` mutation at all, not even `but
branch new`, until the wedge is diagnosed; a mutation issued while wedged can create
phantom commits and corrupt refs. Follow the freeze rule and recovery steps in the
`gitbutler-workspace-recovery` skill.
