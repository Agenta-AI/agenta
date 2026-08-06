# Frontend conventions

Scope: everything under `web/` (`oss`, `ee`, `packages`, `apps`). This file loads when you
work in the frontend. The repo-wide root conventions live in `/AGENTS.md`.

For deep `@agenta/*` package reference (package vs app placement, molecules, bridges, the
EntityPicker, package unit tests), use the **`agenta-package-practices`** skill. It holds
the detail this file only summarizes.

## Before committing

- Run `pnpm lint-fix` within the `web` folder.
- Theme colors have a single source of truth: `oss/src/styles/theme/palette.ts` (semantic
  roles with `{light, dark}` values). To change any color, edit `palette.ts`, run
  `pnpm generate:tailwind-tokens`, and commit the regenerated `theme-variables.css` +
  `oss/src/styles/theme/antd-overrides.generated.ts`. Never hand-edit the generated files.
  See the "Styling" section below and `docs/designs/dark-mode.md`.
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
- Per-resource accessors (the entry point to use): `web/packages/agenta-sdk/src/resources.ts`
  (`getWorkflowsClient`, `getSessionsClient`, …; `@agenta/sdk/config` pins the host)
- Generated client: `web/packages/agenta-api-client/`
- Existing Fern-using domains: `@agenta/entities/{gatewayTool,secret,event,testset,workflow}`
  (PR #4425 migrated `workflow`)

Prerequisite: the consuming package must declare `"@agenta/sdk": "workspace:../agenta-sdk"`
in its `package.json` `dependencies`. Today `@agenta/entities` is the main consumer; any
new package adopting Fern must add this dep first, otherwise `tsc --noEmit` fails on the
`@agenta/sdk` import at type-check time.

### Pattern

```typescript
import {getSomeDomainClient} from "@agenta/sdk/resources"

import {safeParseWithLogging} from "../../shared"
import {someResponseSchema} from "../core"

export async function someApiCall({projectId, refId}: SomeParams): Promise<SomeResponse | null> {
    if (!projectId) return null

    // Per-resource Fern client (single source of truth for the request/response
    // shape, kept in sync with the backend OpenAPI spec via Fern codegen).
    const data = await getSomeDomainClient().someMethod(
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

- Use the per-resource accessors from `@agenta/sdk/resources` (`getWorkflowsClient()`,
  `getSessionsClient()`, …) — host-pinned lazy singletons. If the resource has no
  accessor yet, add one there (three lines, follow the existing pattern). NEVER import
  from the `@agenta/sdk` root in app/package source: its barrel statically pulls the
  monolithic client with all 27 resource clients (~300KB parsed) into whatever bundle
  imports it — this regressed `_app` once already and is now lint-enforced in packages.
- Pass query params via `{queryParams: {...}}`, NOT axios's `{params: {...}}`.
- Keep zod validation at the boundary. Fern's types under-declare backend `extra="allow"`
  fields; the local schema is your independent drift check.
- Use `safeParseWithLogging` from `@agenta/entities/shared` for the validation. It logs
  structured errors without crashing.

### Anti-patterns

```typescript
// BAD - root barrel import: bundles all 27 resource clients into this chunk
import {getAgentaSdkClient} from "@agenta/sdk"
// BAD - raw axios for a new endpoint
const response = await axios.post(`${getAgentaApiUrl()}/workflows/revisions/retrieve`, body, {
    params: {project_id: projectId},
})
// BAD - using axios `params` shape with the Fern client
await getWorkflowsClient().retrieveWorkflowRevision(body, {params: {project_id}})  // expects queryParams
// BAD - skipping zod validation because "Fern's types are typed"
return await getWorkflowsClient().retrieveWorkflowRevision(body, {queryParams})    // misses shape drift
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

### Single project scope

Exactly one `project_id` is in scope at any time in the web app. Never write code that
handles multiple projects defensively. In particular, a `createBatchFetcher` `batchFn`
must not group requests by project or fan out one query per project: take the project
from the first request, throw if any request disagrees, and resolve all ids with a
single call (the `/query` endpoints accept multiple refs). Grouping by other dimensions
(a revision-scoped cache, a run id the API requires) is fine; the project dimension is
always singular.

## Entity display names (workflows, variants, revisions)

Workflows are stored git-style: a workflow artifact has variants, and each variant has
revisions. All three carry a `name` column, and reading the wrong one is a recurring bug
class (evaluators showing "default", SDK-created apps showing "--" or hex slugs).

- The entity display name lives on the workflow ARTIFACT: `artifact.name`, falling back
  to its slug. Use `workflowMolecule.selectors.artifactName(entityId)`; it accepts a
  revision id or a workflow id.
- A variant label comes from the VARIANT: `variant.name`, then `variant.slug`. Resolve it
  through the variants list by `workflow_variant_id`. Never label a variant from a
  revision's fields.
- `revision.name` is dead for display. Never read it as a label and never write entity
  names into it. Revisions contribute only `version` (the vN tag) and `message`. Reason:
  UI-created revisions carry the variant name ("default") and SDK-created revisions carry
  no name at all.
- Pick the label by entity kind. Evaluators and other entities that do not use variants
  display artifact name + version. Applications in comparison or evaluation contexts
  display the variant label + version.
- Review blocker: any `.name` read off a revision entity (e.g. `selectors.data(id)?.name`
  or a revision row's `name`) used as a display label. Point to the sanctioned selectors
  above instead.

## Styling

When adding or changing UI elements, implement appearance and interaction states for both light and dark themes, and verify both before considering the work complete.

**Theme colors.** All theme-aware colors flow from one source of truth,
`oss/src/styles/theme/palette.ts` — semantic roles (surface / text / border / fill /
accent / semantic / scales / feature families), each a `{light, dark}` pair. The generator
(`pnpm generate:tailwind-tokens`) turns it into `theme-variables.css`, the antd dark
overrides, and the `--ag-c-*` compatibility shim. In components, consume colors as antd
semantic tokens (Tailwind `bg-colorBgContainer`, `text-colorText`, or `var(--ag-color*)`),
not raw hex or `--ag-c-*` literals. To change a color, edit `palette.ts` and regenerate —
never hand-edit `theme-variables.css` or `theme/antd-overrides.generated.ts`. Full model:
`docs/designs/dark-mode.md`.

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

### Keep in-code comments terse

**Hard rule.** At most ONE short line per comment. No multi-line blocks narrating *why*
in prose, no restating what the code shows. Before writing any comment, ask "can this be
one line?" — if not, cut it. Longer comments only for a genuinely surprising constraint
(documented bug, race, ordering requirement), and even then a sentence or two max.

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
