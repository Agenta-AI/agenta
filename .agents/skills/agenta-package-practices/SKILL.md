---
name: agenta-package-practices
description: Where to put frontend code (package vs the web/mobile app layer) and how to use the @agenta/* packages. Use when authoring or moving code in web/packages, choosing which @agenta/* package owns something (ui, entities, entity-ui, shared, chat, sessions, playground, the *-ui domain packages, ...), using molecules, the loadable bridge, the EntityPicker, or writing package unit tests.
---

# Agenta package practices

This skill is the source of truth for where frontend code lives and how the
`@agenta/*` workspace packages are used. Load it when you author or move code in
`web/packages/`, decide between the app layer and a package, or work with the entity
state primitives (molecules, bridges, pickers) or package unit tests.

## When to use this skill

- Deciding whether new code belongs in `web/mobile` (the app layer) or a package.
  `web/oss` and `web/ee` are the abandoned desktop app: never add code there.
- Choosing which of the `@agenta/*` packages owns a piece of code, or importing from one.
- Building with molecules, the loadable bridge, or the EntityPicker.
- Writing or fixing unit tests inside a package under `web/packages/*/tests/`.

## Code placement: packages vs application code

### Quick heuristic

```text
Is the code used by 2+ features, or could be?
├─ NO  → Keep it in the app layer (web/mobile/src/features/<feature>/)
└─ YES → Move it to a package, picking by purpose:
         ├─ Pure utility / type (no React)              → @agenta/shared
         ├─ Reusable UI component / style util          → @agenta/ui
         ├─ Entity state + API (molecule, atoms)        → @agenta/entities
         ├─ Entity-specific UI (modals, pickers, drive) → @agenta/entity-ui
         ├─ Agent chat (model, transport, components)   → @agenta/chat
         ├─ Domain logic, no screens                    → the domain's headless package
         │    (annotation, auth, navigation, observability, playground,
         │     sessions, settings, skills)
         └─ Domain UI / a whole surface                 → the domain's -ui package
              (annotation-ui, auth-ui, automation-ui, home-ui, navigation-ui,
               observability-ui, playground-ui, sessions-ui, settings-ui, skills-ui)
```

A new domain gets a headless/`-ui` pair when it has both state and UI; see
`web/packages/README.md` for the full list with one-line purposes.

### Hard rules

- **Respect the layers.** Dependencies point one way, down this stack:
  1. `@agenta/shared` (imports no other package); `@agentaai/api-client` ← `@agenta/sdk`
  2. `@agenta/ui` (shared only)
  3. `@agenta/entities` (sdk, shared, ui)
  4. headless domain packages (entities, shared, sdk; `navigation` also reads
     `sessions`, `settings` reads `navigation` and `ui`). They own state and API calls,
     not screens, and never import `entity-ui`, `chat`, or a `-ui` package.
  5. `@agenta/entity-ui`, `@agenta/chat`, and the `-ui` packages. These may import each
     other (e.g. `entity-ui` → `sessions-ui`, `playground-ui` → `chat`), but never in
     a cycle.
  Declare every `@agenta/*` import in the package's `package.json`. Circular imports
  break the build.
- **No legacy compat shims in packages.** Keep `OldFormat → NewFormat` adapters in the
  app layer. Packages stay clean.
- **No `any` types.** Packages enforce `@typescript-eslint/no-explicit-any: error`.
- **Never import the `queryClient` singleton.** Reach the cache with
  `getHostQueryClient()` from `@agenta/shared/api`, resolved per call. The singleton is the
  host's to install; on a host that brought its own client, writes to it silently do nothing.
  Lint-enforced. Contract: `web/AGENTS.md` § "The QueryClient host contract".
- **Use exported subpaths**, not internal paths:
  `import {x} from "@agenta/entities/testcase"`, not
  `from "@agenta/entities/src/testcase/state/molecule"`.
- **Verify your change builds AND lints before pushing:**
  `pnpm turbo run build --filter=@agenta/<package>` and
  `pnpm turbo run lint --filter=@agenta/<package>`.

## Package overview

There are 24 `@agenta/*` packages plus `@agentaai/api-client`. The full list, with a
one-line purpose each, is `web/packages/README.md`. The core ones:

| Package | Purpose | Key exports |
| --- | --- | --- |
| `@agenta/shared` | Utilities, types, schemas, hooks; host QueryClient API | `./api`, `./state`, `./utils`, `getHostQueryClient` |
| `@agenta/ui` | Shared UI kit | shadcn primitives (`./ui`), `EnhancedModal`, `InfiniteVirtualTable`, `cn`, `textColors`, presentational components |
| `@agenta/sdk` | Fern client wrapper | per-resource clients in `./resources` |
| `@agenta/entities` | Entity state and API calls | molecules (`workflowMolecule`, `testcaseMolecule`, ...), the loadable bridge |
| `@agenta/entity-ui` | Entity-specific UI | `EntityPicker`, modals, drawers, drill-in, the drive |
| `@agenta/chat` | Agent chat | model, transport, state, hooks, chat components |
| `@agenta/playground` | Playground state controllers | `./state`, `./snapshot`, `./agent-chat` |
| `@agenta/playground-ui` | Playground UI | comparison view, execution items, agent build, commit |

READMEs: `agenta-ui`, `agenta-entities`, `agenta-entity-ui`, `agenta-shared`,
`agenta-playground`, `agenta-playground-ui`, and `agenta-api-client` each have a
`README.md` at the package root.

## Subpath imports for tree-shaking

Always use subpath imports. Importing from a root barrel (`@agenta/shared`) pulls the
entire dependency graph and inflates the bundle.

`@agenta/shared`:

```typescript
import {axios, getAgentaApiUrl, getEnv, configureAxios} from "@agenta/shared/api"
import {projectIdAtom, setProjectIdAtom} from "@agenta/shared/state"
import {dayjs, isValidUUID, getValueAtPath, setValueAtPath, formatNumber, formatLatency} from "@agenta/shared/utils"
import {useDebounceInput} from "@agenta/shared/hooks"
import {MESSAGE_CONTENT_SCHEMA, CHAT_MESSAGE_SCHEMA} from "@agenta/shared/schemas"
import type {SimpleChatMessage, MessageContent, ToolCall} from "@agenta/shared/types"
```

`@agenta/ui`:

```typescript
import {...} from "@agenta/ui/ui"                 // shadcn primitives (Button, Dialog, Sheet, ...)
import {...} from "@agenta/ui"                    // presentational components, cn, textColors
import {...} from "@agenta/ui/table"              // InfiniteVirtualTable, paginated stores
import {...} from "@agenta/ui/editor"             // Editor, JSON parsing utilities
import {...} from "@agenta/ui/shared-editor"      // SharedEditor, useDebounceInput
import {...} from "@agenta/ui/chat-message"       // ChatMessageEditor, message types/schemas
import {...} from "@agenta/ui/llm-icons"          // LLM provider icons
import {...} from "@agenta/ui/cell-renderers"     // Table cell renderers, CellRendererRegistry
```

`@agenta/entities`:

```typescript
import {...} from "@agenta/entities/workflow"     // workflowMolecule (apps, evaluators, agents)
import {...} from "@agenta/entities/shared"       // molecule factories, transforms
import {...} from "@agenta/entities/trace"        // trace/span molecule, schemas
import {...} from "@agenta/entities/testset"      // testset/revision molecules
import {...} from "@agenta/entities/testcase"     // testcase molecule
import {...} from "@agenta/entities/loadable"     // loadable bridge
import {...} from "@agenta/entities/runnable"     // execution utilities, port helpers
import {...} from "@agenta/entity-ui/selection"   // EntityPicker and adapters
```

## Modals

`EnhancedModal` from `@agenta/ui` is an antd-`Modal`-compatible facade over the
`@agenta/ui` Radix `Dialog`, kept so existing call sites work unchanged. Use it
instead of raw antd `Modal` in package code. In `web/mobile`, and for new
surfaces, compose `Dialog`/`Sheet` from `@agenta/ui/ui` directly.

```typescript
import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"

function MyModal({open, onClose}: {open: boolean; onClose: () => void}) {
    return (
        <EnhancedModal open={open} onCancel={onClose} title="Modal Title" footer={null}>
            <ModalContent>{/* Main content */}</ModalContent>
            <ModalFooter>
                <Button onClick={onClose}>Cancel</Button>
                <Button type="primary">Confirm</Button>
            </ModalFooter>
        </EnhancedModal>
    )
}
```

Why: consistent styling, proper scroll handling via `ModalContent`, standardized footer
via `ModalFooter`, theme integration.

## Style utilities and presentational components

When adding or changing UI elements, implement appearance and interaction states for both light and dark themes, and verify both before considering the work complete.

```typescript
import {cn, textColors, bgColors} from "@agenta/ui"

<div className={cn("base-class", isActive && "active-class")} />
<span className={textColors.secondary}>Secondary text</span>
<div className={bgColors.hover}>Hoverable area</div>
```

Section layout primitives from `@agenta/ui`:

```typescript
import {
  SectionCard, SectionLabel, SectionHeaderRow, ConfigBlock, VersionBadge,
  RevisionLabel, StatusTag, PanelHeader, SourceIndicator,
} from "@agenta/ui"

<SectionCard>
  <SectionHeaderRow left={<SectionLabel>Configuration</SectionLabel>} right={<Button>Edit</Button>} />
  <ConfigBlock title="Settings"><Input /></ConfigBlock>
</SectionCard>
```

## Package selection guide

```text
Need a primitive (button, dialog, ...)? → @agenta/ui/ui
Need a modal?                          → Dialog from @agenta/ui/ui (EnhancedModal for antd-style call sites)
Class-name utils or theme colors?      → cn, textColors, bgColors from @agenta/ui
Section layout primitives?             → SectionCard, SectionLabel, ConfigBlock from @agenta/ui
Entity state management (molecules)?   → *Molecule from @agenta/entities/{entity}
Entity selection UI?                   → EntityPicker from @agenta/entity-ui/selection
Loadable bridge?                       → loadableBridge from @agenta/entities/loadable
Building playground features?          → state from @agenta/playground, UI from @agenta/playground-ui
Chat, sessions, observability, ...?    → the domain's headless + -ui package pair
```

## Molecule pattern (entity state management)

Full documentation: `web/packages/agenta-entities/src/shared/README.md`.

A molecule provides a unified API for entity state with draft, loading, and cache:

```typescript
molecule.atoms.*        // atom families for reactive subscriptions
molecule.reducers.*     // write operations
molecule.get.* / set.*  // imperative reads/writes (snapshot from store)
molecule.useController  // React hook combining atoms + dispatch
molecule.cleanup.*      // memory management
```

Where to use which API:

```text
React component  → useAtom / molecule.useController
Inside an atom   → get(molecule.atoms.*)
Callback/effect  → molecule.get.* / molecule.set.*
```

```typescript
import {testcaseMolecule} from "@agenta/entities/testcase"

function TestcaseEditor({id}: {id: string}) {
  const [state, dispatch] = testcaseMolecule.useController(id)
  if (state.isPending) return <Skeleton />
  if (!state.data) return <NotFound />
  return <Input value={state.data.input} onChange={(e) => dispatch.update({input: e.target.value})} />
}

// Fine-grained subscription: only re-renders when isDirty changes
function DirtyIndicator({id}: {id: string}) {
  const isDirty = useAtomValue(testcaseMolecule.atoms.isDirty(id))
  return isDirty ? <Badge>Modified</Badge> : null
}
```

Imperative API for callbacks:

```typescript
async function handleSave(id: string) {
  const data = testcaseMolecule.get.data(id)
  if (!data || !testcaseMolecule.get.isDirty(id)) return
  await api.save(data)
  testcaseMolecule.set.discard(id)
}
```

Examples: `workflowMolecule` (`@agenta/entities/workflow`), `testcaseMolecule`
(`@agenta/entities/testcase`), `traceSpanMolecule` (`@agenta/entities/trace`),
`testsetMolecule` and `revisionMolecule` (`@agenta/entities/testset`). Other entity
subpaths (`session`, `secret`, `gatewayTool`, ...) follow the same pattern.

Data flow: `Server → TanStack Query → atoms.serverData → atoms.draft (local changes) →
atoms.data (merged) → useController → component`.

Anti-patterns:

```typescript
// BAD - atoms require React context
async function handleSave(id) { const data = useAtomValue(molecule.atoms.data(id)) } // breaks
// GOOD - imperative API
async function handleSave(id) { const data = molecule.get.data(id) }

// BAD - new atom every render
const derived = atom((get) => get(molecule.atoms.data(id)))
// GOOD - memoize the atom
const derived = useMemo(() => atom((get) => get(molecule.atoms.data(id))), [id])
```

## Loadable bridge pattern

Full documentation: `web/packages/agenta-entities/src/loadable/README.md`.

A loadable represents a data source that provides input rows (local mode = manual entry,
connected mode = synced with a testset revision or trace).

```typescript
import {loadableBridge} from "@agenta/entities/loadable"
import {useAtomValue, useSetAtom} from "jotai"

const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
const addRow = useSetAtom(loadableBridge.actions.addRow)
addRow(loadableId, {prompt: "Hello, world!"})

const connect = useSetAtom(loadableBridge.actions.connectToSource)
connect(loadableId, testsetRevisionId, "MyTestset v1", "testcase")
```

Selectors: `rows`, `columns`, `activeRow`, `mode`, `isDirty`, `connectedSource`.
Actions: `addRow`, `updateRow`, `removeRow`, `setActiveRow`, `connectToSource`, `disconnect`.

## Runnables (executable entities)

Full documentation: `web/packages/agenta-entities/src/runnable/README.md`.

A runnable is an executable entity (app, evaluator, or agent revision). There is no
separate runnable bridge: read revision data straight from `workflowMolecule`.
`@agenta/entities/runnable` holds the execution utilities and port helpers.

```typescript
import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

const data = useAtomValue(workflowMolecule.selectors.data(revisionId))
const inputPorts = useAtomValue(workflowMolecule.selectors.inputPorts(revisionId))
const outputPorts = useAtomValue(workflowMolecule.selectors.outputPorts(revisionId))
const config = useAtomValue(workflowMolecule.selectors.configuration(revisionId))
```

## Entity selection system

Full documentation: `web/packages/agenta-entity-ui/src/selection/README.md`.

Use the unified `EntityPicker` from `@agenta/entity-ui/selection` for hierarchical
selection (Workflow → Variant → Revision).

```typescript
import {
    EntityPicker,
    type TestsetSelectionResult,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"

// Cascading dropdowns (inline forms, compact)
<EntityPicker<WorkflowRevisionSelectionResult> variant="cascading" adapter="workflowRevision" onSelect={handleSelect} />

// Breadcrumb navigation (modals)
<EntityPicker<WorkflowRevisionSelectionResult> variant="breadcrumb" adapter="workflowRevision" onSelect={handleSelect} showSearch showBreadcrumb rootLabel="All Apps" />

// List with hover popovers (sidebars, 2-level)
<EntityPicker<TestsetSelectionResult> variant="list-popover" adapter="testset" onSelect={handleSelect} autoSelectLatest selectLatestOnParentClick />
```

Mode hooks: `useCascadingMode`, `useBreadcrumbMode`, `useListPopoverMode`.

Pre-built adapters:

| Adapter | Hierarchy | Selection result |
| --- | --- | --- |
| `workflowRevision` | Workflow → Variant → Revision (filter apps/evaluators with query flags; `createWorkflowRevisionAdapter` for a 2-level variant) | `WorkflowRevisionSelectionResult` |
| `evaluator` | Flat evaluator list | `EvaluatorSelectionResult` |
| `testset` | Testset → Revision | `TestsetSelectionResult` |

## Package unit tests

Packages host tests under `tests/unit/`, not in `src/`. Most packages run vitest
(each has a `vitest.config.ts` at its root). Any new package shipping testable logic
should match this layout.

### Layout

```text
web/packages/<pkg>/
├── package.json          # vitest + scripts
├── tsconfig.json         # excludes src/**/__tests__/**
├── vitest.config.ts      # at package root
└── tests/
    ├── __mocks__/        # stub deps (e.g. @agenta/ui for antd)
    └── unit/
        └── <feature>.test.ts
```

Why tests live in `tests/unit/`, not `src/`: the package build runs `tsc --noEmit` over
`src/`. Test files in `src/**/__tests__/**` pull in deps not declared in the package's
`dependencies`, which CI's stricter resolution fails on even though they resolve locally
via hoisting. Test runners transpile independently of the package `tsconfig`, so moving
tests out of `src/` does not change how they run. Reference: commit `1c0a900`.

### Minimal vitest.config.ts

```typescript
import {defineConfig} from "vitest/config"

export default defineConfig({
    test: {
        include: ["tests/unit/**/*.test.ts"],
        environment: "node",
        reporters: ["default", "junit"],
        outputFile: {junit: "./test-results/junit.xml"},
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/index.ts"],
            reporter: ["text", "lcov", "json-summary"],
            reportsDirectory: "./coverage",
        },
    },
})
```

For packages that import React/antd, stub `@agenta/ui` to keep the test env pure Node:

```typescript
resolve: {
    alias: {"@agenta/ui": path.resolve(__dirname, "tests/__mocks__/agenta-ui.ts")},
},
```

### Standard package.json scripts

```json
{
  "scripts": {
    "test": "pnpm run test:unit",
    "test:unit": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "check": "pnpm run types:check && pnpm run lint"
  },
  "devDependencies": {
    "@vitest/coverage-v8": "^4.1.4",
    "vitest": "^4.1.4"
  }
}
```

### Mocking the Fern client in tests

Mock `@agenta/sdk/resources` (the per-resource accessors), not axios. Constructing a
real Fern client reads env vars and initializes transport, neither of which a unit test
wants.

```typescript
import {beforeEach, describe, expect, it, vi} from "vitest"

const fernRetrieve = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getWorkflowsClient: () => ({retrieveWorkflowRevision: fernRetrieve}),
}))

// Import the unit-under-test AFTER vi.mock so it picks up the mocked module.
import {retrieveWorkflowRevision} from "../../src/workflow/api/api"

beforeEach(() => { fernRetrieve.mockReset() })

it("invokes the Fern client with project_id as a queryParam", async () => {
    fernRetrieve.mockResolvedValueOnce({workflow_revision: {id: "rev-1"}})
    await retrieveWorkflowRevision({projectId: "proj-42", workflowRef: {id: "wf-1"}})
    const [body, opts] = fernRetrieve.mock.calls[0]
    expect(body).toEqual({workflow_ref: {id: "wf-1"}})
    expect(opts).toEqual({queryParams: {project_id: "proj-42"}})
})
```

Reference test files:
- `web/packages/agenta-entities/tests/unit/retrieveWorkflowRevision.test.ts` (Fern mocked)
- `web/packages/agenta-playground/tests/unit/traceRefResolution.test.ts` (pure logic)
- `web/packages/agenta-entities/tests/__mocks__/agenta-ui.ts` (antd stub)

### Integration tests

For code that exercises a real backend, use a separate `vitest.integration.config.ts`
with `include: ["tests/integration/**/*.test.ts"]`, raised timeouts (30s),
`sequence.concurrent: false`, and `globalSetup` + `setupFiles`. No coverage section.
`@agenta/entities` is the established example
(`web/packages/agenta-entities/vitest.integration.config.ts`).

Write an integration test (not a unit test) when: the code talks to a real backend and
the request/response contract is the thing under test; the code coordinates multiple
molecules/atoms whose interaction is the bug surface; or you are testing a migration path
where the real backend behaviour is the spec. Otherwise use a unit test.

### What to test

High value: API request shape (correct Fern method, body, query params), boundary
validation (bad responses return `null`/empty instead of crashing), pure derivation logic
(extractors, predicates, key-priority pickers, cache TTL), and guards (empty IDs, missing
project IDs).

Skip: anything needing a running React tree, HTTP transport (Fern owns it), and antd
rendering inside packages.
