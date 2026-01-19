/**
 * Loadable Controller
 *
 * Manages loadable entities (data sources like testsets) - rows (testcases), columns,
 * and execution state. Loadables can be connected to testset revisions or used locally.
 *
 * ## Architecture
 *
 * The loadable system has two layers:
 * - **store.ts**: Pure state atoms (no entity dependencies)
 * - **controller.ts**: Bridges entity APIs to loadable state
 *
 * When connected to a testset, the controller:
 * - Routes row mutations through testcaseMolecule API
 * - Syncs testcase data to loadable rows
 * - Delegates dirty detection to testcaseMolecule
 *
 * ## Usage
 *
 * ```typescript
 * import { loadableController } from '@agenta/entities/loadable'
 *
 * // Selectors
 * const rows = useAtomValue(loadableController.testset.selectors.rows(loadableId))
 * const activeRow = useAtomValue(loadableController.testset.selectors.activeRow(loadableId))
 *
 * // Actions
 * const addRow = useSetAtom(loadableController.testset.actions.addRow)
 * addRow(loadableId, { prompt: 'Hello' })
 *
 * const connectToSource = useSetAtom(loadableController.testset.actions.connectToSource)
 * connectToSource(loadableId, revisionId, 'TestsetName v1')
 * ```
 */

import {projectIdAtom} from "@agenta/shared"
import {atom} from "jotai"
import {atomFamily} from "jotai-family"
import {queryClientAtom} from "jotai-tanstack-query"

import {testcaseMolecule} from "../testcase"
import type {FlattenedTestcase} from "../testcase/core"

import {
    loadableStateAtomFamily,
    loadableColumnsAtomFamily,
    loadableAllColumnsAtomFamily,
    loadableActiveRowAtomFamily,
    loadableRowCountAtomFamily,
    loadableModeAtomFamily,
    loadableExecutionResultsAtomFamily,
    loadableDataAtomFamily,
    loadableConnectedSourceAtomFamily,
    loadableLinkedRunnableAtomFamily,
} from "./store"
import type {TestsetRow, TestsetColumn, RunnableType, RowExecutionResult} from "./types"

// ============================================================================
// TESTCASE BRIDGE ATOMS
// These atoms bridge testcaseMolecule data to loadable rows when connected
// ============================================================================

/**
 * Derived rows atom that reads from testcaseMolecule when connected.
 * This is the "bridge" that syncs testcase data to the loadable format.
 */
const connectedRowsAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Not connected - return stored rows
        if (!state.connectedSourceId) {
            return state.rows
        }

        // Connected - derive from testcaseMolecule
        const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)

        return displayRowIds.map((id) => {
            const entity = get(testcaseMolecule.selectors.data(id))
            if (!entity) {
                return {id, data: {}} as TestsetRow
            }

            // Convert testcase entity to TestsetRow format
            // Exclude system fields
            const data: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(entity)) {
                // Skip system fields (id, flags, tags, meta, etc.)
                if (key === "id" || key === "flags" || key === "tags" || key === "meta") continue
                data[key] = value
            }

            return {id, data} as TestsetRow
        })
    }),
)

/**
 * Dirty detection that uses testcaseMolecule when connected.
 */
const connectedHasLocalChangesAtomFamily = atomFamily((loadableId: string) =>
    atom((get) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Not connected - no "local changes" concept
        if (!state.connectedSourceId) {
            return false
        }

        // Connected - delegate to testcaseMolecule
        return get(testcaseMolecule.atoms.hasUnsavedChanges)
    }),
)

// ============================================================================
// ROW ACTIONS
// ============================================================================

/**
 * Add a row to the loadable
 * When connected, routes through testcase molecule for proper dirty tracking
 */
const addRowAtom = atom(null, (get, set, loadableId: string, data?: Record<string, unknown>) => {
    const state = get(loadableStateAtomFamily(loadableId))

    if (state.connectedSourceId) {
        // CONNECTED: Route through testcase molecule
        const result = set(testcaseMolecule.actions.add, data as Partial<FlattenedTestcase>)
        if (result?.id) {
            // Update active row
            set(loadableStateAtomFamily(loadableId), {
                ...state,
                activeRowId: result.id,
            })
        }
        return result?.id ?? null
    }

    // LOCAL: Keep current behavior
    const rowId = `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const newRow: TestsetRow = {
        id: rowId,
        data: data ?? {},
    }

    set(loadableStateAtomFamily(loadableId), {
        ...state,
        rows: [...state.rows, newRow],
        activeRowId: rowId, // Auto-select new row
    })

    return rowId
})

/**
 * Update a row's data
 * When connected, routes through testcase molecule for proper dirty tracking
 */
const updateRowAtom = atom(
    null,
    (get, set, loadableId: string, rowId: string, data: Record<string, unknown>) => {
        const state = get(loadableStateAtomFamily(loadableId))

        if (state.connectedSourceId) {
            // CONNECTED: Route through testcase molecule
            set(testcaseMolecule.reducers.update, rowId, data as Partial<FlattenedTestcase>)
            return
        }

        // LOCAL: Keep current behavior
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            rows: state.rows.map((row) =>
                row.id === rowId ? {...row, data: {...row.data, ...data}} : row,
            ),
        })
    },
)

/**
 * Remove a row
 * When connected, routes through testcase molecule for proper dirty tracking
 */
const removeRowAtom = atom(null, (get, set, loadableId: string, rowId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    if (state.connectedSourceId) {
        // CONNECTED: Route through testcase molecule
        set(testcaseMolecule.actions.delete, rowId)

        // Update active row if needed
        if (state.activeRowId === rowId) {
            const displayRowIds = get(testcaseMolecule.atoms.displayRowIds)
            const remaining = displayRowIds.filter((id) => id !== rowId)
            set(loadableStateAtomFamily(loadableId), {
                ...state,
                activeRowId: remaining[0] ?? null,
            })
        }
        return
    }

    // LOCAL: Keep current behavior
    const newRows = state.rows.filter((r) => r.id !== rowId)
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        rows: newRows,
        activeRowId: state.activeRowId === rowId ? (newRows[0]?.id ?? null) : state.activeRowId,
    })
})

/**
 * Set the active row
 */
const setActiveRowAtom = atom(null, (get, set, loadableId: string, rowId: string | null) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        activeRowId: rowId,
    })
})

/**
 * Set all rows
 */
const setRowsAtom = atom(null, (get, set, loadableId: string, rows: TestsetRow[]) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        rows,
        activeRowId: rows.length > 0 ? rows[0].id : null,
    })
})

/**
 * Clear all rows
 */
const clearRowsAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        rows: [],
        activeRowId: null,
        executionResults: {},
    })
})

// ============================================================================
// COLUMN ACTIONS
// ============================================================================

/**
 * Set columns
 */
const setColumnsAtom = atom(null, (get, set, loadableId: string, columns: TestsetColumn[]) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        columns,
    })
})

/**
 * Initialize with columns - sets columns and adds initial row if empty
 */
const initializeWithColumnsAtom = atom(
    null,
    (get, set, loadableId: string, columns: TestsetColumn[]) => {
        const state = get(loadableStateAtomFamily(loadableId))

        // Build initial empty data from columns
        const emptyData: Record<string, unknown> = {}
        columns.forEach((col) => {
            emptyData[col.key] = ""
        })

        // Add initial row if no rows exist and not connected
        const shouldAddRow = state.rows.length === 0 && !state.connectedSourceId

        // Generate row ID once to ensure consistency
        const newRowId = `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

        const newState = {
            ...state,
            columns,
            rows: shouldAddRow
                ? [
                      {
                          id: newRowId,
                          data: emptyData,
                      },
                  ]
                : state.rows,
            activeRowId: shouldAddRow ? newRowId : state.activeRowId,
        }

        set(loadableStateAtomFamily(loadableId), newState)
    },
)

/**
 * Add a column
 */
const addColumnAtom = atom(null, (get, set, loadableId: string, column: TestsetColumn) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Add empty value to all rows
    const updatedRows = state.rows.map((row) => ({
        ...row,
        data: {...row.data, [column.key]: ""},
    }))

    set(loadableStateAtomFamily(loadableId), {
        ...state,
        columns: [...state.columns, column],
        rows: updatedRows,
    })
})

/**
 * Remove a column
 */
const removeColumnAtom = atom(null, (get, set, loadableId: string, columnKey: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    // Remove value from all rows
    const updatedRows = state.rows.map((row) => {
        const {[columnKey]: _removed, ...rest} = row.data
        return {...row, data: rest}
    })

    set(loadableStateAtomFamily(loadableId), {
        ...state,
        columns: state.columns.filter((c) => c.key !== columnKey),
        rows: updatedRows,
    })
})

// ============================================================================
// CONNECTION ACTIONS
// ============================================================================

/**
 * Connect to an external source (e.g., testset revision)
 * Uses testcaseMolecule public API for initialization.
 */
const connectToSourceAtom = atom(
    null,
    (
        get,
        set,
        loadableId: string,
        sourceId: string,
        sourceName?: string,
        testcases?: {id: string; [key: string]: unknown}[],
    ) => {
        const state = get(loadableStateAtomFamily(loadableId))
        const queryClient = get(queryClientAtom)
        const projectId = get(projectIdAtom)

        // If testcases provided, populate query cache so data is available immediately
        if (testcases && testcases.length > 0) {
            for (const tc of testcases) {
                queryClient.setQueryData(["testcase", projectId, tc.id], tc as FlattenedTestcase)
            }
        }

        set(loadableStateAtomFamily(loadableId), {
            ...state,
            connectedSourceId: sourceId,
            connectedSourceName: sourceName ?? null,
            rows: [], // Clear local rows - they come from molecule now
        })
    },
)

/**
 * Disconnect from source (switch to local mode)
 */
const disconnectAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        connectedSourceId: null,
        connectedSourceName: null,
    })
})

/**
 * Discard local changes (revert to connected source data)
 */
const discardChangesAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))

    if (state.connectedSourceId) {
        // CONNECTED: Delegate to testcase molecule
        set(testcaseMolecule.reducers.discardAll)
        return
    }

    // LOCAL: Clear local rows
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        rows: [],
    })
})

/**
 * Commit local changes to create a new revision
 */
const commitChangesAtom = atom(
    null,
    async (
        get,
        _set,
        loadableId: string,
        _message?: string,
    ): Promise<{revisionId: string; version: number}> => {
        const state = get(loadableStateAtomFamily(loadableId))

        if (!state.connectedSourceId) {
            throw new Error("Cannot commit: not connected to a source")
        }

        // In a full implementation, this would call the API to create a new revision
        // For now, return a placeholder
        return {
            revisionId: `rev-${Date.now()}`,
            version: 1,
        }
    },
)

// ============================================================================
// RUNNABLE LINKING ACTIONS
// ============================================================================

/**
 * Link to a runnable (columns derive from runnable's inputSchema)
 */
const linkToRunnableAtom = atom(
    null,
    (get, set, loadableId: string, runnableType: RunnableType, runnableId: string) => {
        const state = get(loadableStateAtomFamily(loadableId))
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            linkedRunnableType: runnableType,
            linkedRunnableId: runnableId,
        })
    },
)

/**
 * Unlink from runnable
 */
const unlinkFromRunnableAtom = atom(null, (get, set, loadableId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        linkedRunnableType: null,
        linkedRunnableId: null,
    })
})

// ============================================================================
// EXECUTION STATE ACTIONS
// ============================================================================

/**
 * Set execution result for a row
 */
const setRowExecutionResultAtom = atom(
    null,
    (get, set, loadableId: string, result: RowExecutionResult) => {
        const state = get(loadableStateAtomFamily(loadableId))
        set(loadableStateAtomFamily(loadableId), {
            ...state,
            executionResults: {
                ...state.executionResults,
                [result.rowId]: result,
            },
        })
    },
)

/**
 * Clear execution result for a row
 */
const clearRowExecutionResultAtom = atom(null, (get, set, loadableId: string, rowId: string) => {
    const state = get(loadableStateAtomFamily(loadableId))
    const {[rowId]: _removed, ...rest} = state.executionResults
    set(loadableStateAtomFamily(loadableId), {
        ...state,
        executionResults: rest,
    })
})

// ============================================================================
// CONTROLLER EXPORT
// ============================================================================

/**
 * Testset loadable controller
 */
export const testsetLoadable = {
    selectors: {
        /** Rows for a loadable - uses bridge atom when connected */
        rows: (loadableId: string) => connectedRowsAtomFamily(loadableId),

        /** Columns for a loadable */
        columns: (loadableId: string) => loadableColumnsAtomFamily(loadableId),

        /** All columns for a loadable (not filtered) */
        allColumns: (loadableId: string) => loadableAllColumnsAtomFamily(loadableId),

        /** Active row for a loadable */
        activeRow: (loadableId: string) => loadableActiveRowAtomFamily(loadableId),

        /** Row count for a loadable */
        rowCount: (loadableId: string) => loadableRowCountAtomFamily(loadableId),

        /** Mode for a loadable */
        mode: (loadableId: string) => loadableModeAtomFamily(loadableId),

        /** Is dirty for a loadable */
        isDirty: (loadableId: string) => connectedHasLocalChangesAtomFamily(loadableId),

        /** Has local changes for a loadable */
        hasLocalChanges: (loadableId: string) => connectedHasLocalChangesAtomFamily(loadableId),

        /** Execution results for a loadable */
        executionResults: (loadableId: string) => loadableExecutionResultsAtomFamily(loadableId),

        /** Full data for a loadable */
        data: (loadableId: string) => loadableDataAtomFamily(loadableId),

        /** Connected source for a loadable */
        connectedSource: (loadableId: string) => loadableConnectedSourceAtomFamily(loadableId),

        /** Linked runnable for a loadable */
        linkedRunnable: (loadableId: string) => loadableLinkedRunnableAtomFamily(loadableId),

        /**
         * Whether the linked runnable supports dynamic inputs.
         * This is a placeholder - actual value should come from the runnable's schema.
         * Returns false by default.
         */
        supportsDynamicInputs: (_loadableId: string) =>
            atom((get) => {
                // This would need to be derived from the runnable's inputSchema.additionalProperties
                // For now, return false as a safe default
                void get
                return false
            }),
    },

    actions: {
        /** Add a row */
        addRow: addRowAtom,

        /** Update a row */
        updateRow: updateRowAtom,

        /** Remove a row */
        removeRow: removeRowAtom,

        /** Set active row */
        setActiveRow: setActiveRowAtom,

        /** Set all rows */
        setRows: setRowsAtom,

        /** Clear all rows */
        clearRows: clearRowsAtom,

        /** Set columns */
        setColumns: setColumnsAtom,

        /** Initialize with columns */
        initializeWithColumns: initializeWithColumnsAtom,

        /** Add a column */
        addColumn: addColumnAtom,

        /** Remove a column */
        removeColumn: removeColumnAtom,

        /** Connect to source */
        connectToSource: connectToSourceAtom,

        /** Disconnect from source */
        disconnect: disconnectAtom,

        /** Discard changes */
        discardChanges: discardChangesAtom,

        /** Commit changes */
        commitChanges: commitChangesAtom,

        /** Link to runnable */
        linkToRunnable: linkToRunnableAtom,

        /** Unlink from runnable */
        unlinkFromRunnable: unlinkFromRunnableAtom,

        /** Set row execution result */
        setRowExecutionResult: setRowExecutionResultAtom,

        /** Clear row execution result */
        clearRowExecutionResult: clearRowExecutionResultAtom,
    },
}

/**
 * Unified loadable controller
 * Supports multiple loadable types (testset, span in future)
 */
export const loadableController = {
    /**
     * Testset loadable operations
     */
    testset: testsetLoadable,
}
