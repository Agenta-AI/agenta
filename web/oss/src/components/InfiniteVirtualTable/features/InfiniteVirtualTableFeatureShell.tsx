import {useCallback, useEffect, useMemo, useState} from "react"
import type {Key, ReactNode} from "react"

import clsx from "clsx"

import ColumnVisibilityPopoverContent from "../components/columnVisibility/ColumnVisibilityPopoverContent"
import TableSettingsDropdown from "../components/columnVisibility/TableSettingsDropdown"
import TableShell from "../components/TableShell"
import type {InfiniteDatasetStore} from "../createInfiniteDatasetStore"
import useTableExport, {type TableExportOptions} from "../hooks/useTableExport"
import InfiniteVirtualTable from "../InfiniteVirtualTable"
import type {
    ColumnVisibilityMenuRenderer,
    ColumnVisibilityState,
    InfiniteTableRowBase,
    InfiniteVirtualTableProps,
    InfiniteVirtualTableRowSelection,
} from "../types"

type ColumnVisibilityRenderer<Row extends InfiniteTableRowBase> = (
    controls: ColumnVisibilityState<Row>,
    close: () => void,
    context: {scopeId: string | null},
) => ReactNode

export interface TableScopeConfig {
    scopeId: string | null
    pageSize: number
    enableInfiniteScroll?: boolean
    columnVisibilityStorageKey?: string | null
    columnVisibilityDefaults?: Key[]
    viewportTrackingEnabled?: boolean
}

export interface TableFeaturePagination<Row extends InfiniteTableRowBase> {
    rows: Row[]
    loadNextPage: () => void
    resetPages: () => void
}

export type TableFeatureExportOptions<Row extends InfiniteTableRowBase> = TableExportOptions<Row>

export interface InfiniteVirtualTableFeatureProps<Row extends InfiniteTableRowBase> {
    datasetStore: InfiniteDatasetStore<Row, any, any>
    tableScope: TableScopeConfig
    columns: InfiniteVirtualTableProps<Row>["columns"]
    rowKey: InfiniteVirtualTableProps<Row>["rowKey"]
    title?: ReactNode
    filters?: ReactNode
    primaryActions?: ReactNode
    secondaryActions?: ReactNode
    className?: string
    containerClassName?: string
    tableClassName?: string
    autoHeight?: boolean
    rowHeight?: number
    fallbackControlsHeight?: number
    fallbackHeaderHeight?: number
    resizableColumns?: InfiniteVirtualTableProps<Row>["resizableColumns"]
    tableProps?: InfiniteVirtualTableProps<Row>["tableProps"]
    beforeTable?: ReactNode
    afterTable?: ReactNode
    columnVisibilityMenuRenderer?: ColumnVisibilityMenuRenderer<Row> | ColumnVisibilityRenderer<Row>
    columnVisibility?: InfiniteVirtualTableProps<Row>["columnVisibility"]
    rowSelection?: InfiniteVirtualTableRowSelection<Row>
    onPaginationStateChange?: (payload: {resetPages: () => void; loadNextPage: () => void}) => void
    onRowsChange?: (rows: Row[]) => void
    pagination?: TableFeaturePagination<Row>
    enableExport?: boolean
    exportFilename?: string
    renderExportButton?: (props: {onExport: () => void; loading: boolean}) => ReactNode
    exportOptions?: TableFeatureExportOptions<Row>
    /**
     * When true, the gear icon opens a dropdown menu with actions (Export, Column Visibility)
     * instead of directly opening the column visibility popover.
     * Default: false (gear icon opens column visibility popover directly)
     */
    useSettingsDropdown?: boolean
    /**
     * Delete action configuration for the settings dropdown.
     * Only used when useSettingsDropdown is true.
     */
    settingsDropdownDelete?: {
        onDelete: () => void
        disabled?: boolean
        label?: string
    }
    keyboardShortcuts?: InfiniteVirtualTableProps<Row>["keyboardShortcuts"]
}

const DEFAULT_ROW_HEIGHT = 48
const DEFAULT_CONTROLS_HEIGHT = 72
const DEFAULT_TABLE_HEADER_HEIGHT = 48

interface ColumnVisibilityRendererContext {
    scopeId: string | null
    onExport?: () => void
    isExporting?: boolean
}

const resolveColumnVisibilityRenderer = <Row extends InfiniteTableRowBase>(
    renderer: InfiniteVirtualTableFeatureProps<Row>["columnVisibilityMenuRenderer"],
    config: InfiniteVirtualTableProps<Row>["columnVisibility"] | undefined,
    context: ColumnVisibilityRendererContext,
): ColumnVisibilityMenuRenderer<Row> => {
    const {scopeId, onExport, isExporting} = context
    if (!renderer) {
        return (controls, close) => (
            <ColumnVisibilityPopoverContent
                controls={controls}
                onClose={close}
                scopeId={scopeId}
                resolveNodeMeta={config?.resolveNodeMeta}
                onExport={onExport}
                isExporting={isExporting}
            />
        )
    }
    return (controls, close) => renderer(controls, close, {scopeId, onExport, isExporting})
}

function InfiniteVirtualTableFeatureShellBase<Row extends InfiniteTableRowBase>(
    props: InfiniteVirtualTableFeatureProps<Row> & {pagination: TableFeaturePagination<Row>},
) {
    const {
        tableScope,
        columns,
        rowKey,
        title,
        filters,
        primaryActions,
        secondaryActions,
        className,
        containerClassName,
        tableClassName,
        autoHeight = true,
        rowHeight = DEFAULT_ROW_HEIGHT,
        fallbackControlsHeight = DEFAULT_CONTROLS_HEIGHT,
        fallbackHeaderHeight = DEFAULT_TABLE_HEADER_HEIGHT,
        resizableColumns = true,
        tableProps,
        beforeTable,
        afterTable,
        columnVisibilityMenuRenderer,
        columnVisibility,
        rowSelection,
        onPaginationStateChange,
        onRowsChange,
        pagination,
        enableExport = true,
        exportFilename,
        renderExportButton,
        exportOptions,
        useSettingsDropdown = false,
        settingsDropdownDelete,
        keyboardShortcuts,
    } = props
    const {scopeId, pageSize, enableInfiniteScroll = true} = tableScope

    useEffect(() => {
        onPaginationStateChange?.({
            resetPages: pagination.resetPages,
            loadNextPage: pagination.loadNextPage,
        })
    }, [onPaginationStateChange, pagination.loadNextPage, pagination.resetPages])

    useEffect(() => {
        onRowsChange?.(pagination.rows)
    }, [onRowsChange, pagination.rows])

    const handleLoadMore = useCallback(() => {
        if (!enableInfiniteScroll) return
        pagination.loadNextPage()
    }, [enableInfiniteScroll, pagination.loadNextPage])

    const [controlsHeight, setControlsHeight] = useState(0)
    const [tableHeaderHeight, setTableHeaderHeight] = useState<number | null>(null)

    const resolvedControlsHeight = controlsHeight || fallbackControlsHeight
    const resolvedTableHeaderHeight = tableHeaderHeight ?? fallbackHeaderHeight
    const visibleRowCount = pagination.rows.length || pageSize
    const bodyHeight = autoHeight ? null : rowHeight * Math.max(visibleRowCount, 1)
    const headerHeight = resolvedControlsHeight + resolvedTableHeaderHeight + 32
    const fixedHeight = !autoHeight && bodyHeight !== null ? bodyHeight + headerHeight : undefined
    const resolvedContainerClassName =
        containerClassName ??
        (autoHeight ? "w-full grow min-h-0 overflow-hidden" : "w-full overflow-hidden")

    const tableExport = useTableExport<Row>()
    const [isExporting, setIsExporting] = useState(false)
    const {
        filename: exportOptionsFilename,
        isColumnExportable,
        getValue: getExportValue,
        formatValue: formatExportValue,
        includeSkeletonRows,
        beforeExport,
        resolveValue,
        resolveColumnLabel,
    } = exportOptions ?? {}
    const resolvedExportFilename = exportOptionsFilename ?? exportFilename ?? "table-export.csv"
    const exportHandler = useCallback(async () => {
        if (isExporting) return
        setIsExporting(true)
        try {
            await tableExport({
                columns,
                rows: pagination.rows,
                filename: resolvedExportFilename,
                isColumnExportable,
                getValue: getExportValue,
                formatValue: formatExportValue,
                includeSkeletonRows,
                beforeExport,
                resolveValue,
                resolveColumnLabel,
            })
        } catch (error) {
            console.error("[InfiniteVirtualTable] Failed to export table", error)
        } finally {
            setIsExporting(false)
        }
    }, [
        beforeExport,
        columns,
        getExportValue,
        formatExportValue,
        includeSkeletonRows,
        isExporting,
        isColumnExportable,
        pagination.rows,
        resolveValue,
        resolveColumnLabel,
        resolvedExportFilename,
        tableExport,
    ])

    const exportButtonNode = useMemo(() => {
        if (!enableExport) return null
        if (renderExportButton) {
            return renderExportButton({onExport: exportHandler, loading: isExporting})
        }
        // Export button is now rendered inside the column visibility popover
        return null
    }, [enableExport, exportHandler, isExporting, renderExportButton])

    const columnVisibilityRenderer = useMemo(
        () =>
            resolveColumnVisibilityRenderer(columnVisibilityMenuRenderer, columnVisibility, {
                scopeId,
                onExport: enableExport ? exportHandler : undefined,
                isExporting,
            }),
        [
            columnVisibilityMenuRenderer,
            columnVisibility,
            scopeId,
            enableExport,
            exportHandler,
            isExporting,
        ],
    )

    const viewportTrackingEnabled = useMemo(
        () =>
            tableScope.viewportTrackingEnabled ?? pagination.rows.some((row) => !row.__isSkeleton),
        [pagination.rows, tableScope.viewportTrackingEnabled],
    )

    const settingsDropdownRenderer = useCallback(
        (controls: ColumnVisibilityState<Row>) => (
            <TableSettingsDropdown
                controls={controls}
                onExport={enableExport ? exportHandler : undefined}
                isExporting={isExporting}
                onDelete={settingsDropdownDelete?.onDelete}
                deleteDisabled={settingsDropdownDelete?.disabled}
                deleteLabel={settingsDropdownDelete?.label}
                renderColumnVisibilityContent={(ctrls, close) =>
                    columnVisibilityRenderer(ctrls, close, {
                        scopeId,
                        onExport: enableExport ? exportHandler : undefined,
                        isExporting,
                    })
                }
            />
        ),
        [
            columnVisibilityRenderer,
            enableExport,
            exportHandler,
            isExporting,
            scopeId,
            settingsDropdownDelete,
        ],
    )

    const columnVisibilityConfig = useMemo(
        () => ({
            storageKey: tableScope.columnVisibilityStorageKey ?? undefined,
            defaultHiddenKeys: tableScope.columnVisibilityDefaults,
            viewportTrackingEnabled,
            renderMenuContent: columnVisibilityRenderer,
            renderMenuTrigger: useSettingsDropdown ? settingsDropdownRenderer : undefined,
        }),
        [
            columnVisibilityRenderer,
            settingsDropdownRenderer,
            tableScope.columnVisibilityDefaults,
            tableScope.columnVisibilityStorageKey,
            useSettingsDropdown,
            viewportTrackingEnabled,
        ],
    )

    return (
        <div
            className={clsx("flex flex-col", autoHeight ? "h-full min-h-0" : "min-h-0", className)}
            style={fixedHeight ? {height: fixedHeight} : undefined}
        >
            <TableShell
                title={title}
                filters={filters}
                primaryActions={primaryActions}
                secondaryActions={
                    secondaryActions || exportButtonNode ? (
                        <div className="flex items-center gap-2">
                            {secondaryActions}
                            {exportButtonNode}
                        </div>
                    ) : undefined
                }
                onHeaderHeightChange={setControlsHeight}
                className="flex flex-1 min-h-0 flex-col"
            >
                {beforeTable}
                <InfiniteVirtualTable<Row>
                    useIsolatedStore
                    columns={columns}
                    dataSource={pagination.rows}
                    loadMore={handleLoadMore}
                    rowKey={rowKey}
                    rowSelection={rowSelection}
                    resizableColumns={resizableColumns}
                    columnVisibility={columnVisibilityConfig}
                    bodyHeight={bodyHeight}
                    scopeId={scopeId}
                    containerClassName={resolvedContainerClassName}
                    tableClassName={tableClassName}
                    tableProps={tableProps}
                    keyboardShortcuts={keyboardShortcuts}
                    onHeaderHeightChange={setTableHeaderHeight}
                />
                {afterTable}
            </TableShell>
        </div>
    )
}

const InfiniteVirtualTableFeatureShellWithStore = <Row extends InfiniteTableRowBase>(
    props: InfiniteVirtualTableFeatureProps<Row>,
) => {
    const {datasetStore, tableScope} = props
    const pagination = datasetStore.hooks.usePagination({
        scopeId: tableScope.scopeId,
        pageSize: tableScope.pageSize,
        resetOnScopeChange: true,
    })
    return <InfiniteVirtualTableFeatureShellBase {...props} pagination={pagination} />
}

const InfiniteVirtualTableFeatureShell = <Row extends InfiniteTableRowBase>(
    props: InfiniteVirtualTableFeatureProps<Row>,
) => {
    if (props.pagination) {
        return <InfiniteVirtualTableFeatureShellBase {...props} pagination={props.pagination} />
    }
    return <InfiniteVirtualTableFeatureShellWithStore {...props} />
}

export default InfiniteVirtualTableFeatureShell
