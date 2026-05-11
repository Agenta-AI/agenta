# Context: input_keys Not Saved on Commit

## Problem Statement

A customer reported that when they have 2 prompt configurations in a single app, the API only returns the `input_keys` from the first prompt. The second prompt's `input_keys` are missing.

### What is `input_keys`?

`input_keys` is a list of template variable names (e.g., `["question", "context"]`) extracted from prompt message templates (e.g., `"Answer {{question}} given {{context}}"`). It is stored inside each prompt config within the `parameters` JSON blob:

```
data.parameters.ag_config.<prompt_name>.input_keys = ["question", "context"]
```

At runtime, the backend uses `input_keys` to:
1. Know which variables to extract from the testcase/datapoint
2. Validate that all required inputs are provided

### How `input_keys` Flows

```
Frontend Playground (user edits prompts)
  ↓
  parameters.ag_config.prompt.input_keys should be updated
  ↓
Commit → API stores parameters JSON blob as-is
  ↓
Runtime reads input_keys from stored parameters
  → helpers.find_key_occurrences(parameters, "input_keys")
  → Uses them to map testcase data to inputs
```

The API is a **transparent pass-through** — it does not compute or validate `input_keys`. Whatever the frontend sends in `data.parameters` is stored verbatim and returned as-is.

## Root Cause

The `input_keys` field is **never being updated** during editing or before commit in the current frontend code. A refactoring (commit `56bd5e329` by Arda, Feb 17 2026) removed the enhanced prompts mechanism, and with it, the `syncInputKeysInPrompts` call site that kept `input_keys` in sync with message template variables.

### Timeline

1. **`430575a25`** — `syncInputKeysInPrompts` utility created
2. **`9dd49e1ca`** — Added `syncInputKeysInPrompts` calls in `setEnhancedPromptsAtom`, `mutateEnhancedPromptsAtom`, and `updatePropertyAtom` in the legacy app revision store (since removed)
3. **`56bd5e329`** — Major refactor: removed enhanced prompts mechanism entirely from `store.ts`, including `setEnhancedPromptsAtom`, `mutateEnhancedPromptsAtom`, etc. The `syncInputKeysInPrompts` call sites were removed with these atoms
4. **`8e57e69c9`** — Lint fix removed the now-unused import of `syncInputKeysInPrompts`

**Result:** `syncInputKeysInPrompts` is defined in the codebase but **never called anywhere**.

## Goals

1. **Fix the immediate bug**: Ensure `input_keys` is correctly computed and saved for ALL prompt configs on commit (not just the first one)
2. **Support both entity paths**: The fix must work for both workflow entities (new path) and legacy app revision entities
3. **Minimal, targeted change**: Don't re-introduce the removed enhanced prompts mechanism — work within the current architecture

## Non-Goals

- Refactoring the commit flow
- Changing the API to compute `input_keys` server-side (future improvement, not this fix)
- Fixing the playground invocation path (it already computes variables at runtime via `extractVariablesFromConfig`)
