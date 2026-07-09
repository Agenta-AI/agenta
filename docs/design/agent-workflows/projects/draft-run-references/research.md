# Research: how a self-commit fails

This document traces the bug through all three layers. Read it top to bottom. Each section
builds on the one before it. File and line citations are exact as of the commit recorded in
status.md.

## The tool that fails: commit_revision

`commit_revision` is a platform op. A platform op is a tool whose call is turned into a
direct HTTP request to the Agenta API, with some fields filled by the server instead of by
the model.

`commit_revision` needs to know which variant to commit to. That variant id is never
supplied by the model. Two things make that true:

1. The variant id is declared as a **context binding**, not a model input. The catalog entry
   binds the request body field `workflow_revision.workflow_variant_id` to the run-context
   token `$ctx.workflow.variant.id`:

   ```python
   PlatformOp(
       op="commit_revision",
       ...
       context_bindings={
           "workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id"
       },
   )
   ```

   (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:1090-1100`)

2. The variant id is **stripped from the schema the model sees**. When the catalog builds the
   model-visible input schema, it removes every field named in `context_bindings`, so the
   model cannot and does not pass it:

   ```python
   for field in self.context_bindings:
       _strip_field(schema, field)
   ```

   (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:156-173`)

So the variant id must come from the run context. If the run context does not carry it, the
call has no target.

## Where the runner throws

When the runner executes a direct call, it fills each context binding last, after the model
args and the static body. If a binding token resolves to `undefined`, the runner throws
instead of sending a call with a missing field:

```typescript
if (call.context) {
  for (const [bodyPath, token] of Object.entries(call.context)) {
    deepDelete(body, bodyPath);
    const value = resolveCtxToken(runContext, token);
    if (value === undefined) {
      throw new Error(
        `missing run-context value for direct-call binding '${bodyPath}'`,
      );
    }
    deepSet(body, bodyPath, value);
  }
}
```

(`services/runner/src/tools/direct.ts:226-236`)

This is the exact error the user sees. The token `$ctx.workflow.variant.id` resolved to
`undefined`. Failing closed here is deliberate: a direct call that declares a context binding
must have that context, or it could target the wrong thing.

So the question becomes: why is `runContext.workflow.variant.id` sometimes undefined?

## Where run context comes from

The runner receives the run context from the Python side. The workflow part of the run
context is assembled from the tracing references:

```python
def _run_context_workflow() -> Optional[RunContextWorkflow]:
    references = TracingContext.get().references
    revision = _run_context_reference_from_any(
        references,
        ("workflow_revision", "application_revision", "evaluator_revision"),
        with_version=True,
    )
    workflow = RunContextWorkflow(
        artifact=_run_context_reference_from_any(
            references, ("workflow", "application", "evaluator")
        ),
        variant=_run_context_reference_from_any(
            references,
            ("workflow_variant", "application_variant", "evaluator_variant"),
        ),
        revision=revision,
    )
    if not workflow.model_dump(exclude_none=True):
        return None
    workflow.is_draft = revision is None
    return workflow
```

(`sdks/python/agenta/sdk/agents/tracing.py:135-166`)

Read this carefully, because it holds the key to the whole design.

- The **variant** comes from the `application_variant` reference (or `workflow_variant`, or
  `evaluator_variant`).
- The **revision** comes from the `application_revision` reference.
- `is_draft` is `True` when there is **no revision reference**. Nothing else sets it.
- If the references carry no workflow identity at all, the whole workflow context is `None`,
  and `variant.id` is undefined.

Two facts fall out of this, and they are the heart of the fix:

1. **Variant identity and draft-ness are independent.** The variant reference decides which
   variant is running. The revision reference decides whether the run is a draft. You can
   have a variant with no revision. That is a draft run of a known variant.
2. **Dropping the variant reference destroys the target for `commit_revision`.** With no
   variant reference, `variant.id` is undefined, and the runner throws.

## Where the references come from

The tracing references are set from the `/invoke` request's `references` block. The running
decorator merges the request references onto the tracing context:

```python
_references = {**(self.references or {}), **(request.references or {})}
...
tracing_ctx.references = _references
```

(`sdks/python/agenta/sdk/decorators/running.py:354, 376`)

So whatever the frontend puts in `references` is what the run context is built from. If the
frontend sends `references: null`, the tracing context has no references, the workflow
context is `None`, and `commit_revision` has no variant to target.

## The frontend decision that causes the bug

The playground builds the references from the loaded revision entity. `buildAgentReferences`
produces up to three families from the entity's ids: `application`, `application_variant`,
and `application_revision` (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:86-117`).

Then the request builder decides whether to forward them:

```typescript
const fullReferences = buildAgentReferences(entity)
const isDirty = store.get(workflowMolecule.selectors.isDirty(entityId)) as boolean
const isCommittedRevisionRun =
    !isDirty && typeof fullReferences?.application_revision?.id === "string"
const references = isCommittedRevisionRun ? fullReferences : null
```

(`web/packages/agenta-playground/src/state/execution/agentRequest.ts:355-359`)

This is an all-or-nothing gate. If the config panel is clean (no unsaved edits) and there is
a real committed revision, the run forwards **all** references. Otherwise it forwards
**none**, including the `application` and `application_variant` references.

Dropping those two on a dirty run is the bug. The gate had one good reason and one wrong
reason to withhold the revision reference, and it then swept the variant and app references
along with it:

- The good reason: a dirty run is an inline-config draft, so forwarding the revision would
  wrongly mark the run as non-draft. Draft-ness keys only on the revision reference
  (`tracing.py:165`), so the revision must stay out of a dirty run. That part is correct.
- The wrong reason: the code comment claimed the backend would re-resolve a bare variant
  reference to its latest revision, so it dropped the variant too, out of caution. The next
  section proves that claim does not hold for a playground run. The caution is what removed
  the variant, and the variant is exactly what `commit_revision` needs.

The application reference should never have been dropped at all. It carries no draft signal.
This PR changes the gate to forward `application` and `application_variant` on every run and
to gate only `application_revision` on cleanliness. See plan.md, Option 1.

## Worked example: the reference block, clean versus dirty

**Clean run (the loaded revision has no unsaved edits, `isDirty` is false).** The request sends:

```json
"references": {
  "application":          {"id": "<app-uuid>",     "slug": "my-agent"},
  "application_variant":  {"id": "<variant-uuid>", "slug": "my-agent.default"},
  "application_revision": {"id": "<rev-uuid>",     "slug": "...", "version": "3"}
}
```

Run context: artifact set, variant set, revision set. `is_draft` is false. `variant.id` is
bound. `commit_revision` works.

**Dirty run today (the loaded revision has unsaved edits, `isDirty` is true).** The request sends:

```json
"references": null
```

Run context: no workflow identity at all. `variant.id` is undefined. `commit_revision`
throws the reported error.

## What "dirty" means, and why the loop happens

This section answers the "works, then stops working in the same conversation" symptom. It
first pins down what `isDirty` actually compares, because the mechanism is not the one an
early reading of this bug assumed.

### The dirty check compares a revision against its own snapshot

`isDirty` comes from `workflowMolecule.selectors.isDirty`, which reads
`workflowIsDirtyAtomFamily`
(`web/packages/agenta-entities/src/workflow/state/store.ts:1897-1934, 2011-2034`). For the
loaded revision, it compares two things:

- the draft overlay for that revision (`workflowBaseEntityAtomFamily(workflowId)`), which
  holds the user's unsaved edits to the config panel, and
- that same revision's own fetched server snapshot
  (`workflowServerDataSelectorFamily(workflowId)` → `workflowQueryAtomFamily`, store.ts:2192-2221
  and 1050-1077; react-query key `["workflows","revision",revisionId,projectId]`, staleTime 30s).

Both sides are keyed by the **same** revision id. Revisions are immutable, so the snapshot
never moves. There is no comparison against the variant's latest revision. That latest-revision
query (`["workflows","latestRevision",...]`) is a different family used elsewhere. If the
loaded revision has no draft overlay, `isDirty` returns false right away (store.ts:1903-1908).

So "dirty" means one thing only: **the loaded revision carries a draft overlay.** It does not
mean the panel lags a newer HEAD. A revision reads as dirty when the user edited the config
panel, or when an event that should have repointed the panel was missed, or when the panel
held unsaved edits before the conversation even started. Whenever the loaded revision is
dirty, the old gate dropped every reference, and `commit_revision` failed.

### After a self-commit, the panel already repoints to the new revision

A self-commit creates a new revision. A mechanism added in issue #4920 already moves the panel
onto that new revision, so the panel does not sit on a stale one.

The backend's Vercel stream adapter derives a `data-committed-revision` event from the
`commit_revision` tool output
(`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:242-249, 729-756`). The chat panel
reacts to that event (`web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:851-873`): it
invalidates the latest-revision and inspect caches (store.ts:2632-2641) and calls
`switchEntity`
(`web/packages/agenta-playground/src/state/controllers/playgroundController.ts:2296-2308`) to
repoint the loaded entity id to the new revision id. The new id has no draft overlay, so
`isDirty` is false right away. The request builder reads the current entity through a ref at
send time (`AgentChatPanel.tsx:380-386`), so the next run in the conversation uses the new
revision.

When everything goes right, one self-commit runs like this:

1. You load a committed agent. The loaded revision has no draft overlay. `isDirty` is false.
2. The agent calls `commit_revision`. A new revision is created.
3. The `data-committed-revision` event arrives. `switchEntity` repoints the panel to the new
   revision id. That id has no overlay, so `isDirty` stays false.
4. The next commit in the same conversation runs against the new revision and works.

### Why the loop was still reported

The loop happens whenever the loaded revision is dirty at the moment a run is sent, for any
reason. Two common causes:

- The user edited the config panel before or during the conversation. The overlay makes the
  revision dirty.
- The `data-committed-revision` repointing did not complete. If the stream is aborted, the
  event is missed, or the commit and the event race, the panel stays on the old revision id,
  which still carries its overlay and reads as dirty.

Either way, once the loaded revision is dirty, the old all-or-nothing gate sent
`references: null`, the run context had no variant, and `commit_revision` threw the reported
error. The observed failing turns carried `references: null` on the failing commit, which
tells us the panel was dirty when the run was sent.

This is why the run itself must always carry the variant identity, independent of panel state.
The #4920 repointing removes one cause of a stale panel, but it depends on the stream event
arriving and being processed by the panel's effect. Anything that interrupts the stream leaves
the old revision loaded. The fix in plan.md makes `commit_revision` work regardless, by
forwarding the variant on every run.

## The claim we must verify before recommending the frontend fix

The frontend comment gives a second reason for dropping the variant:

> The resolver also re-resolves a bare variant ref to its latest revision, so the variant
> must be dropped too.

(`web/packages/agenta-playground/src/state/execution/agentRequest.ts:349-350`)

If that were true for our case, the recommended fix would be wrong. Forwarding a bare variant
would make the backend resolve it to the variant's HEAD revision, which would set
`is_draft` back to false and defeat the whole point.

We verified this claim in code. It does **not** apply to playground runs. Here is why.

The re-resolution happens in `resolve_references_with_info`, which calls the retrieve endpoint
to turn a variant reference into a concrete revision, then merges that resolved revision back
into the tracing references (`sdks/python/agenta/sdk/middlewares/running/resolver.py:220-346`,
merge at `:593`). But that function only runs when reference hydration is needed, and the
gate for that is:

```python
request_has_parameters = bool(request.data and request.data.parameters)
needs_reference_hydration = bool(
    request.references
    and not request_has_parameters
    and (revision is None or not revision.parameters)
)
```

(`sdks/python/agenta/sdk/middlewares/running/resolver.py:577-582`)

Hydration needs `not request_has_parameters`. Every playground agent run sends its resolved
configuration as `data.parameters`:

```typescript
requestBody: {
    session_id: opts.sessionId,
    references,
    data: {inputs: {messages: history}, parameters},
}
```

(`web/packages/agenta-playground/src/state/execution/agentRequest.ts:391-398`)

So `request_has_parameters` is always true for a playground run, `needs_reference_hydration`
is always false, and `resolve_references_with_info` never runs. The variant is never
re-resolved to a revision. Only the raw request references reach the tracing context, through
the direct assignment at `running.py:376`.

**Conclusion.** For a playground run, forwarding a bare `application_variant` with no
`application_revision` leaves the tracing references with a variant and no revision. The run
context then has `variant.id` set and `revision` unset, so `is_draft` stays true and
`commit_revision` gets its target. The comment's fear is real for a references-only run that
carries no parameters, but a playground run is never that. This is what makes the frontend
fix both small and correct.

## App scoping is already safe on a draft run

One more fact matters for the fix. Even today, a draft run stays associated with its app,
because the app id rides the URL query independently of the `references` block:

```typescript
const appId = fullReferences?.application?.id
const url = withQuery(invocationUrl, {
    application_id: appId,
    project_id: headers.Authorization ? projectId : undefined,
})
```

(`web/packages/agenta-playground/src/state/execution/agentRequest.ts:378-386`)

So the app is never lost on a dirty run. Only the variant and revision identities are
dropped. The fix restores the variant while leaving the app scoping untouched.
