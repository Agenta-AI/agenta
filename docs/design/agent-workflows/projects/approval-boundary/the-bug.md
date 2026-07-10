# The bug: an auto-approved run stops at the tool gate

Prerequisite: [how-approvals-work.md](how-approvals-work.md), especially "Gate 2" and "The
journey of one gated tool call".

## What you observe

The `uc9-digest` agent (three read tools, then `SEND_MESSAGE`) runs with permission policy
`auto`. A one-shot HTTP invoke should run all four tools and finish. Instead:

- **Streaming**: the stream shows the three reads with results, then a `tool_call` for
  `SEND_MESSAGE`, then an `interaction_request` asking for approval, then `done`. Four tool
  calls, three results. The run ended waiting for an approval that no one can give.
- **Batch**: the response is HTTP 200 with one assistant message that ends mid-sentence,
  right before the terminal tool ("...posting the digest now."). Nothing indicates the run
  stopped. The caller cannot tell a paused run from a finished one.

Before diagnosing, be precise about what *should* happen, because it is subtler than "the
run should never pause". Every tool resolves to an **effective permission**: its final
`allow | ask | deny`, computed from the author's explicit per-tool permission, the legacy
`needs_approval` flag, or a catalog hint that defaults read-only tools to `allow` and
mutating tools to `ask` (`effective_permission`,
`sdks/python/agenta/sdk/agents/tools/models.py:273-292`). Tools with no effective permission at all
fall back to the global policy, and that is what `auto` governs.

`SEND_MESSAGE` is a write, so it resolves to `ask` by default. Under a correct
implementation, this specific run pauses there until the author marks the tool `allow`.
The bug is therefore three things, none of which is "it paused":

- the pause happens for the wrong reason (a session id instead of the tool's effective permission);
- the `auto` policy is dead code for the tools it does govern;
- a headless caller can neither see the pause nor answer it.

Auto-approval itself is a decision our own runner makes internally; it is not a human
interaction. When the policy says `auto`, nobody should be asked for anything.

## The root cause, in four steps

Each step is small and looks reasonable alone. Together they make the `auto` policy
unreachable.

**1. The responder parks before it reads the policy.** `HITLResponder.onPermission`
(`services/runner/src/responder.ts:201-206`) checks three things in order: a stored decision
from a previous turn, then `hasHumanSurface`, then the policy. When a gate is fresh (no
stored decision) and `hasHumanSurface` is true, it returns `park` without ever looking at
`basePolicy`. The policy only applies when there is no human surface.

**2. "Human surface" means "the request has a session id".**
`services/runner/src/engines/sandbox_agent.ts:627`:

```ts
const hasHumanSurface = !!(request.sessionId && request.sessionId.trim());
```

The comment above it (lines 621-626) explains the design assumption: interactive `/messages`
runs carry a session id, the headless `/invoke` path sets none, so a session id is a good
proxy for "someone is watching the stream".

**3. That assumption is false: the SDK mints a session id for every run.** The request
normalizer resolves a session id before any handler runs, and when the caller supplied none
it mints a fresh UUID (`sdks/python/agenta/sdk/middlewares/running/normalizer.py:307`,
`sdks/python/agenta/sdk/models/shared.py:13-22`). It does this for batch and streaming
alike. The id flows into the run request (`services/oss/src/agent/app.py:216, 254`), so
every run the runner ever sees has a non-empty `sessionId`.

**4. Therefore every fresh gate parks.** `hasHumanSurface` is always true, branch 2 always
wins, and `basePolicy === "auto"` is dead code for any harness that raises gates. A headless
one-shot invoke parks at the first gated tool exactly like an interactive playground run.
The turn ends `stopReason: "paused"`.

Two aggravators hide the failure:

- **Batch swallows the stop reason.** `_agent_batch`
  (`services/oss/src/agent/app.py:303-321`) drains the event stream and returns only the
  final assistant text. `result.stop_reason` (`"paused"`) is read nowhere. A paused run and
  a completed run produce the same-shaped 200 response.
- **The playground auto-resumes.** `useChat` re-sends the conversation the moment you click
  Approve, so in the one surface humans actually watch, the park looks like a feature. Every
  surface without a human (curl, agent-as-tool, evaluations, triggers) just dies at the
  gate.

## Why the code is this way: the history

The park mechanism is not an accident; it is a deliberate fix for an earlier bug, and this
bug is that fix's blind spot.

- Originally the runner answered every gate inline with a hardcoded auto-approve. No run
  ever paused, and no human could ever be asked.
- The human-in-the-loop work (see `../hitl-fix/`, QA finding F-024) needed a way to pause a
  run for an approval. First attempt: answer "reject" and let the frontend prompt. That
  broke the UI, because Claude turns a reject into a failed tool call, and the failure
  overwrote the approval prompt on screen.
- The fix (commit `b109cc51ef`, 2026-06-25) introduced the real park: send the harness no
  answer at all, tear the session down, resume on a later turn. Correct mechanism, and it
  fixed F-024. A follow-up (F-040) made sure the teardown is active: without it, a parked
  turn whose harness never gives up just hangs. So park has two ancestors: F-024 says
  "never answer reject when you mean pause", F-040 says "a pause must still end the turn".
- But the condition for parking was written as "is a human surface present" and implemented
  as "is there a session id", at a time when the invoke path really did omit session ids.
  When the SDK later started minting ids for every request (for tracing and session
  bookkeeping), the proxy silently went from "sometimes true" to "always true". No test
  pinned "a headless auto run does not park", so nothing failed.

One runner unit test actually pins the buggy behavior as correct:
`services/runner/tests/unit/responder.test.ts` (around line 227) asserts that the responder
parks when a human surface exists "even under deny basePolicy". Under the fix, that test
changes meaning.

## The real design flaw underneath

The one-line diagnosis is: **the runner infers intent from transport metadata.** Whether a
tool call needs a human is a question about the tool and the author's config (`ask` vs
`allow` vs the policy default). The runner instead asks "did this request arrive with a
session id", which is a fact about plumbing, and the plumbing changed underneath it.

The information the responder actually needs already exists and already travels to the
runner: every resolved tool carries its `permission` (`allow | ask | deny`) on the run
request (`services/runner/src/protocol.ts:122-128, 220-225`). The responder just never reads
it. The relay reads it for its own gate, and the Claude settings renderer reads it a third
time on the Python side. Three enforcement points, each consulting a different subset of the
same config; the one that decides about parking consults none of it.

[design-review.md](design-review.md) develops this into concrete recommendations;
[plan.md](plan.md) sequences the fix.

## The shape of the fix (summary; details in plan.md)

Park only on authored intent, never on transport hints:

- The responder resolves the gated tool's own permission from the run request: explicit
  `allow` allows, `deny` denies, `ask` parks.
- A tool with no explicit permission falls back to the policy: `auto` allows in place (the
  run streams the tool result and finishes), `deny` denies.
- `hasHumanSurface` is deleted. An `ask` tool parks even on a headless run; that pause is
  authored, visible, and answerable later once the interactions plane grows a real resume.
- Batch stops hiding the pause: `/invoke` surfaces `stop_reason` so a caller can tell
  "paused at an approval" from "done".

This keeps the playground behavior for tools that genuinely ask (`ask` tools still park and
still show buttons), restores `auto` to its documented meaning everywhere, and removes the
signal that rotted once already.
