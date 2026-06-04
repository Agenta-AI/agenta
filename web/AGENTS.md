# Frontend conventions

Scope: everything under `web/` (`oss`, `ee`, `packages`, `apps`). This file loads when you
work in the frontend. The repo-wide root conventions live in `/AGENTS.md`.

For deep `@agenta/*` package reference (package vs app placement, molecules, bridges, the
EntityPicker, package unit tests), use the **`agenta-package-practices`** skill. It holds
the detail this file only summarizes.

## Before committing

- Run `pnpm lint-fix` within the `web` folder.
- If you update Ant Design tokens, run `pnpm generate:tailwind-tokens` and commit the
  generated file.
- The Fern-generated `@agentaai/api-client` ships as a compiled `dist/` (entry
  `./dist/index.js`). `pnpm install` runs the package's `prepare` script which builds
  `dist/` automatically, so a fresh checkout works out of the box. If you regenerate the
  client (`bash ./clients/scripts/generate.sh --language typescript`) or edit
  `web/packages/agenta-api-client/src/`, run `pnpm install` again or
  `pnpm --filter @agentaai/api-client build` so consumers (`@agenta/sdk`,
  `@agenta/entities`, `web/oss`, `web/ee`) see the update. The `.js` extensions in Fern's
  relative imports are intentional NodeNext-style emission and resolve only via the
  compiled `dist/`.

## Frontend API: use the Fern client

All new frontend API code goes through the Fern-generated client, not raw axios. The
client is the single source of truth for request/response shapes. It is regenerated from
the backend OpenAPI spec and prevents the FE from drifting from the backend.

References:
- Workspace SDK wrapper: `web/packages/agenta-sdk/src/index.ts` (`getAgentaSdkClient`)
- Generated client: `web/packages/agenta-api-client/`
- Existing Fern-using domains: `@agenta/entities/{gatewayTool,secret,event,testset,workflow}`
  (PR #4425 migrated `workflow`)

Prerequisite: the consuming package must declare `"@agenta/sdk": "workspace:../agenta-sdk"`
in its `package.json` `dependencies`. Today `@agenta/entities` is the main consumer; any
new package adopting Fern must add this dep first, otherwise `tsc --noEmit` fails on the
`@agenta/sdk` import at type-check time.

### Pattern

```typescript
import {getAgentaSdkClient} from "@agenta/sdk"
import {getAgentaApiUrl} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {someResponseSchema} from "../core"

export async function someApiCall({projectId, refId}: SomeParams): Promise<SomeResponse | null> {
    if (!projectId) return null

    // Single source of truth for the request/response shape, kept in sync with the
    // backend OpenAPI spec via Fern codegen.
    const client = getAgentaSdkClient({host: getAgentaApiUrl()})
    const data = await client.someDomain.someMethod(
        {ref: {id: refId}},
        {queryParams: {project_id: projectId}},
    )

    // Zod validation stays at the boundary. Fern's compile-time types under-declare
    // backend extra="allow" fields, so drift detection via the local schema still has
    // independent value.
    const validated = safeParseWithLogging(someResponseSchema, data, "[someApiCall]")
    return validated ?? null
}
```

### Key rules

- Use `getAgentaSdkClient({host: getAgentaApiUrl()})` — it is a lazy singleton, share it
  across calls.
- Pass query params via `{queryParams: {...}}`, NOT axios's `{params: {...}}`.
- Keep zod validation at the boundary. Fern's types under-declare backend `extra="allow"`
  fields; the local schema is your independent drift check.
- Use `safeParseWithLogging` from `@agenta/entities/shared` for the validation. It logs
  structured errors without crashing.

### Anti-patterns

```typescript
// BAD - raw axios for a new endpoint
const response = await axios.post(`${getAgentaApiUrl()}/workflows/revisions/retrieve`, body, {
    params: {project_id: projectId},
})
// BAD - using axios `params` shape with the Fern client
await client.workflows.retrieveWorkflowRevision(body, {params: {project_id}})  // expects queryParams
// BAD - skipping zod validation because "Fern's types are typed"
return await client.workflows.retrieveWorkflowRevision(body, {queryParams})    // misses shape drift
```

### Migrating legacy axios calls

- **New implementation = Fern.** Every new function that talks to the Agenta backend uses
  the Fern client, regardless of file or package.
- **Adding a new function to an existing axios-using file = Fern.** You do not have to
  migrate the file's existing axios functions in the same change.
- **Existing axios calls migrate incrementally**, opportunistically when you touch a
  function for another reason. The migration is mechanical (PR #4425, commit `c3572fd`).

## Import aliases

The monorepo uses TypeScript path aliases. Choosing the right pattern matters for
maintainability.

Available aliases:
1. `@/oss/*` — resolves with fallback order: `ee/src/*` → `oss/src/*`
2. `@agenta/oss/src/*` — explicit import from the OSS package (npm workspace)
3. `@/agenta-oss-common/*` — similar fallback to `@/oss/*` (less common)

### Use `@/oss/*` for shared utilities and state

For shared utilities, helpers, types, hooks, or state that work the same in EE and OSS:

```typescript
import {getEnv} from "@/oss/lib/helpers/dynamicEnv"
import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {User, JSSTheme} from "@/oss/lib/Types"
import {selectedOrgIdAtom} from "@/oss/state/org"
import axios from "@/oss/lib/api/assets/axiosConfig"
```

Why: the fallback lets EE override an implementation if needed, falling back to OSS by
default.

### Use `@agenta/oss/src/*` for explicit OSS imports

When EE code must explicitly reference the OSS version of a component or page (extending,
wrapping, or re-exporting OSS), to guarantee the OSS implementation rather than an EE
override:

```typescript
import OssSidebarBanners from "@agenta/oss/src/components/SidebarBanners"
import ObservabilityPage from "@agenta/oss/src/pages/w/[workspace_id]/p/[project_id]/observability"
import {DeploymentRevisions} from "@agenta/oss/src/lib/types_ee"
```

### Never use relative paths for cross-package imports

```typescript
// BAD - fragile, hard to maintain
import OssSidebarBanners from "../../../../oss/src/components/SidebarBanners"
// GOOD - explicit alias
import OssSidebarBanners from "@agenta/oss/src/components/SidebarBanners"
```

### Quick decision guide

```text
Are you in EE code importing from OSS?
├─ Is it a component/page that EE extends or wraps?  → @agenta/oss/src/*
├─ Is it a utility, helper, type, or state atom?     → @/oss/*
└─ Not sure?                                         → @agenta/oss/src/* (explicit is safer)
```

## Architecture overview

Module-based architecture prioritizing maintainability, reusability, and clear separation
of concerns.

Core principles:
1. **Modular organization.** Modules are distinct feature areas (similar to pages). Each
   module is self-contained with its own components, hooks, and assets. Shared
   functionality is elevated to the appropriate hierarchy level.
2. **Component structure.** Components are organized by scope of use, and may contain
   presentational logic (`Component.tsx`), UI-only subcomponents (`components/*.tsx`),
   component-specific hooks (`hooks/*.ts`), local constants/utilities (`assets/*.ts`),
   and types (`types.d.ts`).
3. **Code movement.** Module-specific code stays in the module. Code used across modules
   moves up: components to root `/components`, hooks to root `/hooks`, UI/constants/utils
   to root `/assets`, types to root `types.d.ts`.

Adopt this structure progressively as you modify components. No big-bang refactors.

## State management

1. **Store organization.** Each module can have its own `store` folder with Jotai atoms.
   A global store at root level holds cross-module state.
2. **State movement.** Local UI-only state stays local. State shared within a module uses
   a module-level store. State shared across modules moves to root `/store`. Consider
   scope of usage, update frequency, performance, and persistence.
3. **Tools.** Prefer Jotai atoms for all shared state. Local component state for UI-only
   concerns.
4. **Avoid prop drilling.** When state is only meaningful within a component tree, use
   Jotai atoms instead of threading props through intermediate components.

```typescript
// Avoid: passing selectedId/setSelectedId through Child1 → Child2 → GrandChild
// Prefer: an atom any component in the tree reads directly
export const selectedIdAtom = atom<string | null>(null)

function GrandChild() {
    const [selectedId, setSelectedId] = useAtom(selectedIdAtom)
    return <div onClick={() => setSelectedId(123)}>{selectedId}</div>
}
```

Use **props** when the parent owns the state, it is single-level, or props are
config/callbacks. Use **atoms** when state is shared across non-parent-child components,
drilled through multiple levels, or is module/feature-scoped.

5. **Persisted state.** For state that survives browser sessions, use `atomWithStorage`
   from `jotai/utils`:

```typescript
import {atomWithStorage} from "jotai/utils"

export const rowHeightAtom = atomWithStorage<"small" | "medium" | "large">(
    "agenta:table:row-height", // localStorage key
    "medium",
)
```

For app/module-scoped data, hold all data in one storage atom and expose scoped access
via a derived atom:

```typescript
const selectedVariantsByAppAtom = atomWithStorage<Record<string, string[]>>(
    "agenta_selected_revisions_v2", {},
)
export const selectedVariantsAtom = atom(
    (get) => {
        const appId = get(routerAppIdAtom) || "__global__"
        return get(selectedVariantsByAppAtom)[appId] || []
    },
    (get, set, next: string[]) => {
        const appId = get(routerAppIdAtom) || "__global__"
        const all = get(selectedVariantsByAppAtom)
        set(selectedVariantsByAppAtom, {...all, [appId]: next})
    },
)
```

For nullable strings, use `stringStorage` from `@/oss/state/utils/stringStorage` as the
third arg so null is handled properly.

Use `atomWithStorage` for user preferences, recently-used items, persistent UI state, and
form drafts. Prefix keys with `agenta:`. Examples:
`web/oss/src/components/EvalRunDetails2/state/rowHeight.ts`,
`web/oss/src/state/app/atoms/fetcher.ts`,
`web/oss/src/components/Playground/state/atoms/core.ts`.

## Data fetching

Primary pattern: Jotai atoms with TanStack Query via `atomWithQuery` from
`jotai-tanstack-query`. Use it for API data, queries that depend on other atoms, sharing
data across components, and when you need caching, loading states, and refetching.

```typescript
import {atomWithQuery} from "jotai-tanstack-query"

export const dataQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["data", projectId],   // include all dependencies
        queryFn: () => fetchData(projectId),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        enabled: !!projectId,            // conditional fetching
    }
})

const query = useAtomValue(dataQueryAtom)
```

For parameterized queries use `atomFamily`; for derived data use `selectAtom`; for
mutations, call the API then `queryClient.invalidateQueries({queryKey: [...]})`.

Key principles: include all reactive dependencies in `queryKey`, use `enabled` for
conditional queries, `selectAtom` for derived data, invalidate after mutations, set an
appropriate `staleTime`. Examples: `web/oss/src/state/profile/selectors/user.ts`,
`web/oss/src/state/environment/atoms/fetcher.ts`,
`web/oss/src/state/queries/atoms/fetcher.ts`.

Do NOT use `useEffect` with manual state for data fetching. Use `atomWithQuery`.

Legacy SWR + axios is present in older code but must not be used for new features.

## Styling

Always prefer Tailwind utility classes over CSS-in-JS or separate CSS files.

```typescript
// Good
<main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
    <Card className="max-w-[520px] w-[90%] text-center">...</Card>
</main>
```

Avoid `react-jss`/`styled-components` and inline `style={{...}}`. CSS-in-JS is acceptable
only for complex Ant Design overrides that Tailwind cannot express, dynamic theme-dependent
styles needing JS calculation, and legacy components (refactor to Tailwind when you touch
them). Tailwind benefits: no style bloat, consistent design system, better performance,
works with Ant Design. Good example: `web/oss/src/components/CustomWorkflowBanner/index.tsx`.

## React best practices

### Component reusability

Before duplicating similar functionality, consider reusability, but do not over-abstract.
Extract a component when it is used in 3+ places with similar logic, has complex isolated
logic, or has a clear stable interface. Do not extract when used only twice, requirements
are still evolving, or it is small (< 20 lines). When you spot a reuse opportunity, surface
it to the developer with the trade-off rather than refactoring silently.

### Performance (critical for evaluations and observability, which handle large datasets)

1. **Minimize re-renders.** `useMemo` for expensive computations, `React.memo` for stable
   props, avoid inline functions/objects in render, especially in lists.

```typescript
// BAD - new function every render
{items.map(item => <Row key={item.id} onClick={() => handleClick(item)} />)}
// GOOD - stable callback
const handleRowClick = useCallback((item) => handleClick(item), [])
{items.map(item => <Row key={item.id} onClick={handleRowClick} item={item} />)}
```

2. **Optimize query updates.** Do not put frequently-changing values in `queryKey`. Use
   `select` to extract only needed data. Set `staleTime` for data that rarely changes.

```typescript
// BAD - refetches every second
atomWithQuery((get) => ({queryKey: ["data", get(currentTimeAtom)], queryFn: fetchData}))
// GOOD - refetches only on meaningful change
atomWithQuery((get) => ({queryKey: ["data", get(projectIdAtom), get(filterAtom)], queryFn: fetchData, staleTime: 60_000}))
```

3. **Virtualize large lists** (100+ items). Reference: `InfiniteVirtualTable`.
4. **Debounce/throttle** search inputs, filters, scroll and resize handlers.

### Modular component design

Keep components focused and decoupled: high cohesion, low coupling. Pass IDs/keys, not
entire data structures. Components fetch their own data via atoms with queries.

```typescript
// Good - component owns its data needs
function UserCard({userId}: {userId: string}) {
    const user = useAtomValue(userQueryAtomFamily(userId))
    return <Card>{user.name}</Card>
}
```

### Avoid inline array props with heavy content

Passing an inline array of objects with JSX content creates a new array every render,
forcing re-renders. Memoize it.

```typescript
const items = useMemo(() => [
    {title: "Item 1", content: <div>Content 1</div>},
    {title: "Item 2", content: <div>Content 2</div>},
], [])
<AccordionTreePanel items={items} />
```

## Packages, entities, and code placement

The `@agenta/*` workspace packages share UI, state, and utilities across OSS and EE. The
**`agenta-package-practices`** skill is the source of truth for this area. Load it when you:

- Decide whether code belongs in the app layer (`web/oss`/`web/ee`) or a package.
- Import from `@agenta/ui`, `@agenta/entities`, `@agenta/entity-ui`, `@agenta/shared`, or
  `@agenta/playground` (always via subpath exports for tree-shaking).
- Build a new modal (use `EnhancedModal` from `@agenta/ui`, not raw antd `Modal`).
- Use entity state (molecules), the loadable/runnable bridges, or the `EntityPicker`.
- Write package unit tests (they live in `tests/unit/`, not `src/`).

Quick placement heuristic:

```text
Is the code used by 2+ features, or could be?
├─ NO  → keep it in the app layer (web/oss/src/ or web/ee/src/)
└─ YES → move to a package by purpose:
         UI component / style util         → @agenta/ui
         entity state (molecule, atoms)     → @agenta/entities
         entity-specific UI (modals/pickers)→ @agenta/entity-ui
         playground state / UI              → @agenta/playground / @agenta/playground-ui
         pure utility / type (no React)     → @agenta/shared
```

Hard rules (full detail in the skill): respect the import hierarchy
`shared ← ui ← entities ← entity-ui ← playground ← playground-ui`; no legacy compat shims
in packages; no `any`; use exported subpaths; verify with
`pnpm turbo run build --filter=@agenta/<package>` and `lint` before pushing.

Bridge and molecule docs also live next to the code:
`web/packages/agenta-entities/src/{loadable,runnable,shared}/README.md` and
`web/packages/agenta-entity-ui/src/selection/README.md`.
