/**
 * Loadable State Store
 *
 * Pure Jotai atoms for loadable state management.
 * Loadables represent data sources (like testsets) that can be connected to runnables.
 *
 * This module has NO entity dependencies - it's pure state.
 * Entity integrations (testcase, appRevision, etc.) are handled at the controller level.
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import type {LoadableState} from "./types"

// ============================================================================
// DEFAULT STATE
// ============================================================================

const defaultLoadableState: LoadableState = {
    columns: [],
    activeRowId: null,
    name: null,
    connectedSourceId: null,
    connectedSourceName: null,
    linkedRunnableType: null,
    linkedRunnableId: null,
    executionResults: {},
    outputMappings: [],
    hiddenTestcaseIds: new Set<string>(),
    disabledOutputMappingRowIds: new Set<string>(),
}

// ============================================================================
// CORE STATE ATOM
// ============================================================================

/**
 * Loadable state per loadable ID
 */
export const loadableStateAtomFamily = atomFamily((_loadableId: string) =>
    atom<LoadableState>(defaultLoadableState),
)

// ============================================================================
// DERIVED ATOMS (pure - no entity dependencies)
// ============================================================================

/**
 * Rows for a loadable
 * @deprecated Use loadableController.testset.selectors.rows instead - rows now live in testcaseMolecule
 */
export const loadableRowsAtomFamily = atomFamily((_loadableId: string) =>
    atom(() => {
        // Rows now live in testcaseMolecule, not in loadable state
        // Use loadableController.testset.selectors.rows(loadableId) instead
        return []
    }),
)

/**
 * Columns for a loadable
 * Returns columns from loadable state.
 * The controller is responsible for deriving columns from runnables.
 */
export const loadableColumnsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        return state.columns
    }),
)

/**
 * All columns for a loadable (derived from row data)
 * @deprecated Use loadableController.testset.selectors.columns instead
 */
export const loadableAllColumnsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        // Return columns from state - actual column derivation happens in controller
        return state.columns
    }),
)

/**
 * Active row ID for a loadable
 * @deprecated Use loadableController.testset.selectors.activeRow instead
 */
export const loadableActiveRowAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        // Just return the active row ID - actual row data comes from testcaseMolecule
        return state.activeRowId
    }),
)

/**
 * Row count for a loadable
 * @deprecated Use testcaseMolecule.atoms.displayRowIds.length instead
 */
export const loadableRowCountAtomFamily = atomFamily((_loadableId: string) =>
    atom(() => {
        // Row count now comes from testcaseMolecule.atoms.displayRowIds
        return 0
    }),
)

/**
 * Mode for a loadable (local or connected)
 */
export const loadableModeAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        return state.connectedSourceId ? ("connected" as const) : ("local" as const)
    }),
)

/**
 * Is dirty for a loadable
 * This is a simple flag - actual dirty detection is controller responsibility.
 */
export const loadableIsDirtyAtomFamily = atomFamily((_loadableId: string) => atom<boolean>(false))

/**
 * Has local changes for a loadable
 * This is a simple flag - actual dirty detection is controller responsibility.
 */
export const loadableHasLocalChangesAtomFamily = atomFamily((_loadableId: string) =>
    atom<boolean>(false),
)

/**
 * Execution results for a loadable
 */
export const loadableExecutionResultsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(loadableStateAtomFamily(loadableId)).executionResults),
)

/**
 * Full data for a loadable
 */
export const loadableDataAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(loadableStateAtomFamily(loadableId))),
)

/**
 * Connected source for a loadable
 */
export const loadableConnectedSourceAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        return {
            id: state.connectedSourceId,
            name: state.connectedSourceName,
        }
    }),
)

/**
 * Linked runnable for a loadable
 */
export const loadableLinkedRunnableAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        return {
            type: state.linkedRunnableType,
            id: state.linkedRunnableId,
        }
    }),
)

/**
 * Output mappings for a loadable
 */
export const loadableOutputMappingsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(loadableStateAtomFamily(loadableId)).outputMappings ?? []),
)
