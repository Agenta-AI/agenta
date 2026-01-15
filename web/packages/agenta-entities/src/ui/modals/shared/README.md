# Shared Modal Utilities

Common utilities, types, and factories for entity modals (commit, save, delete).

## Components

### `EnhancedModal`

A performance-optimized Modal wrapper that provides consistent behavior across all entity modals.

#### Features

| Feature | Description |
|---------|-------------|
| **Lazy rendering** | Content only mounts after first open, avoiding Ant Design's eager portal rendering |
| **Auto-contained height** | Default `maxHeight: 90vh` with internal scrolling (no window scroll) |
| **Smart style merging** | Custom styles for container/body/footer merged with defaults |
| **Consistent defaults** | Centered, border radius, destroy on close |
| **Cleanup on hide** | Resets render state after `afterClose` |

#### Usage

```tsx
import { EnhancedModal } from "@agenta/entities/ui/modals"

function MyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <EnhancedModal
      open={open}
      onCancel={onClose}
      title="My Modal"
      footer={<MyFooter />}
    >
      <MyContent />
    </EnhancedModal>
  )
}
```

#### Props

```typescript
interface EnhancedModalProps extends Omit<ModalProps, "styles"> {
  children?: React.ReactNode
  /** Custom styles - can be object or function */
  styles?: EnhancedModalStyles | ((context: {props: EnhancedModalProps}) => EnhancedModalStyles)
  /** Max height of modal. Set undefined to disable. Default: "90vh" */
  maxHeight?: string | undefined
  /** Enable lazy rendering. Default: true */
  lazyRender?: boolean
}
```

#### Custom Styles

The `styles` prop supports smart merging for container, body, and footer:

```tsx
<EnhancedModal
  open={open}
  onCancel={onClose}
  styles={{
    body: { paddingTop: 16 },
    container: { maxHeight: "80vh" }, // Override default maxHeight
  }}
>
  <Content />
</EnhancedModal>
```

#### Disabling Features

```tsx
// Disable auto-height
<EnhancedModal maxHeight={undefined} />

// Disable lazy rendering (useful for forms with autofocus)
<EnhancedModal lazyRender={false} />
```

## Hook Factories

### `createEntityActionHook`

Creates a base entity action hook that provides standardized methods for triggering modal actions.

```typescript
import { createEntityActionHook } from "./shared"
import { openCommitModalAtom, commitModalLoadingAtom, commitModalOpenAtom } from "./commit/state"

// Create the base hook
const useEntityCommit = createEntityActionHook({
  openAtom: openCommitModalAtom,
  loadingAtom: commitModalLoadingAtom,
  openStateAtom: commitModalOpenAtom,
})

// Usage in component
function MyComponent() {
  const { actionEntity, actionEntityRef, isActioning, isOpen } = useEntityCommit()

  // By type, id, and name
  actionEntity("testset", "id-123", "My Testset")

  // By entity reference
  actionEntityRef({ type: "testset", id: "id-123", name: "My Testset" })
}
```

### `createTypedEntityActionHook`

Creates a typed hook for a specific entity type, wrapping the base hook.

```typescript
import { createTypedEntityActionHook } from "./shared"

// Create typed hook
const useTestsetCommit = createTypedEntityActionHook(useEntityCommit, "testset")

// Usage in component
function TestsetActions({ testsetId }: { testsetId: string }) {
  const { action, isActioning, isOpen } = useTestsetCommit()

  // Simpler API - no need to specify type
  action(testsetId, "My Testset")
}
```

## Types

### `BaseModalState`

Common state shape for all modals:

```typescript
interface BaseModalState {
  isOpen: boolean
  isLoading: boolean
  error: Error | null
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

The delete modal has a fundamentally different pattern - it supports **batch deletion** with an array of entities:

```typescript
// Delete signature
openDeleteModalAtom: WritableAtom<null, [entities: EntityReference[]], void>
```

Rather than over-complicating the factory to handle both patterns, the delete hook maintains its own implementation. This keeps the factory simple and purpose-focused while allowing delete to support its unique batch operation requirements.
