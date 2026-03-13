# Research: input_keys Data Flow

## Architecture Overview

### Where `input_keys` lives

`input_keys` is NOT a database column. It's a nested JSON value stored inside the `data` column of the `workflow_revisions` table:

```
workflow_revisions.data (JSON column)
  └── parameters (Dict)
       └── ag_config (Dict)
            ├── prompt_1
            │    ├── messages: [...]
            │    ├── llm_config: {...}
            │    └── input_keys: ["question", "context"]  ← HERE
            └── prompt_2
                 ├── messages: [...]
                 ├── llm_config: {...}
                 └── input_keys: ["topic"]  ← AND HERE
```

### API Side (Transparent Pass-Through)

The API stores and returns the `data` JSON blob **as-is**. No server-side computation of `input_keys`.

**Key files:**
- `api/oss/src/services/llm_apps_service.py` (lines 187-188) — reads `input_keys` at runtime:
  ```python
  input_keys = helpers.find_key_occurrences(parameters, "input_keys") or []
  inputs = {key: datapoint.get(key, None) for key in input_keys}
  ```
- `api/oss/src/services/helpers.py` (lines 81-108) — `find_key_occurrences` recursively searches the parameters dict for all values under the key `"input_keys"`
- `sdk/agenta/sdk/workflows/handlers.py` (lines 2024-2032) — validates inputs against `input_keys`

### Frontend — Two Entity Paths

#### 1. Workflow Path (New)

**Commit flow:**
- `web/packages/agenta-entities/src/workflow/state/commit.ts` (line 196-207)
- Reads `entity.data.parameters` and strips metadata
- Sends to `POST /preview/workflows/revisions/commit`

**Configuration editing:**
- Uses DrillIn/SchemaControls to directly edit `entity.data.parameters`
- Changes go through the workflow molecule's draft mechanism
- **No code updates `input_keys` when messages change**

#### 2. Legacy App Revision Path

**Commit flow:**
- `web/packages/agenta-entities/src/legacyAppRevision/state/commit.ts` (line 283-396)
- Takes `parameters` from the caller (CommitVariantChangesModal)
- Sends to `PUT /variants/{variantId}/parameters`

**CommitVariantChangesModal** (`web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/index.tsx`):
- Line 104: `parameters: configuration ?? {}`
- `configuration` comes from `runnableBridge.data(variantId)?.configuration`
- Bridge's `workflowToRunnable` (line 636): `configuration = entity.data.parameters`

Both paths commit whatever is in `entity.data.parameters` — no `input_keys` recomputation.

### The Missing Link: `syncInputKeysInPrompts`

**File:** `web/packages/agenta-entities/src/legacyAppRevision/utils/syncInputKeys.ts`

This function:
1. Iterates ALL prompts
2. Extracts template variables (`{{var}}`) from message content
3. Sets `input_keys` on each prompt

**Status:** Defined but **never called**. All call sites were removed in commit `56bd5e329`.

### Template Variable Extraction (Runtime vs Commit)

The codebase has **robust variable extraction** that works at runtime:

- `extractVariablesFromConfig()` — in `runnable/utils.ts` (line 641) — scans messages, response_format, tools
- `extractVariablesFromPrompts()` — in `runnable/utils.ts` (line 579) — scans raw prompt messages
- `extractVariablesFromEnhancedPrompts()` — in `runnable/utils.ts` (line 1054) — scans enhanced (wrapped) prompts

These are used for:
- Input ports derivation (playground UI)
- Request body building (invocation)
- Input mapping modal

But **none of them are used during commit** to update `input_keys` in the parameters.

### requestBodyBuilder's Partial Fix

`web/packages/agenta-entities/src/legacyAppRevision/utils/requestBodyBuilder.ts` has code (lines 486-511) that sets `input_keys` on the **first prompt config only**:

```typescript
const promptKey = Object.keys(ag_config || {})[0]  // ← FIRST ONLY
const target = promptKey ? ag_config[promptKey] : undefined
if (isRecord(target)) {
    target["input_keys"] = keys
}
```

This explains the customer's symptom: "Only the input keys of the first configuration are coming through."

However, `requestBodyBuilder` is used for **invocations** (the /test endpoint), not for **commits**. The commit path sends raw parameters without this enrichment.

### `input_keys` Handling in Schema Controls (UI)

The DrillIn/SchemaControls UI (line 238-239 of `schemaUtils.ts`) explicitly **hides** `input_keys` from the user:
```typescript
const excludeKeys = new Set([
    "messages", "model", "tools", "tool_choice", ...
    "inputKeys", "input_keys",  // ← hidden
    ...
])
```

This is correct — `input_keys` is a derived/computed field, not user-editable.

### `cleanupDefaultParameters` in app-selector

When a new app is created from a template, `cleanupDefaultParameters` (line 279 in `web/oss/src/services/app-selector/api/index.ts`) correctly extracts `input_keys` for ALL prompt configs:

```typescript
if (hasMessages && !config.input_keys) {
    const variables = extractVariablesFromConfig({[key]: config})
    if (variables.length > 0) {
        config.input_keys = variables
    }
}
```

But this only runs on **initial template creation**, not on subsequent edits or commits.

## Key Observation: `requestBodyBuilder.ts` Bug

The `requestBodyBuilder.ts` file has two separate issues:

1. **Only sets `input_keys` on the first prompt** — `Object.keys(ag_config || {})[0]`
2. **Only runs during invocation**, not during commit

Both issues contribute to the bug. Even if we fix the commit path, the invocation path will still only send `input_keys` for the first prompt.

## `stripAgentaMetadataDeep` Behavior

Both commit paths call `stripAgentaMetadataDeep()` on parameters before sending. This function removes `agenta_metadata` and `__agenta_metadata` keys but does **NOT** remove `input_keys`. So `input_keys` should pass through cleanly if present.
