/**
 * Revision Table State
 *
 * Provides revision-level state for testcase tables.
 * Columns and rows are managed at the revision level, not testcase level.
 *
 * @example
 * ```typescript
 * // Read effective columns (base + pending adds - pending removes)
 * const columns = useAtomValue(effectiveColumnsAtomFamily(revisionId))
 *
 * // Read effective row IDs (server + pending adds - pending removes)
 * const rowIds = useAtomValue(effectiveRowIdsAtomFamily(revisionId))
 *
 * // Add a column
 * const addColumn = useSetAtom(addColumnReducer)
 * addColumn({ revisionId, columnKey: 'new_column' })
 *
 * // Add a row
 * const addRow = useSetAtom(addRowReducer)
 * const newId = addRow({ revisionId, initialData: { name: 'Test' } })
 * ```
 */

import {atom} from "jotai"
import type {Atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {FlattenedTestcase} from "../../testcase/core"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Column definition for table display
 */
export interface TableColumn {
    key: string
    label: string
    parentKey?: string // For grouped columns (e.g., "meta.field" has parentKey "meta")
}

/**
 * Column rename operation
 */
export interface ColumnRenameOp {
    oldKey: string
    newKey: string
}

/**
 * Pending column operations for a revision
 */
export interface PendingColumnOps {
    add: string[]
    remove: string[]
    rename: ColumnRenameOp[]
}

/**
 * Pending row operations for a revision
 */
export interface PendingRowOps {
    add: string[] // New row IDs (local entities)
    remove: string[] // Row IDs marked for deletion
}

/**
 * Row reference for table display
 */
export interface RowRef {
    id: string
    key: string
    __isNew?: boolean
    __isDeleted?: boolean
}

// ============================================================================
// INITIAL VALUES
// ============================================================================

const EMPTY_COLUMN_OPS: PendingColumnOps = {
    add: [],
    remove: [],
    rename: [],
}

const EMPTY_ROW_OPS: PendingRowOps = {
    add: [],
    remove: [],
}

// ============================================================================
// PENDING OPERATIONS ATOMS (per revision)
// ============================================================================

/**
 * Pending column operations per revision
 */
export const pendingColumnOpsAtomFamily = atomFamily((_revisionId: string) =>
    atom<PendingColumnOps>({...EMPTY_COLUMN_OPS}),
)

/**
 * Pending row operations per revision
 */
export const pendingRowOpsAtomFamily = atomFamily((_revisionId: string) =>
    atom<PendingRowOps>({...EMPTY_ROW_OPS}),
)

// ============================================================================
// BASE COLUMNS FROM REVISION DATA
// We'll import this from revisionMolecule - for now define the type
// ============================================================================

/**
 * Dependency: Base columns atom family from revision molecule
 * This will be injected when creating the extension
 */
export type BaseColumnsAtomFamily = (revisionId: string) => Atom<TableColumn[]>

/**
 * Dependency: Server row IDs atom family from revision molecule
 * This will be injected when creating the extension
 */
export type ServerRowIdsAtomFamily = (revisionId: string) => Atom<string[]>

// ============================================================================
// EFFECTIVE STATE FACTORIES
// These create atoms that merge base state with pending operations
// ============================================================================

/**
 * Create effective columns atom factory
 * Merges base columns with pending column operations
 */
export function createEffectiveColumnsAtomFamily(
    baseColumnsAtomFamily: BaseColumnsAtomFamily,
): (revisionId: string) => Atom<TableColumn[]> {
    return atomFamily((revisionId: string) =>
        atom((get): TableColumn[] => {
            const baseColumns = get(baseColumnsAtomFamily(revisionId))
            const ops = get(pendingColumnOpsAtomFamily(revisionId))

            // Start with base columns
            let columns = [...baseColumns]

            // Apply renames
            for (const rename of ops.rename) {
                columns = columns.map((col) => {
                    if (col.key === rename.oldKey) {
                        return {...col, key: rename.newKey, label: rename.newKey}
                    }
                    // Also rename parentKey if it matches
                    if (col.parentKey === rename.oldKey) {
                        return {...col, parentKey: rename.newKey}
                    }
                    return col
                })
            }

            // Remove deleted columns
            columns = columns.filter((col) => !ops.remove.includes(col.key))

            // Add new columns
            for (const newKey of ops.add) {
                if (!columns.some((col) => col.key === newKey)) {
                    columns.push({key: newKey, label: newKey})
                }
            }

            return columns
        }),
    )
}

/**
 * Create effective row IDs atom factory
 * Merges server row IDs with pending row operations
 */
export function createEffectiveRowIdsAtomFamily(
    serverRowIdsAtomFamily: ServerRowIdsAtomFamily,
): (revisionId: string) => Atom<string[]> {
    return atomFamily((revisionId: string) =>
        atom((get): string[] => {
            const serverIds = get(serverRowIdsAtomFamily(revisionId))
            const ops = get(pendingRowOpsAtomFamily(revisionId))

            // Start with server IDs, excluding removed ones
            const effectiveIds = serverIds.filter((id) => !ops.remove.includes(id))

            // Add new IDs at the end
            return [...effectiveIds, ...ops.add]
        }),
    )
}

/**
 * Create row refs atom factory
 * Returns row refs with metadata (__isNew, __isDeleted)
 */
export function createRowRefsAtomFamily(
    serverRowIdsAtomFamily: ServerRowIdsAtomFamily,
): (revisionId: string) => Atom<RowRef[]> {
    return atomFamily((revisionId: string) =>
        atom((get): RowRef[] => {
            const serverIds = get(serverRowIdsAtomFamily(revisionId))
            const ops = get(pendingRowOpsAtomFamily(revisionId))

            const refs: RowRef[] = []

            // Server rows (mark deleted ones)
            for (const id of serverIds) {
                refs.push({
                    id,
                    key: id,
                    __isNew: false,
                    __isDeleted: ops.remove.includes(id),
                })
            }

            // New rows
            for (const id of ops.add) {
                refs.push({
                    id,
                    key: id,
                    __isNew: true,
                    __isDeleted: false,
                })
            }

            return refs
        }),
    )
}

// ============================================================================
// REDUCERS
// ============================================================================

/**
 * Add column reducer
 */
export const addColumnReducer = atom<
    null,
    [{revisionId: string; columnKey: string; defaultValue?: unknown}],
    void
>(null, (get, set, {revisionId, columnKey}) => {
    const ops = get(pendingColumnOpsAtomFamily(revisionId))

    // Don't add if already exists in add list
    if (ops.add.includes(columnKey)) {
        return
    }

    // If it was previously removed, un-remove it instead of adding
    if (ops.remove.includes(columnKey)) {
        set(pendingColumnOpsAtomFamily(revisionId), {
            ...ops,
            remove: ops.remove.filter((k) => k !== columnKey),
        })
        return
    }

    set(pendingColumnOpsAtomFamily(revisionId), {
        ...ops,
        add: [...ops.add, columnKey],
    })
})

/**
 * Remove column reducer
 */
export const removeColumnReducer = atom<null, [{revisionId: string; columnKey: string}], void>(
    null,
    (get, set, {revisionId, columnKey}) => {
        const ops = get(pendingColumnOpsAtomFamily(revisionId))

        // If it was pending add, just remove from add list
        if (ops.add.includes(columnKey)) {
            set(pendingColumnOpsAtomFamily(revisionId), {
                ...ops,
                add: ops.add.filter((k) => k !== columnKey),
            })
            return
        }

        // Don't add if already in remove list
        if (ops.remove.includes(columnKey)) return

        set(pendingColumnOpsAtomFamily(revisionId), {
            ...ops,
            remove: [...ops.remove, columnKey],
        })
    },
)

/**
 * Rename column reducer
 */
export const renameColumnReducer = atom<
    null,
    [{revisionId: string; oldKey: string; newKey: string}],
    void
>(null, (get, set, {revisionId, oldKey, newKey}) => {
    const ops = get(pendingColumnOpsAtomFamily(revisionId))

    // If renaming a pending add, update the add list instead
    if (ops.add.includes(oldKey)) {
        set(pendingColumnOpsAtomFamily(revisionId), {
            ...ops,
            add: ops.add.map((k) => (k === oldKey ? newKey : k)),
        })
        return
    }

    // Check if already renamed - update the existing rename
    const existingRenameIdx = ops.rename.findIndex(
        (r) => r.oldKey === oldKey || r.newKey === oldKey,
    )
    if (existingRenameIdx >= 0) {
        const existing = ops.rename[existingRenameIdx]
        const updatedRenames = [...ops.rename]
        updatedRenames[existingRenameIdx] = {
            oldKey: existing.oldKey,
            newKey,
        }
        set(pendingColumnOpsAtomFamily(revisionId), {
            ...ops,
            rename: updatedRenames,
        })
        return
    }

    set(pendingColumnOpsAtomFamily(revisionId), {
        ...ops,
        rename: [...ops.rename, {oldKey, newKey}],
    })
})

/**
 * Add row reducer
 * Adds a row ID to pending adds
 * If no ID is provided, generates a new one
 */
let rowIdCounter = 0
export const addRowReducer = atom<
    null,
    [{revisionId: string; rowId?: string; initialData?: Partial<FlattenedTestcase>}],
    string
>(null, (get, set, {revisionId, rowId, initialData}) => {
    // Use provided ID or generate a new one
    const newId =
        rowId ??
        (() => {
            rowIdCounter++
            return `new-${Date.now()}-${rowIdCounter}`
        })()

    const ops = get(pendingRowOpsAtomFamily(revisionId))

    // Don't add if already in the list
    if (ops.add.includes(newId)) {
        return newId
    }

    set(pendingRowOpsAtomFamily(revisionId), {
        ...ops,
        add: [...ops.add, newId],
    })

    // Return the ID - caller is responsible for creating the testcase entity
    return newId
})

/**
 * Remove row reducer
 * Marks a row for deletion (or removes from pending adds if new)
 */
export const removeRowReducer = atom<null, [{revisionId: string; rowId: string}], void>(
    null,
    (get, set, {revisionId, rowId}) => {
        const ops = get(pendingRowOpsAtomFamily(revisionId))

        // If it's a pending add, just remove from add list
        if (ops.add.includes(rowId)) {
            set(pendingRowOpsAtomFamily(revisionId), {
                ...ops,
                add: ops.add.filter((id) => id !== rowId),
            })
            return
        }

        // Don't add if already in remove list
        if (ops.remove.includes(rowId)) return

        set(pendingRowOpsAtomFamily(revisionId), {
            ...ops,
            remove: [...ops.remove, rowId],
        })
    },
)

/**
 * Remove multiple rows reducer
 */
export const removeRowsReducer = atom<null, [{revisionId: string; rowIds: string[]}], void>(
    null,
    (get, set, {revisionId, rowIds}) => {
        const ops = get(pendingRowOpsAtomFamily(revisionId))

        // Separate pending adds vs server rows
        const pendingToRemove = rowIds.filter((id) => ops.add.includes(id))
        const serverToRemove = rowIds.filter(
            (id) => !ops.add.includes(id) && !ops.remove.includes(id),
        )

        set(pendingRowOpsAtomFamily(revisionId), {
            ...ops,
            add: ops.add.filter((id) => !pendingToRemove.includes(id)),
            remove: [...ops.remove, ...serverToRemove],
        })
    },
)

/**
 * Clear all pending operations for a revision
 */
export const clearPendingOpsReducer = atom<null, [revisionId: string], void>(
    null,
    (_get, set, revisionId) => {
        set(pendingColumnOpsAtomFamily(revisionId), {...EMPTY_COLUMN_OPS})
        set(pendingRowOpsAtomFamily(revisionId), {...EMPTY_ROW_OPS})
    },
)

// ============================================================================
// DIRTY STATE
// ============================================================================

/**
 * Check if revision has pending changes (columns or rows)
 */
export const hasPendingChangesAtomFamily = atomFamily((revisionId: string) =>
    atom((get): boolean => {
        const colOps = get(pendingColumnOpsAtomFamily(revisionId))
        const rowOps = get(pendingRowOpsAtomFamily(revisionId))

        return (
            colOps.add.length > 0 ||
            colOps.remove.length > 0 ||
            colOps.rename.length > 0 ||
            rowOps.add.length > 0 ||
            rowOps.remove.length > 0
        )
    }),
)

// ============================================================================
// IMPERATIVE API
// ============================================================================

function getStore() {
    return getDefaultStore()
}

export const revisionTableState = {
    atoms: {
        pendingColumnOps: pendingColumnOpsAtomFamily,
        pendingRowOps: pendingRowOpsAtomFamily,
        hasPendingChanges: hasPendingChangesAtomFamily,
    },
    reducers: {
        addColumn: addColumnReducer,
        removeColumn: removeColumnReducer,
        renameColumn: renameColumnReducer,
        addRow: addRowReducer,
        removeRow: removeRowReducer,
        removeRows: removeRowsReducer,
        clearPendingOps: clearPendingOpsReducer,
    },
    factories: {
        createEffectiveColumnsAtomFamily,
        createEffectiveRowIdsAtomFamily,
        createRowRefsAtomFamily,
    },
    get: {
        pendingColumnOps: (revisionId: string) =>
            getStore().get(pendingColumnOpsAtomFamily(revisionId)),
        pendingRowOps: (revisionId: string) => getStore().get(pendingRowOpsAtomFamily(revisionId)),
        hasPendingChanges: (revisionId: string) =>
            getStore().get(hasPendingChangesAtomFamily(revisionId)),
    },
    set: {
        addColumn: (params: {revisionId: string; columnKey: string}) =>
            getStore().set(addColumnReducer, params),
        removeColumn: (params: {revisionId: string; columnKey: string}) =>
            getStore().set(removeColumnReducer, params),
        renameColumn: (params: {revisionId: string; oldKey: string; newKey: string}) =>
            getStore().set(renameColumnReducer, params),
        addRow: (params: {revisionId: string; initialData?: Partial<FlattenedTestcase>}) =>
            getStore().set(addRowReducer, params),
        removeRow: (params: {revisionId: string; rowId: string}) =>
            getStore().set(removeRowReducer, params),
        removeRows: (params: {revisionId: string; rowIds: string[]}) =>
            getStore().set(removeRowsReducer, params),
        clearPendingOps: (revisionId: string) => getStore().set(clearPendingOpsReducer, revisionId),
    },
}
