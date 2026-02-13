# Entities Onboarding Reference

Quick reference for new contributors working with `@agenta/entities`.

## When to use which API

| Goal | Recommended API | Notes |
| --- | --- | --- |
| Execute data rows in playground | `loadableBridge` | Rows always come from `testcaseMolecule` (local or server). |
| Run app revisions | `runnableBridge` | Wraps app/evaluator revisions for execution metadata. |
| Render testcase tables | `testcaseDataController` | Abstracts local vs server data sources. |
| Get effective testcases for a revision | `revision.atoms.effectiveTestcases(id)` | Server rows + local pending rows merged. |
| Edit entity metadata | `testsetMolecule`, `revisionMolecule`, `appRevisionMolecule` | Draft state is merged into `data`. |
| Commit testset changes | `revisionMolecule.actions.commit` | Commit creates a new revision. |

## Local vs backend mental model

- Local entities are **first-class**: they use the same controller APIs as backend entities.
- Local rows are created via `testcaseMolecule.actions.add` and get `local-`/`new-` IDs.
- `loadableBridge.mode(loadableId)` is the only mode switch you typically need.

## Common flows

### Edit testset data

1. Connect a loadable to a revision (`loadableBridge.actions.connectToSource`).
2. Edit rows using loadable row actions (they route to `testcaseMolecule`).
3. Commit via `revisionMolecule.actions.commit` to create a new revision.

### Execute with local rows

1. Keep loadable disconnected (local mode).
2. Add rows with `loadableBridge.actions.addRow`.
3. Execute via the runnable (app revision) without needing any special branching.

## Effective testcases

The revision molecule provides `effectiveTestcaseIds` and `effectiveTestcases` atoms that merge server rows with local pending additions. Use these when you need the complete set of rows for a revision:

```typescript
import { revision } from '@agenta/entities'

// Get all effective IDs (server + local pending)
const ids = useAtomValue(revision.atoms.effectiveTestcaseIds(revisionId))

// Get resolved testcase data
const testcases = useAtomValue(revision.atoms.effectiveTestcases(revisionId))
```

## Data controller pattern

For table components, use data controllers instead of manual atom wiring. Data controllers provide unified access to rows, columns, loading state, and selection:

```typescript
import { testcaseDataController } from '@agenta/entities/testcase'

const config = useMemo(() => ({ scopeId: 'my-table', revisionId }), [revisionId])

// Read data
const rows = useAtomValue(testcaseDataController.selectors.rows(config))
const columns = useAtomValue(testcaseDataController.selectors.columns(config))
const isLoading = useAtomValue(testcaseDataController.selectors.isLoading(config))

// Handle selection
const selectedIds = useAtomValue(testcaseDataController.selectors.selectedIds(config.scopeId))
const toggleSelection = useSetAtom(testcaseDataController.actions.toggleSelection)
```

For UI, prefer `EntityTable` from `@agenta/entity-ui` which wires up the controller automatically.
