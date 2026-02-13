# Entity Selection Adapters

Adapters define how to navigate and select entities within specific hierarchies. Each adapter connects the selection UI to the underlying data layer (molecules/atoms).

## Overview

An adapter is the bridge between:
- **Data Layer**: Jotai atoms from entity molecules (e.g., `appRevision.selectors.apps`)
- **Selection UI**: The `EntityPicker` component with its variants (`cascading`, `breadcrumb`, `list-popover`)

## Pre-built Adapters

### appRevisionAdapter

Navigates the App → Variant → Revision hierarchy.

```typescript
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entity-ui'

// Cascading dropdowns
<EntityPicker<AppRevisionSelectionResult>
  variant="cascading"
  adapter="appRevision"
  onSelect={(selection) => {
    // selection.metadata.appId
    // selection.metadata.appName
    // selection.metadata.variantId
    // selection.metadata.variantName
    // selection.metadata.revision
  }}
/>

// Or breadcrumb navigation
<EntityPicker<AppRevisionSelectionResult>
  variant="breadcrumb"
  adapter="appRevision"
  onSelect={handleSelect}
  showSearch
  showBreadcrumb
/>
```

### evaluatorRevisionAdapter

Navigates the Evaluator → Variant → Revision hierarchy.

```typescript
import { EntityPicker, type EvaluatorRevisionSelectionResult } from '@agenta/entity-ui'

<EntityPicker<EvaluatorRevisionSelectionResult>
  variant="breadcrumb"
  adapter="evaluatorRevision"
  onSelect={(selection) => {
    // selection.metadata.evaluatorId
    // selection.metadata.evaluatorName
    // selection.metadata.variantId
    // selection.metadata.variantName
  }}
  showSearch
  showBreadcrumb
  rootLabel="All Evaluators"
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

Adapters must be initialized with actual atoms during app startup. This is done via setter functions:

```typescript
// In Providers.tsx or app initialization
import { setAppRevisionAtoms, setEvaluatorRevisionAtoms, setTestsetAtoms } from '@agenta/entity-ui'
import { appRevisionMolecule } from '@agenta/entities/appRevision'
import { evaluatorRevisionMolecule } from '@agenta/entities/evaluatorRevision'
import { testsetMolecule, revisionMolecule } from '@agenta/entities/testset'

// Configure app revision adapter
setAppRevisionAtoms({
  appsAtom: appRevisionMolecule.selectors.apps,
  variantsByAppFamily: (appId) => appRevisionMolecule.selectors.variantsByApp(appId),
  revisionsByVariantFamily: (variantId) => appRevisionMolecule.selectors.revisions(variantId),
})

// Configure evaluator revision adapter
setEvaluatorRevisionAtoms({
  evaluatorsAtom: evaluatorRevisionMolecule.selectors.evaluators,
  variantsAtomFamily: (evaluatorId) => evaluatorRevisionMolecule.selectors.variantsByEvaluator(evaluatorId),
  revisionsAtomFamily: (variantId) => evaluatorRevisionMolecule.selectors.revisions(variantId),
})

// Configure testset adapter
setTestsetAtoms({
  testsetsListAtom: testsetMolecule.atoms.list(null),
  revisionsListFamily: (testsetId) => revisionMolecule.atoms.list(testsetId),
})
```

## Creating Custom Adapters

Use `createAdapter` to define new entity hierarchies:

```typescript
import { createAdapter, type SelectionPathItem } from '@agenta/entity-ui'

interface MySelectionResult {
  type: 'myEntity'
  id: string
  label: string
  path: SelectionPathItem[]
  metadata: {
    parentId: string
    parentName: string
  }
}

export const myAdapter = createAdapter<MySelectionResult>({
  name: 'myEntity',
  entityType: 'myEntity',
  levels: [
    {
      type: 'parent',
      listAtom: parentListAtom,  // Atom<ListQueryState<Parent>>
      getId: (parent) => parent.id,
      getLabel: (parent) => parent.name,
      hasChildren: () => true,
      isSelectable: () => false,
    },
    {
      type: 'myEntity',
      listAtomFamily: (parentId) => childListAtomFamily(parentId),
      getId: (entity) => entity.id,
      getLabel: (entity) => entity.name,
      hasChildren: () => false,
      isSelectable: () => true,
    },
  ],
  selectableLevel: 1,  // Which level is selectable (0-indexed)
  toSelection: (path, leafEntity) => ({
    type: 'myEntity',
    id: leafEntity.id,
    label: `${path[0]?.label} / ${leafEntity.name}`,
    path,
    metadata: {
      parentId: path[0]?.id ?? '',
      parentName: path[0]?.label ?? '',
    },
  }),
  emptyMessage: 'No items found',
  loadingMessage: 'Loading...',
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

| Property | Type | Description |
|----------|------|-------------|
| `type` | `SelectableEntityType` | Entity type identifier |
| `listAtom` | `Atom<ListQueryState<T>>` | Static atom for root level |
| `listAtomFamily` | `(parentId: string) => Atom<ListQueryState<T>>` | Atom family for child levels |
| `getId` | `(entity: T) => string` | Extract entity ID |
| `getLabel` | `(entity: T) => string` | Extract display label |
| `getIcon` | `(entity: T) => ReactNode` | Optional icon |
| `getDescription` | `(entity: T) => string` | Optional description text |
| `hasChildren` | `(entity: T) => boolean` | Can expand to show children? |
| `isSelectable` | `(entity: T) => boolean` | Can be selected as final value? |
| `isDisabled` | `(entity: T) => boolean` | Visible but not interactive? |

## Files

- `createAdapter.ts` - Factory function and registry
- `types.ts` - Adapter interface types
- `appRevisionAdapter.ts` - App → Variant → Revision
- `evaluatorRevisionAdapter.ts` - Evaluator → Variant → Revision
- `testsetAdapter.ts` - Testset → Revision
