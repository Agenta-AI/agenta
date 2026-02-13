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
    connectedSourceType: null,
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
 * Mode for a loadable (local or connected)
 */
export const loadableModeAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        return state.connectedSourceId ? ("connected" as const) : ("local" as const)
    }),
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
            type: state.connectedSourceType,
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
