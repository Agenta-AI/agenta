# Entity Modals

Reusable modal components for entity operations (commit, save, delete). These modals work with any registered entity type through the adapter pattern.

## Directory Structure

```
modals/
├── actions/                # Unified action dispatch system
│   ├── types.ts            # EntityModalAction types
│   ├── reducer.ts          # Action reducer
│   ├── context.tsx         # EntityActionProvider + hooks
│   └── index.ts
├── commit/                 # Commit modal (save changes with message)
│   ├── components/
│   ├── hooks/
│   ├── state.ts
│   └── index.ts
├── save/                   # Save modal (save/save-as/create new)
│   ├── components/
│   ├── hooks/
│   ├── state.ts
│   └── index.ts
├── delete/                 # Delete modal (single/batch delete)
│   ├── components/
│   ├── hooks/
│   ├── state.ts
│   └── index.ts
├── shared/                 # Shared utilities and hooks
│   ├── hooks/              # Hook factories
│   └── index.ts
├── adapters.ts             # Entity adapter registry
├── types.ts                # Core types (EntityReference, EntityType, etc.)
├── useSaveOrCommit.ts      # Combined save/commit hook
├── EntityActionProvider.tsx # Combined provider with all modals
└── index.ts                # Public exports
```

## Quick Start

### 1. Register an Entity Adapter

Before using modals with an entity type, register an adapter:

```typescript
import { createAndRegisterEntityAdapter } from '@agenta/entity-ui'
// Use clean named exports from main package
import { testset } from '@agenta/entities'

createAndRegisterEntityAdapter({
  type: 'testset',
  getDisplayName: (entity) => entity?.name ?? 'Untitled Testset',
  deleteAtom: testset.actions.delete,
  dataAtom: (id) => testset.atoms.data(id),
  commitAtom: testset.actions.commit,  // optional
  saveAtom: testset.actions.save,      // optional
})
```

### 2. Add Modal Components to Your App (Recommended: EntityModalsProvider)

Use `EntityModalsProvider` to mount all modals and the action dispatch context in one place:

```tsx
import { EntityModalsProvider } from '@agenta/entity-ui'

function App() {
  return (
    <EntityModalsProvider>
      <YourRoutes />
    </EntityModalsProvider>
  )
}
```

This is equivalent to manually adding each modal:

```tsx
import { 
  EntityActionProvider, 
  EntityCommitModal, 
  EntitySaveModal, 
  EntityDeleteModal 
} from '@agenta/entity-ui'

function App() {
  return (
    <EntityActionProvider>
      <YourRoutes />
      <EntityCommitModal />
      <EntitySaveModal />
      <EntityDeleteModal />
    </EntityActionProvider>
  )
}
```

### 3. Trigger Modals with Unified Dispatch (Recommended)

Use `useEntityActionDispatch` for a unified API:

```tsx
import { 
  useEntityActionDispatch, 
  commitAction, 
  saveAction, 
  deleteAction 
} from '@agenta/entity-ui'

function EntityActions({ entity }: { entity: Entity }) {
  const dispatch = useEntityActionDispatch()

  return (
    <div>
      <Button onClick={() => dispatch(commitAction(
        {type: 'testset', id: entity.id, name: entity.name}
      ))}>
        Commit
      </Button>
      <Button onClick={() => dispatch(saveAction(
        {type: 'testset', id: entity.id, name: entity.name}
      ))}>
        Save
      </Button>
      <Button danger onClick={() => dispatch(deleteAction(
        [{type: 'testset', id: entity.id, name: entity.name}]
      ))}>
        Delete
      </Button>
    </div>
  )
}
```

### 4. Alternative: Trigger Modals with Individual Hooks

```tsx
import { useEntityCommit, useEntitySave, useEntityDelete } from '@agenta/entity-ui'

function EntityActions({ entity }: { entity: Entity }) {
  const { commitEntity } = useEntityCommit()
  const { saveEntity, createEntity } = useEntitySave()
  const { deleteEntity } = useEntityDelete()

  return (
    <div>
      <Button onClick={() => commitEntity('testset', entity.id, entity.name)}>
        Commit
      </Button>
      <Button onClick={() => saveEntity('testset', entity.id, entity.name)}>
        Save
      </Button>
      <Button onClick={() => createEntity('testset')}>
        Create New
      </Button>
      <Button danger onClick={() => deleteEntity('testset', entity.id, entity.name)}>
        Delete
      </Button>
    </div>
  )
}
```

## Unified Action Dispatch (Recommended)

The unified action dispatch system provides a single entry point for all entity modal operations.

### Action Types

| Action | Purpose | Creator |
| ------ | ------- | ------- |
| `commit` | Open commit modal | `commitAction(entity, initialMessage?)` |
| `save` | Open save modal | `saveAction(entity, saveAsNew?)` |
| `create` | Open save modal for new entity | `createAction(entityType, initialName?)` |
| `delete` | Open delete modal | `deleteAction(entities, onSuccess?)` |
| `saveOrCommit` | Route to save or commit based on state | `saveOrCommitAction(entity, state, options?)` |

### Dispatch Hooks

| Hook | Purpose |
| ---- | ------- |
| `useEntityActionDispatch` | Get dispatch function for modal actions |
| `useEntityActionState` | Get current modal state (activeModal, isOpen, isLoading) |
| `useEntityActionGuard` | Check if any modal is open (for preventing concurrent modals) |

### Guard Behavior

By default, `EntityModalsProvider` guards against opening multiple modals simultaneously. When a modal is already open, dispatch calls are ignored with a dev warning.

```tsx
// Disable guard if needed
<EntityModalsProvider guardConcurrentModals={false}>
  <App />
</EntityModalsProvider>
```

## Available Hooks (Legacy API)

These hooks remain available for backwards compatibility:

| Hook | Purpose | Methods |
| ---- | ------- | ------- |
| `useEntityCommit` | Commit changes with message | `commitEntity`, `commitEntityRef` |
| `useEntitySave` | Save/save-as/create | `saveEntity`, `saveEntityRef`, `createEntity` |
| `useEntityDelete` | Delete single/multiple | `deleteEntity`, `deleteEntities` |
| `useSaveOrCommit` | Combined save + commit | `saveOrCommit`, `createNew` |

### Entity-Specific Convenience Hooks

```typescript
// Testset hooks
const { commitTestset } = useTestsetCommit()
const { saveTestset, createTestset } = useTestsetSave()
const { deleteTestset } = useTestsetDelete()

// Variant hooks
const { commitVariant } = useVariantCommit()
const { saveVariant, createVariant } = useVariantSave()
const { deleteVariant } = useVariantDelete()
```

## Adapter Interface

Each entity type provides an adapter that defines modal behaviors:

```typescript
interface EntityModalAdapter<TEntity> {
  type: EntityType

  // Display
  getDisplayName: (entity: TEntity | null) => string
  getDisplayLabel: (count: number) => string
  getIcon?: () => ReactNode

  // Validation
  canDelete?: (entity: TEntity | null) => boolean
  getDeleteWarning?: (entity: TEntity | null) => string | null
  canCommit?: (entity: TEntity | null) => boolean

  // Operations (via Jotai atoms)
  deleteAtom: WritableAtom<unknown, [ids: string[]], Promise<void>>
  commitAtom?: WritableAtom<unknown, [params: CommitParams], Promise<void>>
  saveAtom?: WritableAtom<unknown, [params: SaveParams], Promise<string>>

  // Data access
  dataAtom: (id: string) => Atom<TEntity | null>
}
```

## State Management

Each modal uses Jotai atoms for state:

- **Open state**: Whether modal is visible
- **Entity state**: Current entity being operated on
- **Loading state**: Operation in progress
- **Error state**: Any errors during operation
- **Input state**: Modal-specific inputs (commit message, entity name, etc.)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         useEntity[Action]                        │
│                    (Hook - triggers modal)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      state.ts atoms                              │
│             (openAtom, entityAtom, loadingAtom)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Entity[Action]Modal                          │
│              (Modal UI - reads from atoms)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EntityModalAdapter                          │
│            (Entity-specific logic and atoms)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Hook Factories

For creating entity action hooks with a consistent pattern:

### createEntityActionHook

Creates standardized hooks for triggering modal actions:

```typescript
import { createEntityActionHook, createTypedEntityActionHook } from '@agenta/entity-ui'

// Base hook (works with any entity type)
const useEntityMyAction = createEntityActionHook({
  openAtom: openMyModalAtom,
  loadingAtom: myModal.atoms.loading,
  openStateAtom: myModal.atoms.open,
})

// Typed hook (for specific entity type)
const useTestsetMyAction = createTypedEntityActionHook(useEntityMyAction, 'testset')
```

## Files Overview

| File | Purpose |
|------|---------|
| `types.ts` | Core types: `EntityType`, `EntityReference`, modal state types |
| `adapters.ts` | Adapter registry and factory functions |
| `useSaveOrCommit.ts` | Combined hook for save-or-commit workflows |
| `shared/hooks/createEntityActionHook.ts` | Hook factories for entity actions |
| `index.ts` | Public API exports |
