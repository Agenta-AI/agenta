# EvaluatorRevision Entity Module

Stub implementation for evaluator revision functionality.

## Current State

The evaluator entity system is currently a **stub implementation** because the backend
does not expose dedicated APIs for the evaluator → variant → revision hierarchy.

### What Exists

1. **Stub molecule** ([index.ts](./index.ts)) - Provides a minimal interface with empty/null values
2. **Selection adapter** - Uses runtime configuration via `setEvaluatorRevisionAtoms()`
3. **Data types** - `EvaluatorRevisionDto` exists with `evaluator_id` and `evaluator_variant_id` fields

### What's Missing (Backend Requirements)

To migrate to the relation-based pattern (like testset and appRevision), the backend would need to expose:

| Endpoint | Purpose |
|----------|---------|
| `GET /evaluators/{evaluatorId}/variants` | List variants for an evaluator |
| `GET /evaluator-variants/{variantId}/revisions` | List revisions for a variant |

Currently, evaluator data is fetched via:
- `GET /evaluators` - Returns flat list of evaluators
- `POST /preview/evaluators/revisions/query` - Batch fetches revisions by evaluator refs

## Current Usage

The selection adapter requires runtime configuration from the consuming application:

```typescript
import { setEvaluatorRevisionAtoms } from '@agenta/entity-ui/selection'

// During app initialization
setEvaluatorRevisionAtoms({
  // Atom that provides list of evaluators
  evaluatorsAtom: myEvaluatorsAtom,

  // Factory that returns variants for an evaluator
  variantsByEvaluatorFamily: (evaluatorId) => myVariantsAtom(evaluatorId),

  // Factory that returns revisions for a variant
  revisionsByVariantFamily: (variantId) => myRevisionsAtom(variantId),
})
```

## Migration Path

When the backend APIs are available, the migration would follow these steps:

### 1. Create Entity Relations

```typescript
// evaluatorRevision/relations.ts
import { defineRelation, type EntityRelation } from '@agenta/entities/shared'

// Root list atom for evaluators
export const evaluatorsListAtom = atom<ListQueryState<Evaluator>>((get) => {
  const query = get(evaluatorsQueryAtomFamily({ projectId: null }))
  return { data: query.data ?? [], isPending: query.isPending, ... }
})

// Evaluator → Variant relation
export const evaluatorToVariantRelation: EntityRelation<Evaluator, EvaluatorVariant> = {
  name: 'evaluatorToVariant',
  parentType: 'evaluator',
  childType: 'evaluatorVariant',
  listAtomFamily: (evaluatorId) => evaluatorVariantsQueryAtomFamily(evaluatorId),
  selection: {
    getId: (variant) => variant.id,
    getLabel: (variant) => variant.name ?? variant.slug ?? 'Unnamed',
    hasChildren: true,
    isSelectable: false,
    autoSelectSingle: true,
  },
}

// Variant → Revision relation
export const variantToEvaluatorRevisionRelation: EntityRelation<EvaluatorVariant, EvaluatorRevision> = {
  name: 'variantToEvaluatorRevision',
  parentType: 'evaluatorVariant',
  childType: 'evaluatorRevision',
  listAtomFamily: (variantId) => evaluatorRevisionsQueryAtomFamily(variantId),
  selection: {
    getId: (revision) => revision.id,
    getLabel: (revision) => `v${revision.version ?? 0}`,
    hasChildren: false,
    isSelectable: true,
    autoSelectSingle: true,
  },
}
```

### 2. Create Relation-Based Adapter

```typescript
// adapters/evaluatorRevisionRelationAdapter.ts
import { createThreeLevelAdapter } from './createAdapterFromRelations'

export const evaluatorRevisionAdapter = createThreeLevelAdapter<EvaluatorRevisionSelectionResult>({
  name: 'evaluatorRevision',
  grandparentType: 'evaluator',
  grandparentListAtom: evaluatorsListAtom,
  parentType: 'evaluatorVariant',
  parentRelation: evaluatorToVariantRelation,
  childType: 'evaluatorRevision',
  childRelation: variantToEvaluatorRevisionRelation,
  // ... rest of config
})
```

### 3. Remove Runtime Configuration

Once migrated, the `setEvaluatorRevisionAtoms()` function and the legacy adapter can be removed.

## Data Types

```typescript
interface EvaluatorRevisionData {
  id: string
  name?: string
  slug?: string
  version?: number
  configuration?: unknown
  invocationUrl?: string
  schemas?: {
    inputSchema?: unknown
    outputSchema?: unknown
  }
}

interface SettingsPreset {
  name: string
  description?: string
  settings_values: Record<string, unknown>
}

// From API types
interface EvaluatorRevisionDto {
  id?: string
  slug?: string
  evaluator_id?: string
  evaluator_variant_id?: string
  version?: string
  data?: Record<string, any>
  flags?: Record<string, any>
  meta?: Record<string, any>
  tags?: Record<string, unknown>
}
```

## See Also

- [Selection Adapters README](../../agenta-entity-ui/src/selection/adapters/README.md)
- [testset relations](../testset/relations.ts) - Example of relation-based implementation
- [appRevision relations](../appRevision/relations.ts) - Example of 3-level hierarchy
