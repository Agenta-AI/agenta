# Status

This file records the project's current state.

## State

The design has one open product decision (D11, what the first release promises) and six open
implementation questions; see [decisions.md](decisions.md) for the list. The problem is verified
against code, the research covers the mounts surface, the modality taxonomy, the ACP content model
read from the two adapters we actually pin, and how other tools handle attachments, and every major
choice is written as options and a decision. Implementation has not started.

The one-line problem: agent workflows are text-only at the model. A file travels intact from the
chat box to the runner and is dropped at the one call that hands a turn to the harness
(`services/runner/src/engines/sandbox_agent/run-turn.ts`, the `session.prompt` call, currently near
line 742). The image fix is entirely on our side of that call, because both pinned adapters deliver
an image natively. Native audio and native documents are different: neither pinned adapter supports
them today, so those modalities are blocked on adapter work.

## Reading order

See [README.md](README.md). In short: [context.md](context.md) for the plain story,
[research.md](research.md) for the findings, [design.md](design.md) for the design and its options,
[plan.md](plan.md) for the staged work, [scope.md](scope.md) for in and out, and
[decisions.md](decisions.md) for the log and open questions.

## Stage tracker

| Stage | Scope | State |
| --- | --- | --- |
| 0 | Close the silent-failure gap: refuse paste and drop while the feature is off | not started (optional) |
| 1 | First user-visible release: the attachment resource and storage, the record-schema extension, the runner's resolve-materialize-and-deliver seam for images, structured capability errors, and the minimum security and limits work | not started |
| 2 | Audio and documents: add the `audio` block, map audio and documents, retire the old capability names through an alias rollout, derive front-end limits | blocked on adapter work |
| 3 | Findability polish and cleanup: "Shared by you" origin, reference-counting cleanup refinement, read-only credential scope, verify the edit-then-find flow | not started |

## Decisions taken

See the decision log in [decisions.md](decisions.md) (D1 through D11, with D11 still open). In brief:
deliver inline for perception and on disk for tool use; keep the original in a dedicated session mount
out of the sandbox; two copies, an unchanging original and a disposable working copy; compute the
capability as the intersection of transport, adapter fidelity, and model, and gate in the composer and
the runner; never silently drop, attach an unsupported kind as workspace-only, and fail the turn only
on a contract violation; enforce immutability through a create-only upload route with no signed
credentials for the mount; carry an opaque server-issued `attachment_id` on the wire (D10); audio is
a goal but blocked on adapter work.

## Open questions

See [decisions.md](decisions.md). Three questions are settled by evidence (document delivery, the
working-copy path, the runner read path); decisions.md records them. The open
questions are: what the first release promises (D11, the product owner's decision); how native audio is
delivered at all (blocked on adapter work); the cold-replay budget numbers; when the old capability
names are removed across independently deployed components; the retention rules when a session is
archived or deleted; the exact media-type and validation matrix; and the cleanup refinement from a
time-to-live sweep to reference counting.

## Next actions

- The product owner decides the open product question D11 (what the first release promises) on the PR.
- Decide whether Stage 0 ships on its own or folds into Stage 1.
- The runner-rebuilds-context-from-records direction is tracked in
  [#5443](https://github.com/Agenta-AI/agenta/issues/5443) (the warm-case counterpart is #5384). It
  stays outside this project's scope.

## Artifacts

- [README.md](README.md) · [context.md](context.md) · [research.md](research.md) ·
  [design.md](design.md) · [plan.md](plan.md) · [scope.md](scope.md) · [decisions.md](decisions.md)
- Branch: `docs/agent-multi-modality` (docs only).
