# Context

## What this workspace is

This workspace explains how tool permissions and approvals work in the agent runtime, from
the playground form down to the Claude Code harness. It then explains one confirmed bug in
that flow, reviews the code that implements it, and proposes a plan that fixes the bug and
the design weaknesses that produced it.

Read [how-approvals-work.md](how-approvals-work.md) first. Every other document builds on it.

## The symptom that started this

A repo-digest agent (`uc9-digest`) has four tools: three read-only lookups (`LIST_COMMITS`,
`LIST_REPOSITORY_ISSUES`, `LIST_ALL_CHANNELS`) and one side-effecting write (`SEND_MESSAGE`,
which posts to Slack). The agent's permission policy is `auto`, which is documented as
"approve tool prompts automatically, do not wait for a human."

A one-shot HTTP call to this agent stops before the last tool. The three reads run. Then the
run emits a request for human approval of `SEND_MESSAGE` and ends. Nobody is there to
approve, and a one-shot call has no way to answer, so the run just stops. The batch response
makes it worse: it returns HTTP 200 with a mid-sentence assistant reply and no hint that the
run paused.

The same agent works in the playground. That is not because the playground avoids the pause.
It hits the same pause, shows an Approve button, and quietly re-sends the conversation after
you click it. The playground papers over a stop that kills every caller without a human and
a resend loop.

## Why this is a bug and not a policy choice

The author asked for `auto`. The code that should honor `auto` is never reached. The runner
decides "park and wait for a human" based on whether the request carries a session id, and
the SDK now mints a session id for every request. So the `auto` policy is dead code, and the
run's own comment ("the headless invoke path sets no session id") describes a world that no
longer exists. [the-bug.md](the-bug.md) walks the exact chain.

## Scope

In scope:

- Explaining the whole permission and approval flow in plain words, with current file
  references (`services/agent/` was renamed to `services/runner/`; older docs cite stale
  paths).
- The bug: root cause, history, and a concrete fix.
- A review of the permission/approval code for correctness and for organization.
- A plan that fixes the bug now and simplifies the design so this class of bug stops
  recurring.

Out of scope:

- Changing how batch vs streaming invoke returns results. That work lives in the sibling
  workspace `../builder-agent-reliability/streaming-invoke/`.
- Wiring the durable interactions plane end to end. The API side exists and is half wired by
  design; the product currently resolves approvals through the frontend. We only make sure
  the plan does not fight that future work.
- Backward compatibility. The whole big-agents feature is a pre-release POC. We can rename
  fields and change behavior freely.

## Decisions already taken by the owner

- **Auto means auto everywhere.** When the policy auto-approves a tool, the tool runs and
  the human sees that it ran. No prompt, in the playground or anywhere else. Only an
  explicit "ask" should wait for a human.
- This PR ships documentation and a plan. Implementation follows in a separate PR once the
  plan is reviewed.

## Related workspaces

- `../capability-config/` designed the three-layer permission model this doc builds on. Its
  proposal already warns against the exact confusion behind this bug.
- `../hitl-fix/` fixed an earlier approval bug (the runner used to answer "reject" when it
  wanted to pause, which broke the approval UI). The fix introduced "park", and the park
  condition is what this workspace corrects.
- `../builder-agent-reliability/streaming-invoke/` found this bug while investigating
  partial batch output. Its `approval-boundary.md` holds the first investigation; this
  workspace supersedes it with verified current paths and a broader review.
