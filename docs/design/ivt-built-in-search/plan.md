# IVT Built-in Search Input

## Problem

Every table that uses `InfiniteVirtualTableFeatureShell` manually creates a search `Input`, wires it to local or atom state, wraps it in `useMemo`, and passes it via `filters` or `primaryActions`. This boilerplate is repeated in **9+ places** across the codebase with minor variations (placeholder text, width, input type).

The shell already accepts `searchDeps` (via `useTableManager`) to reset pagination on search changes, but the actual search UI is always external.

## Current Pattern (repeated everywhere)

```tsx
const [searchTerm, setSearchTerm] = useState("")

const table = useTableManager({
    datasetStore: myStore.store,
    scopeId: "my-table",
    pageSize: 50,
    searchDeps: [searchTerm],
})

const searchNode = useMemo(
    () => (
        <Input.Search
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search"
            allowClear
            className="w-[400px]"
        />
    ),
    [searchTerm],
)

<InfiniteVirtualTableFeatureShell
    {...table.shellProps}
    filters={searchNode}
    columns={columns}
    autoHeight
/>
```

## Affected Files

### Passed as `filters` prop (4)
- `web/oss/src/components/pages/app-management/components/ApplicationManagementSection.tsx`
- `web/oss/src/components/pages/prompts/components/PromptsTableSection.tsx`
- `web/packages/agenta-annotation-ui/src/components/AnnotationQueuesView/index.tsx`
- `web/oss/src/components/TestcasesTableNew/components/TestcasesTableShell.tsx`

### Passed as `primaryActions` prop (1)
- `web/oss/src/components/DeploymentsDashboard/modals/SelectDeployVariantModalContent.tsx`

### Separate JSX element alongside IVT (3)
- `web/oss/src/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/EvaluatorVariantModal.tsx`
- `web/oss/src/components/pages/evaluations/NewEvaluation/Components/SelectVariantSection.tsx`
- `web/oss/src/components/DeploymentsDashboard/components/Modal/SelectDeployVariantModal.tsx`

### Parent page managing search for child table (1)
- `web/oss/src/components/DeploymentsDashboard/index.tsx` → passes to `DeploymentsTable`

## Proposal

### Option A: Built-in search on `useTableManager` + `FeatureShell`

Add optional search config to `useTableManager`. When enabled, the hook manages search state internally and the shell renders the input automatically in the `filters` slot.

**useTableManager changes:**

```tsx
interface UseTableManagerOptions<T> {
    // ... existing options ...

    /** Built-in search configuration. When provided, the hook manages search state. */
    search?: {
        /** Placeholder text (default: "Search") */
        placeholder?: string
        /** Max width class (default: "max-w-[320px]") */
        className?: string
        /** Whether search is disabled */
        disabled?: boolean
        /** External atom to sync search term with (for cross-component access) */
        atom?: WritableAtom<string, [string], void>
    } | boolean  // `true` = defaults
}
```

When `search` is provided:
1. The hook creates internal `searchTerm` state (or uses the provided atom)
2. `searchDeps` is automatically set to `[searchTerm]`
3. A new `searchNode` is added to the return value
4. `shellProps` includes `filters: searchNode` (merged with any explicit `filters`)

**Result value additions:**

```tsx
interface UseTableManagerResult<T> {
    // ... existing return values ...

    /** Search term value (only when search config is provided) */
    searchTerm: string
    /** Search term setter (only when search config is provided) */
    setSearchTerm: (value: string) => void
}
```

**Shell changes:**

`shellProps` already passes through to the shell. The `filters` slot in `shellProps` would include the built-in search node. No changes needed to `InfiniteVirtualTableFeatureShell` itself.

**Usage after:**

```tsx
const table = useTableManager({
    datasetStore: myStore.store,
    scopeId: "my-table",
    pageSize: 50,
    search: { placeholder: "Search revisions..." },
})

<InfiniteVirtualTableFeatureShell
    {...table.shellProps}
    columns={columns}
    autoHeight
/>
```

### Option B: Built-in search directly on `FeatureShell`

Add a `search` prop to `InfiniteVirtualTableFeatureShell` that renders the input in the `filters` slot.

```tsx
<InfiniteVirtualTableFeatureShell
    {...table.shellProps}
    columns={columns}
    search={{ placeholder: "Search revisions..." }}
    autoHeight
/>
```

The shell would internally manage search state and expose it via a callback or ref.

**Downside:** The shell doesn't currently own state — it receives everything via props. Adding internal state breaks this pattern.

### Recommendation

**Option A** is preferred because:
- `useTableManager` already manages search-related state (`searchDeps`, pagination reset)
- The hook is the natural place to own search state
- No changes to the shell component itself (it just receives props)
- Consumers can still pass custom `filters` if they need more than just search
- External atom support allows cross-component access (e.g. `registrySearchTermAtom`)
- Backward compatible — `search` is optional, existing code continues to work

## Variations to Handle

| Variation | Solution |
|-----------|----------|
| Custom placeholder | `search.placeholder` |
| Custom width | `search.className` |
| Disabled state | `search.disabled` |
| Jotai atom for external access | `search.atom` |
| Additional filters alongside search | Pass extra filters via separate `filters` prop (merged) |
| Plain `Input` vs `Input.Search` | Always use `Input.Search` for consistency. The visual difference is minimal |
| No search (current default) | Omit `search` option |

## Migration

Adopt incrementally — no big bang refactor needed. When touching a file that has the manual search pattern, replace it with the built-in config.
