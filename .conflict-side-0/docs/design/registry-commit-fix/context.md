# Context

## Problem

When a user hard-refreshes the browser on the registry page and then tries to commit a revision from the variant drawer, the commit fails with:

```
{"detail": "Error while trying to update the app variant: badly formed hexadecimal UUID string"}
```

The request goes to `PUT /api/variants/{shortId}/parameters` (the legacy endpoint) instead of `POST /api/workflows/revisions/commit` (the workflow endpoint).

If the user first visits the playground and then navigates to the registry, the commit works because playground state is populated.

## Root Cause

There are **two bugs** working together:

### Bug 1: Entity type routing depends on ephemeral playground state

`controllerCommitRevisionAtom` in `playgroundController.ts:1545` decides which commit path to use by looking up the revision ID in `playgroundNodesAtom`:

```ts
const nodes = get(playgroundNodesAtom)
const node = nodes.find((n) => n.entityId === payload.revisionId)

if (node?.entityType === "workflow") {
    // → workflow commit (correct)
} else {
    // → legacy commit (incorrect fallback)
}
```

`playgroundNodesAtom` is in-memory only (`atom<PlaygroundNode[]>([])`). It is populated when the playground page adds nodes. After a hard refresh on the registry page, the playground was never mounted, so nodes are empty. The lookup returns `undefined`, and the controller falls through to the legacy path.

### Bug 2: Slug passed as variantId

`CommitVariantChangesModal` at line 103 passes `runnableData?.slug` as `variantId`:

```ts
const result = await commitRevision({
    revisionId: variantId,       // this is the prop (revision ID) — correct
    variantId: variantSlug,      // this is runnableData?.slug — NOT a UUID
    parameters: configuration ?? {},
})
```

When the legacy path is taken, this slug (e.g. `"5c2a1a65029f"`) is used as a MongoDB/Postgres variant UUID. The backend rejects it with the `badly formed hexadecimal UUID string` error.

## Why the playground works

When the user visits the playground first:
1. `setEntityIdsAtom` (playgroundController.ts:1696) creates nodes with `entityType: resolver.getType(entityId)`.
2. The resolver reads `playgroundEntityModeAtom`, which is hardcoded to `"workflow"`.
3. Nodes are stored in `playgroundNodesAtom` with `entityType: "workflow"`.
4. When the user later opens the registry drawer and commits, `controllerCommitRevisionAtom` finds the node and takes the workflow path.

## Why this is purely a frontend issue

The backend workflow commit endpoint works. The bug is that the frontend routes to the wrong endpoint when playground in-memory state is missing.
