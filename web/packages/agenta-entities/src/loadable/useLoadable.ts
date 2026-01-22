/**
 * useLoadable Hook (Optional Convenience Wrapper)
 *
 * This hook is an OPTIONAL convenience wrapper around `loadableBridge`.
 * For better architecture, prefer using `loadableBridge` directly with atoms.
 *
 * ## Recommended: Use loadableBridge directly
 *
 * ```typescript
 * import { loadableBridge } from '@agenta/entities/loadable'
 * import { useAtomValue, useSetAtom } from 'jotai'
 *
 * // Read state via derived atoms (no side effects)
 * const rows = useAtomValue(loadableBridge.selectors.rows(loadableId))
 * const activeRow = useAtomValue(loadableBridge.selectors.activeRow(loadableId))
 *
 * // Write via actions
 * const addRow = useSetAtom(loadableBridge.actions.addRow)
 * addRow(loadableId, { input: 'test' })
 * ```
 *
 * ## Legacy: useLoadable hook
 *
 * ```tsx
 * import { useLoadable } from '@agenta/entities/loadable'
 *
 * const loadable = useLoadable(loadableId)
 * loadable.rows           // TestsetRow[]
 * loadable.activeRow      // TestsetRow | null (derived - returns first row if none selected)
 * loadable.addRow()       // Add empty row
 * ```
 *
 * @deprecated Prefer `loadableBridge` for a more predictable, side-effect-free API
 */

import {useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"

import {loadableController} from "./controller"
import type {
    TestsetRow,
    TestsetColumn,
    RunnableType,
    RowExecutionResult,
    ConnectedSource,
} from "./types"

// Re-export ConnectedSource type for backwards compatibility
export type {ConnectedSource}

/**
 * Return type for useLoadable hook
 */
export interface UseLoadableReturn {
    // Identity
    loadableId: string

    // State
    rows: TestsetRow[]
    /** Columns derived from linked runnable's inputSchema */
    columns: TestsetColumn[]
    /** ALL columns from testset data (not filtered by linked runnable) - use for input mapping */
    allColumns: TestsetColumn[]
    /** Column keys that are new (added from prompt template but not in original testcase data) */
    newColumnKeys: string[]
    activeRow: TestsetRow | null
    activeRowId: string | null
    rowCount: number
    isDirty: boolean
    /** Whether there are local changes in connected mode (draft exists) */
    hasLocalChanges: boolean
    /** Whether the linked runnable supports dynamic inputs (additionalProperties) */
    supportsDynamicInputs: boolean
    mode: "local" | "connected"
    /** @deprecated Use connectedSource.id instead */
    connectedSourceId: string | null
    /** Connected source info (id and display name) - replaces testsetSelection atoms */
    connectedSource: ConnectedSource
    isLoading: boolean

    // Row actions
    addRow: (data?: Record<string, unknown>) => void
    updateRow: (rowId: string, data: Record<string, unknown>) => void
    removeRow: (rowId: string) => void
    setActiveRow: (rowId: string | null) => void
    setRows: (rows: TestsetRow[]) => void
    clearRows: () => void

    // Column actions
    setColumns: (columns: TestsetColumn[]) => void
    /** Initialize with columns - sets columns and adds initial row if in local mode with no rows */
    initializeWithColumns: (columns: TestsetColumn[]) => void
    /** Add a column - adds empty value to all existing rows (makes testset dirty) */
    addColumn: (column: TestsetColumn) => void
    /** Remove a column - removes value from all existing rows (makes testset dirty) */
    removeColumn: (columnKey: string) => void

    // Connection actions
    /** Connect to an external source (e.g., testset revision)
     * @param sourceId - The revision ID to connect to
     * @param sourceName - Optional display name (e.g., "TestsetName v3")
     * @param testcases - Optional testcase data for immediate initialization
     */
    connectToSource: (
        sourceId: string,
        sourceName?: string,
        testcases?: {id: string; [key: string]: unknown}[],
    ) => void
    disconnect: () => void
    /** Discard local changes and revert to connected source data */
    discardChanges: () => void
    /** Commit local changes to create a new revision (only in connected mode) */
    commitChanges: (message?: string) => Promise<{revisionId: string; version: number}>
    /** Update testcase selection (for editing which testcases are included after connection) */
    updateTestcaseSelection: (selectedIds: string[]) => void
    /** Import testcases as new local rows (without changing connection state) */
    importRows: (testcases: Record<string, unknown>[]) => string[]

    // Runnable linking actions
    /** Link to a runnable - columns will be derived from runnable's inputSchema */
    linkToRunnable: (runnableType: RunnableType, runnableId: string) => void
    /** Unlink from runnable */
    unlinkFromRunnable: () => void

    // Execution state (per row)
    /** All execution results keyed by row ID */
    executionResults: Record<string, RowExecutionResult>
    getRowExecutionState: (rowId: string) => {
        status: "idle" | "pending" | "running" | "success" | "error" | "cancelled"
        output?: unknown
        error?: {message: string; code?: string}
    } | null
    /** Set execution result for a row */
    setRowExecutionResult: (result: RowExecutionResult) => void
    /** Clear execution result for a row */
    clearRowExecutionResult: (rowId: string) => void

    // Row state selectors (for UI indicators)
    /** Get row ready state selector (for useAtomValue) */
    getRowReadyStateAtom: (
        rowId: string,
    ) => ReturnType<typeof loadableController.testset.selectors.rowReadyState>
    /** Get row execution stale state selector (for useAtomValue) */
    getRowExecutionStaleStateAtom: (
        rowId: string,
    ) => ReturnType<typeof loadableController.testset.selectors.rowExecutionStaleState>
    /** Get row output mapping override state selector (for useAtomValue) */
    getRowOutputMappingOverrideStateAtom: (
        rowId: string,
    ) => ReturnType<typeof loadableController.testset.selectors.rowOutputMappingOverrideState>
    /** Revert output mapping overrides for a row (restore original values) */
    revertOutputMappingOverrides: (rowId: string) => boolean
}

/**
 * Hook for working with testset loadable entities
 *
 * @param loadableId - The ID of the loadable entity
 * @returns An object with state and actions for the loadable
 */
export function useLoadable(loadableId: string): UseLoadableReturn {
    // Get atoms for this loadable
    const rowsAtom = useMemo(
        () => loadableController.testset.selectors.rows(loadableId),
        [loadableId],
    )
    const activeRowAtom = useMemo(
        () => loadableController.testset.selectors.activeRow(loadableId),
        [loadableId],
    )
    const columnsAtom = useMemo(
        () => loadableController.testset.selectors.columns(loadableId),
        [loadableId],
    )
    const allColumnsAtom = useMemo(
        () => loadableController.testset.selectors.allColumns(loadableId),
        [loadableId],
    )
    const rowCountAtom = useMemo(
        () => loadableController.testset.selectors.rowCount(loadableId),
        [loadableId],
    )
    const modeAtom = useMemo(
        () => loadableController.testset.selectors.mode(loadableId),
        [loadableId],
    )
    const isDirtyAtom = useMemo(
        () => loadableController.testset.selectors.isDirty(loadableId),
        [loadableId],
    )
    const hasLocalChangesAtom = useMemo(
        () => loadableController.testset.selectors.hasLocalChanges(loadableId),
        [loadableId],
    )
    const executionResultsAtom = useMemo(
        () => loadableController.testset.selectors.executionResults(loadableId),
        [loadableId],
    )
    const dataAtom = useMemo(
        () => loadableController.testset.selectors.data(loadableId),
        [loadableId],
    )
    const connectedSourceAtom = useMemo(
        () => loadableController.testset.selectors.connectedSource(loadableId),
        [loadableId],
    )
    const supportsDynamicInputsAtom = useMemo(
        () => loadableController.testset.selectors.supportsDynamicInputs(loadableId),
        [loadableId],
    )
    const newColumnKeysAtom = useMemo(
        () => loadableController.testset.selectors.newColumnKeys(loadableId),
        [loadableId],
    )

    // Subscribe to state
    const rows = useAtomValue(rowsAtom)
    const activeRowIdFromAtom = useAtomValue(activeRowAtom) // Now returns ID, not row
    const columns = useAtomValue(columnsAtom)
    const allColumns = useAtomValue(allColumnsAtom)
    const rowCount = useAtomValue(rowCountAtom)

    // Derive activeRow from rows using activeRowId
    const activeRow = useMemo(() => {
        if (!activeRowIdFromAtom && rows.length > 0) {
            return rows[0] // Default to first row if no explicit selection
        }
        return rows.find((r) => r.id === activeRowIdFromAtom) ?? null
    }, [activeRowIdFromAtom, rows])
    const mode = useAtomValue(modeAtom)
    const isDirty = useAtomValue(isDirtyAtom)
    const hasLocalChanges = useAtomValue(hasLocalChangesAtom)
    const executionResults = useAtomValue(executionResultsAtom)
    const _data = useAtomValue(dataAtom)
    const connectedSource = useAtomValue(connectedSourceAtom)
    const supportsDynamicInputs = useAtomValue(supportsDynamicInputsAtom)
    const newColumnKeys = useAtomValue(newColumnKeysAtom)

    // Get action setters
    // Note: activeRow selector already returns first row if no explicit selection (derived atom)
    const setActiveRowAction = useSetAtom(loadableController.testset.actions.setActiveRow)
    const setAddRow = useSetAtom(loadableController.testset.actions.addRow)
    const setUpdateRow = useSetAtom(loadableController.testset.actions.updateRow)
    const setRemoveRow = useSetAtom(loadableController.testset.actions.removeRow)
    const setRowsAction = useSetAtom(loadableController.testset.actions.setRows)
    const setClearRows = useSetAtom(loadableController.testset.actions.clearRows)
    const setColumnsAction = useSetAtom(loadableController.testset.actions.setColumns)
    const setInitializeWithColumns = useSetAtom(
        loadableController.testset.actions.initializeWithColumns,
    )
    const setAddColumn = useSetAtom(loadableController.testset.actions.addColumn)
    const setRemoveColumn = useSetAtom(loadableController.testset.actions.removeColumn)
    const setConnectToSource = useSetAtom(loadableController.testset.actions.connectToSource)
    const setDisconnect = useSetAtom(loadableController.testset.actions.disconnect)
    const setDiscardChanges = useSetAtom(loadableController.testset.actions.discardChanges)
    const setCommitChanges = useSetAtom(loadableController.testset.actions.commitChanges)
    const setLinkToRunnable = useSetAtom(loadableController.testset.actions.linkToRunnable)
    const setUnlinkFromRunnable = useSetAtom(loadableController.testset.actions.unlinkFromRunnable)
    const setUpdateTestcaseSelection = useSetAtom(
        loadableController.testset.actions.updateTestcaseSelection,
    )
    const setImportRows = useSetAtom(loadableController.testset.actions.importRows)
    const setRowExecutionResultAction = useSetAtom(
        loadableController.testset.actions.setRowExecutionResult,
    )
    const clearRowExecutionResultAction = useSetAtom(
        loadableController.testset.actions.clearRowExecutionResult,
    )
    // Row actions
    const addRow = useCallback(
        (rowData?: Record<string, unknown>) => {
            setAddRow(loadableId, rowData)
        },
        [loadableId, setAddRow],
    )

    const updateRow = useCallback(
        (rowId: string, rowData: Record<string, unknown>) => {
            setUpdateRow(loadableId, rowId, rowData)
        },
        [loadableId, setUpdateRow],
    )

    const removeRow = useCallback(
        (rowId: string) => {
            setRemoveRow(loadableId, rowId)
        },
        [loadableId, setRemoveRow],
    )

    const setActiveRow = useCallback(
        (rowId: string | null) => {
            setActiveRowAction(loadableId, rowId)
        },
        [loadableId, setActiveRowAction],
    )

    const setRows = useCallback(
        (newRows: TestsetRow[]) => {
            setRowsAction(loadableId, newRows)
        },
        [loadableId, setRowsAction],
    )

    const clearRows = useCallback(() => {
        setClearRows(loadableId)
    }, [loadableId, setClearRows])

    // Column actions
    const setColumns = useCallback(
        (newColumns: TestsetColumn[]) => {
            setColumnsAction(loadableId, newColumns)
        },
        [loadableId, setColumnsAction],
    )

    const initializeWithColumns = useCallback(
        (newColumns: TestsetColumn[]) => {
            setInitializeWithColumns(loadableId, newColumns)
        },
        [loadableId, setInitializeWithColumns],
    )

    const addColumn = useCallback(
        (column: TestsetColumn) => {
            setAddColumn(loadableId, column)
        },
        [loadableId, setAddColumn],
    )

    const removeColumn = useCallback(
        (columnKey: string) => {
            setRemoveColumn(loadableId, columnKey)
        },
        [loadableId, setRemoveColumn],
    )

    // Connection actions
    const connectToSource = useCallback(
        (
            sourceId: string,
            sourceName?: string,
            testcases?: {id: string; [key: string]: unknown}[],
        ) => {
            setConnectToSource(loadableId, sourceId, sourceName, testcases)
        },
        [loadableId, setConnectToSource],
    )

    const disconnect = useCallback(() => {
        setDisconnect(loadableId)
    }, [loadableId, setDisconnect])

    const discardChanges = useCallback(() => {
        setDiscardChanges(loadableId)
    }, [loadableId, setDiscardChanges])

    const commitChanges = useCallback(
        (message?: string) => {
            return setCommitChanges(loadableId, message)
        },
        [loadableId, setCommitChanges],
    )

    const updateTestcaseSelection = useCallback(
        (selectedIds: string[]) => {
            setUpdateTestcaseSelection(loadableId, selectedIds)
        },
        [loadableId, setUpdateTestcaseSelection],
    )

    const importRows = useCallback(
        (testcases: Record<string, unknown>[]) => {
            return setImportRows(loadableId, testcases)
        },
        [loadableId, setImportRows],
    )

    // Runnable linking actions
    const linkToRunnable = useCallback(
        (runnableType: RunnableType, runnableId: string) => {
            setLinkToRunnable(loadableId, runnableType, runnableId)
        },
        [loadableId, setLinkToRunnable],
    )

    const unlinkFromRunnable = useCallback(() => {
        setUnlinkFromRunnable(loadableId)
    }, [loadableId, setUnlinkFromRunnable])

    // Execution state getter
    const getRowExecutionState = useCallback(
        (rowId: string) => {
            return executionResults[rowId] ?? null
        },
        [executionResults],
    )

    // Execution state setter
    const setRowExecutionResult = useCallback(
        (result: RowExecutionResult) => {
            setRowExecutionResultAction(loadableId, result)
        },
        [loadableId, setRowExecutionResultAction],
    )

    const clearRowExecutionResult = useCallback(
        (rowId: string) => {
            clearRowExecutionResultAction(loadableId, rowId)
        },
        [loadableId, clearRowExecutionResultAction],
    )

    // Row state selector getters (return atoms for use with useAtomValue)
    const getRowReadyStateAtom = useCallback(
        (rowId: string) => loadableController.testset.selectors.rowReadyState(loadableId, rowId),
        [loadableId],
    )

    const getRowExecutionStaleStateAtom = useCallback(
        (rowId: string) =>
            loadableController.testset.selectors.rowExecutionStaleState(loadableId, rowId),
        [loadableId],
    )

    const getRowOutputMappingOverrideStateAtom = useCallback(
        (rowId: string) =>
            loadableController.testset.selectors.rowOutputMappingOverrideState(loadableId, rowId),
        [loadableId],
    )

    // Revert output mapping overrides action
    const setRevertOutputMappingOverrides = useSetAtom(
        loadableController.testset.actions.revertOutputMappingOverrides,
    )
    const revertOutputMappingOverrides = useCallback(
        (rowId: string) => setRevertOutputMappingOverrides(loadableId, rowId),
        [loadableId, setRevertOutputMappingOverrides],
    )

    return {
        // Identity
        loadableId,

        // State
        rows,
        columns,
        allColumns,
        newColumnKeys,
        activeRow,
        activeRowId: activeRow?.id ?? null,
        rowCount,
        isDirty,
        hasLocalChanges,
        supportsDynamicInputs,
        mode,
        connectedSourceId: connectedSource.id,
        connectedSource,
        isLoading: false, // TODO: Add loading state

        // Row actions
        addRow,
        updateRow,
        removeRow,
        setActiveRow,
        setRows,
        clearRows,

        // Column actions
        setColumns,
        initializeWithColumns,
        addColumn,
        removeColumn,

        // Connection actions
        connectToSource,
        disconnect,
        discardChanges,
        commitChanges,
        updateTestcaseSelection,
        importRows,

        // Runnable linking actions
        linkToRunnable,
        unlinkFromRunnable,

        // Execution state
        executionResults,
        getRowExecutionState,
        setRowExecutionResult,
        clearRowExecutionResult,

        // Row state selectors (for UI indicators)
        getRowReadyStateAtom,
        getRowExecutionStaleStateAtom,
        getRowOutputMappingOverrideStateAtom,
        revertOutputMappingOverrides,
    }
}
