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
    rows: [],
    columns: [],
    activeRowId: null,
    connectedSourceId: null,
    connectedSourceName: null,
    linkedRunnableType: null,
    linkedRunnableId: null,
    executionResults: {},
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
 * Returns rows from the loadable state - no entity integration here.
 * The controller is responsible for syncing entity data to this state.
 */
export const loadableRowsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        return state.rows
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
 */
export const loadableAllColumnsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        if (state.rows.length === 0) return state.columns

        const keySet = new Set<string>()
        state.rows.forEach((row) => {
            Object.keys(row.data).forEach((key) => keySet.add(key))
        })
        return Array.from(keySet).map((key) => ({
            key,
            name: key,
            type: "string" as const,
        }))
    }),
)

/**
 * Active row for a loadable
 */
export const loadableActiveRowAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const rows = state.rows

        // If no active row ID set, return the first row
        if (!state.activeRowId && rows.length > 0) {
            return rows[0]
        }

        // Find the active row by ID
        return rows.find((r) => r.id === state.activeRowId) ?? null
    }),
)

/**
 * Row count for a loadable
 */
export const loadableRowCountAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => get(loadableStateAtomFamily(loadableId)).rows.length),
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
