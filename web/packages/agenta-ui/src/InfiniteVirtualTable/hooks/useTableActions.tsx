import {useCallback} from "react"

import {useRouter} from "next/router"

import type {InfiniteTableRowBase} from "../types"

/**
 * Configuration for standard table actions
 */
export interface TableActionsConfig<T extends InfiniteTableRowBase> {
    /** Base URL for navigation (e.g., "/testsets") */
    baseUrl?: string

    /** Callback when viewing details */
    onView?: (record: T) => void

    /** Callback when creating a new item */
    onCreate?: () => void

    /** Callback when cloning an item */
    onClone?: (record: T) => void

    /** Callback when renaming an item */
    onRename?: (record: T) => void

    /** Callback when deleting an item */
    onDelete?: (record: T) => void

    /** Callback when deleting multiple items */
    onDeleteMany?: (records: T[]) => void

    /** Custom ID extractor (default: record.id or record._id) */
    getRecordId?: (record: T) => string
}

export interface TableActionsReturn<T extends InfiniteTableRowBase> {
    /** Navigate to view details */
    handleView: (record: T) => void

    /** Handle clone action */
    handleClone: (record: T) => void

    /** Handle rename action */
    handleRename: (record: T) => void

    /** Handle delete single item */
    handleDelete: (record: T) => void

    /** Handle delete multiple items */
    handleDeleteMany: (records: T[]) => void

    /** Handle create new item */
    handleCreate: () => void
}

/**
 * Hook to create standard CRUD action handlers for tables.
 * Reduces boilerplate for common table actions.
 *
 * @example
 * ```tsx
 * const actions = useTableActions({
 *   baseUrl: `${projectURL}/testsets`,
 *   onClone: (record) => {
 *     setMode("clone")
 *     setEditValues(record)
 *     setModalOpen(true)
 *   },
 *   onDelete: (record) => {
 *     setDeleteTargets([record])
 *     setDeleteModalOpen(true)
 *   },
 * })
 *
 * // Use in column definitions
 * const columns = useTableColumns([
 *   { key: "name", title: "Name" },
 *   {
 *     type: "actions",
 *     items: [
 *       { key: "view", onClick: actions.handleView },
 *       { key: "clone", onClick: actions.handleClone },
 *       { key: "delete", onClick: actions.handleDelete },
 *     ],
 *   },
 * ])
 * ```
 */
export function useTableActions<T extends InfiniteTableRowBase>(
    config: TableActionsConfig<T> = {},
): TableActionsReturn<T> {
    const router = useRouter()
    const {baseUrl, onView, onCreate, onClone, onRename, onDelete, onDeleteMany, getRecordId} =
        config

    const defaultGetId = useCallback(
        (record: T): string => {
            if (getRecordId) return getRecordId(record)
            // Try common ID fields
            const rec = record as Record<string, unknown>
            const id = rec.id || rec._id || rec.key
            if (typeof id === "string") return id
            throw new Error("Could not extract ID from record. Provide getRecordId function.")
        },
        [getRecordId],
    )

    const handleView = useCallback(
        (record: T) => {
            if (onView) {
                onView(record)
                return
            }

            // Default behavior: navigate to detail page
            if (baseUrl) {
                const id = defaultGetId(record)
                router.push(`${baseUrl}/${id}`)
            }
        },
        [baseUrl, defaultGetId, onView, router],
    )

    const handleClone = useCallback(
        (record: T) => {
            if (onClone) {
                onClone(record)
            }
        },
        [onClone],
    )

    const handleRename = useCallback(
        (record: T) => {
            if (onRename) {
                onRename(record)
            }
        },
        [onRename],
    )

    const handleDelete = useCallback(
        (record: T) => {
            if (onDelete) {
                onDelete(record)
            }
        },
        [onDelete],
    )

    const handleDeleteMany = useCallback(
        (records: T[]) => {
            if (onDeleteMany) {
                onDeleteMany(records)
            }
        },
        [onDeleteMany],
    )

    const handleCreate = useCallback(() => {
        if (onCreate) {
            onCreate()
        }
    }, [onCreate])

    return {
        handleView,
        handleClone,
        handleRename,
        handleDelete,
        handleDeleteMany,
        handleCreate,
    }
}
