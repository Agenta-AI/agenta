# Delete Modal

Modal for deleting entities, with support for single and batch deletion across multiple entity types.

## Files

| File | Purpose |
|------|---------|
| `EntityDeleteModal.tsx` | Main modal component |
| `EntityDeleteTitle.tsx` | Modal title with count |
| `EntityDeleteContent.tsx` | Confirmation message and warnings |
| `EntityDeleteFooter.tsx` | Cancel/Delete action buttons |
| `useEntityDelete.ts` | Hook to trigger the modal |
| `state.ts` | Jotai atoms for modal state |
| `index.ts` | Public exports |

## Usage

### Delete Single Entity

```tsx
import { useEntityDelete } from '@agenta/entities/ui'

function DeleteButton({ entity }: { entity: Entity }) {
  const { deleteEntity, isDeleting } = useEntityDelete()

  return (
    <Button
      danger
      onClick={() => deleteEntity('testset', entity.id, entity.name)}
      loading={isDeleting}
    >
      Delete
    </Button>
  )
}
```

### Delete Multiple Entities (Batch)

```tsx
const { deleteEntities } = useEntityDelete()

// Delete multiple entities at once
deleteEntities([
  { type: 'testset', id: '1', name: 'Testset 1' },
  { type: 'testset', id: '2', name: 'Testset 2' },
  { type: 'revision', id: '3', name: 'Revision v3' },
])
```

### Delete Mixed Entity Types

The delete modal supports batch deletion of different entity types simultaneously:

```tsx
deleteEntities([
  { type: 'testset', id: 't1' },
  { type: 'variant', id: 'v1' },
  { type: 'evaluator', id: 'e1' },
])
```

### Entity-Specific Hooks

```tsx
// For testsets
const { deleteTestset } = useTestsetDelete()
deleteTestset(testsetId, testsetName)

// For variants
const { deleteVariant } = useVariantDelete()
deleteVariant(variantId, variantName)

// For evaluators
const { deleteEvaluator } = useEvaluatorDelete()
deleteEvaluator(evaluatorId, evaluatorName)
```

## Hook Return Type

```typescript
interface UseEntityDeleteReturn {
  deleteEntity: (type: EntityType, id: string, name?: string) => void
  deleteEntities: (entities: EntityReference[]) => void
  isDeleting: boolean
  isOpen: boolean
}
```

## State Atoms

| Atom | Type | Description |
|------|------|-------------|
| `deleteModalOpenAtom` | `boolean` | Whether modal is visible |
| `deleteModalEntitiesAtom` | `EntityReference[]` | Entities to delete |
| `deleteModalLoadingAtom` | `boolean` | Operation in progress |
| `deleteModalErrorAtom` | `Error \| null` | Error during delete |

### Derived Atoms

| Atom | Type | Description |
|------|------|-------------|
| `deleteModalGroupsAtom` | `EntityGroup[]` | Entities grouped by type |
| `deleteModalNamesAtom` | `string[]` | Display names from adapters |
| `deleteModalWarningsAtom` | `string[]` | Warning messages from adapters |
| `deleteModalBlockedAtom` | `EntityReference[]` | Entities that cannot be deleted |
| `deleteModalCanProceedAtom` | `boolean` | Can proceed (no blocked entities) |
| `deleteModalCountAtom` | `number` | Total count of entities |
| `deleteModalStateAtom` | `DeleteModalState` | Combined state object |

### Action Atoms

| Atom | Description |
|------|-------------|
| `resetDeleteModalAtom` | Reset all state to defaults |
| `openDeleteModalAtom` | Open modal with entities |
| `closeDeleteModalAtom` | Close modal (preserves state) |
| `executeDeleteAtom` | Execute the delete operation |

## Component Props

### EntityDeleteModal

```typescript
interface EntityDeleteModalProps {
  open?: boolean              // External control
  onClose?: () => void        // Close callback
  entities?: EntityReference[] // Entities to delete
  onSuccess?: () => void      // Success callback
}
```

## Features

### Entity Grouping

When deleting multiple entities of different types, they are grouped in the confirmation dialog:

```
Delete 3 items?

Testsets (2):
- My Testset
- Another Testset

Variants (1):
- Default Variant
```

### Delete Warnings

Adapters can provide warnings that display in the confirmation:

```typescript
createAndRegisterEntityAdapter({
  type: 'testset',
  // ...
  getDeleteWarning: (testset) => {
    if (testset?.isUsedInEvaluations) {
      return 'This testset is used in evaluations'
    }
    return null
  },
})
```

### Blocked Deletions

Adapters can prevent deletion of certain entities:

```typescript
createAndRegisterEntityAdapter({
  type: 'variant',
  // ...
  canDelete: (variant) => {
    // Cannot delete the last variant
    return variant?.siblingCount > 1
  },
})
```

## Requirements

For the delete modal to work with an entity type, the adapter must provide:

1. `deleteAtom` - Atom that performs the delete operation

```typescript
createAndRegisterEntityAdapter({
  type: 'testset',
  // ... other config
  deleteAtom: testsetMolecule.reducers.delete,
  canDelete: (testset) => true,  // optional validation
  getDeleteWarning: (testset) => null,  // optional warning
})
```

The delete atom receives an array of IDs:

```typescript
deleteAtom: WritableAtom<unknown, [ids: string[]], Promise<void>>
```

## Design Note

This hook doesn't use `createEntityActionHook` from `../shared` because delete operations have a fundamentally different pattern - they support batch deletion with an array of entities, while the factory is designed for single-entity operations with optional extra arguments.
