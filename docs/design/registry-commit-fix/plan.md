# Plan

## Approach

Keep the fix narrowly scoped to the broken commit flow.

Replace the `playgroundNodesAtom` lookup in `controllerCommitRevisionAtom` with the existing `getRunnableTypeResolver()` mechanism. This resolver already returns `"workflow"` for all entities in OSS (via `playgroundEntityModeAtom`), and it checks type hints first for edge cases. It works regardless of whether the playground was ever mounted.

Also fix the `CommitVariantChangesModal` payload so it stops passing legacy-only fields (`slug` as `variantId`, plus `parameters`) into the commit call. The workflow commit atom already reads the committed data from entity state.

Defer create/delete changes unless we reproduce a related bug in those flows. They touch adjacent behavior, but they are not required to fix the reported registry commit regression.

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

### Step 2: Stop passing slug as variantId from CommitVariantChangesModal

**File:** `web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/index.tsx`
**Lines:** 99-105

The `variantId: variantSlug` field in the commit payload is only used by the legacy path. With Step 1, the workflow path will be taken, and `commitWorkflowRevisionAtom` reads the variant ID from the entity data itself (`entity.workflow_variant_id`). So the modal doesn't need to pass it.

Remove `variantId` and `parameters` from the commit call - the workflow commit atom reads these from entity state:

```ts
const result = await commitRevision({
    revisionId: variantId,
    commitMessage: note,
})
```

This also removes the `configuration` dependency, making the modal simpler and preventing the slug/UUID mismatch from leaking into the request.

### Step 3: Verify

- Hard refresh on registry page
- Open variant drawer
- Edit a prompt value
- Click Commit
- Verify the request goes to `POST /preview/workflows/revisions/commit`
- Verify a new revision is created and the drawer updates

## Deferred Follow-ups

### Follow-up A: create-variant flow

`controllerCreateVariantAtom` uses the same `playgroundNodesAtom` check, but it also has separate base-revision resolution logic tied to node state. This is adjacent to the reported bug, but broader than the commit fix. Only include it now if we reproduce the same refresh issue in the registry modal's `As a new variant` path.

### Follow-up B: delete flow

`controllerDeleteRevisionAtom` has the same node-based routing pattern, but delete also has workflow-vs-legacy branching in the delete modal before the controller is even called. This should be handled separately after a quick audit.

## Risk Assessment

**Low risk for the targeted fix.** The changes align with how the codebase already works:
- `playgroundEntityModeAtom` is already hardcoded to `"workflow"` — no entity in OSS uses the legacy mode
- `setEntityIdsAtom` already uses `getRunnableTypeResolver()` for exactly this purpose
- `runnableBridge.crud.commitRevision` is already wired to `commitWorkflowRevisionAtom`
- The registry and playground commit buttons both already represent workflow revisions in current OSS usage

We are not removing legacy code in this change. We are only making the commit flow stop depending on ephemeral playground UI state.
