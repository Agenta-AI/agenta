# Entity Selection Adapters

Adapters define how to navigate and select entities within specific hierarchies. Each adapter connects the selection UI to the underlying data layer (molecules/atoms).

## Overview

An adapter is the bridge between:

- **Data Layer**: Jotai atoms from entity molecules and relations
- **Selection UI**: The `EntityPicker` component with its variants (`cascading`, `breadcrumb`, `list-popover`)

## Pre-built Adapters

### workflowRevisionAdapter

Navigates the Workflow → Variant → Revision hierarchy.

```typescript
import { EntityPicker, type WorkflowRevisionSelectionResult } from '@agenta/entity-ui'

<EntityPicker<WorkflowRevisionSelectionResult>
  variant="cascading"
  adapter="workflowRevision"
  onSelect={(selection) => {
    // selection.metadata.workflowId
    // selection.metadata.workflowName
    // selection.metadata.variantId
    // selection.metadata.variantName
    // selection.metadata.revision
  }}
/>
```

### evaluatorAdapter

A flat evaluator list (1 level).

```typescript
import { EntityPicker, type EvaluatorSelectionResult } from '@agenta/entity-ui'

<EntityPicker<EvaluatorSelectionResult>
  variant="breadcrumb"
  adapter="evaluator"
  onSelect={(selection) => {
    // selection.metadata.evaluatorId
    // selection.metadata.evaluatorName
  }}
  showSearch
/>
```

### testsetAdapter

Navigates the Testset → Revision hierarchy (2 levels).

```typescript
import { EntityPicker, type TestsetSelectionResult } from '@agenta/entity-ui'

// List-popover variant (ideal for 2-level hierarchies)
<EntityPicker<TestsetSelectionResult>
  variant="list-popover"
  adapter="testset"
  onSelect={(selection) => {
    // selection.metadata.testsetId
    // selection.metadata.testsetName
    // selection.metadata.revisionId
    // selection.metadata.version
    // selection.metadata.commitMessage
  }}
  autoSelectLatest
  selectLatestOnParentClick
/>
```

## Initializing Adapters

The workflowRevision and testset adapters are derived from entity relations and need no runtime
configuration. The evaluator adapter takes its list atom via `initializeSelectionSystem`:

```typescript
import {initializeSelectionSystem} from "@agenta/entity-ui"

initializeSelectionSystem({
    evaluator: {evaluatorsAtom: nonArchivedEvaluatorsAtom},
})
```

## Creating Custom Adapters

Use `createAdapter` to define new entity hierarchies:

```typescript
import {createAdapter, type SelectionPathItem} from "@agenta/entity-ui/selection"

interface MySelectionResult {
    type: "myEntity"
    id: string
    label: string
    path: SelectionPathItem[]
    metadata: {
        parentId: string
        parentName: string
    }
}

export const myAdapter = createAdapter<MySelectionResult>({
    name: "myEntity",
    entityType: "myEntity",
    levels: [
        {
            type: "parent",
            listAtom: parentListAtom, // Atom<ListQueryState<Parent>>
            getId: (parent) => parent.id,
            getLabel: (parent) => parent.name,
            hasChildren: () => true,
            isSelectable: () => false,
        },
        {
            type: "myEntity",
            listAtomFamily: (parentId) => childListAtomFamily(parentId),
            getId: (entity) => entity.id,
            getLabel: (entity) => entity.name,
            hasChildren: () => false,
            isSelectable: () => true,
        },
    ],
    selectableLevel: 1, // Which level is selectable (0-indexed)
    toSelection: (path, leafEntity) => ({
        type: "myEntity",
        id: leafEntity.id,
        label: `${path[0]?.label} / ${leafEntity.name}`,
        path,
        metadata: {
            parentId: path[0]?.id ?? "",
            parentName: path[0]?.label ?? "",
        },
    }),
    emptyMessage: "No items found",
    loadingMessage: "Loading...",
})
```

## Adapter Registry

Adapters can be registered globally and resolved by name:

```typescript
import { registerSelectionAdapter, getSelectionAdapter } from '@agenta/entity-ui'

// Register
registerSelectionAdapter('myEntity', myAdapter)

// Resolve by name
const adapter = getSelectionAdapter('myEntity')

// Components accept string names
<EntityPicker variant="breadcrumb" adapter="myEntity" onSelect={handleSelect} />
```

## HierarchyLevel Configuration

Each level in the hierarchy supports:

| Property         | Type                                            | Description                     |
| ---------------- | ----------------------------------------------- | ------------------------------- |
| `type`           | `SelectableEntityType`                          | Entity type identifier          |
| `listAtom`       | `Atom<ListQueryState<T>>`                       | Static atom for root level      |
| `listAtomFamily` | `(parentId: string) => Atom<ListQueryState<T>>` | Atom family for child levels    |
| `getId`          | `(entity: T) => string`                         | Extract entity ID               |
| `getLabel`       | `(entity: T) => string`                         | Extract display label           |
| `getIcon`        | `(entity: T) => ReactNode`                      | Optional icon                   |
| `getDescription` | `(entity: T) => string`                         | Optional description text       |
| `hasChildren`    | `(entity: T) => boolean`                        | Can expand to show children?    |
| `isSelectable`   | `(entity: T) => boolean`                        | Can be selected as final value? |
| `isDisabled`     | `(entity: T) => boolean`                        | Visible but not interactive?    |

## Files

- `createAdapter.ts` - Factory function and registry
- `createAdapterFromRelations.ts` - Relation-based factories (`createTwoLevelAdapter`, `createThreeLevelAdapter`)
- `types.ts` - Adapter interface types
- `workflowRevisionRelationAdapter.ts` - Workflow → Variant → Revision
- `evaluatorAdapter.ts` - Evaluator (flat list)
- `testsetRelationAdapter.ts` - Testset → Revision
