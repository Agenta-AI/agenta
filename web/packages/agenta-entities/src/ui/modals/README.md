# Entity Modals

Reusable modal components for entity operations (commit, save, delete). These modals work with any registered entity type through the adapter pattern.

## Directory Structure

```
modals/
├── commit/                 # Commit modal (save changes with message)
│   ├── EntityCommitModal.tsx
│   ├── EntityCommitTitle.tsx
│   ├── EntityCommitContent.tsx
│   ├── EntityCommitFooter.tsx
│   ├── useEntityCommit.ts
│   ├── state.ts
│   └── index.ts
├── save/                   # Save modal (save/save-as/create new)
│   ├── EntitySaveModal.tsx
│   ├── EntitySaveTitle.tsx
│   ├── EntitySaveContent.tsx
│   ├── EntitySaveFooter.tsx
│   ├── useEntitySave.ts
│   ├── state.ts
│   └── index.ts
├── delete/                 # Delete modal (single/batch delete)
│   ├── EntityDeleteModal.tsx
│   ├── EntityDeleteTitle.tsx
│   ├── EntityDeleteContent.tsx
│   ├── EntityDeleteFooter.tsx
│   ├── useEntityDelete.ts
│   ├── state.ts
│   └── index.ts
├── shared/                 # Shared utilities and factories
│   ├── createEntityActionHook.ts
│   ├── types.ts
│   └── index.ts
├── adapters.ts             # Entity adapter registry
├── types.ts                # Core types (EntityReference, EntityType, etc.)
├── useSaveOrCommit.ts      # Combined save/commit hook
└── index.ts                # Public exports
```

## Quick Start

### 1. Register an Entity Adapter

Before using modals with an entity type, register an adapter:

```typescript
import { createAndRegisterEntityAdapter } from '@agenta/entities/ui'

createAndRegisterEntityAdapter({
  type: 'testset',
  getDisplayName: (testset) => testset?.name ?? 'Untitled Testset',
  deleteAtom: testsetMolecule.reducers.delete,
  dataAtom: (id) => testsetMolecule.selectors.data(id),
  commitAtom: testsetMolecule.reducers.commit,  // optional
  saveAtom: testsetMolecule.reducers.save,      // optional
})
```

### 2. Add Modal Components to Your App

Add the modal components once at the app root:

```tsx
import { EntityCommitModal, EntitySaveModal, EntityDeleteModal } from '@agenta/entities/ui'

function App() {
  return (
    <>
      <YourRoutes />
      <EntityCommitModal />
      <EntitySaveModal />
      <EntityDeleteModal />
    </>
  )
}
```

### 3. Trigger Modals with Hooks

```tsx
import { useEntityCommit, useEntitySave, useEntityDelete } from '@agenta/entities/ui'

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

## Available Hooks

| Hook | Purpose | Methods |
|------|---------|---------|
| `useEntityCommit` | Commit changes with message | `commitEntity`, `commitEntityRef` |
| `useEntitySave` | Save/save-as/create | `saveEntity`, `saveEntityRef`, `createEntity` |
| `useEntityDelete` | Delete single/multiple | `deleteEntity`, `deleteEntities` |
| `useSaveOrCommit` | Combined save + commit | `save`, `commit`, `saveOrCommit` |

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

## Files Overview

| File | Purpose |
|------|---------|
| `types.ts` | Core types: `EntityType`, `EntityReference`, modal state types |
| `adapters.ts` | Adapter registry and factory functions |
| `useSaveOrCommit.ts` | Combined hook for save-or-commit workflows |
| `index.ts` | Public API exports |
