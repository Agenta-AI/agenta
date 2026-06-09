import {useMemo, type ReactNode} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    type InfiniteTableRowBase,
    type InfiniteDatasetStore,
    type InfiniteVirtualTableProps,
    type TableFeatureExportOptions,
    type UseTableManagerConfig,
} from "@agenta/ui/table"
import {getDefaultStore} from "jotai/vanilla"

/**
 * Props for {@link EvaluationListView}.
 *
 * Generic over the row type `Row`; consumers supply the dataset store, column
 * definitions, filters, and actions. This component owns only the wiring between
 * `useTableManager` and `InfiniteVirtualTableFeatureShell` — it bakes in no
 * queue/run-specific columns or behaviour.
 */
export interface EvaluationListViewProps<Row extends InfiniteTableRowBase> {
    /** The paginated dataset store (the store's `.store`). */
    datasetStore: InfiniteDatasetStore<Row, unknown, unknown>
    /** Unique scope ID for this table instance. */
    scopeId: string
    /** Number of items per page (default: 50). */
    pageSize?: number

    /** Column definitions, typed as the shell's column type for `Row`. */
    columns: InfiniteVirtualTableProps<Row>["columns"]

    /** Optional filters slot (search inputs, filter popovers, etc.). */
    filters?: ReactNode
    /** Optional primary-actions slot (e.g. a create button). */
    primaryActions?: ReactNode

    /** Callback when a row is clicked. */
    onRowClick?: (record: Row) => void
    /** Callback when a bulk delete is triggered. */
    onBulkDelete?: (records: Row[]) => void
    /** Dependencies that should trigger pagination reset (e.g. search term). */
    searchDeps?: unknown[]

    /** CSV export options. */
    exportOptions?: TableFeatureExportOptions<Row>
    /** Whether to render the export button (default: true). */
    enableExport?: boolean

    /** Whether the shell sizes itself to its flex parent (default: true). */
    autoHeight?: boolean
    /** Optional className for the shell wrapper. */
    className?: string
    /** Table props passed through to the underlying table (merged with manager props). */
    tableProps?: InfiniteVirtualTableProps<Row>["tableProps"]
    /** Jotai store to use for the table. Defaults to the global default store. */
    store?: InfiniteVirtualTableProps<Row>["store"]
}

/**
 * Generic, config-driven evaluation list table.
 *
 * Faithful extraction of the table wiring used by `AnnotationQueuesView`:
 * `useTableManager(...)` feeds `InfiniteVirtualTableFeatureShell` via `shellProps`,
 * while columns, filters, actions, and the store are passed in by the consumer.
 */
function EvaluationListView<Row extends InfiniteTableRowBase>({
    datasetStore,
    scopeId,
    pageSize = 50,
    columns,
    filters,
    primaryActions,
    onRowClick,
    onBulkDelete,
    searchDeps,
    exportOptions,
    enableExport = true,
    autoHeight = true,
    className = "flex-1 min-h-0",
    tableProps,
    store,
}: EvaluationListViewProps<Row>) {
    const managerConfig: UseTableManagerConfig<Row> = {
        datasetStore,
        scopeId,
        pageSize,
        onRowClick,
        searchDeps,
        onBulkDelete,
    }

    const table = useTableManager<Row>(managerConfig)

    const resolvedTableProps = useMemo(() => {
        if (!tableProps) return table.tableProps
        return {...(table.tableProps ?? {}), ...tableProps}
    }, [table.tableProps, tableProps])

    const resolvedStore = store ?? getDefaultStore()

    return (
        <InfiniteVirtualTableFeatureShell<Row>
            {...table.shellProps}
            columns={columns}
            filters={filters}
            primaryActions={primaryActions}
            tableProps={resolvedTableProps}
            exportOptions={exportOptions}
            enableExport={enableExport}
            autoHeight={autoHeight}
            className={className}
            store={resolvedStore}
        />
    )
}

export default EvaluationListView
