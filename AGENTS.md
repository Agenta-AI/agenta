# Contributor Guide

## Dev Environment Tips
- If you make changes to the frontend, make sure to run `pnpm lint-fix` within the web folder
- If you make changes to the backend or sdk, make sure to run `ruff format` and `ruff check --fix` within the sdk or api folder
- If you update Ant Design tokens, run `pnpm generate:tailwind-tokens` in the web folder and commit the generated file


## Testing Instructions
- Tests are currently still not working and should not be run 

## PR instructions
- If the user provides you with the issue id, title the PR: [issue-id] fix(frontend): <Title> where fix is the type (fix, feat, chore, ci, doc, test.. [we're using better-branch) and frontend is where and it could be api, sdk, frontend, docs, ..

## Import Aliases Best Practices

The monorepo uses TypeScript path aliases for cleaner imports. Understanding when to use each pattern is important for maintainability.

### Available Aliases

1. **`@/oss/*`** - Resolves with fallback order: `ee/src/*` → `oss/src/*`
2. **`@agenta/oss/src/*`** - Explicit import from OSS package (npm workspace)
3. **`@/agenta-oss-common/*`** - Similar fallback to `@/oss/*` (less common)

### When to Use Each Pattern

#### Use `@/oss/*` for shared utilities and state

Use this pattern when importing shared utilities, helpers, types, hooks, or state that work the same in both EE and OSS:

```typescript
// ✅ Good - Shared utilities
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {User, JSSTheme} from "@/oss/lib/Types"
import {selectedOrgIdAtom} from "@/oss/state/org"
import axios from "@/oss/lib/api/assets/axiosConfig"
```

**Why:** The fallback mechanism allows EE to override implementations if needed, while falling back to OSS by default.

#### Use `@agenta/oss/src/*` for explicit OSS imports

Use this pattern when EE code needs to **explicitly reference the OSS version** of a component or page, typically for:
- Extending/wrapping OSS components
- Re-exporting OSS pages with EE enhancements
- Ensuring you get the OSS implementation (not an EE override)

```typescript
// ✅ Good - Explicit OSS component import
import OssSidebarBanners from "@agenta/oss/src/components/SidebarBanners"
import ObservabilityPage from "@agenta/oss/src/pages/w/[workspace_id]/p/[project_id]/observability"
import {DeploymentRevisions} from "@agenta/oss/src/lib/types_ee"
```

**Why:** This bypasses the fallback mechanism and guarantees you're importing from the OSS package.

#### Never use relative paths for cross-package imports

```typescript
// ❌ Bad - Fragile and hard to maintain
import OssSidebarBanners from "../../../../oss/src/components/SidebarBanners"

// ✅ Good - Use explicit alias
import OssSidebarBanners from "@agenta/oss/src/components/SidebarBanners"
```

**Why:** Relative paths break easily with refactoring and are harder to read.

### Examples in the Codebase

**Shared utilities with `@/oss/*`:**
- `web/ee/src/state/billing/atoms.ts` - Uses `@/oss/*` for API utilities, types, and state atoms
- `web/ee/src/hooks/useCrispChat.ts` - Uses `@/oss/*` for environment helpers

**Explicit OSS imports with `@agenta/oss/src/*`:**
- `web/ee/src/components/SidebarBanners/index.tsx` - Wraps OSS component
- `web/ee/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/traces/index.tsx` - Re-exports OSS page
- `web/ee/src/components/DeploymentHistory/DeploymentHistory.tsx` - Uses EE-specific types from OSS

### Quick Decision Guide

```
Are you in EE code importing from OSS?
├─ Is it a component/page that EE extends or wraps?
│  └─ Use: @agenta/oss/src/*
├─ Is it a utility, helper, type, or state atom?
│  └─ Use: @/oss/*
└─ Not sure?
   └─ Use: @agenta/oss/src/* (explicit is safer)
```


### Architecture Overview

Our folder structure follows a module-based architecture that prioritizes maintainability, reusability, and clear separation of concerns.

#### Core Principles

1. **Modular Organization**

    - Modules represent distinct feature areas (similar to pages)
    - Each module is self-contained with its own components, hooks, and assets
    - Shared functionality is elevated to appropriate hierarchy levels

2. **Component Structure**

    - Components are organized by their scope of use
    - Each component may contain:
        - Presentational logic (`Component.tsx`)
        - UI-only subcomponents (`components/*.tsx`)
        - Component-specific hooks (`hooks/*.ts`)
        - Local constants and utilities (`assets/*.ts`)
        - Type definitions (`types.d.ts`)

3. **Code Movement Guidelines**
   The following rules determine where code should live:
    - Module-specific code stays within the module
    - Components used across multiple modules move to root `/components`
    - Hooks used across multiple modules move to root `/hooks`
    - UI elements, constants, or utilities used across modules move to root `/assets`
    - Types used across modules move to root `types.d.ts`

#### State Management

1. **Store Organization**

 - Each module can have its own `store` folder containing:
     - Jotai atoms for reactive state
   - Global store at root level for cross-module state

2. **State Movement Guidelines**

    - State used only within a component stays as local state
    - State shared between components in a module uses module-level store
    - State shared across modules moves to root `/store`
    - Consider these factors when choosing state location:
        - Scope of state usage
        - Frequency of updates
        - Performance implications
        - Data persistence requirements

3. **State Management Tools**
   - Prefer Jotai atoms for all kind of shared state
   - Local component state for UI-only concerns

4. **Avoiding Prop Drilling**
    - **When state is only meaningful within a component tree**: Use Jotai atoms instead of prop drilling
    - Prop drilling (passing props through multiple levels) makes code brittle and hard to maintain
    - Atoms allow any component in the tree to access state without intermediate components knowing about it

**Example - Avoid prop drilling:**

❌ **Don't do this:**
```typescript
function Parent() {
    const [selectedId, setSelectedId] = useState(null)
    return <Child1 selectedId={selectedId} setSelectedId={setSelectedId} />
}

function Child1({selectedId, setSelectedId}) {
    // Child1 doesn't use these props, just passes them down
    return <Child2 selectedId={selectedId} setSelectedId={setSelectedId} />
}

function Child2({selectedId, setSelectedId}) {
    return <GrandChild selectedId={selectedId} setSelectedId={setSelectedId} />
}

function GrandChild({selectedId, setSelectedId}) {
    // Finally uses them here
    return <div onClick={() => setSelectedId(123)}>{selectedId}</div>
}
```

✅ **Use atoms instead:**
```typescript
// In module store or appropriate location
export const selectedIdAtom = atom<string | null>(null)

function Parent() {
    return <Child1 />
}

function Child1() {
    // No props needed
    return <Child2 />
}

function Child2() {
    return <GrandChild />
}

function GrandChild() {
    // Direct access to state
    const [selectedId, setSelectedId] = useAtom(selectedIdAtom)
    return <div onClick={() => setSelectedId(123)}>{selectedId}</div>
}
```

**When to use atoms vs props:**
- Use **props** when: Parent component owns/controls the state, single level passing, or props are configuration/callbacks
- Use **atoms** when: State needs to be shared across non-parent-child components, multiple levels of drilling, or state is module/feature-scoped

5. **Persisted State with LocalStorage**

For state that needs to persist across browser sessions, use `atomWithStorage` from `jotai/utils`:

```typescript
import {atomWithStorage} from "jotai/utils"

// Simple usage - automatically syncs with localStorage
export const rowHeightAtom = atomWithStorage<"small" | "medium" | "large">(
    "agenta:table:row-height", // localStorage key
    "medium", // default value
)

// Usage in components - same as regular atoms
const [rowHeight, setRowHeight] = useAtom(rowHeightAtom)
```

**For storing app/module-scoped data:**
```typescript
// Storage atom holds all app-specific data
const selectedVariantsByAppAtom = atomWithStorage<Record<string, string[]>>(
    "agenta_selected_revisions_v2",
    {},
)

// Derived atom provides scoped access per app
export const selectedVariantsAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        return all[appId] || []
    },
    (get, set, next: string[]) => {
        const appId = get(routerAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        set(selectedVariantsByAppAtom, {...all, [appId]: next})
    },
)
```

**For nullable strings, use custom stringStorage:**
```typescript
import {stringStorage} from "@/oss/state/utils/stringStorage"

export const recentAppIdAtom = atomWithStorage<string | null>(
    "agenta:recent-app",
    null,
    stringStorage, // Handles null values properly
)
```

**When to use `atomWithStorage`:**
- User preferences (theme, row height, view mode)
- Recently used items (recent app, recent filter)
- UI state that should persist (sidebar open/closed, panel sizes)
- Form drafts or temporary data

**Best practices:**
- Prefix keys with `agenta:` for consistency (e.g., `"agenta:table:row-height"`)
- Use TypeScript types for type safety
- Provide sensible defaults
- For complex objects, `atomWithStorage` handles JSON serialization automatically
- For nullable strings, use `stringStorage` helper

**Examples in codebase:**
- `web/oss/src/components/EvalRunDetails2/state/rowHeight.ts` - User preference
- `web/oss/src/state/app/atoms/fetcher.ts` - Recent app tracking
- `web/oss/src/components/Playground/state/atoms/core.ts` - App-scoped selections

#### Implementation Strategy

-   **Current Approach**: Gradual adoption during regular development
-   **Migration**: Update components to follow this structure as they are modified
-   **No Big Bang**: Avoid large-scale refactoring
-   **Progressive Enhancement**: Easy to implement incrementally

This structure supports:

-   Clear ownership and responsibility
-   Easy code review and modification
-   Identification of reusable patterns
-   Natural code organization based on usage
-   Scalable architecture that grows with the application

### Data Fetching Best Practices

**Primary Pattern: Jotai Atoms with TanStack Query**

For data fetching, use `atomWithQuery` from `jotai-tanstack-query`. This combines Jotai's reactive state with TanStack Query's caching and synchronization.

**When to use `atomWithQuery`:**
- Fetching data from APIs
- When query depends on other atoms (e.g., `projectIdAtom`, `appIdAtom`)
- Sharing data across multiple components
- Need caching, loading states, and automatic refetching

**Basic Pattern:**

```typescript
import {atomWithQuery} from "jotai-tanstack-query"

export const dataQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom) // Read dependencies
    
    return {
        queryKey: ["data", projectId], // Include all dependencies
        queryFn: () => fetchData(projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        enabled: !!projectId, // Conditional fetching
    }
})

// Usage in components
const query = useAtomValue(dataQueryAtom)
const data = query.data
const isLoading = query.isPending
```

**For parameterized queries, use `atomFamily`:**

```typescript
export const itemQueryAtomFamily = atomFamily((itemId: string) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)
        return {
            queryKey: ["item", itemId, projectId],
            queryFn: () => fetchItem(itemId),
            enabled: !!itemId && !!projectId,
        }
    })
)

// Usage
const itemQuery = useAtomValue(itemQueryAtomFamily(itemId))
```

**Derived atoms for data transformation:**

```typescript
export const dataAtom = selectAtom(
    dataQueryAtom,
    (res) => res.data ?? [],
    deepEqual
)
```

**Mutations and invalidation:**

```typescript
export const createItemAtom = atom(
    null,
    async (_get, _set, payload) => {
        const res = await createItem(payload)
        await queryClient.invalidateQueries({queryKey: ["items"]})
        return res
    }
)
```

**Key Principles:**
1. Include all reactive dependencies in `queryKey`
2. Use `enabled` for conditional queries
3. Use `selectAtom` for derived data
4. Invalidate queries after mutations
5. Set appropriate `staleTime` for caching

**Examples in codebase:**
- `web/oss/src/state/profile/selectors/user.ts` - Simple query
- `web/oss/src/state/environment/atoms/fetcher.ts` - Multi-dependency query
- `web/oss/src/state/queries/atoms/fetcher.ts` - Atom family with parameters
- `web/oss/src/state/testset/hooks/useTestset.ts` - Hook wrapper pattern

---

### Loadable Bridge Pattern

For managing data sources that provide inputs to runnables (testsets, traces), use the **Loadable Bridge** from `@agenta/entities/loadable`.

**Full documentation:** `web/packages/agenta-entities/src/loadable/README.md`

**What is a Loadable?**

A loadable represents a data source that provides input rows for execution. Loadables can operate in:
- **Local mode**: Manual data entry
- **Connected mode**: Synced with an entity (testset revision, trace)

**Basic Usage:**

```typescript
import { loadableBridge } from '@agenta/entities/loadable'
import { useAtomValue, useSetAtom } from 'jotai'

// Read rows
const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))

// Add a row
const addRow = useSetAtom(loadableBridge.actions.addRow)
addRow(loadableId, { prompt: 'Hello, world!' })

// Connect to a testset
const connect = useSetAtom(loadableBridge.actions.connectToSource)
connect(loadableId, testsetRevisionId, 'MyTestset v1', 'testcase')
```

**Available Selectors:**

| Selector | Returns | Description |
|----------|---------|-------------|
| `rows(loadableId)` | `LoadableRow[]` | All rows in the loadable |
| `columns(loadableId)` | `LoadableColumn[]` | Column definitions |
| `activeRow(loadableId)` | `LoadableRow \| null` | Currently selected row |
| `mode(loadableId)` | `'local' \| 'connected'` | Current mode |
| `isDirty(loadableId)` | `boolean` | Has unsaved changes |
| `connectedSource(loadableId)` | `{id, name}` | Connected source info |

**Available Actions:**

| Action | Parameters | Description |
|--------|------------|-------------|
| `addRow` | `(loadableId, data?)` | Add a new row |
| `updateRow` | `(loadableId, rowId, data)` | Update row data |
| `removeRow` | `(loadableId, rowId)` | Remove a row |
| `setActiveRow` | `(loadableId, rowId)` | Select a row |
| `connectToSource` | `(loadableId, sourceId, sourceName, sourceType)` | Connect to entity |
| `disconnect` | `(loadableId)` | Switch to local mode |

---

### Runnable Bridge Pattern

For managing executable entities (app revisions, evaluators), use the **Runnable Bridge** from `@agenta/entities/runnable`.

**Full documentation:** `web/packages/agenta-entities/src/runnable/README.md`

**Basic Usage:**

```typescript
import { runnableBridge } from '@agenta/entities/runnable'
import { useAtomValue } from 'jotai'

// Get runnable data
const data = useAtomValue(runnableBridge.selectors.data(revisionId))

// Get input/output ports
const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(revisionId))
const outputPorts = useAtomValue(runnableBridge.selectors.outputPorts(revisionId))

// Access evaluator-specific features
const evalController = runnableBridge.runnable('evaluatorRevision')
const presets = useAtomValue(evalController.selectors.presets(evaluatorId))
```

**Available Selectors:**

| Selector | Returns | Description |
| -------- | ------- | ----------- |
| `data(runnableId)` | `RunnableData \| null` | Runnable data |
| `query(runnableId)` | `BridgeQueryState` | Query state with loading/error |
| `isDirty(runnableId)` | `boolean` | Has unsaved changes |
| `inputPorts(runnableId)` | `RunnablePort[]` | Input port definitions |
| `outputPorts(runnableId)` | `RunnablePort[]` | Output port definitions |
| `configuration(runnableId)` | `Record<string, unknown> \| null` | Configuration object |

---

### Entity Selection System

For hierarchical entity selection (App → Variant → Revision), use components from `@agenta/entities/ui`.

**Full documentation:** `web/packages/agenta-entities/src/ui/selection/README.md`

**Using EntityPicker:**

```typescript
import { EntityPicker, type AppRevisionSelectionResult } from '@agenta/entities/ui'

function MyComponent() {
  const handleSelect = (selection: AppRevisionSelectionResult) => {
    console.log('Selected:', selection.metadata.appName, selection.metadata.variantName)
  }

  return (
    <EntityPicker<AppRevisionSelectionResult>
      adapter="appRevision"
      onSelect={handleSelect}
      showSearch
      showBreadcrumb
      rootLabel="All Apps"
    />
  )
}
```

**Using EntityCascader:**

```typescript
import { EntityCascader, type TestsetSelectionResult } from '@agenta/entities/ui'

function TestsetSelector() {
  const [value, setValue] = useState<string[]>([])

  return (
    <EntityCascader<TestsetSelectionResult>
      adapter="testset"
      value={value}
      onChange={(path, selection) => {
        setValue(path)
        console.log('Selected revision:', selection?.metadata.revisionId)
      }}
      placeholder="Select testset and revision"
      showSearch
      allowClear
    />
  )
}
```

**Pre-built Adapters:**

| Adapter | Hierarchy | Selection Result |
|---------|-----------|------------------|
| `appRevisionAdapter` | App → Variant → Revision | `AppRevisionSelectionResult` |
| `evaluatorRevisionAdapter` | Evaluator → Variant → Revision | `EvaluatorRevisionSelectionResult` |
| `testsetAdapter` | Testset → Revision | `TestsetSelectionResult` |

---

### Molecule Pattern (Entity State Management)

For entities requiring CRUD operations with draft state, loading indicators, and cache management, use the **Molecule Pattern** from `@agenta/entities`.

**Full documentation:** `web/packages/agenta-entities/src/shared/README.md`

**What is a Molecule?**

A molecule provides a unified API for entity state management:

```typescript
molecule.atoms.*        // Atom families for reactive subscriptions
molecule.reducers.*     // Write operations
molecule.get.*          // Imperative reads (snapshot from store)
molecule.set.*          // Imperative writes
molecule.useController  // React hook combining atoms + dispatch
molecule.cleanup.*      // Memory management
```

**Quick Decision - Where to use which API:**

```
Where are you using it?
         │
    ┌────┼────┐
    │    │    │
 React  Atom  Callback
    │    │    │
    ▼    ▼    ▼
useAtom  get(mol.   mol.get.*
         atoms.*)   mol.set.*
```

**Basic Usage:**

```typescript
import { testcaseMolecule } from '@agenta/entities/testcase'

// React hook - returns [state, dispatch]
function TestcaseEditor({ id }: { id: string }) {
  const [state, dispatch] = testcaseMolecule.useController(id)

  if (state.isPending) return <Skeleton />
  if (!state.data) return <NotFound />

  return (
    <Input
      value={state.data.input}
      onChange={(e) => dispatch.update({ input: e.target.value })}
    />
  )
}

// Fine-grained subscriptions - only re-renders when isDirty changes
function DirtyIndicator({ id }: { id: string }) {
  const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
  return isDirty ? <Badge>Modified</Badge> : null
}
```

**Imperative API (for callbacks):**

```typescript
async function handleSave(id: string) {
  const data = testcaseMolecule.get.data(id)
  if (!data || !testcaseMolecule.get.isDirty(id)) return

  await api.save(data)
  testcaseMolecule.set.discard(id)
}
```

**Available Atoms:**

| Atom | Type | Description |
|------|------|-------------|
| `data` | `T \| null` | Entity with draft merged |
| `serverData` | `T \| null` | Raw server data |
| `draft` | `TDraft \| null` | Local changes only |
| `query` | `QueryState<T>` | Query state (isPending, isError) |
| `isDirty` | `boolean` | Has unsaved local changes |
| `isNew` | `boolean` | Entity not yet on server |

**Available Molecules:**

| Entity | Import | Description |
|--------|--------|-------------|
| Testcase | `testcaseMolecule` from `@agenta/entities/testcase` | Testcase with cell subscriptions |
| Trace Span | `traceSpanMolecule` from `@agenta/entities/trace` | Trace span with attribute drill-in |
| Testset | `testsetMolecule` from `@agenta/entities/testset` | Testset with list/detail queries |
| Revision | `revisionMolecule` from `@agenta/entities/testset` | Revision with column management |

**Data Flow Architecture:**

```
Server → TanStack Query → atoms.serverData
                              ↓
                         atoms.draft (local changes)
                              ↓
                         atoms.data (merged)
                              ↓
                         useController → Component
```

**Anti-Patterns to Avoid:**

```typescript
// BAD - atoms require React context
async function handleSave(id: string) {
  const data = useAtomValue(molecule.atoms.data(id)) // Won't work!
}

// GOOD - use imperative API
async function handleSave(id: string) {
  const data = molecule.get.data(id)
}
```

```typescript
// BAD - new atom every render
const derived = atom((get) => get(molecule.atoms.data(id)))

// GOOD - memoize the atom
const derived = useMemo(
  () => atom((get) => get(molecule.atoms.data(id))),
  [id]
)
```

---

**Legacy: SWR Pattern (avoid for new code)**

We previously used SWR with Axios for data fetching. This pattern is still present in older code but should not be used for new features.

#### ❌ Avoid: useEffect for Data Fetching

Don't use `useEffect` with manual state management for data fetching:

```javascript
// DON'T DO THIS
useEffect(() => {
    fetchData().then(setData).catch(setError)
}, [])
```

Use `atomWithQuery` instead (see above).

### Styling Best Practices

#### Use Tailwind CSS (Preferred)

**Always prefer Tailwind utility classes over CSS-in-JS or separate CSS files** for styling whenever possible.

✅ **Preferred: Tailwind classes**
```typescript
// Good - Uses Tailwind utilities
<main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
    <Card className="max-w-[520px] w-[90%] text-center">
        <Typography.Title level={3} className="!mb-2">
            Unable to establish connection
        </Typography.Title>
    </Card>
</main>
```

❌ **Avoid: CSS-in-JS (react-jss, styled-components)**
```typescript
// Avoid - Creates extra overhead and complexity
const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: {
        "& .ant-collapse-header": {
            backgroundColor: `#FAFAFB !important`,
        },
    },
}))

function Component() {
    const classes = useStyles()
    return <div className={classes.collapseContainer}>...</div>
}
```

❌ **Avoid: Inline styles**
```typescript
// Avoid - Not themeable, harder to maintain
<div style={{maxWidth: "520px", width: "90%", textAlign: "center"}}>
```

**When CSS-in-JS is acceptable:**
- Complex Ant Design component overrides that can't be done with Tailwind
- Dynamic theme-dependent styles that require JS calculations
- Legacy components (refactor to Tailwind when touching the code)

**Tailwind benefits:**
- No style bloat or unused CSS
- Consistent design system
- Better performance (no runtime style injection)
- Easier to read and maintain
- Works seamlessly with Ant Design

**Examples in codebase:**
- `web/oss/src/components/CustomWorkflowBanner/index.tsx` - Good Tailwind usage
- `web/oss/src/components/ChatInputs/ChatInputs.tsx` - Mixed (being migrated)

---

### React Best Practices

#### Component Reusability

**Before implementing similar functionality in multiple places, consider reusability:**

When you notice patterns that could be extracted:
1. **Don't immediately refactor** - Jumping straight to abstraction can over-engineer
2. **Ask the developer** with context about the potential for reuse
3. **Provide analysis**: Show where similar code exists and potential benefits/costs of refactoring

**Example prompt when detecting reusability:**
```
I notice this table cell rendering logic is similar to:
- components/EvalRunDetails2/TableCells/MetricCell.tsx
- components/Evaluators/cells/MetricDisplayCell.tsx

Before implementing, would you like me to:
A) Create a reusable component (requires refactoring both existing usages)
B) Proceed with current implementation (can consolidate later if pattern repeats)

The trade-off: (A) takes more time now but improves maintainability; (B) is faster but may create tech debt.
```

**When to extract components:**
- Used in 3+ places with similar logic
- Complex logic that benefits from isolation
- Clear, stable interface that won't change often

**When NOT to extract:**
- Only used twice (wait for third usage to confirm pattern)
- Requirements are still evolving
- Small, simple components (< 20 lines)

---

#### Performance Considerations

**Critical for evaluations and observability features** - these handle large datasets:

1. **Minimize Re-renders**
   - Use `useMemo` for expensive computations
   - Use `React.memo` for components that receive stable props
   - Avoid inline functions/objects in render (especially in lists)

```typescript
// ❌ Bad - Creates new function every render
{items.map(item => <Row key={item.id} onClick={() => handleClick(item)} />)}

// ✅ Good - Stable callback
const handleRowClick = useCallback((item) => handleClick(item), [])
{items.map(item => <Row key={item.id} onClick={handleRowClick} item={item} />)}
```

2. **Optimize Query Updates**
   - Be mindful of `queryKey` dependencies - don't include frequently changing values unnecessarily
   - Use `select` option in queries to extract only needed data
   - Consider `staleTime` for data that doesn't change often

```typescript
// ❌ Bad - Refetches on every UI update
atomWithQuery((get) => ({
    queryKey: ["data", get(currentTimeAtom)], // currentTimeAtom updates every second!
    queryFn: fetchData
}))

// ✅ Good - Only refetches when meaningful dependencies change
atomWithQuery((get) => ({
    queryKey: ["data", get(projectIdAtom), get(filterAtom)],
    queryFn: fetchData,
    staleTime: 60_000 // Cache for 1 minute
}))
```

3. **Virtualization for Large Lists**
   - Use virtual scrolling for lists with 100+ items
   - Reference: `InfiniteVirtualTable` component

4. **Debounce/Throttle User Input**
   - Debounce search inputs, filters
   - Throttle scroll handlers, resize handlers

---

#### Modular Component Design

**Keep components focused and decoupled:**

✅ **Good: Component owns its internal concerns**
```typescript
// Component only needs IDs, fetches its own data
function UserCard({userId}: {userId: string}) {
    const user = useAtomValue(userQueryAtomFamily(userId))
    return <Card>{user.name}</Card>
}

// Parent doesn't need to know about user data structure
function UserList({userIds}: {userIds: string[]}) {
    return userIds.map(id => <UserCard key={id} userId={id} />)
}
```

❌ **Bad: Parent must know too much**
```typescript
// Parent must fetch and pass everything
function UserCard({
    userName,
    userEmail,
    userAvatar,
    userRole,
    userDepartment
}: {/* many props */}) {
    return <Card>...</Card>
}

// Parent is tightly coupled to UserCard's needs
function UserList({userIds}: {userIds: string[]}) {
    const users = useAtomValue(usersQueryAtom) // Must fetch all data
    return users.map(user => (
        <UserCard
            key={user.id}
            userName={user.name}
            userEmail={user.email}
            userAvatar={user.avatar}
            userRole={user.role}
            userDepartment={user.department}
        />
    ))
}
```

**Principles:**
- **High cohesion**: Component contains related logic together
- **Low coupling**: Minimal dependencies on parent/sibling components
- **Props should be minimal**: Pass IDs/keys, not entire data structures when possible
- **Components fetch their own data**: Use atoms with queries for data needs
- **Single Responsibility**: Each component does one thing well

**Benefits:**
- Easier to test in isolation
- Can reuse without bringing unnecessary dependencies
- Changes to one component don't cascade to others
- Clear interfaces and responsibilities

---

#### Avoiding Inline Array Props

Passing inline arrays of objects with heavy content such as JSX is considered a bad practice in React. This is because it can lead to unnecessary re-renders and performance issues. When you pass an inline array, a new array is created every time the component renders, causing React to think that the prop has changed even if the content is the same.

For example, in the `AccordionTreePanel` component, the `items` prop is passed an inline array of objects with JSX content:

❌ **Avoid this pattern:**

```javascript
<AccordionTreePanel
  items={[
    {
      title: "Item 1",
      content: <div>Content 1</div>,
    },
    {
      title: "Item 2",
      content: <div>Content 2</div>,
    },
  ]}
/>
```

✅ **Use this pattern:**

```javascript
import {useMemo} from "react"

const items = useMemo(
    () => [
        {
            title: "Item 1",
            content: <div>Content 1</div>,
        },
        {
            title: "Item 2",
            content: <div>Content 2</div>,
        },
    ],
    [],
)

<AccordionTreePanel items={items} />
```

---

### Shared Components and Package Architecture

The monorepo uses workspace packages to share components, utilities, and logic across OSS and EE. Understanding which package to use and how to properly compose components is important for maintainability.

**Key Documentation:**

| Package | README Location |
|---------|-----------------|
| `@agenta/ui` | `web/packages/agenta-ui/README.md` |
| `@agenta/entities` | `web/packages/agenta-entities/README.md` |
| `@agenta/shared` | `web/packages/agenta-shared/README.md` |
| `@agenta/playground` | `web/packages/agenta-playground/` |

#### Package Overview

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| `@agenta/shared` | Pure utilities (no React) | Path utilities, common types |
| `@agenta/ui` | Reusable React components | `EnhancedModal`, `InfiniteVirtualTable`, `cn`, `textColors`, presentational components |
| `@agenta/entities` | Entity state/hooks/controllers | Molecules, bridges, UI components (modals, pickers) |
| `@agenta/playground` | Playground-specific components | `PlaygroundContent`, `EntitySelector`, `InputMappingModal` |

#### @agenta/entities Subpath Exports

```typescript
import { ... } from '@agenta/entities'           // Core utilities
import { ... } from '@agenta/entities/shared'    // Molecule factories, transforms
import { ... } from '@agenta/entities/trace'     // Trace/span molecule, schemas
import { ... } from '@agenta/entities/testset'   // Testset/revision molecules
import { ... } from '@agenta/entities/testcase'  // Testcase molecule
import { ... } from '@agenta/entities/loadable'  // Loadable bridge
import { ... } from '@agenta/entities/runnable'  // Runnable bridge
import { ... } from '@agenta/entities/ui'        // UI components (modals, pickers)
```

#### EnhancedModal (Required for All New Modals)

**All new modals MUST use `EnhancedModal` from `@agenta/ui`** instead of raw `antd Modal`:

```typescript
import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"

function MyModal({open, onClose}: {open: boolean; onClose: () => void}) {
    return (
        <EnhancedModal
            open={open}
            onCancel={onClose}
            title="Modal Title"
            footer={null}
        >
            <ModalContent>
                {/* Main content */}
            </ModalContent>
            <ModalFooter>
                <Button onClick={onClose}>Cancel</Button>
                <Button type="primary">Confirm</Button>
            </ModalFooter>
        </EnhancedModal>
    )
}
```

**Why EnhancedModal:**

- Consistent styling across the application
- Proper scroll handling with `ModalContent`
- Standardized footer layout with `ModalFooter`
- Theme integration

#### Style Utilities

Use utilities from `@agenta/ui` for consistent styling:

```typescript
import {cn, textColors, bgColors} from "@agenta/ui"

// cn - Combines class names with conditional support
<div className={cn("base-class", isActive && "active-class")} />

// textColors - Theme-aware text colors
<span className={textColors.secondary}>Secondary text</span>

// bgColors - Theme-aware background colors
<div className={bgColors.hover}>Hoverable area</div>
```

#### Presentational Components

Use section layout primitives from `@agenta/ui`:

```typescript
import {
  SectionCard,
  SectionLabel,
  SectionHeaderRow,
  ConfigBlock,
  VersionBadge,
  RevisionLabel,
  StatusTag,
  PanelHeader,
  SourceIndicator,
} from "@agenta/ui"

// Section card with header
<SectionCard>
  <SectionHeaderRow
    left={<SectionLabel>Configuration</SectionLabel>}
    right={<Button>Edit</Button>}
  />
  <ConfigBlock title="Settings">
    <Input />
  </ConfigBlock>
</SectionCard>
```

#### Package Selection Guide

```text
Need a modal?
└─ Use: EnhancedModal from @agenta/ui

Need class name utilities or theme colors?
└─ Use: cn, textColors, bgColors from @agenta/ui

Need section layout primitives?
└─ Use: SectionCard, SectionLabel, ConfigBlock from @agenta/ui

Need entity state management (molecules)?
└─ Use: *Molecule from @agenta/entities/{entity}

Need entity selection UI?
└─ Use: EntityPicker, EntityCascader from @agenta/entities/ui

Need loadable/runnable bridges?
└─ Use: loadableBridge, runnableBridge from @agenta/entities/{type}

Building playground features?
└─ Use: Components from @agenta/playground
```
