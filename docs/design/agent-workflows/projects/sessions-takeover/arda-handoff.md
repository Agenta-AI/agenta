# Handoff: the approvals and sessions work, and where your branch fits

Arda, this is the context you need to pick up the approvals surface again after last
weekend. You wrote the approval user experience and the config-section work yourself, and
all of that ships. What changed underneath you is the approval machinery on the runner and
a restructure of how a session is stored. This document explains what happened, the
decisions Mahmoud has made about your branch, the branch you will work on, your task list,
and the two questions he wants your read on. Every decision below comes with the reason and
a place to verify it. You should be able to start within an hour, and you will not need a
meeting to do it.

A note on vocabulary, because a few terms recur. The **runner** is the Node and TypeScript
sidecar under `services/runner/` that drives a coding agent inside a sandbox. The coding
agent itself is the **harness**, either Pi or Claude Code. A **gate** is a human-approval
request the harness raises before a policy-gated tool runs; the playground shows a gate as
an approval card. To **park** a gate is to end the streamed turn while keeping the live
harness process alive in a pool, waiting for the human's answer; a **warm resume** checks
that process back out and answers the gate in place. A **sentinel** is a bookkeeping string
the runner writes as a tool result when the real result is not available. **Hydration** is
the frontend rebuilding the conversation from the saved records when you reload a session.

## 1. What happened while you were heads down

During a live QA of two parallel approval-gated shell writes in one turn, the conversation
died: the first approved command was reported as not executed, the whole turn went silent
after the second approval, the first card flipped back to waiting, and a later question was
answered with a stale "Done" (the full reconstruction is
`docs/design/agent-workflows/scratch/debug-concurrent-approvals-db58551b.md`). A fix train,
now open as PR #5382, root-caused four defects behind that failure and rebuilt the
multi-gate approval machinery on the runner and the reload path on the frontend to fix them.
In parallel, the session storage layer was restructured: the mutable per-session state blob
became an append-only per-turn ledger plus a liveness row, now combined into one branch as
PR #5436. Because JP is away and you were heads-down on Drive work, Mahmoud took over both
lines and reconciled them against your branch (PR #5426), which had independently rebuilt
the same multi-gate machinery and the same reload fix without the incident evidence. Your
branch and the fix train collide because both generalize the runner's single-gate parking
into multi-gate parking in the same six runner files, and the two designs disagree on the
resume contract, which is exactly where the ruling below lands.

## 2. The rulings, and the reason for each

These are Mahmoud's decisions. Each one names its reason and where you can check it. None of
them is a comment on the quality of your work; where a decision goes against your branch, it
is because your branch was built before the incident produced its evidence.

### 2.1 The multi-gate machinery from PR #5382 survives; your four machinery commits are not ported

Your branch replaces the runner's single parked gate with a multi-gate collection, in
commits `23b9557fef` (hold parallel gates and resume together), `e658c1ec43` (parked-turn
transcript hygiene), `3e5c2d1c44` (reload restore of a parked-and-resumed approval), and
`a7524a835c` (the formatting rider). Those four are not carried onto the surviving branch.

The reason is the resume contract, not the code. Your resume is all-or-nothing: the runner
only resumes once the frontend has answered every parked gate, and a resume that answers a
subset is treated as a mismatch and evicts the live session (your `server.ts` comment states
this contract directly). That is the exact shape whose failure caused the dead conversation.
After a state rebuild, the frontend's "every card settled" precondition can never hold,
because the saved record held every gate's request and never its answer, so the last answer
sat unsent in browser memory (incident report, defect 1 and defect 4). Your branch also
predates the four incident fixes: it does not exclude an approved, executing call from the
post-pause sweep, has no second sentinel for a call whose result is unknown, records a
never-started sibling as a fake success, and never persists the answer half of a gate at
all (incident report, defects 2 through 4, mapped commit-by-commit in
`docs/design/agent-workflows/projects/sessions-takeover/arda-branch-reconciliation.md`,
Pair 1 and Decision 1). PR #5382 fixes all four, carries an end-to-end regression replay of
the incident, and was verified across four live QA cycles (PR #5382 description, "How this
was verified"). Your implementation was competent; it was simply built without the evidence
that these four cases exist.

### 2.2 The collect window is not ported now, and is recorded on issue #5391 with your authorship

Your genuinely novel idea on the machinery side is the collect window: instead of parking on
the first gate, gather every gate raised inside a short debounce window (a new
`AGENTA_RUNNER_APPROVAL_COLLECT_MS`, default 800 milliseconds) so a staggered batch parks
together and the user sees several cards at once. It is not ported now.

The reason is that under today's harness adapters there is no burst to gather. Both harnesses
raise their gates strictly one at a time and block: the second gate does not exist until the
first is answered. The incident timeline shows Pi raising confirms serially (incident report,
"Pi serializes confirms"), and the live QA on issue #5391 established the same for Claude:
two parallel gated calls in one turn produce exactly one `request_permission` from the
`claude-agent-acp` adapter, which blocks until answered (issue #5391, "the ACP adapter
serializes permission requests"; the Zed comparison reaches the same conclusion about the
shared adapter in `docs/design/agent-workflows/scratch/zed-acp-approvals-comparison.md`).
Until the upstream adapters can hold several permission requests open at once, a window of
any length batches nothing. So the idea is recorded on issue #5391 as the agreed client-side
half, with your authorship, to be built once the upstream half lands.

### 2.3 Your user experience and config work ships

The always-allow toggle, approve-all, the config sections, the drawer width fix, and the
compose harness config all ship. They are the parts with your name on them, and every one of
them merges cleanly over both the fix train and the storage rework (the trial-merge ground
truth is in the reconciliation document, Part 2: only the ten runner and hydration files
conflict, everything else auto-merges). Concretely these are commits `491c593986` (the
shared `HeightCollapse` and section primitives), `0f1448f68a` (the changed-path and focus
primitives), `9ab4099cb8` (the context-driven config sections), `14e82e03c7` (always-allow
and batch resolve), `8bdd5c4ed4` (drawer width), and `07c9153a62` (compose harness config).
They will be ported for you onto the new branch described in section 3.

There is one caution you own. Your approve-all dock was written against the old dispatch, in
which the frontend sent the batch only once every card had settled. PR #5382 changes the
frontend to per-card dispatch, where one click sends one answer and the runner can resume on
a subset of the parked gates. The runner accepts partial answer sets by design, so an
approve-all click that fires several answers in waves should compose, but this is the one
seam nobody has watched live (reconciliation document, Part 4 item 4, and Decision 3). It
needs one repeat QA pass on the dock after #5382 merges. That pass is in your task list.

### 2.4 Two of your ideas are adopted as your first tasks, rebuilt rather than cherry-picked

Two things you built independently are the same things the fix train explicitly deferred or
had not reached. Both are adopted, and both are yours to build first. They are rebuilt
against the merged code rather than cherry-picked, because your original commits sit in the
same runner blocks the fix train reworked and do not apply as-is (reconciliation document,
Pair 3 and Pair 4).

The first is the transcript hygiene pair: on a resume, do not save a second copy of the
user's message, and give a paused turn a distinct end-marker so a reload can tell a pause
from a real turn boundary. The guardrail is that one of the fix train's reload checks
currently relies on that duplicate row existing. Its server-transcript-adoption heuristic
prefers the server copy of the conversation whenever the server copy has more messages, and
the duplicate user row is part of what makes it have more (reconciliation document, Pair 3).
So when you remove the duplicate, re-check that frontend adoption heuristic in the same
change.

The second is the deferred-command hint after replay: when a sibling tool call was skipped
because the turn paused for another approval, render it on the cold path as a neutral "this
was skipped, not denied, call it again" nudge instead of an error string the model reads as
a denial. Two guardrails. It lands only on top of the fixed post-pause cleanup, because only
there is the deferred marker trustworthy; without the sweep fix an approved call that
actually ran can still be stamped deferred, and your nudge would then invite the model to
run a side-effecting command twice (incident report, defect 2; reconciliation document,
Pair 4). And it must also cover the `APPROVED_EXECUTION_RESULT_UNKNOWN` sentinel, which your
branch does not know about, with the opposite instruction: do not retry.

### 2.5 The rest of your roadmap comes from the known gaps

The storage architecture document lists what the restructure does not yet do (architecture
document, section 9, "What is missing"). Mahmoud's rulings on those gaps set the rest of
your roadmap.

Wire session titles to the new rename endpoint. The server side is done on PR #5436: the
liveness row grew `name` and `description` fields and a dedicated rename endpoint that cannot
collide with liveness writes. The frontend still keeps titles only in localStorage, so a
title exists only in the browser that set it (architecture document, gap 3). Your task is the
frontend half: write and read the header through that endpoint.

Build cancel and steer on the signal plumbing that already exists. The lock-side machinery is
complete on the merged lane: the kill command tears the run down, and an interrupt flag rides
the heartbeat so a cancel reaches an in-flight run (the runner wires the heartbeat's
`is_current_turn` to an abort; architecture document, gap 5, and section 4). Use the protocol
shape from the Zed comparison: cancel the turn, answer every pending permission request as
cancelled, wait for the harness to settle into an idle cancelled state, then send the new
instruction as a fresh prompt (Zed comparison, "Recommended changes", item 3). This is what
db58551b defect 6 showed is missing today, where new text during a park is swallowed as a
resume of the stale task.

Two things are explicitly out of scope for now: session deletion (gap 4) and live mid-turn
attach (gap 6).

## 3. Your branch and how to work on it

You do not need GitButler for any of this. You work on a plain git branch with normal git.

The rest of us work on a stack of branches. `feat/sessions-storage-rework` (PR #5436) is the
storage rework at the bottom. `plan/concurrent-approvals` (PR #5382) sits on top of it and
carries the surviving multi-gate machinery. Your branch will be a new plain git branch, cut
from the head of `plan/concurrent-approvals`, with your keeper commits from section 2.3
ported onto it. You work there.

The one rule that protects you: while you are working, we do not rewrite the two branches
underneath you. Anything we need to change on them lands as new commits on top, so your base
never moves under you. If a rewrite of those two branches ever becomes unavoidable, we agree
the moment with you first, before it happens. That means you can treat your base as stable
and rebase on your own schedule, not on ours.

Merge order is PR #5436 first, then PR #5382, then your branch's PR. Set your PR's base to
the branch directly below it so the diff shows only your work.

Your old branch and PR #5426 will be closed with a comment linking this document, so the
reasoning is attached to the thread. Your original branch stays on origin untouched as the
archive of your version; nothing about your work is lost, and you can always diff against it.

## 4. Your task list

In order. Guardrails are inline so you do not have to hold them in your head.

1. **Rebuild the transcript hygiene pair** (ruling 2.4, first idea). On resume, stop saving a
   second copy of the user message, and stamp a distinct end-marker on a paused turn so
   hydration can tell a pause from a turn boundary. Rebuild against the merged runner code,
   not from your old commit. Guardrail: in the same change, re-check the frontend
   server-transcript-adoption heuristic, which today leans on the duplicate row being present
   (reconciliation document, Pair 3).

2. **Rebuild the deferred-command hint after replay** (ruling 2.4, second idea). On the cold
   path, render a deferred sibling as a "skipped, not denied, call it again" nudge. Guardrail
   one: land it only on top of the fixed post-pause cleanup, so the deferred marker is
   trustworthy (incident report, defect 2). Guardrail two: also handle the
   `APPROVED_EXECUTION_RESULT_UNKNOWN` sentinel, with the opposite instruction, do not retry.

3. **Repeat QA the approve-all dock against per-card dispatch** (ruling 2.3). After #5382
   merges, drive an approve-all click over several parked gates and confirm the waves of
   partial answers resume and re-park cleanly. This is the one seam not yet watched live.

4. **Wire session titles to the rename endpoint** (ruling 2.5). Frontend half only; the
   server rename endpoint is on #5436. Replace the localStorage-only title with a write and
   read through the header endpoint.

5. **Build cancel and steer on the existing signal plumbing** (ruling 2.5). For cancel, use
   the Zed protocol shape: cancel the turn, answer every pending permission as cancelled, wait
   for the harness to settle, then send the new instruction. For steer, read the OpenCode
   comparison first (`opencode-comparison.md`, same folder): their design treats a
   mid-turn message as durable data, a per-session inbox row marked "steer" or "queue" that
   the loop picks up at safe boundaries, instead of a dispatch-time judgment call. That
   pattern is the recommended shape for our steer semantics, because it is exactly what
   makes "a new message must never be swallowed by parked work" structural rather than
   heuristic. The kill command and the heartbeat interrupt flag already exist; you are
   building the dispatch semantics and the surface on top of them.

Out of scope for now: session deletion and live mid-turn attach.

## 5. What to read, and why each matters to you

- `docs/design/agent-workflows/projects/sessions-takeover/arda-branch-reconciliation.md`.
  The commit-by-commit map of your branch, which commits ship and which do not, the four
  overlap verdicts, and the extraction plan. This is the primary evidence behind section 2;
  read it first.
- `docs/design/agent-workflows/scratch/debug-concurrent-approvals-db58551b.md`. The incident
  reconstruction and the four defects. This is why the machinery ruling went the way it did,
  and it is the ground truth for the guardrails on your first two tasks.
- `docs/design/agent-workflows/scratch/zed-acp-approvals-comparison.md`. Where cancel and
  steer come from. The "Recommended changes" section gives the exact cancel-then-restart
  protocol shape you will build in task 5, and it explains why the adapter serializes gates.
- `docs/design/agent-workflows/projects/sessions-takeover/architecture.md`. The six storage
  planes at working depth, verified against real database rows. You do not need to absorb it
  all; the parts that touch your tasks are section 4 (the streams and liveness plane, for
  cancel and steer), section 5 (the interactions plane, for open question 6.2), and section 9
  (the gaps that became your roadmap). Treat it as reference, not as required reading.
- PR #5382 and PR #5436 descriptions, for the exact shape of what merges beneath you. Your
  own PR #5426 description, for the record of what you built and where each piece landed.

## 6. Two questions Mahmoud wants your read on

Neither is settled. Your view as the frontend owner is why he is asking.

### 6.1 The streams-table rename

The table named `session_streams` stores no streamed frames; the architecture document opens
by killing exactly that mental model (architecture document, page 1, mental model 2). It
holds liveness and ownership, and it now also carries the session identity, the `name` and
`description` header. The name misleads on both counts. The open question is whether to rename
the table so its name matches what it holds. You read and write this row from the frontend
(session fetch, and the rename UI you are about to wire in task 4), so the churn and the
clarity both land partly on you. Weigh in on whether the rename is worth it and what the name
should be.

### 6.2 The interactions guard ruling

The runner refuses to create an interaction row when the run context carries no
`workflow_revision` reference, because the respond path could not re-invoke anything without
it. The consequence is that gates in that state are answerable in-band only and are invisible
to any interactions-plane inbox; a real QA session had approval records but zero interaction
rows for exactly this reason (architecture document, section 5, "Sharp edges"). The open
question is whether to keep that guard as is, accepting that some gates never get a durable
interaction row, or to relax it. It matters to any future approval-inbox surface, which is
your territory. Weigh in on which way it should go.
