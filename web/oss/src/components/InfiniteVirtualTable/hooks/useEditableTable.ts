import {useCallback, useMemo, useState} from "react"

import type {InfiniteTableRowBase} from "../types"

export interface EditableTableColumn {
    /** Column key/dataIndex */
    key: string
    /** Display name */
    name: string
}

export interface EditableTableConfig<Row extends InfiniteTableRowBase> {
    /** Initial columns derived from data or provided explicitly */
    initialColumns?: EditableTableColumn[]
    /** System fields to exclude when deriving columns from row data */
    systemFields?: string[]
    /** Callback when a cell value changes */
    onCellChange?: (rowId: string, columnKey: string, value: unknown) => void
    /** Callback when columns change (add/rename/delete) */
    onColumnsChange?: (columns: EditableTableColumn[]) => void
    /** Callback when rows are added */
    onRowsAdd?: (rows: Row[]) => void
    /** Callback when rows are deleted */
    onRowsDelete?: (rowIds: string[]) => void
    /** Generate a new row with default values */
    createNewRow?: () => Partial<Row>
}

export interface EditableTableState<Row extends InfiniteTableRowBase> {
    /** Current columns */
    columns: EditableTableColumn[]
    /** Local edits map: rowId -> { columnKey: value } */
    localEdits: Map<string, Record<string, unknown>>
    /** New rows not yet persisted */
    newRows: Row[]
    /** Row IDs marked for deletion */
    deletedRowIds: Set<string>
    /** Whether there are unsaved changes */
    hasUnsavedChanges: boolean
    /** Derive columns from first row data */
    deriveColumnsFromRow: (row: Row) => void
}

export interface EditableTableActions<Row extends InfiniteTableRowBase> {
    /** Edit a cell value. Pass originalValue to auto-clear edit when value matches original. */
    editCell: (rowId: string, columnKey: string, value: unknown, originalValue?: unknown) => void
    /** Add a new row and return it */
    addRow: () => Row
    /** Delete rows by IDs */
    deleteRows: (rowIds: string[]) => void
    /** Add a new column */
    addColumn: (name: string) => boolean
    /** Rename a column */
    renameColumn: (oldName: string, newName: string) => boolean
    /** Delete a column */
    deleteColumn: (columnKey: string) => void
    /** Set columns explicitly */
    setColumns: (columns: EditableTableColumn[]) => void
    /** Get the display value for a cell (with local edits applied) */
    getCellValue: (row: Row, columnKey: string) => unknown
    /** Get all rows with edits applied and new rows included */
    getDisplayRows: (serverRows: Row[]) => Row[]
    /** Get final row data for saving (only column values) */
    getFinalRowData: (serverRows: Row[]) => Record<string, unknown>[]
    /** Clear all local state (after save) */
    clearLocalState: () => void
    /** Mark changes as saved */
    markAsSaved: () => void
}

const DEFAULT_SYSTEM_FIELDS = ["id", "key", "created_at", "updated_at", "__isSkeleton"]

export function useEditableTable<Row extends InfiniteTableRowBase>(
    config: EditableTableConfig<Row> = {},
): [EditableTableState<Row>, EditableTableActions<Row>] {
    const {
        initialColumns = [],
        systemFields = DEFAULT_SYSTEM_FIELDS,
        onCellChange,
        onColumnsChange,
        onRowsAdd,
        onRowsDelete,
        createNewRow,
    } = config

    const [columns, setColumnsState] = useState<EditableTableColumn[]>(initialColumns)
    const [originalColumns, setOriginalColumns] = useState<EditableTableColumn[]>(initialColumns)
    const [localEdits, setLocalEdits] = useState<Map<string, Record<string, unknown>>>(new Map())
    const [newRows, setNewRows] = useState<Row[]>([])
    const [deletedRowIds, setDeletedRowIds] = useState<Set<string>>(new Set())

    const systemFieldsSet = useMemo(() => new Set(systemFields), [systemFields])

    // Edit a cell value
    const editCell = useCallback(
        (rowId: string, columnKey: string, value: unknown, originalValue?: unknown) => {
            const isNewRow = newRows.some((r) => String(r.key) === rowId || r.id === rowId)

            if (isNewRow) {
                setNewRows((prev) =>
                    prev.map((r) => {
                        if (String(r.key) === rowId || r.id === rowId) {
                            return {...r, [columnKey]: value}
                        }
                        return r
                    }),
                )
            } else {
                setLocalEdits((prev) => {
                    const next = new Map(prev)
                    const existing = next.get(rowId) || {}

                    // If value matches original, remove this edit
                    if (originalValue !== undefined && value === originalValue) {
                        const {[columnKey]: _removed, ...rest} = existing
                        if (Object.keys(rest).length === 0) {
                            next.delete(rowId)
                        } else {
                            next.set(rowId, rest)
                        }
                    } else {
                        next.set(rowId, {...existing, [columnKey]: value})
                    }

                    return next
                })
            }

            onCellChange?.(rowId, columnKey, value)
        },
        [newRows, onCellChange],
    )

    // Add a new row
    const addRow = useCallback((): Row => {
        const timestamp = Date.now()
        const baseRow = createNewRow?.() || {}
        const newRow = {
            key: `new-${timestamp}`,
            id: `new-${timestamp}`,
            __isSkeleton: false,
            ...baseRow,
        } as unknown as Row

        // Initialize all columns with empty strings
        columns.forEach((col) => {
            if (!(col.key in newRow)) {
                ;(newRow as Record<string, unknown>)[col.key] = ""
            }
        })

        setNewRows((prev) => [...prev, newRow])
        onRowsAdd?.([newRow])
        return newRow
    }, [columns, createNewRow, onRowsAdd])

    // Delete rows
    const deleteRows = useCallback(
        (rowIds: string[]) => {
            const newRowKeys = new Set(newRows.map((r) => String(r.key)))
            const existingToDelete = rowIds.filter((id) => !newRowKeys.has(id))
            const newToDelete = rowIds.filter((id) => newRowKeys.has(id))

            if (newToDelete.length > 0) {
                setNewRows((prev) => prev.filter((r) => !newToDelete.includes(String(r.key))))
            }

            if (existingToDelete.length > 0) {
                setDeletedRowIds((prev) => {
                    const next = new Set(prev)
                    existingToDelete.forEach((id) => next.add(id))
                    return next
                })
            }

            onRowsDelete?.(rowIds)
        },
        [newRows, onRowsDelete],
    )

    // Add a new column
    const addColumn = useCallback(
        (name: string): boolean => {
            const trimmedName = name.trim()
            if (!trimmedName) return false
            if (columns.some((c) => c.key === trimmedName || c.name === trimmedName)) return false

            const newColumn: EditableTableColumn = {key: trimmedName, name: trimmedName}
            const newColumns = [...columns, newColumn]
            setColumnsState(newColumns)
            onColumnsChange?.(newColumns)
            return true
        },
        [columns, onColumnsChange],
    )

    // Rename a column
    const renameColumn = useCallback(
        (oldName: string, newName: string): boolean => {
            const trimmedNewName = newName.trim()
            if (!trimmedNewName) return false
            if (oldName === trimmedNewName) return true
            if (columns.some((c) => c.key === trimmedNewName && c.key !== oldName)) return false

            const newColumns = columns.map((c) =>
                c.key === oldName ? {key: trimmedNewName, name: trimmedNewName} : c,
            )
            setColumnsState(newColumns)

            // Update local edits to use new key
            setLocalEdits((prev) => {
                const next = new Map<string, Record<string, unknown>>()
                prev.forEach((edits, rowId) => {
                    const newEdits: Record<string, unknown> = {}
                    Object.entries(edits).forEach(([key, value]) => {
                        newEdits[key === oldName ? trimmedNewName : key] = value
                    })
                    next.set(rowId, newEdits)
                })
                return next
            })

            // Update new rows
            setNewRows((prev) =>
                prev.map((r) => {
                    if (oldName in r) {
                        const newRow = {...r}
                        ;(newRow as Record<string, unknown>)[trimmedNewName] = r[oldName]
                        delete (newRow as Record<string, unknown>)[oldName]
                        return newRow
                    }
                    return r
                }),
            )

            onColumnsChange?.(newColumns)
            return true
        },
        [columns, onColumnsChange],
    )

    // Delete a column
    const deleteColumn = useCallback(
        (columnKey: string) => {
            const newColumns = columns.filter((c) => c.key !== columnKey)
            setColumnsState(newColumns)

            // Remove from local edits
            setLocalEdits((prev) => {
                const next = new Map<string, Record<string, unknown>>()
                prev.forEach((edits, rowId) => {
                    const newEdits: Record<string, unknown> = {}
                    Object.entries(edits).forEach(([key, value]) => {
                        if (key !== columnKey) {
                            newEdits[key] = value
                        }
                    })
                    if (Object.keys(newEdits).length > 0) {
                        next.set(rowId, newEdits)
                    }
                })
                return next
            })

            // Remove from new rows
            setNewRows((prev) =>
                prev.map((r) => {
                    const newRow = {...r}
                    delete (newRow as Record<string, unknown>)[columnKey]
                    return newRow
                }),
            )

            onColumnsChange?.(newColumns)
        },
        [columns, onColumnsChange],
    )

    // Set columns explicitly
    const setColumns = useCallback(
        (newColumns: EditableTableColumn[]) => {
            setColumnsState(newColumns)
            onColumnsChange?.(newColumns)
        },
        [onColumnsChange],
    )

    // Get cell value with local edits applied
    const getCellValue = useCallback(
        (row: Row, columnKey: string): unknown => {
            // Always use row.key as the unique identifier
            const rowKey = String(row.key)
            const edits = localEdits.get(rowKey)
            if (edits && columnKey in edits) {
                return edits[columnKey]
            }
            return row[columnKey]
        },
        [localEdits],
    )

    // Get display rows with edits applied
    // New rows are prepended at the top to avoid UX issues with infinite scrolling
    const getDisplayRows = useCallback(
        (serverRows: Row[]): Row[] => {
            const filteredRows = serverRows
                .filter((row) => {
                    // Always use row.key as the unique identifier
                    const rowKey = String(row.key)
                    return !deletedRowIds.has(rowKey)
                })
                .map((row) => {
                    const rowKey = String(row.key)
                    const edits = localEdits.get(rowKey)
                    if (edits) {
                        return {...row, ...edits}
                    }
                    return row
                })

            // Prepend new rows at the top (reversed so newest is first)
            return [...newRows.slice().reverse(), ...filteredRows]
        },
        [deletedRowIds, localEdits, newRows],
    )

    // Get final row data for saving
    const getFinalRowData = useCallback(
        (serverRows: Row[]): Record<string, unknown>[] => {
            const displayRows = getDisplayRows(serverRows)
            return displayRows.map((row) => {
                const rowData: Record<string, unknown> = {}
                columns.forEach((col) => {
                    rowData[col.key] = row[col.key] ?? ""
                })
                return rowData
            })
        },
        [columns, getDisplayRows],
    )

    // Clear local state
    const clearLocalState = useCallback(() => {
        setLocalEdits(new Map())
        setNewRows([])
        setDeletedRowIds(new Set())
        // Also sync original columns with current columns after save
        setOriginalColumns(columns)
    }, [columns])

    // Mark as saved (syncs original columns with current)
    const markAsSaved = useCallback(() => {
        setOriginalColumns(columns)
    }, [columns])

    // Derive columns from first row if not set
    const deriveColumnsFromRow = useCallback(
        (row: Row) => {
            if (columns.length > 0) return

            const dynamicCols = Object.keys(row)
                .filter((key) => !systemFieldsSet.has(key))
                .map((key) => ({key, name: key}))

            if (dynamicCols.length > 0) {
                setColumnsState(dynamicCols)
                setOriginalColumns(dynamicCols) // Track original columns from server
                onColumnsChange?.(dynamicCols)
            }
        },
        [columns.length, systemFieldsSet, onColumnsChange],
    )

    // Compute hasUnsavedChanges based on actual differences
    const hasUnsavedChanges = useMemo(() => {
        // Check for new rows
        if (newRows.length > 0) return true

        // Check for deleted rows
        if (deletedRowIds.size > 0) return true

        // Check for local edits (cell changes)
        if (localEdits.size > 0) return true

        // Check for column changes (added, removed, or renamed)
        if (columns.length !== originalColumns.length) return true

        // Check if any column was renamed or reordered
        const columnsChanged = columns.some((col, index) => {
            const origCol = originalColumns[index]
            return !origCol || col.key !== origCol.key || col.name !== origCol.name
        })
        if (columnsChanged) return true

        return false
    }, [newRows.length, deletedRowIds.size, localEdits.size, columns, originalColumns])

    const state: EditableTableState<Row> = {
        columns,
        localEdits,
        newRows,
        deletedRowIds,
        hasUnsavedChanges,
        deriveColumnsFromRow,
    }

    const actions: EditableTableActions<Row> = useMemo(
        () => ({
            editCell,
            addRow,
            deleteRows,
            addColumn,
            renameColumn,
            deleteColumn,
            setColumns,
            getCellValue,
            getDisplayRows,
            getFinalRowData,
            clearLocalState,
            markAsSaved,
        }),
        [
            editCell,
            addRow,
            deleteRows,
            addColumn,
            renameColumn,
            deleteColumn,
            setColumns,
            getCellValue,
            getDisplayRows,
            getFinalRowData,
            clearLocalState,
            markAsSaved,
        ],
    )

    return [state, actions]
}

export default useEditableTable
