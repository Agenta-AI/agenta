# Shared Modal Utilities

Common utilities, types, and factories for entity modals (commit, save, delete).

## Components

Entity modals build on the kit `Dialog` parts from `@agenta/ui/ui` (`Dialog`, `DialogContent`,
`DialogHeader`, `DialogTitle`, `DialogFooter`). Radix mounts the content only while open, and
`onCloseAutoFocus` on `DialogContent` runs once the close animation has unmounted it.

## Hook Factories

### `createEntityActionHook`

Creates a base entity action hook that provides standardized methods for triggering modal actions.

```typescript
import {createEntityActionHook} from "./shared"
import {openCommitModalAtom, commitModalLoadingAtom, commitModalOpenAtom} from "./commit/state"

// Create the base hook
const useEntityCommit = createEntityActionHook({
    openAtom: openCommitModalAtom,
    loadingAtom: commitModalLoadingAtom,
    openStateAtom: commitModalOpenAtom,
})

// Usage in component
function MyComponent() {
    const {actionEntity, actionEntityRef, isActioning, isOpen} = useEntityCommit()

    // By type, id, and name
    actionEntity("testset", "id-123", "My Testset")

    // By entity reference
    actionEntityRef({type: "testset", id: "id-123", name: "My Testset"})
}
```

## Design Decisions

### Why Not a Full Modal State Factory?

After analysis, the three modals (commit, save, delete) have:

- **Common patterns**: open/loading/error atoms, reset/close actions
- **Unique logic**: Each has different validation, execution, and derived state

A full factory would be complex and hard to maintain. Instead:

1. **Hook factories** abstract the common hook pattern (50-70% duplication)
2. **State files** remain separate but use shared utilities
3. **Types** are shared for consistency

### Why Delete Doesn't Use the Hook Factory

The `createEntityActionHook` factory is designed for single-entity operations with optional extra arguments:

```typescript
// Factory signature
openAtom: WritableAtom<null, [entity: EntityReference, ...args: TOpenArgs], void>
```

The delete modal has a fundamentally different pattern - it supports **batch deletion** with an options object:

```typescript
// Delete signature
interface OpenDeleteModalOptions {
    entities: EntityReference[]
    onSuccess?: () => void
}
openDeleteModalAtom: WritableAtom<null, [options: OpenDeleteModalOptions], void>
```

Rather than over-complicating the factory to handle both patterns, the delete hook maintains its own implementation. This keeps the factory simple and purpose-focused while allowing delete to support its unique batch operation requirements with optional success callbacks.
