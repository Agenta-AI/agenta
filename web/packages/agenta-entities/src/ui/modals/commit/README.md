# Commit Modal

Modal for committing entity changes, creating new revisions with a commit message.

## Files

| File | Purpose |
|------|---------|
| `EntityCommitModal.tsx` | Main modal component |
| `EntityCommitTitle.tsx` | Modal title showing entity name |
| `EntityCommitContent.tsx` | Commit message input form |
| `EntityCommitFooter.tsx` | Cancel/Commit action buttons |
| `useEntityCommit.ts` | Hook to trigger the modal |
| `state.ts` | Jotai atoms for modal state |
| `index.ts` | Public exports |

## Usage

### Basic Usage

```tsx
import { useEntityCommit } from '@agenta/entities/ui'

function CommitButton({ entity }: { entity: Entity }) {
  const { commitEntity, isCommitting } = useEntityCommit()

  return (
    <Button
      onClick={() => commitEntity('testset', entity.id, entity.name)}
      loading={isCommitting}
    >
      Commit Changes
    </Button>
  )
}
```

### With Initial Message

```tsx
const { commitEntity } = useEntityCommit()

// Pass initial commit message as 4th argument
commitEntity('testset', entity.id, entity.name, 'Initial commit message')
```

### Using Entity Reference

```tsx
const { commitEntityRef } = useEntityCommit()

commitEntityRef({ type: 'testset', id: entity.id, name: entity.name })
```

### Entity-Specific Hooks

```tsx
// For revisions
const { commitRevision } = useRevisionCommit()
commitRevision(revisionId, revisionName)

// For variants
const { commitVariant } = useVariantCommit()
commitVariant(variantId, variantName)
```

## Hook Return Type

```typescript
interface UseEntityCommitReturn {
  commitEntity: (type: EntityType, id: string, name?: string, initialMessage?: string) => void
  commitEntityRef: (entity: EntityReference, initialMessage?: string) => void
  isCommitting: boolean
  isOpen: boolean
}
```

## State Atoms

| Atom | Type | Description |
|------|------|-------------|
| `commitModalOpenAtom` | `boolean` | Whether modal is visible |
| `commitModalEntityAtom` | `EntityReference \| null` | Entity being committed |
| `commitModalMessageAtom` | `string` | Commit message input |
| `commitModalLoadingAtom` | `boolean` | Operation in progress |
| `commitModalErrorAtom` | `Error \| null` | Error during commit |

### Derived Atoms

| Atom | Type | Description |
|------|------|-------------|
| `commitModalEntityNameAtom` | `string` | Display name from adapter |
| `commitModalCanCommitAtom` | `boolean` | Adapter validation result |
| `commitModalCanProceedAtom` | `boolean` | Can submit (has message + can commit) |
| `commitModalStateAtom` | `CommitModalState` | Combined state object |

### Action Atoms

| Atom | Description |
|------|-------------|
| `resetCommitModalAtom` | Reset all state to defaults |
| `openCommitModalAtom` | Open modal with entity |
| `closeCommitModalAtom` | Close modal (preserves state) |
| `setCommitMessageAtom` | Update commit message |
| `executeCommitAtom` | Execute the commit operation |

## Component Props

### EntityCommitModal

```typescript
interface EntityCommitModalProps {
  open?: boolean              // External control
  onClose?: () => void        // Close callback
  entity?: EntityReference    // Entity to commit
  onSuccess?: (result: { newRevisionId?: string }) => void
}
```

## Requirements

For the commit modal to work with an entity type, the adapter must provide:

1. `commitAtom` - Atom that performs the commit operation
2. `canCommit` (optional) - Validation function

```typescript
createAndRegisterEntityAdapter({
  type: 'testset',
  // ... other config
  commitAtom: testsetMolecule.reducers.commit,
  canCommit: (testset) => testset?.isDirty ?? false,
})
```
