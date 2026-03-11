# Plan

## Approach

Replace the `playgroundNodesAtom` lookup in `controllerCommitRevisionAtom` with the existing `getRunnableTypeResolver()` mechanism. This resolver already returns `"workflow"` for all entities in OSS (via `playgroundEntityModeAtom`), and it checks type hints first for edge cases. It works regardless of whether the playground was ever mounted.

Apply the same fix to `controllerCreateVariantAtom` and `controllerDeleteRevisionAtom` for consistency.

Also fix the `CommitVariantChangesModal` passing `slug` as `variantId`, since that field is only meaningful for the legacy path and should not leak through.

## Steps

### Step 1: Fix entity type resolution in controllerCommitRevisionAtom

**File:** `web/packages/agenta-playground/src/state/controllers/playgroundController.ts`
**Lines:** 1545-1609

Replace:
```ts
const nodes = get(playgroundNodesAtom)
const node = nodes.find((n) => n.entityId === payload.revisionId)
if (node?.entityType === "workflow") {
```

With:
```ts
const resolver = getRunnableTypeResolver()
const entityType = resolver.getType(payload.revisionId)
if (entityType === "workflow") {
```

This uses the same resolver that `setEntityIdsAtom` (line 1708) already uses. The resolver:
1. Checks `getRunnableTypeHint(entityId)` first (for entities with hints)
2. Falls back to `playgroundEntityModeAtom` which is hardcoded to `"workflow"`

So for any entity without a registered hint, it correctly returns `"workflow"`.

### Step 2: Apply the same fix to controllerCreateVariantAtom

**File:** `web/packages/agenta-playground/src/state/controllers/playgroundController.ts`
**Lines:** 1451-1543

Same pattern: replace `playgroundNodesAtom` lookup with `getRunnableTypeResolver().getType()`.

### Step 3: Apply the same fix to controllerDeleteRevisionAtom

**File:** `web/packages/agenta-playground/src/state/controllers/playgroundController.ts`
**Lines:** 1612-1657

Same pattern.

### Step 4: Stop passing slug as variantId from CommitVariantChangesModal

**File:** `web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/index.tsx`
**Lines:** 99-105

The `variantId: variantSlug` field in the commit payload is only used by the legacy path. With Step 1, the workflow path will be taken, and `commitWorkflowRevisionAtom` reads the variant ID from the entity data itself (`entity.workflow_variant_id`). So the modal doesn't need to pass it.

Remove `variantId` and `parameters` from the commit call — the workflow commit atom reads these from entity state:

```ts
const result = await commitRevision({
    revisionId: variantId,
    commitMessage: note,
})
```

This also removes the `configuration` dependency, making the modal simpler.

### Step 5: Verify

- Hard refresh on registry page
- Open variant drawer
- Edit a prompt value
- Click Commit
- Verify the request goes to `POST /preview/workflows/revisions/commit`
- Verify a new revision is created and the drawer updates

## Risk Assessment

**Low risk.** The changes align with how the codebase already works:
- `playgroundEntityModeAtom` is already hardcoded to `"workflow"` — no entity in OSS uses the legacy mode
- `setEntityIdsAtom` already uses `getRunnableTypeResolver()` for exactly this purpose
- `runnableBridge.crud.commitRevision` is already wired to `commitWorkflowRevisionAtom`
- The legacy commit path in the controller is dead code for current OSS usage

The legacy fallback branches remain in the controller for any future non-workflow entity type — we're just fixing the routing decision, not removing legacy code.
