import type {Key, MouseEvent, RefObject} from "react"
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {Grid} from "antd"
import type {ColumnsType} from "antd/es/table"
import clsx from "clsx"

import type {InfiniteDatasetStore} from "../createInfiniteDatasetStore"
import type {
    TableScopeConfig,
    TableFeaturePagination,
    InfiniteVirtualTableFeatureProps,
    TableDeleteConfig,
    TableExportConfig,
} from "../features/InfiniteVirtualTableFeatureShell"
import type {
    InfiniteTableRowBase,
    InfiniteVirtualTableProps,
    InfiniteVirtualTableRowSelection,
} from "../types"

import useTableExport from "./useTableExport"

/**
 * Helper to detect if a click event should be ignored for row navigation
 * Returns true if the click was on an interactive element (button, link, dropdown, etc.)
 */
export const shouldIgnoreRowClick = (event: MouseEvent<HTMLElement>): boolean => {
    const target = event.target as HTMLElement

    // Check if clicking on interactive elements
    if (
        target.closest("button") ||
        target.closest("a") ||
        target.closest(".ant-dropdown-trigger") ||
        target.closest(".ant-checkbox-wrapper") ||
        target.closest(".ant-select") ||
        target.closest("input") ||
        target.closest("textarea")
    ) {
        return true
    }

    return false
}

export interface UseTableManagerConfig<T extends InfiniteTableRowBase> {
    /** The dataset store for this table */
    datasetStore: InfiniteDatasetStore<T, any, any>

    /** Unique scope ID for this table instance */
    scopeId: string

    /** Number of items per page (default: 50) */
    pageSize?: number

    /** Row height in pixels (default: 48) */
    rowHeight?: number

    /** Callback when a row is clicked */
    onRowClick?: (record: T) => void

    /** Dependencies that should trigger pagination reset (e.g., search term) */
    searchDeps?: any[]

    /** Whether rows should be clickable (default: true) */
    clickableRows?: boolean

    /** Custom className for rows */
    rowClassName?: string | ((record: T) => string)

    /** Storage key for column visibility persistence */
    columnVisibilityStorageKey?: string | null

    /** Enable infinite scroll (default: true) */
    enableInfiniteScroll?: boolean

    /** Callback when bulk delete is triggered */
    onBulkDelete?: (records: T[]) => void

    /** Label for delete button (default: "Delete") */
    deleteLabel?: string

    /** Tooltip when delete is disabled (default: "Select items to delete") */
    deleteDisabledTooltip?: string

    /** Label for export button (default: "Export CSV") */
    exportLabel?: string

    /** Tooltip when export is disabled (default: "Select items to export") */
    exportDisabledTooltip?: string

    /** Filename for CSV export (default: "table-export.csv") */
    exportFilename?: string
}

export interface UseTableManagerReturn<T extends InfiniteTableRowBase> {
    /** Pagination state and controls */
    pagination: ReturnType<InfiniteDatasetStore<T, any, any>["hooks"]["usePagination"]>

    /** Selected row keys */
    selectedRowKeys: Key[]

    /** Update selected row keys */
    setSelectedRowKeys: (keys: Key[] | ((prev: Key[]) => Key[])) => void

    /** Row selection configuration for the table */
    rowSelection: InfiniteVirtualTableRowSelection<T>

    /** Table props configuration */
    tableProps: InfiniteVirtualTableProps<T>["tableProps"]

    /** Table scope configuration */
    tableScope: TableScopeConfig

    /** Pagination configuration for FeatureShell */
    tablePagination: TableFeaturePagination<T>

    /** Get currently selected records */
    getSelectedRecords: () => T[]

    /** Clear selection */
    clearSelection: () => void

    /** Whether running on narrow screen (< lg breakpoint) */
    isNarrowScreen: boolean

    /** Delete action config for the shell */
    deleteAction: TableDeleteConfig | undefined

    /** Export action config for the shell */
    exportAction: TableExportConfig | undefined

    /** Handler to export a single row */
    handleExportRow: (record: T) => Promise<void>

    /** Whether a row is currently being exported */
    rowExportingKey: string | null

    /** Ref to store current columns for export */
    columnsRef: RefObject<ColumnsType<T> | null>

    /** Spread these props directly to InfiniteVirtualTableFeatureShell */
    shellProps: Pick<
        InfiniteVirtualTableFeatureProps<T>,
        | "datasetStore"
        | "tableScope"
        | "pagination"
        | "rowSelection"
        | "tableProps"
        | "deleteAction"
        | "exportAction"
        | "useSettingsDropdown"
        | "rowKey"
    >
}

/**
 * Hook to manage common table setup and reduce boilerplate.
 *
 * Consolidates:
 * - Pagination setup and auto-reset
 * - Row selection state and config
 * - Row click handlers with smart ignore logic
 * - Table props with sensible defaults
 * - Scope and pagination configs
 *
 * @example
 * ```tsx
 * const table = useTableManager({
 *   datasetStore: testsetsDatasetStore,
 *   scopeId: "testsets-page",
 *   pageSize: 50,
 *   onRowClick: (record) => router.push(`/testsets/${record._id}`),
 *   searchDeps: [searchTerm],
 * })
 *
 * return (
 *   <InfiniteVirtualTableFeatureShell
 *     tableScope={table.tableScope}
 *     pagination={table.tablePagination}
 *     rowSelection={table.rowSelection}
 *     tableProps={table.tableProps}
 *     // ... other props
 *   />
 * )
 * ```
 */
export function useTableManager<T extends InfiniteTableRowBase>({
    datasetStore,
    scopeId,
    pageSize = 50,
    rowHeight = 48,
    onRowClick,
    searchDeps = [],
    clickableRows = true,
    rowClassName,
    columnVisibilityStorageKey,
    enableInfiniteScroll = true,
    onBulkDelete,
    deleteLabel = "Delete",
    deleteDisabledTooltip = "Select items to delete",
    exportLabel = "Export CSV",
    exportDisabledTooltip = "Select items to export",
    exportFilename = "table-export.csv",
}: UseTableManagerConfig<T>): UseTableManagerReturn<T> {
    // Responsive breakpoints
    const screens = Grid.useBreakpoint()
    const isNarrowScreen = !screens.lg

    // Pagination
    const pagination = datasetStore.hooks.usePagination({
        scopeId,
        pageSize,
        resetOnScopeChange: false,
    })

    const {rows, loadNextPage, resetPages} = pagination

    // Selection state
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

    // Export state
    const [rowExportingKey, setRowExportingKey] = useState<string | null>(null)
    const tableExport = useTableExport<T>()
    const columnsRef = useRef<ColumnsType<T> | null>(null)

    // Auto-reset pagination when search dependencies change
    useEffect(() => {
        if (searchDeps.length > 0) {
            resetPages()
        }
    }, [resetPages, ...searchDeps])

    // Row selection config
    const rowSelection = useMemo<InfiniteVirtualTableRowSelection<T>>(
        () => ({
            type: "checkbox" as const,
            selectedRowKeys,
            onChange: (keys: Key[]) => {
                setSelectedRowKeys(keys)
            },
            getCheckboxProps: (record: T) => ({
                disabled: Boolean(record.__isSkeleton),
            }),
            columnWidth: 48,
            fixed: true,
        }),
        [selectedRowKeys],
    )

    // Row click handlers
    const buildRowHandlers = useCallback(
        (record: T) => {
            const isNavigable = clickableRows && !record.__isSkeleton
            const customClass =
                typeof rowClassName === "function" ? rowClassName(record) : rowClassName

            return {
                onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                    if (!isNavigable) return
                    if (shouldIgnoreRowClick(event)) return
                    onRowClick?.(record)
                },
                className: clsx(customClass, {
                    "opacity-60 animate-pulse": record.__isSkeleton,
                }),
                style: {
                    cursor: isNavigable ? "pointer" : "default",
                    height: rowHeight,
                    minHeight: rowHeight,
                } as React.CSSProperties,
            }
        },
        [clickableRows, onRowClick, rowClassName, rowHeight],
    )

    // Table props with defaults
    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            sticky: true,
            bordered: true,
            virtual: true,
            tableLayout: "fixed" as const,
            onRow: buildRowHandlers,
        }),
        [buildRowHandlers],
    )

    // Table scope config
    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId,
            pageSize,
            enableInfiniteScroll,
            columnVisibilityStorageKey: columnVisibilityStorageKey ?? undefined,
        }),
        [scopeId, pageSize, enableInfiniteScroll, columnVisibilityStorageKey],
    )

    // Pagination config for FeatureShell
    const tablePagination = useMemo<TableFeaturePagination<T>>(
        () => ({
            rows,
            loadNextPage,
            resetPages,
        }),
        [rows, loadNextPage, resetPages],
    )

    // Helper to get selected records
    const getSelectedRecords = useCallback(
        () => rows.filter((record) => selectedRowKeys.includes(record.key)),
        [rows, selectedRowKeys],
    )

    // Helper to clear selection
    const clearSelection = useCallback(() => {
        setSelectedRowKeys([])
    }, [])

    // Delete action config - shell handles button rendering and narrow screen behavior
    const deleteAction = useMemo<TableDeleteConfig | undefined>(
        () =>
            onBulkDelete
                ? {
                      onDelete: () => onBulkDelete(getSelectedRecords()),
                      disabled: !selectedRowKeys.length,
                      disabledTooltip: deleteDisabledTooltip,
                      label: deleteLabel,
                  }
                : undefined,
        [
            onBulkDelete,
            selectedRowKeys.length,
            getSelectedRecords,
            deleteDisabledTooltip,
            deleteLabel,
        ],
    )

    // Export action config - shell handles button rendering and narrow screen behavior
    const exportAction = useMemo<TableExportConfig | undefined>(
        () => ({
            disabled: !selectedRowKeys.length,
            disabledTooltip: exportDisabledTooltip,
            label: exportLabel,
        }),
        [selectedRowKeys.length, exportDisabledTooltip, exportLabel],
    )

    // Handler to export a single row
    const handleExportRow = useCallback(
        async (record: T) => {
            if (!record || record.__isSkeleton || !record.key) return
            const snapshot = columnsRef.current
            if (!snapshot?.length) {
                console.warn("[useTableManager] Cannot export row without columns")
                return
            }
            const sanitizedKey = String(record.key).replace(/[^a-zA-Z0-9-_]+/g, "-")
            setRowExportingKey(String(record.key))
            try {
                await tableExport({
                    columns: snapshot,
                    rows: [record],
                    filename: exportFilename.replace(".csv", `-${sanitizedKey}.csv`),
                })
            } catch (error) {
                console.error("[useTableManager] Failed to export row", error)
            } finally {
                setRowExportingKey((current) => (current === String(record.key) ? null : current))
            }
        },
        [tableExport, exportFilename],
    )

    // Row key extractor
    const rowKeyExtractor = useCallback((record: T) => record.key, [])

    // Shell props to spread directly to InfiniteVirtualTableFeatureShell
    const shellProps = useMemo(
        () => ({
            datasetStore,
            tableScope,
            pagination: tablePagination,
            rowSelection,
            tableProps,
            deleteAction,
            exportAction,
            useSettingsDropdown: isNarrowScreen,
            rowKey: rowKeyExtractor,
        }),
        [
            datasetStore,
            tableScope,
            tablePagination,
            rowSelection,
            tableProps,
            deleteAction,
            exportAction,
            isNarrowScreen,
            rowKeyExtractor,
        ],
    )

    return {
        pagination,
        selectedRowKeys,
        setSelectedRowKeys,
        rowSelection,
        tableProps,
        tableScope,
        tablePagination,
        getSelectedRecords,
        clearSelection,
        isNarrowScreen,
        deleteAction,
        exportAction,
        handleExportRow,
        rowExportingKey,
        columnsRef,
        shellProps,
    }
}
