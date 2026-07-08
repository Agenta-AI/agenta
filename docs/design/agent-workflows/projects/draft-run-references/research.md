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
**none**.

The intent is documented right above it: a dirty run is an inline-config draft, so forwarding
the revision would wrongly mark the run as non-draft. The comment then goes one step further
and drops the variant too. That extra step is what breaks `commit_revision`, because the
variant is exactly what the tool needs.

## Worked example: the reference block, clean versus dirty

**Clean run (panel matches the committed HEAD, `isDirty` is false).** The request sends:

```json
"references": {
  "application":          {"id": "<app-uuid>",     "slug": "my-agent"},
  "application_variant":  {"id": "<variant-uuid>", "slug": "my-agent.default"},
  "application_revision": {"id": "<rev-uuid>",     "slug": "...", "version": "3"}
}
```

Run context: artifact set, variant set, revision set. `is_draft` is false. `variant.id` is
bound. `commit_revision` works.

**Dirty run today (panel has unsaved edits, `isDirty` is true).** The request sends:

```json
"references": null
```

Run context: no workflow identity at all. `variant.id` is undefined. `commit_revision`
throws the reported error.

## The loop: why it works, then stops

This explains the "works, then stops working in the same conversation" symptom.

1. You load the agent. The panel matches the committed HEAD. `isDirty` is false.
2. You ask for a change. The agent calls `commit_revision`. References are sent in full.
   The commit works and creates a **new** revision. The HEAD moves forward.
3. The panel you loaded now lags the new HEAD. The dirty check compares the panel against
   the current HEAD and flips `isDirty` to true.
4. You ask for another change in the same conversation. Because `isDirty` is now true, the
   request sends `references: null`. `commit_revision` fails.
5. Every later commit fails the same way, until the page reloads and the panel re-syncs to
   the new HEAD.

The successful commit is what poisons the next one. The agent's own success flips the dirty
flag, and the dirty flag drops the variant.

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
