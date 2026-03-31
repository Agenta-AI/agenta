import {ReactNode} from "react"

import {TableProps, ColumnType} from "antd/es/table"

/**
 * Props for the renderAggregatedData function
 */
export interface RenderAggregatedDataParams<RecordType = any> {
    isSkeleton: boolean
    isCollapsed: boolean
    record: RecordType
}

/**
 * Enhanced column type that extends Ant Design's ColumnType with additional features
 */
export type EnhancedColumnType<RecordType = any> = Omit<ColumnType<RecordType>, "children"> & {
    /** Nested columns for grouped headers */
    children?: EnhancedColumnType<RecordType>[]

    /** If true, this column group can be collapsed */
    collapsible?: boolean

    /**
     * Whether to show the not-available cell for empty values on this column.
     * Defaults to inheriting from table-level `addNotAvailableCell` (which defaults to true).
     */
    addNotAvailableCell?: boolean

    /** Minimum width used when resizing */
    minWidth?: number

    /** Whether the column should be hidden by default in `EditColumns` */
    defaultHidden?: boolean

    key?: string

    /**
     * Function to render aggregated data for the column.
     * This will work when the column is collapsed.
     */
    renderAggregatedData?: (params: RenderAggregatedDataParams<RecordType>) => ReactNode
}

/**
 * Type guard to check if a column is a column group
 */
export function isColumnGroup<RecordType>(
    column: EnhancedColumnType<RecordType>,
): column is EnhancedColumnType<RecordType> & {children: EnhancedColumnType<RecordType>[]} {
    return !!(column as any).children
}

// Props for the `EnhancedTable` component
export interface EnhancedTableProps<RecordType> extends Omit<TableProps<RecordType>, "columns"> {
    columns: EnhancedColumnType<RecordType>[]
    /** Number of skeleton rows to show when loading and no data */
    skeletonRowCount?: number
    /** Show not available cell for empty values. Defaults to true */
    addNotAvailableCell?: boolean
    /** Enable virtualized rendering. Defaults to false */
    virtualized?: boolean
    /** Unique key for the table */
    uniqueKey: string
    /** Whether to show horizontal scrollbar */
    showHorizontalScrollBar?: boolean
}
