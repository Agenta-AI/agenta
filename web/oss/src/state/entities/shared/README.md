# Shared Entity Patterns

This directory contains reusable patterns for entity state management across different entity types (testsets, testcases, traces, etc.).

## Quick Reference

### Decision Tree: Which API to Use?

```
┌─────────────────────────────────────────────────────────────────┐
│                    Need entity data?                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Need loading/error states?   │
              └───────────────────────────────┘
                     │              │
                    YES            NO
                     │              │
                     ▼              ▼
         ┌─────────────────┐  ┌─────────────────────────┐
         │ Need actions?   │  │ Table cell with         │
         └─────────────────┘  │ fine-grained updates?   │
              │       │       └─────────────────────────┘
             YES     NO              │        │
              │       │             YES      NO
              ▼       ▼              │        │
   ┌──────────────┐ ┌────────────┐  ▼        ▼
   │ controller() │ │ selectors. │ ┌────────┐ ┌────────────┐
   │              │ │ query()    │ │cell()  │ │selectors.  │
   └──────────────┘ └────────────┘ └────────┘ │data()      │
                                              └────────────┘
```

### API Quick Reference Table

| Need | API | Returns | Re-renders on |
|------|-----|---------|---------------|
| Full state + actions | `controller(id)` | `[state, dispatch]` | Any state change |
| Data only | `selectors.data(id)` | `T \| null` | Data change |
| Loading/error | `selectors.query(id)` | `QueryState<T>` | Query state change |
| Dirty indicator | `selectors.isDirty(id)` | `boolean` | Dirty change |
| Single cell | `selectors.cell({id,col})` | `unknown` | Cell value change |
| Dispatch in atoms | `actions.update/discard` | Write atom | N/A |

---

## Core Concept: Entity Controllers

The **Entity Controller** pattern provides a unified API for working with entities, abstracting away the complexity of multiple atoms (query, draft, dirty state, etc.) into a single cohesive interface.

### Problem

Without controllers, consumers need to import and understand multiple atoms:

```typescript
// OLD WAY - Multiple imports, manual orchestration
import {
  testcaseEntityAtomFamily,
  testcaseQueryAtomFamily,
  testcaseDraftAtomFamily,
  testcaseIsDirtyAtomFamily,
  updateTestcaseAtom,
  discardDraftAtom,
} from "@/state/entities/testcase"

function TestcaseEditor({id}) {
  const entity = useAtomValue(testcaseEntityAtomFamily(id))
  const queryState = useAtomValue(testcaseQueryAtomFamily(id))
  const isDirty = useAtomValue(testcaseIsDirtyAtomFamily(id))
  const update = useSetAtom(updateTestcaseAtom)
  const discard = useSetAtom(discardDraftAtom)
  // ...lots of wiring
}
```

### Solution

Single controller that provides everything:

```typescript
// NEW WAY - Single import, unified API
import {testcase} from "@/state/entities/testcase"

function TestcaseEditor({id}) {
  const [state, dispatch] = useAtom(testcase.controller(id))

  // state.data - entity with draft merged
  // state.serverData - raw server data (from query)
  // state.isPending / state.isError - loading states
  // state.isDirty - has unsaved changes
  // state.isNew - not yet on server

  dispatch({type: "update", changes: {name: "new name"}})
  dispatch({type: "discard"})
}
```

---

## Data Flow Architecture

### Entity Data Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ENTITY DATA FLOW                                   │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
    │   SERVER     │────────▶│  TanStack    │────────▶│   Query      │
    │   (API)      │         │  Query Cache │         │   Atom       │
    └──────────────┘         └──────────────┘         └──────────────┘
                                                              │
                                                              │ Server Data
                                                              ▼
                                                     ┌──────────────────┐
                                                     │                  │
    ┌──────────────┐                                 │   Entity Atom    │
    │   Draft      │────────────────────────────────▶│   (Merged)       │
    │   Atom       │         Local Changes           │                  │
    └──────────────┘                                 └──────────────────┘
          ▲                                                   │
          │                                                   │
          │ dispatch({type: "update"})                        │
          │                                                   ▼
    ┌──────────────┐                                 ┌──────────────────┐
    │  Component   │◀────────────────────────────────│   Controller     │
    │  (UI)        │         state.data              │   Atom           │
    └──────────────┘                                 └──────────────────┘
```

### Controller State Composition

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTROLLER STATE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Query Atom                                    │   │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │   │
│   │  │isPending │  │ isError  │  │  error   │  │   data   │◀─── Server │   │
│   │  │ boolean  │  │ boolean  │  │Error|null│  │  T|null  │     Data   │   │
│   │  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                        │                     │
│   ┌────────────────────────────────────┐               │                     │
│   │           Draft Atom               │               │                     │
│   │  ┌─────────────────────────────┐   │               │                     │
│   │  │  Local Changes (Partial<T>) │   │               │                     │
│   │  └─────────────────────────────┘   │               │                     │
│   └────────────────────────────────────┘               │                     │
│                        │                               │                     │
│                        └───────────┬───────────────────┘                     │
│                                    │                                         │
│                                    ▼ MERGE                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     Controller State Output                          │   │
│   │                                                                      │   │
│   │  state.data       = draft ? {...serverData, ...draft} : serverData  │   │
│   │  state.serverData = queryAtom.data                                   │   │
│   │  state.isPending  = queryAtom.isPending                              │   │
│   │  state.isError    = queryAtom.isError                                │   │
│   │  state.error      = queryAtom.error                                  │   │
│   │  state.isDirty    = draft !== null && draft !== serverData          │   │
│   │  state.isNew      = isNewEntity(id)                                  │   │
│   │                                                                      │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Action Dispatch Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ACTION DISPATCH FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

   Component                  Controller                    Atoms
       │                          │                           │
       │  dispatch({type: "update", changes})                 │
       │─────────────────────────▶│                           │
       │                          │                           │
       │                          │  set(draftAtom, merge)    │
       │                          │──────────────────────────▶│
       │                          │                           │
       │                          │◀──────────────────────────│
       │                          │  draft updated            │
       │                          │                           │
       │                          │  derived: isDirty = true  │
       │                          │──────────────────────────▶│
       │                          │                           │
       │◀─────────────────────────│                           │
       │  re-render with new state│                           │
       │                          │                           │

   ─────────────────────────────────────────────────────────────────────────

   Component                  Controller                    Atoms
       │                          │                           │
       │  dispatch({type: "discard"})                         │
       │─────────────────────────▶│                           │
       │                          │                           │
       │                          │  set(draftAtom, null)     │
       │                          │──────────────────────────▶│
       │                          │                           │
       │                          │  derived: isDirty = false │
       │                          │──────────────────────────▶│
       │                          │                           │
       │◀─────────────────────────│                           │
       │  re-render (data = serverData)                       │
       │                          │                           │
```

### Cache Redirect Flow (Testcase)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CACHE REDIRECT OPTIMIZATION                             │
└─────────────────────────────────────────────────────────────────────────────┘

   Component requests testcase by ID
              │
              ▼
   ┌──────────────────────────────────┐
   │  Check TanStack Query cache      │
   │  for paginated store pages       │
   │  key: ["testcase-paginated",     │
   │        "testcases-{revisionId}"] │
   └──────────────────────────────────┘
              │
              ├──── Found in cache ────▶ Return cached data (no fetch)
              │
              ▼
   ┌──────────────────────────────────┐
   │  Not in cache - use batch fetcher│
   │  Combines requests in 16ms window│
   └──────────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────────┐
   │  Single API call:                │
   │  POST /testcases/query           │
   │  { testcase_ids: [id1, id2, ...]}│
   └──────────────────────────────────┘
              │
              ▼
   ┌──────────────────────────────────┐
   │  Cache results and return        │
   └──────────────────────────────────┘
```

---

## Complete API Reference

### createEntityController

Factory function that creates a unified entity API.

#### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | `string` | Yes | Entity name for debugging |
| `dataAtomFamily` | `(id) => Atom<T \| null>` | Yes | Atom family for merged entity data |
| `queryAtomFamily` | `(id) => QueryAtom<T>` | Yes | Query atom - **single source of truth** |
| `isDirtyAtomFamily` | `(id) => Atom<boolean>` | Yes | Atom family for dirty state |
| `updateAtom` | `WritableAtom` | Yes | Write atom for updating entity draft |
| `discardAtom` | `WritableAtom` | Yes | Write atom for discarding changes |
| `isNewEntity` | `(id) => boolean` | No | Function to detect unsaved entities |
| `drillIn` | `DrillInConfig` | No | Config for path-based navigation |

#### Returned EntityAPI Object

```typescript
interface EntityAPI<T> {
  // Full controller atom - use with useAtom for state + dispatch
  controller: (id: string) => WritableAtom<EntityControllerState<T>, EntityAction<T>>

  // Fine-grained selectors - use with useAtomValue
  selectors: {
    data: (id: string) => Atom<T | null>
    isDirty: (id: string) => Atom<boolean>
    query: (id: string) => Atom<QueryState<T>>
    // Entity-specific selectors may be added (e.g., cell for testcase)
  }

  // Write atoms - use with useSetAtom or set() in atoms
  actions: {
    update: WritableAtom<null, [id: string, changes: Partial<T>], void>
    discard: WritableAtom<null, [id: string], void>
    // Entity-specific actions may be added
  }

  // Optional: Path-based navigation (if drillIn configured)
  drillIn?: DrillInAPI
}
```

#### Controller State Shape

| Property | Type | Description |
|----------|------|-------------|
| `data` | `T \| null` | Entity with draft merged (what UI should display) |
| `serverData` | `T \| null` | Raw server data (for comparison) |
| `isPending` | `boolean` | True while initial fetch in progress |
| `isError` | `boolean` | True if fetch failed |
| `error` | `Error \| null` | Error object if fetch failed |
| `isDirty` | `boolean` | True if has unsaved local changes |
| `isNew` | `boolean` | True if entity not yet on server |

#### Controller Actions

| Action | Payload | Description |
|--------|---------|-------------|
| `{type: "update", changes}` | `Partial<T>` | Merge changes into draft |
| `{type: "discard"}` | none | Clear draft, revert to server data |
| `{type: "setAtPath", path, value}` | `{path: string[], value: unknown}` | Set nested value (if drillIn) |

---

## Available Controllers

### Testcase Controller

```typescript
import {testcase} from "@/state/entities/testcase"
```

#### Selectors

| Selector | Returns | Description |
|----------|---------|-------------|
| `testcase.selectors.data(id)` | `FlattenedTestcase \| null` | Entity with draft merged |
| `testcase.selectors.query(id)` | `QueryState<FlattenedTestcase>` | Query with loading/error |
| `testcase.selectors.isDirty(id)` | `boolean` | Has unsaved changes |
| `testcase.selectors.cell({id, column})` | `unknown` | Single cell value (fine-grained) |

#### Actions

| Action | Signature | Description |
|--------|-----------|-------------|
| `testcase.actions.update` | `(id, changes)` | Update entity fields |
| `testcase.actions.discard` | `(id)` | Discard local changes |
| `testcase.actions.add` | `()` | Create new testcase with empty columns |
| `testcase.actions.create` | `(rows, options?)` | Batch create testcases |
| `testcase.actions.append` | `(rows)` | Append testcases (deprecated) |
| `testcase.actions.delete` | `(ids[])` | Delete testcases |

#### DrillIn API

| Method | Signature | Description |
|--------|-----------|-------------|
| `getValueAtPath` | `(entity, path[])` | Get nested value |
| `setValueAtPathAtom` | Write atom | Set nested value |
| `getRootItems` | `(entity, columns)` | Get root navigation items |

---

### Trace Span Controller

```typescript
import {traceSpan} from "@/state/entities/trace"
```

#### Selectors

| Selector | Returns | Description |
|----------|---------|-------------|
| `traceSpan.selectors.data(id)` | `TraceSpan \| null` | Entity with draft |
| `traceSpan.selectors.query(id)` | `QueryState<TraceSpan>` | Query state |
| `traceSpan.selectors.isDirty(id)` | `boolean` | Has unsaved changes |

#### Actions

| Action | Signature | Description |
|--------|-----------|-------------|
| `traceSpan.actions.update` | `(id, changes)` | Update span fields |
| `traceSpan.actions.discard` | `(id)` | Discard local changes |

---

### Revision Controller

```typescript
import {revision} from "@/state/entities/testset"
```

#### Selectors

| Selector | Returns | Description |
|----------|---------|-------------|
| `revision.selectors.data(id)` | `Revision \| null` | Revision data |
| `revision.selectors.columns(id)` | `string[]` | Column names |
| `revision.selectors.expandedColumns(id)` | `string[]` | Expanded column names |
| `revision.selectors.isDirty(id)` | `boolean` | Has column changes |
| `revision.selectors.changesSummary(id)` | `ChangesSummary` | Summary of changes |

#### Actions

| Action | Signature | Description |
|--------|-----------|-------------|
| `revision.actions.addColumn` | `(name)` | Add new column |
| `revision.actions.deleteColumn` | `(name)` | Delete column |
| `revision.actions.renameColumn` | `({old, new, rowDataMap})` | Rename column |
| `revision.actions.updateColumns` | `(revisionId, columns)` | Set all columns |

#### Queries

| Query | Returns | Description |
|-------|---------|-------------|
| `revision.queries.list(testsetId)` | `QueryState<Revision[]>` | Revisions list |
| `revision.queries.enableList` | Write atom | Enable lazy list query |

---

### Testset Controller

```typescript
import {testset} from "@/state/entities/testset"
```

#### Selectors

| Selector | Returns | Description |
|----------|---------|-------------|
| `testset.selectors.data(id)` | `Testset \| null` | Testset data |

#### Actions

| Action | Signature | Description |
|--------|-----------|-------------|
| `testset.actions.update` | `(id, changes)` | Update testset |
| `testset.actions.updateMetadata` | `(id, metadata)` | Update name/description |
| `testset.actions.discard` | `(id)` | Discard changes |

#### Queries

| Query | Returns | Description |
|-------|---------|-------------|
| `testset.queries.list(searchQuery?)` | `QueryState<Testset[]>` | Testsets list |
| `testset.queries.detail(id)` | `QueryState<Testset>` | Single testset |

#### Paginated Store

| API | Returns | Description |
|-----|---------|-------------|
| `testset.paginated.controller(params)` | `[state, dispatch]` | Full controller |
| `testset.paginated.selectors.rows(params)` | `TRow[]` | Row data |
| `testset.paginated.selectors.pagination(params)` | `PaginationState` | Pagination info |
| `testset.paginated.selectors.selection(params)` | `Key[]` | Selected keys |
| `testset.paginated.actions.refresh` | Write atom | Trigger refresh |

---

## Patterns

### createEntityController

Factory function that creates a unified entity API.

**Config options:**

| Option | Description |
|--------|-------------|
| `name` | Entity name for debugging |
| `dataAtomFamily` | Atom family for merged entity data (server + draft) |
| `queryAtomFamily` | Query atom family - **single source of truth for server data** |
| `isDirtyAtomFamily` | Atom family that returns true if entity has local changes |
| `updateAtom` | Write atom for updating entity draft |
| `discardAtom` | Write atom for discarding local changes |
| `isNewEntity` | Optional function to detect new (unsaved) entities |
| `drillIn` | Optional config for path-based navigation and editing |

### createEntityDraftState

Creates draft state management for entities with save/revert capabilities.

**Features:**

- Separate draft state from original entity
- Dirty state detection via query atom comparison
- Save/revert operations
- Type-safe updates

Example usage in testset revision entities for handling unsaved changes to revision metadata (name, description).

---

## Usage Examples

### Example 1: Full Controller in Components

```typescript
import {testcase} from "@/oss/state/entities/testcase"

const TestcaseEditor = ({testcaseId}: {testcaseId: string}) => {
  const [state, dispatch] = useAtom(testcase.controller(testcaseId))

  // Handle loading/error states
  if (state.isPending) return <Skeleton />
  if (state.isError) return <Error error={state.error} />
  if (!state.data) return <NotFound />

  return (
    <div>
      <Input
        value={state.data.input}
        onChange={(e) => dispatch({
          type: "update",
          changes: {input: e.target.value}
        })}
      />
      {state.isDirty && (
        <Button onClick={() => dispatch({type: "discard"})}>
          Discard Changes
        </Button>
      )}
      {state.isNew && <Badge>New</Badge>}
    </div>
  )
}
```

### Example 2: Fine-grained Subscriptions with Selectors

```typescript
import {testcase} from "@/oss/state/entities/testcase"

// Subscribe only to data changes (no re-render on isDirty change)
const TestcaseDisplay = ({testcaseId}: {testcaseId: string}) => {
  const data = useAtomValue(testcase.selectors.data(testcaseId))
  if (!data) return null
  return <div>{data.input}</div>
}

// Subscribe only to dirty state
const DirtyIndicator = ({testcaseId}: {testcaseId: string}) => {
  const isDirty = useAtomValue(testcase.selectors.isDirty(testcaseId))
  return isDirty ? <Badge>Unsaved</Badge> : null
}
```

### Example 3: Accessing Query State for Loading/Error

```typescript
import {testcase} from "@/oss/state/entities/testcase"

const TestcaseModal = ({testcaseId}: {testcaseId: string}) => {
  // Access query state for loading/error handling
  const queryState = useAtomValue(testcase.selectors.query(testcaseId))

  if (queryState.isPending) return <Skeleton />
  if (queryState.isError) return <Error error={queryState.error} />
  if (!queryState.data) return <NotFound />

  return <TestcaseView testcase={queryState.data} />
}
```

### Example 4: Using Actions in Other Atoms

```typescript
import {testcase} from "@/oss/state/entities/testcase"

// Use actions when dispatching from derived atoms
const batchResetAtom = atom(null, (get, set, ids: string[]) => {
  for (const id of ids) {
    set(testcase.actions.discard, id)
  }
})

// Or for custom update logic
const updateAndLogAtom = atom(null, (get, set, {id, changes}) => {
  console.log("Updating", id, changes)
  set(testcase.actions.update, id, changes)
})
```

### Example 5: Drill-in for Nested Data

```typescript
import {traceSpan} from "@/oss/state/entities/trace"

const NestedValueEditor = ({spanId, path}: {spanId: string; path: string[]}) => {
  const data = useAtomValue(traceSpan.selectors.data(spanId))
  const setValueAtPath = useSetAtom(traceSpan.drillIn!.setValueAtPathAtom)

  // Get nested value using drill-in helper
  const value = traceSpan.drillIn!.getValueAtPath(data, path)

  return (
    <Input
      value={JSON.stringify(value)}
      onChange={(e) => setValueAtPath({
        id: spanId,
        path,
        value: JSON.parse(e.target.value)
      })}
    />
  )
}
```

### Example 6: Derived Atom Reading Multiple Entities

```typescript
import {atom, useAtomValue} from "jotai"
import {useMemo} from "react"
import {testcase} from "@/oss/state/entities/testcase"

// Create a derived atom that subscribes to multiple entities
const useMultipleTestcases = (ids: string[]) => {
  const dataAtom = useMemo(
    () => atom((get) => {
      return ids.map(id => get(testcase.selectors.data(id))).filter(Boolean)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids.join(",")]
  )
  return useAtomValue(dataAtom)
}

// Usage
const TestcaseSummary = ({selectedIds}: {selectedIds: string[]}) => {
  const testcases = useMultipleTestcases(selectedIds)
  return <div>Selected: {testcases.length} testcases</div>
}
```

---

## When to Use Each

| Use Case | API | Why |
|----------|-----|-----|
| Forms/editors | `controller(id)` | Need both state and actions |
| Display components | `selectors.data(id)` | Only need data, avoid extra subscriptions |
| Dirty indicators | `selectors.isDirty(id)` | Only need dirty state |
| Loading spinners | `selectors.query(id)` | Need isPending/isError |
| Derived atoms | `actions.update/discard` | Dispatch from set() |
| Table cells | Entity-specific (e.g., `testcase.selectors.cell`) | Fine-grained reactivity |
| Multiple entities | Derived atom with `useMemo` | Proper subscription management |

---

## Extended Controller Pattern (List Queries)

Some entities have extended APIs beyond the basic controller pattern. These include list query support and cache invalidation helpers.

### Testset Controller

```typescript
import {testset} from "@/state/entities/testset"

// List query - fetch all testsets
const testsetsQuery = useAtomValue(testset.queries.list(searchQuery)) // searchQuery or null
const testsets = testsetsQuery.data?.testsets ?? []
const isLoading = testsetsQuery.isPending

// Detail query - fetch single testset
const testsetQuery = useAtomValue(testset.queries.detail(testsetId))

// Entity selector (from cache)
const testsetData = useAtomValue(testset.selectors.data(testsetId))

// Cache invalidation (after mutations)
testset.invalidate.list()
testset.invalidate.detail(testsetId)
```

### Revision Controller

```typescript
import {revision} from "@/state/entities/testset"

// Full controller (state + dispatch with column actions)
const [rev, dispatch] = useAtom(revision.controller(revisionId))
dispatch({type: "addColumn", name: "newColumn"})
dispatch({type: "renameColumn", oldName: "old", newName: "new"})
dispatch({type: "deleteColumn", name: "columnToDelete"})

// List query - fetch revisions for a testset
const revisionsQuery = useAtomValue(revision.queries.list(testsetId))
const revisions = revisionsQuery.data?.testset_revisions ?? []

// Enable lazy list query
const enableList = useSetAtom(revision.queries.enableList)
enableList(testsetId)

// Selectors
const columns = useAtomValue(revision.selectors.columns(revisionId))
const isDirty = useAtomValue(revision.selectors.isDirty(revisionId))
const changesSummary = useAtomValue(revision.selectors.changesSummary(revisionId))

// Actions (for use in other atoms)
set(revision.actions.addColumn, "newColumn")
set(revision.actions.renameColumn, {oldName: "old", newName: "new"})
set(revision.actions.deleteColumn, "columnName")

// Cache invalidation
revision.invalidate.list(testsetId)
```

### Extended API Structure

Entities with list support follow this structure:

```typescript
interface ExtendedEntityAPI<T> extends EntityAPI<T> {
  // Queries for fetching data
  queries: {
    list: (param) => Atom<QueryState<ListResponse>>  // List query
    detail: (id) => Atom<QueryState<T>>              // Detail query
    enableList?: WritableAtom                         // Enable lazy list (optional)
  }

  // Cache invalidation
  invalidate: {
    list: (param?) => void   // Invalidate list cache
    detail?: (id) => void    // Invalidate detail cache (optional)
  }
}
```

---

## Architecture Principle

**Query atoms are the single source of truth for server data.**

- Entity atoms derive server data from query atoms (no separate cache)
- Draft atoms store local changes only
- Entity atom merges: `query.data + draft → merged entity`
- Dirty detection compares: `draft !== null` or `draft !== query.data`

```
┌─────────────────────────────────────────────────────────────────┐
│                       Controller                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   Query     │  │   Draft     │  │   isDirty   │              │
│  │ (server)    │→ │  (local)    │→ │  (derived)  │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│         ↓               ↓                                        │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                 Entity Atom (merged)                        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Paginated Entity Store Pattern

For entities that need infinite scroll tables with cursor-based pagination, use `createPaginatedEntityStore`. This wraps the InfiniteVirtualTable's store with entity-specific patterns.

### When to Use

Use paginated stores when:
- Displaying large lists of entities in tables (testsets, testcases)
- Needing cursor-based pagination for performance
- Supporting client-side rows (unsaved drafts)
- Supporting soft-delete filtering

### Paginated Store Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PAGINATED STORE DATA FLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌─────────────────┐
                            │   Meta Atom     │
                            │ (projectId,     │
                            │  filters, etc.) │
                            └────────┬────────┘
                                     │
                                     ▼
    ┌──────────────────────────────────────────────────────────────────────┐
    │                        Paginated Store                                │
    │                                                                       │
    │   ┌────────────┐    ┌────────────┐    ┌────────────┐                │
    │   │  Page 1    │    │  Page 2    │    │  Page 3    │   ...          │
    │   │ (cached)   │    │ (cached)   │    │ (loading)  │                │
    │   └────────────┘    └────────────┘    └────────────┘                │
    │         │                 │                 │                        │
    │         └─────────────────┼─────────────────┘                        │
    │                           │                                          │
    │                           ▼                                          │
    │   ┌──────────────────────────────────────────────────────────────┐  │
    │   │              Combined Rows (with skeletons)                   │  │
    │   │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────────┐  │  │
    │   │  │Row 1 │ │Row 2 │ │Row 3 │ │ ...  │ │Row N │ │ Skeleton │  │  │
    │   │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────────┘  │  │
    │   └──────────────────────────────────────────────────────────────┘  │
    │                           │                                          │
    │   Optional:               │                                          │
    │   ┌──────────────┐        │                                          │
    │   │ Client Rows  │────────┘  (prepended)                            │
    │   │ (drafts)     │                                                   │
    │   └──────────────┘                                                   │
    │                                                                       │
    │   ┌──────────────┐                                                   │
    │   │ Exclude IDs  │──────────▶ (filtered out)                        │
    │   │ (soft-delete)│                                                   │
    │   └──────────────┘                                                   │
    │                                                                       │
    └──────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                          ┌─────────────────┐
                          │  Controller     │
                          │  ┌───────────┐  │
                          │  │ rows      │  │
                          │  │ hasMore   │  │
                          │  │ isFetching│  │
                          │  │ totalCount│  │
                          │  │ selection │  │
                          │  └───────────┘  │
                          └─────────────────┘
```

### createPaginatedEntityStore

Factory function that creates a paginated entity store compatible with InfiniteVirtualTable.

**Config options:**

| Option | Description |
|--------|-------------|
| `entityName` | Entity name (used for store key and debugging) |
| `metaAtom` | Atom providing query metadata (projectId, filters, etc.) |
| `fetchPage` | Async function to fetch a page of data |
| `rowConfig` | Row ID extraction and skeleton defaults |
| `clientRowsAtom` | Optional atom for unsaved draft rows |
| `excludeRowIdsAtom` | Optional atom for soft-deleted row IDs |
| `isEnabled` | Optional custom enabled check |
| `transformRow` | Optional API row to table row transformer |

**Returns a PaginatedEntityStore:**

```typescript
interface PaginatedEntityStore<TRow, TApiRow, TMeta> {
  // Entity name for debugging
  entityName: string

  // The underlying table store (for InfiniteVirtualTable)
  store: InfiniteDatasetStore<TRow, TApiRow, TMeta>

  // Row helpers for skeletons and merging
  rowHelpers: TableRowHelpers<TRow, TApiRow>

  // Refresh trigger - increment to force refetch
  refreshAtom: WritableAtom<number, [], void>

  // Meta atom for query parameters
  metaAtom: Atom<TMeta>

  // Invalidate the paginated cache
  invalidate: () => void

  // Controller pattern
  controller: (params) => WritableAtom<ControllerState, Action>
  selectors: { rows, pagination, selection }
  actions: { refresh }
}
```

### Example: Creating a Paginated Store

```typescript
// testset/paginatedStore.ts
import {atom} from "jotai"
import {createPaginatedEntityStore} from "@/state/entities/shared"
import {projectIdAtom} from "@/state/project"
import type {Testset} from "./schema"

// Define meta atom with filters
interface TestsetPaginatedMeta {
  projectId: string | null
  searchTerm: string
  dateRange: {from?: string; to?: string} | null
}

const testsetSearchTermAtom = atom("")
const testsetDateRangeAtom = atom<{from?: string; to?: string} | null>(null)

const testsetPaginatedMetaAtom = atom<TestsetPaginatedMeta>((get) => ({
  projectId: get(projectIdAtom),
  searchTerm: get(testsetSearchTermAtom),
  dateRange: get(testsetDateRangeAtom),
}))

// Create the paginated store
export const testsetPaginatedStore = createPaginatedEntityStore<
  TestsetTableRow,
  TestsetApiRow,
  TestsetPaginatedMeta
>({
  entityName: "testset",
  metaAtom: testsetPaginatedMetaAtom,
  fetchPage: async ({meta, limit, cursor}) => {
    const response = await fetchTestsetsWindow({
      projectId: meta.projectId!,
      limit,
      cursor,
      searchQuery: meta.searchTerm || null,
      dateRange: meta.dateRange,
    })
    return response
  },
  rowConfig: {
    getRowId: (row) => row.id,
    skeletonDefaults: {id: "", name: "", created_at: "", updated_at: ""},
  },
})
```

### Example: Using in Controller

```typescript
// testset/controller.ts
import {testsetPaginatedStore} from "./paginatedStore"

export const testset = {
  // ... existing controller, queries, selectors, etc.

  // Paginated store for table views
  paginated: testsetPaginatedStore,
}
```

### Example: Using with InfiniteVirtualTable

```typescript
import {testset} from "@/state/entities/testset"
import {useInfiniteTablePagination} from "@/components/InfiniteVirtualTable"

const TestsetsTable = () => {
  // Use the paginated store with the table hook
  const {rows, loadNextPage, paginationInfo} = useInfiniteTablePagination({
    store: testset.paginated.store,
    scopeId: projectId,
    pageSize: 50,
  })

  // Refresh trigger
  const refresh = useSetAtom(testset.paginated.refreshAtom)

  return (
    <InfiniteVirtualTable
      dataSource={rows}
      loadMore={loadNextPage}
      columns={columns}
      // ...
    />
  )
}
```

### Example: With Client-Side Rows (Drafts)

```typescript
// For testcases with unsaved drafts
const clientTestcaseRowsAtom = atom<TestcaseTableRow[]>([])
const excludedTestcaseIdsAtom = atom<Set<string>>(new Set())

export const testcasePaginatedStore = createPaginatedEntityStore({
  entityName: "testcase",
  metaAtom: testcasePaginatedMetaAtom,
  fetchPage: fetchTestcasesPage,
  rowConfig: {
    getRowId: (row) => row.id,
    skeletonDefaults: {id: "", input: {}, output: {}},
  },
  // Unsaved testcases are prepended to server rows
  clientRowsAtom: clientTestcaseRowsAtom,
  // Soft-deleted testcases are filtered out
  excludeRowIdsAtom: excludedTestcaseIdsAtom,
})
```

### Paginated Controller Pattern

The paginated store includes a controller pattern for unified state access, similar to single entity controllers:

```typescript
import {testset} from "@/state/entities/testset"

// Full controller - state + dispatch
const [state, dispatch] = useAtom(testset.paginated.controller({
  scopeId: 'testsets-list',
  pageSize: 50,
}))

// State
state.rows          // array of rows
state.totalCount    // total count
state.hasMore       // whether more pages exist
state.isFetching    // loading state
state.selectedKeys  // selected row keys

// Actions
dispatch({type: 'refresh'})
dispatch({type: 'select', keys: ['id1', 'id2']})
dispatch({type: 'selectAll'})
dispatch({type: 'clearSelection'})
dispatch({type: 'toggleSelection', key: 'id1'})
```

For fine-grained subscriptions, use individual selectors:

```typescript
// Only subscribe to rows
const rows = useAtomValue(testset.paginated.selectors.rows({scopeId, pageSize}))

// Only subscribe to pagination state
const {hasMore, isFetching} = useAtomValue(testset.paginated.selectors.pagination({scopeId, pageSize}))

// Selection (read/write)
const [selectedKeys, setSelectedKeys] = useAtom(testset.paginated.selectors.selection({scopeId, pageSize}))

// Imperative refresh
const refresh = useSetAtom(testset.paginated.actions.refresh)
refresh()
```

### Paginated Store vs List Queries

| Feature | Paginated Store | List Query |
|---------|-----------------|------------|
| Use case | Infinite scroll tables | Simple lists, dropdowns |
| Pagination | Cursor-based, infinite | Fixed limit (e.g., 100) |
| Client rows | Supported | Not supported |
| Soft-delete | Supported | Not supported |
| Controller pattern | Yes | No |
| Integration | InfiniteVirtualTable | useAtomValue |

---

## Anti-Patterns to Avoid

### ❌ Using globalStore.get() for Reading

```typescript
// BAD - No reactivity, snapshot read
const globalStore = getDefaultStore()
const data = globalStore.get(testcase.selectors.data(id))
```

```typescript
// GOOD - Proper subscription
const data = useAtomValue(testcase.selectors.data(id))

// Or in derived atoms
const derivedAtom = atom((get) => {
  return get(testcase.selectors.data(id))
})
```

### ❌ Creating Atoms in Render

```typescript
// BAD - Creates new atom every render
const MyComponent = ({id}) => {
  const dataAtom = atom((get) => get(testcase.selectors.data(id)))
  return useAtomValue(dataAtom)
}
```

```typescript
// GOOD - Memoize the atom
const MyComponent = ({id}) => {
  const dataAtom = useMemo(
    () => atom((get) => get(testcase.selectors.data(id))),
    [id]
  )
  return useAtomValue(dataAtom)
}
```

### ❌ Variable Shadowing with Entity Names

```typescript
// BAD - 'testcase' shadows the imported controller
import {testcase} from "@/state/entities/testcase"

const {testcase, data} = entity  // Shadows import!
testcase.selectors.data(id)  // Error: testcase is undefined
```

```typescript
// GOOD - Rename destructured variable
import {testcase} from "@/state/entities/testcase"

const {testcase: testcaseField, data} = entity
testcase.selectors.data(id)  // Works!
```

---

## Contributing

When creating new entity modules:

1. **Use `createEntityController`** for unified entity API with selectors and actions
2. **Configure `drillIn`** if entity needs path-based navigation/editing
3. **Use query atoms as single source of truth** for server data
4. **Use `createEntityDraftState`** if entity supports editing with save/revert
5. **Use `createPaginatedEntityStore`** for infinite scroll table views
6. **Export both base atoms and controller** to give consumers choice
