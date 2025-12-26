import type {CSSProperties, Key, ReactNode} from "react"
import {useCallback, useEffect, useMemo, useState} from "react"

import {Trash} from "@phosphor-icons/react"
import {Button, Grid, Tabs, Tooltip} from "antd"
import type {MenuProps} from "antd"
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
    /** Margin around viewport for preloading columns (e.g., "0px 200px" to preload 200px on left/right) */
    viewportMargin?: string
    /** Debounce time in ms before marking a column as hidden after it exits viewport (default: 150) */
    viewportExitDebounceMs?: number
}

export interface TableFeaturePagination<Row extends InfiniteTableRowBase> {
    rows: Row[]
    loadNextPage: () => void
    resetPages: () => void
}

export type TableFeatureExportOptions<Row extends InfiniteTableRowBase> = TableExportOptions<Row>

export interface TableTabItem {
    key: string
    label: string
}

export interface TableTabsConfig {
    /** Tab items to render */
    items: TableTabItem[]
    /** Currently active tab key */
    activeKey: string
    /** Callback when tab changes */
    onChange: (key: string) => void
    /** Optional CSS variable for tab indicator color */
    indicatorColor?: string
    /** Optional className for the tabs container */
    className?: string
}

/** Configuration for the built-in delete action */
export interface TableDeleteConfig {
    /** Callback when delete is triggered */
    onDelete: () => void
    /** Whether the delete action is disabled */
    disabled?: boolean
    /** Tooltip to show when disabled */
    disabledTooltip?: string
    /** Button label (default: "Delete") */
    label?: string
}

/** Configuration for the built-in export action */
export interface TableExportConfig {
    /** Whether the export action is disabled */
    disabled?: boolean
    /** Tooltip to show when disabled */
    disabledTooltip?: string
    /** Button label (default: "Export CSV") */
    label?: string
}

export interface InfiniteVirtualTableFeatureProps<Row extends InfiniteTableRowBase> {
    datasetStore: InfiniteDatasetStore<Row, any, any>
    tableScope: TableScopeConfig
    columns: InfiniteVirtualTableProps<Row>["columns"]
    rowKey: InfiniteVirtualTableProps<Row>["rowKey"]
    title?: ReactNode
    /** Tabs configuration for the header */
    tabs?: TableTabsConfig
    /** @deprecated Use tabs prop instead. Additional content to render in the header row */
    headerExtra?: ReactNode
    filters?: ReactNode
    primaryActions?: ReactNode
    /**
     * Built-in delete action configuration.
     * When provided, the shell renders a standard delete button.
     * On narrow screens, this moves to the settings dropdown.
     */
    deleteAction?: TableDeleteConfig
    /**
     * Built-in export action configuration.
     * When provided along with enableExport, the shell renders a standard export button.
     * On narrow screens, export moves to the settings dropdown.
     */
    exportAction?: TableExportConfig
    /** @deprecated Use deleteAction instead. Custom secondary actions to render */
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
    /** @deprecated Use exportAction instead for button customization */
    renderExportButton?: (props: {onExport: () => void; loading: boolean}) => ReactNode
    exportOptions?: TableFeatureExportOptions<Row>
    /**
     * When true, the gear icon opens a dropdown menu with actions (Export, Column Visibility)
     * instead of directly opening the column visibility popover.
     * Default: false (gear icon opens column visibility popover directly)
     */
    useSettingsDropdown?: boolean
    /**
     * @deprecated Use deleteAction instead.
     * Delete action configuration for the settings dropdown.
     * Only used when useSettingsDropdown is true.
     */
    settingsDropdownDelete?: {
        onDelete: () => void
        disabled?: boolean
        label?: string
    }
    /**
     * Additional menu items for the settings dropdown.
     * Only used when useSettingsDropdown is true.
     */
    settingsDropdownMenuItems?: MenuProps["items"]
    keyboardShortcuts?: InfiniteVirtualTableProps<Row>["keyboardShortcuts"]
    /**
     * Configuration for expandable rows.
     * When provided, rows can be expanded to show child content (e.g., variants, revisions).
     */
    expandable?: InfiniteVirtualTableProps<Row>["expandable"]
    /**
     * Override the dataSource from pagination.
     * Useful when you need to transform rows (e.g., add children for tree data).
     */
    dataSource?: Row[]
    /**
     * Jotai store to use for the table. When provided, the table will use this store
     * instead of creating an isolated one. Useful when cells need to read from
     * atoms in a shared store (e.g., entity atoms).
     */
    store?: InfiniteVirtualTableProps<Row>["store"]
    /**
     * Ref to access the underlying Ant Design Table instance.
     * Useful for programmatic scrolling via `tableRef.current?.scrollTo({ index })`.
     */
    tableRef?: InfiniteVirtualTableProps<Row>["tableRef"]
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
        tabs,
        headerExtra,
        filters,
        primaryActions,
        deleteAction,
        exportAction,
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
        settingsDropdownMenuItems,
        keyboardShortcuts,
        expandable,
        dataSource,
        tableRef,
        store,
    } = props
    const {scopeId, pageSize, enableInfiniteScroll = true} = tableScope

    // Responsive breakpoints for built-in action buttons
    const screens = Grid.useBreakpoint()
    const isNarrowScreen = !screens.lg

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
            // If rows are selected, export only selected rows; otherwise export all rows
            const selectedKeys = rowSelection?.selectedRowKeys
            const rowsToExport =
                selectedKeys && selectedKeys.length > 0
                    ? pagination.rows.filter((row) => {
                          const key =
                              typeof rowKey === "function" ? rowKey(row) : row[rowKey as keyof Row]
                          return selectedKeys.includes(key as Key)
                      })
                    : pagination.rows
            await tableExport({
                columns,
                rows: rowsToExport,
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
        rowKey,
        rowSelection?.selectedRowKeys,
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

    // Built-in delete button (wide screens only)
    const builtInDeleteButton = useMemo(() => {
        if (!deleteAction || isNarrowScreen) return null
        const {onDelete, disabled, disabledTooltip, label = "Delete"} = deleteAction
        const button = (
            <Button
                danger
                type="text"
                icon={<Trash size={14} className="mt-0.5" />}
                className="flex items-center"
                disabled={disabled}
                onClick={onDelete}
            >
                {label}
            </Button>
        )
        if (disabled && disabledTooltip) {
            return <Tooltip title={disabledTooltip}>{button}</Tooltip>
        }
        return button
    }, [deleteAction, isNarrowScreen])

    // Built-in export button (wide screens only, when exportAction is provided)
    const builtInExportButton = useMemo(() => {
        if (!enableExport || !exportAction || isNarrowScreen) return null
        const {disabled, disabledTooltip, label = "Export CSV"} = exportAction
        const button = (
            <Button disabled={disabled} onClick={exportHandler} loading={isExporting}>
                {label}
            </Button>
        )
        if (disabled && disabledTooltip) {
            return (
                <Tooltip title={disabledTooltip}>
                    <span>{button}</span>
                </Tooltip>
            )
        }
        return button
    }, [enableExport, exportAction, exportHandler, isExporting, isNarrowScreen])

    // Resolve settings dropdown delete config (prefer deleteAction over legacy prop)
    const resolvedSettingsDropdownDelete = useMemo(() => {
        if (deleteAction && isNarrowScreen) {
            return {
                onDelete: deleteAction.onDelete,
                disabled: deleteAction.disabled,
                label: deleteAction.label ? `${deleteAction.label} selected` : "Delete selected",
            }
        }
        return settingsDropdownDelete
    }, [deleteAction, isNarrowScreen, settingsDropdownDelete])

    // Combine secondary actions: built-in buttons + custom secondaryActions + export button
    const resolvedSecondaryActions = useMemo(() => {
        const actions = [
            builtInDeleteButton,
            builtInExportButton,
            secondaryActions,
            exportButtonNode,
        ]
        const filtered = actions.filter(Boolean)
        if (filtered.length === 0) return undefined
        if (filtered.length === 1) return filtered[0]
        return (
            <div className="flex items-center gap-2">
                {filtered.map((action, i) => (
                    <span key={i}>{action}</span>
                ))}
            </div>
        )
    }, [builtInDeleteButton, builtInExportButton, secondaryActions, exportButtonNode])

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
                onDelete={resolvedSettingsDropdownDelete?.onDelete}
                deleteDisabled={resolvedSettingsDropdownDelete?.disabled}
                deleteLabel={resolvedSettingsDropdownDelete?.label}
                additionalMenuItems={settingsDropdownMenuItems}
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
            resolvedSettingsDropdownDelete,
            settingsDropdownMenuItems,
        ],
    )

    const columnVisibilityConfig = useMemo(
        () => ({
            storageKey: tableScope.columnVisibilityStorageKey ?? undefined,
            defaultHiddenKeys: tableScope.columnVisibilityDefaults,
            viewportTrackingEnabled,
            viewportMargin: tableScope.viewportMargin,
            viewportExitDebounceMs: tableScope.viewportExitDebounceMs,
            renderMenuContent: columnVisibilityRenderer,
            renderMenuTrigger: useSettingsDropdown ? settingsDropdownRenderer : undefined,
        }),
        [
            columnVisibilityRenderer,
            settingsDropdownRenderer,
            tableScope.columnVisibilityDefaults,
            tableScope.columnVisibilityStorageKey,
            tableScope.viewportExitDebounceMs,
            tableScope.viewportMargin,
            useSettingsDropdown,
            viewportTrackingEnabled,
        ],
    )

    // Render tabs if configured
    const tabsNode = useMemo(() => {
        if (!tabs) return headerExtra // Fall back to headerExtra for backwards compatibility
        return (
            <div
                className={clsx(
                    "infinite-table-tabs min-w-[320px] [&_.ant-tabs-nav]:mb-0",
                    tabs.className,
                )}
                style={
                    tabs.indicatorColor
                        ? ({"--tab-indicator-color": tabs.indicatorColor} as CSSProperties)
                        : undefined
                }
            >
                <Tabs
                    className="min-w-[320px]"
                    activeKey={tabs.activeKey}
                    items={tabs.items.map((item) => ({
                        key: item.key,
                        label: item.label,
                    }))}
                    onChange={tabs.onChange}
                    destroyOnHidden
                />
            </div>
        )
    }, [tabs, headerExtra])

    return (
        <div
            className={clsx("flex flex-col", autoHeight ? "h-full min-h-0" : "min-h-0", className)}
            style={fixedHeight ? {height: fixedHeight} : undefined}
        >
            <TableShell
                title={title}
                headerExtra={tabsNode}
                filters={filters}
                primaryActions={primaryActions}
                secondaryActions={resolvedSecondaryActions}
                onHeaderHeightChange={setControlsHeight}
                className="flex flex-1 min-h-0 flex-col"
            >
                {beforeTable}
                <InfiniteVirtualTable<Row>
                    useIsolatedStore={!store}
                    store={store}
                    columns={columns}
                    dataSource={dataSource ?? pagination.rows}
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
                    expandable={expandable}
                    onHeaderHeightChange={setTableHeaderHeight}
                    tableRef={tableRef}
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
