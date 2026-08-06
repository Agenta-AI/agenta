# Workflow Variant Molecule

## Problem

Currently there is no molecule for `WorkflowVariant` entities. When UI components need to display a variant's human-readable name (e.g., "default") from a `variantId`, they must:

1. Know the parent `workflowId` (app ID) to call `workflowVariantsListDataAtomFamily(workflowId)`
2. Search through the full variants list to find the matching variant
3. Handle Jotai store isolation (IVT cells run in an isolated Provider, so `useAtomValue` reads from the wrong store — requires `useDefaultStoreAtomValue` workaround)

This creates friction in multiple places:
- Deployment history table cells
- Deployment cards (via `variantNameMapAtom` enrichment in `appEnvironmentAtoms.ts`)
- Variant name resolution anywhere a `variantId` is available but the parent `workflowId` is not

## Proposed Solution

Add a `workflowVariantMolecule` to `@agenta/entities/workflow` that is keyed by `variantId` and provides reactive selectors for variant properties.

### New Atoms

```typescript
// Query atom family — fetches a single variant by ID
// Could reuse the existing variants list query with cache seeding,
// or use a dedicated single-variant endpoint if available.
export const workflowVariantQueryAtomFamily = atomFamily((variantId: string) =>
    atomWithQuery((get) => {
        const projectId = get(workflowProjectIdAtom)
        return {
            queryKey: ["workflows", "variant", variantId, projectId],
            queryFn: async () => fetchWorkflowVariant(variantId, projectId),
            enabled: get(sessionAtom) && !!projectId && !!variantId,
            staleTime: 30_000,
        }
    }),
)

// Derived data selector
const variantDataAtomFamily = atomFamily((variantId: string) =>
    atom<WorkflowVariant | null>((get) => {
        const query = get(workflowVariantQueryAtomFamily(variantId))
        return query.data ?? null
    }),
)

// Name selector (most common use case)
const variantNameAtomFamily = atomFamily((variantId: string) =>
    atom<string | null>((get) => {
        const data = get(variantDataAtomFamily(variantId))
        return data?.name ?? null
    }),
)
```

### Molecule Shape

```typescript
export const workflowVariantMolecule = {
    selectors: {
        data: variantDataAtomFamily,
        name: variantNameAtomFamily,
        query: variantQueryAtomFamily,
    },
    get: {
        data: (variantId: string, options?: StoreOptions) =>
            getStore(options).get(variantDataAtomFamily(variantId)),
        name: (variantId: string, options?: StoreOptions) =>
            getStore(options).get(variantNameAtomFamily(variantId)),
    },
}
```

### Cache Seeding from List Queries

When `workflowVariantsQueryAtomFamily(workflowId)` resolves, seed the individual variant query caches so that `workflowVariantQueryAtomFamily(variantId)` doesn't need a separate network request:

```typescript
// Inside workflowVariantsQueryAtomFamily's queryFn or via an effect
const variants = response.workflow_variants
for (const v of variants) {
    queryClient.setQueryData(["workflows", "variant", v.id, projectId], v)
}
```

This way the molecule works with zero extra API calls when the list is already loaded, and auto-fetches on demand when it isn't.

## API Considerations

- Check if the backend already supports fetching a single variant by ID (e.g., `GET /workflows/variants/{variant_id}`)
- If not, the query can use the list endpoint filtered by workflow ID (requires knowing the workflow ID, which the variant response should include)
- Alternatively, a batch endpoint similar to `fetchWorkflowRevisionsByIdsBatch` could be added for variants

## Migration Path

Once the molecule exists, replace:
- `variantNameMapAtom` in `appEnvironmentAtoms.ts` — cards can use `workflowVariantMolecule.selectors.name(deployedVariantId)` directly
- `useDefaultStoreAtomValue(workflowVariantsListDataAtomFamily(appId))` in `deploymentColumns.tsx` — cells use `useDefaultStoreAtomValue(workflowVariantMolecule.selectors.name(record.variantId))`
- Any other variant name lookups that currently go through the list

## Files to Change

- `web/packages/agenta-entities/src/workflow/state/store.ts` — add query atom family
- `web/packages/agenta-entities/src/workflow/state/molecule.ts` — add variant molecule export
- `web/packages/agenta-entities/src/workflow/index.ts` — export variant molecule
- `web/oss/src/state/environment/appEnvironmentAtoms.ts` — simplify enrichment
- `web/oss/src/components/DeploymentsDashboard/Table/assets/deploymentColumns.tsx` — use molecule
- Possibly `api/oss/src/apis/fastapi/workflows/router.py` — single variant endpoint if needed
