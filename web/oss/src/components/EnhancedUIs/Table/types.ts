import {TableProps, ColumnType} from "antd/es/table"

/**
 * Column definition used by `EnhancedTable`.
 *
 * It extends Ant Design's `ColumnType` with a few additional properties and
 * reintroduces the `children` field so column groups can be nested without
 * switching to `ColumnGroupType` explicitly.
 */
export interface EnhancedColumnType<RecordType> extends ColumnType<RecordType> {
    /** Nested columns for grouped headers */
    children?: EnhancedColumnType<RecordType>[]

    /** If true, this column group can be collapsed */
    collapsible?: boolean

    /** Minimum width used when resizing */
    minWidth?: number

    /** Whether the column should be hidden by default in `EditColumns` */
    defaultHidden?: boolean
}

// Props for the `EnhancedTable` component. Everything from Ant Design's
// `TableProps` is supported except `columns`, which must use the extended
// `EnhancedColumnType` interface above.
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
}
