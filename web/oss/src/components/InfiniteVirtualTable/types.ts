import type {Key, ReactNode} from "react"

import type {ColumnsType, TableProps} from "antd/es/table"
import type {Getter} from "jotai"
import type {Store} from "jotai/vanilla/store"

import type {VisibilityRegistrationHandler} from "./components/ColumnVisibilityHeader"

export interface WindowingState {
    next: string | null
    stop?: string | null
    order?: string | null
    limit?: number | null
}

export interface InfiniteTablePage {
    offset: number
    limit: number
    cursor: string | null
    windowing: WindowingState | null
}

export interface InfiniteTableRowBase {
    key: React.Key
    __isSkeleton: boolean
    [key: string]: unknown
}

export interface InfiniteTableFetchParams<TMeta = unknown> {
    scopeId: string | null
    cursor: string | null
    limit: number
    offset: number
    windowing: WindowingState | null
    meta: TMeta | undefined
    get: Getter
}

export interface InfiniteTableFetchResult<ApiRow> {
    rows: ApiRow[]
    totalCount: number | null
    hasMore: boolean
    nextOffset: number | null
    nextCursor: string | null
    nextWindowing: WindowingState | null
}

export interface ColumnViewportVisibilityEvent {
    scopeId: string | null
    columnKey: string
    visible: boolean
}

export interface ColumnVisibilityState<RecordType> {
    allKeys: Key[]
    leafKeys: Key[]
    hiddenKeys: Key[]
    setHiddenKeys: (keys: Key[]) => void
    isHidden: (key: Key) => boolean
    showColumn: (key: Key) => void
    hideColumn: (key: Key) => void
    toggleColumn: (key: Key) => void
    toggleTree: (key: Key) => void
    reset: () => void
    visibleColumns: ColumnsType<RecordType>
    columnTree: ColumnTreeNode[]
    version: number
}

export interface ColumnTreeNode {
    key: Key
    label: string
    titleNode?: ReactNode
    checked: boolean
    indeterminate: boolean
    children: ColumnTreeNode[]
}

export interface ColumnVisibilityNodeMeta {
    title?: ReactNode
    searchValues?: (string | undefined)[]
    icon?: ReactNode
}

export type ColumnVisibilityNodeMetaResolver = (
    node: ColumnTreeNode,
) => ColumnVisibilityNodeMeta | Promise<ColumnVisibilityNodeMeta | undefined>

export interface ColumnVisibilityMenuRendererContext {
    scopeId: string | null
    onExport?: () => void
    isExporting?: boolean
}

export type ColumnVisibilityMenuRenderer<RecordType> = (
    controls: ColumnVisibilityState<RecordType>,
    close: () => void,
    context: ColumnVisibilityMenuRendererContext,
) => ReactNode

export type ColumnVisibilityMenuTriggerRenderer<RecordType> = (
    controls: ColumnVisibilityState<RecordType>,
    context: ColumnVisibilityMenuRendererContext,
) => ReactNode

export interface ColumnVisibilityConfig<RecordType> {
    storageKey?: string
    defaultHiddenKeys?: Key[]
    viewportTrackingEnabled?: boolean
    viewportMargin?: string
    viewportExitDebounceMs?: number
    onStateChange?: (state: ColumnVisibilityState<RecordType>) => void
    onViewportVisibilityChange?: (
        payload: ColumnViewportVisibilityEvent | ColumnViewportVisibilityEvent[],
    ) => void
    onContextChange?: (payload: {
        controls: ColumnVisibilityState<RecordType>
        registerHeader: VisibilityRegistrationHandler | null
        version: number
    }) => void
    renderMenuContent?: ColumnVisibilityMenuRenderer<RecordType>
    /**
     * Custom renderer for the menu trigger (gear icon).
     * When provided, replaces the default gear icon popover trigger.
     * Useful for rendering a dropdown menu instead of a popover.
     */
    renderMenuTrigger?: ColumnVisibilityMenuTriggerRenderer<RecordType>
    resolveNodeMeta?: ColumnVisibilityNodeMetaResolver
}

export interface InfiniteVirtualTableRowSelection<RecordType> {
    type?: "checkbox" | "radio"
    selectedRowKeys: Key[]
    onChange: (selectedRowKeys: Key[], selectedRows: RecordType[]) => void
    getCheckboxProps?: (record: RecordType) => {
        disabled?: boolean
        indeterminate?: boolean
    }
    columnWidth?: number
    fixed?: boolean
    /** Custom render for the selection cell */
    renderCell?: (
        value: boolean,
        record: RecordType,
        index: number,
        originNode: React.ReactNode,
    ) => React.ReactNode
}

export interface InfiniteVirtualTableKeyboardSelectionShortcuts {
    enabled?: boolean
    navigation?: boolean
    range?: boolean
    selectAll?: boolean
    clear?: boolean
}

export interface InfiniteVirtualTableKeyboardRowShortcuts<RecordType> {
    enabled?: boolean
    autoHighlightFirstRow?: boolean
    highlightOnHover?: boolean
    highlightClassName?: string
    scrollIntoViewOnChange?: boolean
    toggleSelectionWithSpace?: boolean
    onHighlightChange?: (payload: {key: Key | null; record: RecordType | null}) => void
    onOpen?: (payload: {key: Key; record: RecordType}) => void
    onDelete?: (payload: {
        key: Key
        record: RecordType
        selected: boolean
        selection: Key[]
    }) => void
    onExport?: (payload: {key: Key | null; record: RecordType | null; selection: Key[]}) => void
}

export interface InfiniteVirtualTableKeyboardShortcuts<RecordType = any> {
    enabled?: boolean
    selection?: boolean | InfiniteVirtualTableKeyboardSelectionShortcuts
    rows?: InfiniteVirtualTableKeyboardRowShortcuts<RecordType>
}

export interface ResizableColumnsConfig {
    minWidth?: number
}

/**
 * Expand icon render props passed to custom renderers
 */
export interface ExpandIconRenderProps<RecordType> {
    expanded: boolean
    onExpand: () => void
    record: RecordType
    loading: boolean
}

/**
 * Configuration for expandable rows in InfiniteVirtualTable.
 * Provides a minimal API for consumers to define how rows expand.
 */
export interface ExpandableRowConfig<RecordType, ChildType = unknown> {
    /**
     * Function to fetch child data when a row is expanded.
     * Should return a promise that resolves to an array of child items.
     */
    fetchChildren: (record: RecordType) => Promise<ChildType[]>

    /**
     * Render function for the expanded content.
     * Receives the parent record and its fetched children.
     */
    renderExpanded: (
        record: RecordType,
        children: ChildType[],
        loading: boolean,
        error: Error | null,
    ) => ReactNode

    /**
     * Optional: Determine if a row is expandable.
     * Defaults to true for all rows if not provided.
     */
    isExpandable?: (record: RecordType) => boolean

    /**
     * Optional: Custom expand icon renderer.
     */
    expandIcon?: (props: ExpandIconRenderProps<RecordType>) => ReactNode

    /**
     * Optional: Width of the expand column (default: 48)
     * Set to 0 when using showExpandIconInCell to hide the column.
     */
    columnWidth?: number

    /**
     * Optional: Fixed position of expand column (default: undefined)
     */
    fixed?: "left" | "right"

    /**
     * Optional: Cache fetched children to avoid re-fetching on collapse/expand.
     * Default: true
     */
    cacheChildren?: boolean

    /**
     * Optional: Accordion mode - only one row can be expanded at a time.
     * Default: false
     */
    accordion?: boolean

    /**
     * When true, the expand icon column is hidden and consumers should
     * render the expand icon within their own cell using renderExpandIcon.
     * Default: false
     */
    showExpandIconInCell?: boolean
}

export interface InfiniteVirtualTableProps<RecordType, ExpandedChildType = unknown> {
    columns: ColumnsType<RecordType>
    dataSource: RecordType[]
    loadMore: () => void
    rowKey: TableProps<RecordType>["rowKey"]
    active?: boolean
    scrollThreshold?: number
    containerClassName?: string
    tableClassName?: string
    tableProps?: Omit<TableProps<RecordType>, "columns" | "dataSource" | "onScroll" | "pagination">
    rowSelection?: InfiniteVirtualTableRowSelection<RecordType>
    resizableColumns?: boolean | ResizableColumnsConfig
    columnVisibility?: ColumnVisibilityConfig<RecordType>
    onColumnToggle?: (payload: {
        scopeId: string | null
        columnKey: string
        visible: boolean
    }) => void
    scopeId?: string | null
    beforeTable?: React.ReactNode
    useIsolatedStore?: boolean
    store?: Store | null
    bodyHeight?: number | null
    onHeaderHeightChange?: (height: number | null) => void
    keyboardShortcuts?: InfiniteVirtualTableKeyboardShortcuts<RecordType>
    /**
     * Configuration for expandable rows.
     * When provided, rows can be expanded to show child content.
     */
    expandable?: ExpandableRowConfig<RecordType, ExpandedChildType>
    /**
     * Ref to access the underlying Ant Design Table instance.
     * Useful for programmatic scrolling via `tableRef.current?.scrollTo({ index })`.
     */
    tableRef?: React.RefObject<{
        scrollTo: (config: {index: number; align?: "top" | "bottom" | "auto"}) => void
    } | null>
}
