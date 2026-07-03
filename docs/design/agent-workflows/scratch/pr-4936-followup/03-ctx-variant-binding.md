# Thread 03 — How the agent targets its own variant

## Context

For `commit_revision` (and `create_schedule` / `create_subscription`) the agent must
edit the variant it is running, never another. This thread is how that target is found,
why it was empty in the playground (Bug A), and what happens for drafts.

## Explanations

- The model never sends the variant id. It is stripped from the model-visible schema
  and bound server-side from `$ctx.workflow.variant.id`.
- `$ctx` comes from `runContext`, which the agent service builds from the run's tracing
  references (`TracingContext.references`). The resolver and the running decorator stamp
  those from the run's invocation target. This is the SOLE server-side home for the
  identity. Confirmed: nothing stashes it on `request.state` or `RunningContext`.
- The frontend sends the target as references on the run request, NOT as a tool
  argument:
  - Saved (clean) run: sends all three, `application` + `application_variant` +
    `application_revision` (`agentRequest.ts:86-117`, gate at `:349-353`).
  - Draft run: sends NO references at all, on purpose (`agentRequest.ts:336-348`).
- **Bug A was purely consumer-side.** The frontend and resolver correctly sent
  `application*` references. The old run-context builder read only `workflow*` keys, so
  it found nothing. Fix: `tracing.py` now also reads `application*` / `evaluator*` and
  normalizes them (`tracing.py:107-124`). Nothing on the invocation side was wrong.
- The new `direct.ts` fails closed: if the binding is empty it throws instead of
  committing with no target.

### The draft case (corrects an earlier assumption)

For a draft, the frontend sends no references, so `commit_revision` FAILS CLOSED today.
The binding is empty, `direct.ts` throws, the model gets a tool error, no commit is
sent. `commit_revision` works only on a saved/clean run.

This is deliberate. The frontend drops even the bare variant ref because the resolver
would re-resolve it to the variant's LATEST committed revision, which can differ from
the draft config actually running. Committing onto that mismatched base would be wrong.
So "latest revision of the default variant" is NOT what the code does; it is the exact
thing the frontend avoids.

## History

- Bug A: `commit_revision` committed nothing in the playground (no target).
- #4936 fixed it consumer-side (`tracing.py` reads `application*`) and made `direct.ts`
  fail loud.
- Research confirmed: producer was correct, bug was consumer-only, drafts send no refs,
  and `commit_revision` is intentionally inoperative on a draft.
- Correction logged: an earlier note guessed drafts carry a variant ref. They do not.

## Open decision threads

**D1. Should `commit_revision` work on a draft at all?**
Today it cannot (fails closed by design). If a user edits an unsaved draft and asks the
agent to commit, they get a tool error.
- (a) Keep as is: require a saved run before self-commit. Simplest, safest.
- (b) Allow it: commit the draft's inline config as a new revision on the variant. Needs
  a deliberate target rule and a clear message about what gets saved.
My recommendation: (a) for now; revisit if users hit it. The fail-closed behavior is
correct, not a bug.

Your decision: **(a) — approved, with a UX refinement.** Fail-closed on a draft is the right
behavior. But the message returned TO THE MODEL must be actionable, not opaque: when a
self-update tool is called while running a draft (no saved revision bound), return something
like "This updates the configuration you are running, which is an unsaved draft. Ask the user
to commit/save it first, then call this tool again." The model then tells the user to save.
Resolves together with D2 (one generic, no-field-name, actionable message). Implemented as
part of the `commit_revision` tool work (thread 01).

**D2. (Low) The `direct.ts` error message leaks the internal field name to the model.**
Make it generic ("tool unavailable in this run context") and log the path server-side?
My recommendation: yes, small hardening; fold into the cleanup.

Your decision: **approved.** The binding-missing error for self-update tools becomes ONE
message that is both generic (no internal field name, logged server-side) AND actionable (the
draft guidance from D1). Lands with the `commit_revision` tool work (thread 01).
