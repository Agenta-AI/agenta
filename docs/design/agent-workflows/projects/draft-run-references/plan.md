# Plan: restore the variant identity on a draft run

Read research.md first. It proves the mechanism. This document chooses the fix.

Tracking issue: https://github.com/Agenta-AI/agenta/issues/5162

## The decision in one line

Stop dropping the variant and application references on a dirty run. Keep withholding only
the revision reference, because the revision is what marks a run as non-draft. The variant
says which variant is running, the application says which app it belongs to, and
`commit_revision` needs the variant.

## What must stay true

Any fix has to hold three invariants at once. research.md shows how they interact.

1. **A committed-revision run stays non-draft.** A clean run (no unsaved edits) must still
   send all three references, so `is_draft` is false and the run is pinned to its committed
   snapshot.
2. **A dirty inline-config run stays a draft.** When the panel has unsaved edits, the run is
   an inline draft. `is_draft` must stay true. Since `is_draft` keys only on the revision
   reference (`tracing.py:165`), the run must not carry a revision reference.
3. **`commit_revision` always has a variant target.** The run must carry the variant identity
   whenever a real committed variant exists, draft or not.

The current code satisfies 1 and 2 but breaks 3, because it drops the variant along with the
revision.

## Option 1 (recommended): fix the frontend read path

### What changes

In `agentRequest.ts`, replace the all-or-nothing gate with a field-level gate. Always forward
the `application` and `application_variant` references when they exist. Forward
`application_revision` only when the run is clean (`!isDirty`).

Today:

```typescript
const references = isCommittedRevisionRun ? fullReferences : null
```

After (illustrative, final shape decided at implementation):

```typescript
// Always identify WHICH variant is running (well-defined even for a dirty draft).
// Forward the committed-revision reference ONLY on a clean run, so a dirty run stays
// is_draft=true. The variant is orthogonal to draft-ness (see research.md).
const references = fullReferences
    ? {
          ...(fullReferences.application ? {application: fullReferences.application} : {}),
          ...(fullReferences.application_variant
              ? {application_variant: fullReferences.application_variant}
              : {}),
          ...(isCommittedRevisionRun
              ? {application_revision: fullReferences.application_revision}
              : {}),
      }
    : null
```

### The reference block, before and after the fix

For a dirty run of an agent that was committed once:

- **Before:** `references: null`. `commit_revision` throws.
- **After:** `references: {application: {...}, application_variant: {...}}`. Run context has
  `variant.id` set and `revision` unset, so `is_draft` is true and the commit works.

A clean run is unchanged: it still sends all three families and stays non-draft.

### Why this is the right layer

- It matches the repo rule to normalize on the frontend read path. The frontend is where the
  run identity is decided, and it is the layer that knows exactly which variant is loaded.
- It is small. It touches one expression in one file.
- It preserves `is_draft` by construction. The draft signal is the revision reference, and
  the fix keeps gating that reference on `!isDirty`.
- It needs no wire change, no SDK change, no runner change. The backend already reads the
  variant reference it is handed (`tracing.py:155-158`).

### Trade-offs and how we cover them

- **It relies on a verified invariant.** research.md proves that a playground run always
  sends `data.parameters`, so the backend never re-resolves the forwarded variant to a HEAD
  revision (`resolver.py:577-582`). If a future change ever sent a references-only agent run
  with no parameters, forwarding a bare variant would hydrate it to a HEAD revision and flip
  `is_draft` to false. We lock this invariant with a unit test (see the test plan) so a
  regression is caught in CI rather than in production.
- **A never-committed local draft still cannot self-commit.** `buildAgentReferences` drops
  non-UUID ids, so a brand-new agent that was never saved has no real variant id to forward,
  and `commit_revision` still has no target. This is correct and out of scope: there is no
  variant to commit to yet. The reported loop is about an agent that was committed once and
  then keeps failing, and that agent has a real variant id. We note this edge here so the
  reviewer knows it is deliberate, not missed.

## Option 2: derive the variant in the service from the app id

### What changes

The service would look up the variant from `application_id` (which is on the URL query even
for a draft run, `agentRequest.ts:378-386`) whenever the request carries no explicit variant
reference. It would then fill `runContext.workflow.variant` from that lookup.

### Trade-offs

- **Larger blast radius.** The change spreads across the SDK reference assembly and the
  service run-context builder, and it adds a database lookup on a path that today reads only
  what the client sent.
- **Ambiguous for multi-variant apps.** An app can have more than one variant. The app id
  alone does not say which variant is running. The service could guess (for example, the most
  recent variant), but a guess can bind the wrong variant and commit to it. That is a
  correctness risk on a write operation.
- **Wrong layer for a client-known fact.** The frontend already knows exactly which variant
  is loaded. Recovering that identity in the backend from a weaker signal is more code to do
  a worse job.

Option 2 does have one attraction: it works even if the frontend never sends a variant. But
the frontend does know the variant, so that robustness buys little and costs correctness.

## Recommendation

Take **Option 1**. It is the smallest change, it lives in the layer that owns the decision,
it preserves `is_draft` by construction, and it avoids the multi-variant ambiguity that makes
Option 2 risky on a write path. Option 2's only edge (surviving a frontend that sends no
variant) does not apply, because the frontend has the variant and can send it.

## What happens after a successful self-commit

A successful `commit_revision` creates a new revision and moves the HEAD. Two questions
follow.

1. **Does the next commit work without a page reload?** With Option 1, yes. The variant
   identity is forwarded on every run regardless of `isDirty`, so a second commit in the same
   conversation has its target. The loop described in research.md is broken at the source. No
   reload is required for correctness.
2. **Does the panel re-sync to the new revision on its own?** Yes, in the common case it
   already does. A mechanism added in issue #4920 repoints the panel after a self-commit: the
   backend emits a `data-committed-revision` event from the `commit_revision` output, and the
   chat panel reacts by switching the loaded entity to the new revision id (research.md,
   "After a self-commit, the panel already repoints to the new revision"). The new revision
   has no draft overlay, so `isDirty` resets to false and the version chip reflects the new
   committed state. This is a display improvement, not a correctness requirement, and it is
   not fully reliable: if the stream is aborted or the event is missed, the panel stays on the
   old revision and reads as dirty. Option 1 is what makes the run correct in that case,
   because it forwards the variant regardless of panel state. The two concerns stay decoupled:
   the repointing keeps the UI honest, and Option 1 keeps `commit_revision` working even when
   the repointing does not land.

Draft-mode semantics do not regress under Option 1. A clean run sends all three references
and stays non-draft. A dirty run sends the variant but not the revision and stays a draft.
The variant identity and the draft flag move independently, which is exactly what
`tracing.py` already expects.

## Adjacent work: server-stamped identity in run context

A separate design, the session keep-alive project, is landing follow-ups that also enrich the
run context. Its follow-up 5 (`docs/design/agent-workflows/projects/session-keepalive/status.md`,
decision 1 and follow-up 5) moves the session pool's project scope off the sandbox mount and
stamps a server-verified `project_id` into `runContext`. The two designs are adjacent because
both add identity to `runContext`, but they do not overlap:

- Follow-up 5 stamps **project identity**, server-side, from request auth state.
- This design fixes **variant identity**, by forwarding the variant reference that the service
  already resolves into `runContext.workflow`.

They do not contradict each other. One fills the project scope; the other fills the variant
scope.

There is a natural long-term direction that unifies them. Today the variant identity is
trusted from the client `references` block. The project identity in follow-up 5 is instead
derived server-side from request state, which is stronger, because the server does not have to
trust the client for it. The eventual end-state is a single "server-stamped identity in run
context" where both the project and the workflow or variant identity are derived server-side
from the authenticated request, so `commit_revision`'s variant binding is immune to whatever
the client sends. That is a larger change and out of scope here. Option 1 is the correct
minimal fix now, and it does not block that end-state; it fills the same `runContext.workflow`
field the server-stamped version would later own.

## Acceptance checks

- A dirty run of a committed agent sends a `references` block that contains `application` and
  `application_variant` and does **not** contain `application_revision`.
- A clean run of a committed agent still sends all three reference families.
- The run context for a dirty run has `workflow.variant.id` set and `workflow.is_draft` true.
- `commit_revision` succeeds on the second and later calls within one conversation, with no
  page reload.
- A never-committed local draft still sends no variant (unchanged), because there is no real
  variant id yet.

## Test plan

**Unit, frontend (`buildAgentRequest` reference gating).** Add cases to the request-builder
tests:

- Clean, committed revision: `references` contains all three families.
- Dirty, committed revision: `references` contains `application` and `application_variant`,
  and omits `application_revision`.
- Local draft (non-UUID ids): `references` is null (no variant forwarded), unchanged.
- Invariant guard: a dirty committed run still sets `data.parameters`, so the backend
  hydration gate never fires. Assert the request carries `data.parameters` alongside the
  bare-variant references, documenting the invariant Option 1 depends on.

**Integration or replay, the self-commit loop.** Turn the reported failure into a regression
test using the agent-replay approach (see the `agent-replay-test` skill). Capture a real run
where the agent commits, then commits again in the same conversation. Assert:

- The first `commit_revision` succeeds.
- The second `commit_revision` in the same conversation succeeds (today it fails).
- The second run's run context still reports `is_draft` true (the draft signal did not
  regress when the variant was forwarded).

**Live check (optional, during implementation).** Reproduce in the playground on the dev box:
open a committed agent, ask for two changes in one conversation, confirm both commits land and
two new versions appear without reloading.
