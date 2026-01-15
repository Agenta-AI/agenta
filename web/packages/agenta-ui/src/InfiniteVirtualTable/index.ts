export {createInfiniteTableStore} from "./createInfiniteTableStore"
export type {InfiniteTableStore} from "./createInfiniteTableStore"
export {createInfiniteDatasetStore} from "./createInfiniteDatasetStore"
export type {InfiniteDatasetStore, InfiniteDatasetStoreConfig} from "./createInfiniteDatasetStore"
export {createTableColumns} from "./columns/createTableColumns"
export {
    createTextCell,
    createComponentCell,
    createStatusCell,
    createActionsCell,
    createViewportAwareCell,
    createColumnVisibilityAwareCell,
} from "./columns/cells"
export * from "./columns/types"
export {default as useInfiniteTablePagination} from "./hooks/useInfiniteTablePagination"
export {useTableManager, shouldIgnoreRowClick} from "./hooks/useTableManager"
export type {UseTableManagerConfig, UseTableManagerReturn} from "./hooks/useTableManager"
export {useTableActions} from "./hooks/useTableActions"
export type {TableActionsConfig, TableActionsReturn} from "./hooks/useTableActions"
export {
    createStandardColumns,
    createTextColumn,
    createDateColumn,
    createUserColumn,
    createActionsColumn,
    configureUserReference,
} from "./columns/createStandardColumns"
export type {
    StandardColumnDef,
    TextColumnDef,
    DateColumnDef,
    UserColumnDef,
    ActionsColumnDef,
    ActionItem,
} from "./columns/createStandardColumns"
// Table store helpers
export {createTableRowHelpers, createSimpleTableStore, createTableMetaAtom} from "./helpers"
export type {
    TableRowHelpersConfig,
    CreateSkeletonRowParams,
    MergeRowParams,
    TableRowHelpers,
    DateRangeFilter,
    BaseTableMeta,
    SimpleTableStoreConfig,
    SimpleTableStore,
} from "./helpers"
export {
    default as InfiniteVirtualTable,
    InfiniteVirtualTableStoreProvider,
    useVirtualTableScrollContainer,
    useColumnVisibilityControls,
} from "./InfiniteVirtualTable"
export {default as ColumnVisibilityTrigger} from "./components/ColumnVisibilityTrigger"
export {default as ColumnVisibilityMenuTrigger} from "./components/columnVisibility/ColumnVisibilityMenuTrigger"
export {default as ColumnVisibilityPopoverContent} from "./components/columnVisibility/ColumnVisibilityPopoverContent"
export {default as TableSettingsDropdown} from "./components/columnVisibility/TableSettingsDropdown"
export {default as FiltersPopoverTrigger} from "./components/filters/FiltersPopoverTrigger"
export {default as TableShell} from "./components/TableShell"
export {default as TableDescription} from "./components/TableDescription"
export type {TableDescriptionProps} from "./components/TableDescription"
export {InfiniteVirtualTableFeatureShell, useInfiniteTableFeaturePagination} from "./features"
export type {
    TableScopeConfig,
    TableFeaturePagination,
    TableFeatureExportOptions,
    InfiniteVirtualTableFeatureProps,
    TableTabItem,
    TableTabsConfig,
    TableDeleteConfig,
    TableExportConfig,
} from "./features"
export {default as ColumnVisibilityHeader} from "./components/ColumnVisibilityHeader"
export {default as ColumnVisibilityProvider} from "./providers/ColumnVisibilityProvider"
export {useColumnVisibilityContext} from "./context/ColumnVisibilityContext"
export {useExpandableRows} from "./hooks/useExpandableRows"
export {useEditableTable} from "./hooks/useEditableTable"
export type {
    EditableTableColumn,
    EditableTableConfig,
    EditableTableState,
    EditableTableActions,
} from "./hooks/useEditableTable"
export {
    useRowHeight,
    useRowHeightValue,
    createRowHeightAtom,
    createRowHeightPxAtom,
    createRowHeightMaxLinesAtom,
    DEFAULT_ROW_HEIGHT_CONFIG,
} from "./hooks/useRowHeight"
export type {
    RowHeightSize,
    RowHeightOption,
    RowHeightConfig,
    UseRowHeightResult,
} from "./hooks/useRowHeight"
export * from "./types"
export type {ExpandableRowConfig, ExpandIconRenderProps} from "./types"
export type {VisibilityRegistrationHandler} from "./components/ColumnVisibilityHeader"

// Additional exports
export {default as SkeletonLine} from "./components/common/SkeletonLine"
export {ResizableTitle, SkeletonCell} from "./components/common/ResizableTitle"
export {useTableExport, EXPORT_RESOLVE_SKIP} from "./hooks/useTableExport"
export type {TableExportColumnContext} from "./hooks/useTableExport"

// Alias for backward compatibility
export {default as ColumnVisibilityPopoverContentBase} from "./components/columnVisibility/ColumnVisibilityPopoverContent"

// NOTE: Internal atoms (columnVisibility, columnWidths, columnHiddenKeys) are NOT exported.
// They are implementation details used internally by the table components.

// ============================================================================
// PAGINATED STORE
// ============================================================================

export {
    createPaginatedEntityStore,
    type PaginatedEntityRow,
    type PaginatedEntityMeta,
    type PaginatedEntityStore,
    type PaginatedEntityStoreConfig,
    type PaginatedEntityRowConfig,
    type PaginatedFetchParams,
    type PaginatedControllerParams,
    type PaginatedControllerState,
    type PaginatedControllerAction,
    type PaginatedState,
    type PaginatedCombinedState,
} from "./paginated"

// ============================================================================
// ENTITY TABLE HOOK
// ============================================================================

export {useEntityTableState} from "./hooks/useEntityTableState"
export type {
    UseEntityTableStateOptions,
    UseEntityTableStateResult,
} from "./hooks/useEntityTableState"
