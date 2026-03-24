# Research

## The commit call chain (registry drawer → API)

### 1. User clicks "Commit" in the registry drawer

**File:** `web/oss/src/components/VariantsComponents/Drawers/VariantDrawer/assets/VariantDrawerTitle/index.tsx:171`

The `TitleActions` component renders a `CommitVariantChangesButton` with the `variantId` prop (which is actually a revision ID).

### 2. CommitVariantChangesButton opens CommitVariantChangesModal

**File:** `web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton/index.tsx:59`

Simple wrapper that manages open/close state and renders the modal.

### 3. CommitVariantChangesModal.handleSubmit

**File:** `web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/index.tsx:59-141`

Key lines for the "version" (non-variant) commit path:
```ts
const commitRevision = useSetAtom(playgroundController.actions.commitRevision)  // line 29
const variantSlug = runnableData?.slug                                          // line 38

const result = await commitRevision({
    revisionId: variantId,       // the prop — a real revision UUID
    variantId: variantSlug,      // ← BUG 2: slug, not a UUID
    parameters: configuration ?? {},
    commitMessage: note,
})
```

### 4. controllerCommitRevisionAtom (the routing decision)

**File:** `web/packages/agenta-playground/src/state/controllers/playgroundController.ts:1545-1609`

```ts
const nodes = get(playgroundNodesAtom)                           // line 1549
const node = nodes.find((n) => n.entityId === payload.revisionId) // line 1550

if (node?.entityType === "workflow") {
    // WORKFLOW PATH: calls commitWorkflowRevisionAtom → POST /preview/workflows/revisions/commit
} else {
    // LEGACY PATH: calls commitLegacyRevisionAtom → PUT /variants/{variantId}/parameters
}
```

### 5a. Workflow commit (correct path)

**File:** `web/packages/agenta-entities/src/workflow/state/commit.ts:167`

Reads merged entity data from `workflowEntityAtomFamily(revisionId)`, calls `commitWorkflowRevisionApi` which hits `POST /preview/workflows/revisions/commit`.

### 5b. Legacy commit (REMOVED)

> The legacy commit path via `legacyAppRevision/state/commit.ts` has been removed. All commits now go through the workflow path.

## The entity type resolution system

The codebase already has infrastructure to resolve entity types without playground nodes:

### Type hints (module-level Map)

**File:** `web/packages/agenta-entities/src/shared/createEntityBridge.ts:520-540`

```ts
const _runnableTypeHints = new Map<string, string>()
export function registerRunnableTypeHint(id: string, type: string): void
export function getRunnableTypeHint(id: string): string | undefined
```

Playground registers hints when nodes are created (`playgroundController.ts:1714`). But the registry drawer doesn't go through the playground node creation flow, so no hints are registered.

### OSS resolver

**File:** `web/oss/src/state/url/playground.ts:50-59`

```ts
setRunnableTypeResolver({
    getType: (entityId: string) => {
        const hint = getRunnableTypeHint(entityId)
        if (hint) return hint
        const store = getDefaultStore()
        return store.get(playgroundEntityModeAtom)  // always "workflow"
    },
})
```

This resolver correctly returns `"workflow"` for any entity without a hint. But `controllerCommitRevisionAtom` doesn't use it — it directly checks `playgroundNodesAtom` instead.

### runnableBridge.crud.commitRevision

**File:** `web/packages/agenta-entities/src/runnable/bridge.ts:1029`

```ts
crud: {
    commitRevision: commitWorkflowRevisionAtom,  // always workflow!
}
```

The bridge's own crud already wires directly to the workflow commit atom. But the `playgroundController` doesn't delegate to the bridge's crud — it has its own parallel routing logic.

## The same bug pattern exists in create/delete

- `controllerCreateVariantAtom` (line 1474): same `playgroundNodesAtom` check
- `controllerDeleteRevisionAtom` (line 1619): same `playgroundNodesAtom` check

These have the same fragility but are less likely to trigger from the registry since delete uses a different flow and create-variant is less common there.

## Registry drawer data flow

The registry drawer loads entity data through `runnableBridge`:

**File:** `web/oss/src/components/VariantsComponents/Drawers/VariantDrawer/assets/VariantDrawerContent/index.tsx:76`

```ts
const runnableData = useAtomValue(runnableBridge.data(resolvedVariantId))
```

The bridge probes molecule types in order (workflow first per `bridge.ts:860`) and successfully loads the data. So the entity data is available — it's only the commit routing that fails.
