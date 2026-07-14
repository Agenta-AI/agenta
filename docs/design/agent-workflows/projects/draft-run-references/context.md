# Context

## The problem in one sentence

An agent that edits its own configuration can commit the change once, then every later
commit in the same chat fails with a run-context error, until the page reloads.

## What the user sees

You open an agent in the playground and chat with it. You ask it to add some tools. The
agent calls the `commit_revision` tool to save the new configuration. The first commit
works. A new version appears.

Then you ask for another change in the same conversation. The agent calls `commit_revision`
again. This time it fails. The error is:

```
missing run-context value for direct-call binding 'workflow_revision.workflow_variant_id'
```

Every commit after the first one fails the same way. The only fix is to reload the page.

This was reproduced in two recorded sessions:

- `c6de1865` on 2026-07-07.
- `8110bba2` on 2026-07-08.

Both timelines are saved at the repository root as `turn-*.md` files.

## Why this matters

Self-editing is the core loop of the builder agent. The whole point is that you talk to
the agent and it configures itself: it adds tools, edits its prompt, changes its model,
then commits the result. If the second commit in a conversation always fails, the agent
can make exactly one change per page load. That breaks the core experience.

## What this project delivers

This is a design-only workspace. It explains the bug from the ground up, lays out two fixes
with their trade-offs, recommends one, and defines how to verify it. No code changes here.
Implementation follows after review.

## Goals

- Explain, for a reader who has never seen this code, exactly how a commit fails.
- Recommend one fix with clear reasoning.
- Make sure the fix does not break the draft-mode rules that the same code path relies on.
- Define acceptance checks and a test plan.

## Non-goals

- Changing the wire contract between the frontend, the SDK, and the runner.
- Redesigning how run context is assembled. That is a larger effort tracked separately (see
  the related work in plan.md).
- Fixing the case of a brand-new agent that has never been committed. That agent has no
  variant yet, so its first commit is a different flow. This project targets the reported
  loop: an agent that was committed once and then keeps failing.

## Background: the three moving parts

Three layers cooperate on every agent run. You need all three to understand the bug.

1. **The playground (frontend).** It builds the `/invoke` request. It decides what identity
   information to attach to the run, in a block called `references`.
2. **The SDK and service (Python).** They receive the request, assemble a "run context" from
   the references, and hand the run to the runner.
3. **The runner (TypeScript).** It runs the agent loop. When the agent calls a platform tool
   like `commit_revision`, the runner fills in server-owned fields from the run context.

The bug is a disagreement between these layers about one field: which variant is running.
research.md traces the field through all three layers. plan.md proposes the fix.
