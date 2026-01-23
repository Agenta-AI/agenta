# Save Modal

Modal for saving entities, with support for save-as-new (creating copies) and creating new entities from scratch.

## Files

| File | Purpose |
|------|---------|
| `EntitySaveModal.tsx` | Main modal component |
| `EntitySaveTitle.tsx` | Modal title (Save/Save As/Create) |
| `EntitySaveContent.tsx` | Name input form |
| `EntitySaveFooter.tsx` | Cancel/Save action buttons |
| `useEntitySave.ts` | Hook to trigger the modal |
| `state.ts` | Jotai atoms for modal state |
| `index.ts` | Public exports |

## Usage

### Save Existing Entity

```tsx
import { useEntitySave } from '@agenta/entity-ui'

function SaveButton({ entity }: { entity: Entity }) {
  const { saveEntity, isSaving } = useEntitySave()

  return (
    <Button
      onClick={() => saveEntity('testset', entity.id, entity.name)}
      loading={isSaving}
    >
      Save
    </Button>
  )
}
```

### Save As New (Copy)

```tsx
const { saveEntity } = useEntitySave()

// Pass `true` as 4th argument to save as new copy
saveEntity('testset', entity.id, entity.name, true)
```

### Create New Entity

```tsx
const { createEntity } = useEntitySave()

// Opens modal to create new entity of specified type
createEntity('testset')

// With initial name
createEntity('testset', 'My New Testset')
```

### Using Entity Reference

```tsx
const { saveEntityRef } = useEntitySave()

saveEntityRef({ type: 'testset', id: entity.id, name: entity.name })
saveEntityRef({ type: 'testset', id: entity.id }, true) // save as new
```

### Entity-Specific Hooks

```tsx
// For testsets
const { saveTestset, createTestset } = useTestsetSave()
saveTestset(testsetId, testsetName)
createTestset('New Testset')

// For variants
const { saveVariant, createVariant } = useVariantSave()
saveVariant(variantId, variantName)
createVariant('New Variant')
```

## Hook Return Type

```typescript
interface UseEntitySaveReturn {
  saveEntity: (type: EntityType, id: string, name?: string, saveAsNew?: boolean) => void
  saveEntityRef: (entity: EntityReference, saveAsNew?: boolean) => void
  createEntity: (type: EntityType, initialName?: string) => void
  isSaving: boolean
  isOpen: boolean
}
```

## State Atoms

| Atom | Type | Description |
|------|------|-------------|
| `saveModalOpenAtom` | `boolean` | Whether modal is visible |
| `saveModalEntityAtom` | `EntityReference \| null` | Entity being saved (null for new) |
| `saveModalEntityTypeAtom` | `EntityType \| null` | Type for new entity creation |
| `saveModalNameAtom` | `string` | Entity name input |
| `saveModalSaveAsNewAtom` | `boolean` | Save as new copy flag |
| `saveModalLoadingAtom` | `boolean` | Operation in progress |
| `saveModalErrorAtom` | `Error \| null` | Error during save |

### Derived Atoms

| Atom | Type | Description |
|------|------|-------------|
| `saveModalResolvedTypeAtom` | `EntityType \| null` | Type from entity or entityType |
| `saveModalOriginalNameAtom` | `string` | Original name from adapter |
| `saveModalNameModifiedAtom` | `boolean` | Whether name was changed |
| `saveModalCanProceedAtom` | `boolean` | Can submit (has valid name) |
| `saveModalTitleAtom` | `string` | Dynamic modal title |
| `saveModalStateAtom` | `SaveModalState` | Combined state object |

### Action Atoms

| Atom | Description |
|------|-------------|
| `resetSaveModalAtom` | Reset all state to defaults |
| `openSaveModalAtom` | Open modal for existing entity |
| `openSaveNewModalAtom` | Open modal for creating new entity |
| `closeSaveModalAtom` | Close modal (preserves state) |
| `setSaveNameAtom` | Update entity name |
| `toggleSaveAsNewAtom` | Toggle save-as-new flag |
| `executeSaveAtom` | Execute the save operation |

## Component Props

### EntitySaveModal

```typescript
interface EntitySaveModalProps {
  open?: boolean                    // External control
  onClose?: () => void              // Close callback
  entity?: EntityReference          // Entity to save
  defaultEntityType?: EntityType    // Type for new entities
  onSuccess?: (result: { id: string; name: string }) => void
}
```

## Modal Modes

The save modal has three modes based on context:

| Mode | Condition | Title | Behavior |
|------|-----------|-------|----------|
| **Save** | Existing entity, not saveAsNew | "Save {Type}" | Updates existing |
| **Save As** | Existing entity + saveAsNew | "Save {Type} As" | Creates copy |
| **Create** | No entity (via `createEntity`) | "Create {Type}" | Creates new |

## Requirements

For the save modal to work with an entity type, the adapter must provide:

1. `saveAtom` - Atom that performs the save operation

```typescript
createAndRegisterEntityAdapter({
  type: 'testset',
  // ... other config
  saveAtom: testsetMolecule.reducers.save,
})
```

The save atom receives:

```typescript
interface SaveParams {
  id?: string       // Entity ID (undefined for new)
  name: string      // Entity name
  saveAsNew?: boolean
}
```
