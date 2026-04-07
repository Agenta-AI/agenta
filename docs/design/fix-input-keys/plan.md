# Plan: Fix input_keys on Commit

## Approach: Normalize on draft update for workflow entities

After reviewing the current playground wiring and the feedback, the better approach for the new entity system is to normalize `input_keys` when the workflow draft model is updated, not only at commit time.

This more closely matches the old behavior: derived prompt metadata stays correct inside the draft itself, so commit, diff, and later reads all see the same normalized state.

## Review of Lead Feedback

### 1. "We should have the change on mutation in one place not in multiple places"

I agree with this.

My previous plan put the change too late, at commit time.

If the intent is "when the config model changes, keep `input_keys` in sync immediately", then the right place is the workflow draft update path, not the commit path.

Revised approach:

- keep the normalization logic in one helper
- run it from the single workflow draft-update seam
- let commit remain a plain persistence step

For the new entity system, the best seam is likely `updateWorkflowDraftAtom` in `web/packages/agenta-entities/src/workflow/state/store.ts:1135`.

Why this is the best fit:

- `PlaygroundConfigSection` writes via `runnableBridge.update` (`web/packages/agenta-entity-ui/src/DrillInView/components/PlaygroundConfigSection.tsx:189`)
- `runnableBridge.update` routes workflow updates to `workflowMolecule.actions.update`
- `workflowMolecule.actions.update` is `updateWorkflowDraftAtom` (`web/packages/agenta-entities/src/workflow/state/molecule.ts:329`)

So this gives us a true model-update seam for workflow drafts.

### 2. "We should have the change only for prompts... use flags"

I also agree with this.

I agree with this. The workflow-level decision should come from explicit flags, not from re-detecting prompt-ness structurally.

## Type-Based Gating

### Workflow path

Use workflow flags from the current entity/server data:

- `is_custom`
- `is_evaluator`
- `is_human`
- `is_chat`

Only normalize when the workflow is a prompt app, i.e. not:

- custom
- evaluator
- human

That means the sync applies to completion/chat prompt workflows only.

### Legacy path

Since `legacyAppRevision` has been fully removed and replaced by `workflow`, legacy-specific changes are not applicable.

The repository still contains active legacy branches, but the safer scope for this bug is the workflow/new-entities path first.

## Implementation

### 1. Shared helper in one place

**File:** `web/packages/agenta-entities/src/runnable/utils.ts`

Add one shared helper that:

- unwraps `ag_config` if present
- walks config entries
- updates `input_keys` for prompt configs
- returns the original object when nothing changes

This helper is only the transformation; the workflow update atom decides when to run it based on flags.

```typescript
export function syncPromptInputKeysInParameters(
    parameters: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    if (!parameters) return parameters ?? {}

    const agConfig = parameters.ag_config
    if (agConfig && typeof agConfig === "object" && !Array.isArray(agConfig)) {
        const synced = syncInputKeysInConfig(agConfig as Record<string, unknown>)
        return synced !== agConfig ? { ...parameters, ag_config: synced } : parameters
    }

    return syncInputKeysInConfig(parameters)
}

function syncInputKeysInConfig(config: Record<string, unknown>): Record<string, unknown> {
    let changed = false
    const result = { ...config }

    for (const [key, value] of Object.entries(result)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        const promptConfig = value as Record<string, unknown>

        if (!Array.isArray(promptConfig.messages)) continue

        const variables = extractVariablesFromConfig({ [key]: promptConfig })
        const existing = promptConfig.input_keys

        if (
            Array.isArray(existing) &&
            existing.length === variables.length &&
            existing.every((k, i) => k === variables[i])
        ) {
            continue
        }

        result[key] = { ...promptConfig, input_keys: variables }
        changed = true
    }

    return changed ? result : config
}
```

Note: this helper still uses `messages` locally to identify prompt config entries inside an already-approved prompt app. I think that is fine. The important change is that the top-level decision to mutate now comes from explicit flags/app type.

### 2. Workflow draft-update boundary

**Preferred file:** `web/packages/agenta-entities/src/workflow/state/store.ts`

Normalize inside `updateWorkflowDraftAtom()`.

That atom already:

- accepts both `{parameters}` and `{data: {parameters}}`
- is the actual write target behind workflow draft updates
- is used by the workflow molecule update action

Pseudo-shape:

```typescript
const serverData = _get(workflowServerDataSelectorFamily(workflowId))
const flags = serverData?.flags
const shouldSyncPromptInputKeys =
    !flags?.is_custom &&
    !flags?.is_evaluator &&
    !flags?.is_human

const normalizedParameters =
    topLevelParameters !== undefined && shouldSyncPromptInputKeys
        ? syncPromptInputKeysInParameters(topLevelParameters)
        : topLevelParameters
```

Then write those normalized parameters into the draft.

This means commit automatically persists already-normalized data without special commit logic.

### 3. Keep commit logic unchanged for workflow

If we normalize at draft-update time, `commitWorkflowRevisionAtom` and `commitWorkflowRevisionApi()` can stay unchanged for this bug.

## What I would drop from this fix

### Do not change `requestBodyBuilder.ts` in this ticket

I still think `requestBodyBuilder.ts` is suspicious because it only writes `input_keys` to the first prompt config.

But after your lead's feedback, I would remove that from this fix.

Why:

- it is invocation-path logic, not commit mutation logic
- it broadens scope
- it weakens the "single mutation place" principle
- the reported customer bug is about persisted committed data

I would keep it as a separate follow-up only if we can prove it causes a real user-facing issue beyond commit persistence.

## My Feedback on the Lead's Guidance

I think the guidance is right, and after looking at the code again I think my first interpretation was too commit-centric.

### I agree with

- centralizing at the model-update boundary instead of at commit
- using explicit flags/app type instead of rediscovering prompt-ness from shape
- keeping the fix focused on commit persistence

### One nuance / uncertainty

The one thing I am still not fully certain about is scope: the repository still has active legacy branches, but if this customer issue is definitely on the workflow/new-entities path, I would intentionally avoid touching legacy code in this fix.

## Files Changed

| File | Change |
|------|--------|
| `web/packages/agenta-entities/src/runnable/utils.ts` | Add `syncPromptInputKeysInParameters()` |
| `web/packages/agenta-entities/src/workflow/state/store.ts` | Normalize inside `updateWorkflowDraftAtom()` with workflow-flag gating |

## Testing

1. Workflow prompt app with 2 prompts: edit draft and verify both prompt configs update `input_keys` immediately in draft state
2. Commit the same workflow and verify persisted revision contains the correct `input_keys`
3. Custom workflow: edit draft and verify no `input_keys` mutation occurs
4. Evaluator workflow: edit draft and verify no `input_keys` mutation occurs
5. Template format variations: verify `curly`, `fstring`, and `jinja2`

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Workflow flags indicate custom/evaluator/human | Skipped |
| Prompt with no variables | `input_keys` set to `[]` |
| Parameters is null/undefined | Returns `{}` |
| No `ag_config` wrapper | Works at top level directly |
| `ag_config` wrapper present | Unwraps, syncs, re-wraps |
| `input_keys` already correct | No unnecessary copy created |
