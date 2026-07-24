import type {Key, ReactNode} from "react"

import type {ColumnsType, ColumnType} from "antd/es/table"

/**
 * antd column extended with the custom props the InfiniteVirtualTable layer
 * consumes at runtime (column visibility menu, smart resizing, export).
 */
export type ExtendedColumnType<RecordType> = ColumnsType<RecordType>[number] & {
    key?: Key
    children?: ExtendedColumnType<RecordType>[]
    /** Custom node shown for this column in the visibility menu */
    columnVisibilityTitle?: ReactNode
    /** Label shown for this column in the visibility menu */
    columnVisibilityLabel?: string
    /** Lock column from being hidden via the visibility menu */
    columnVisibilityLocked?: boolean
    /** Hide the column by default (until toggled visible) */
    defaultHidden?: boolean
    /** Max width constraint consumed by smart resizable columns */
    maxWidth?: number
    /** Include the column in table export */
    exportEnabled?: boolean
}

export interface TableColumnCell<Row extends object> {
    render: (row: Row, rowIndex: number) => ReactNode
    align?: "left" | "right" | "center"
    className?: string
}

export interface TableColumnConfig<Row extends object> {
    key: Key
    title?: ReactNode | ((context: {column: TableColumnConfig<Row>; depth: number}) => ReactNode)
    width?: number
    minWidth?: number
    flex?: number
    align?: "left" | "right" | "center"
    fixed?: "left" | "right"
    ellipsis?: boolean
    className?: string
    defaultHidden?: boolean
    visibilityKey?: string
    visibilityLabel?: string
    visibilityLocked?: boolean
    visibilityTitle?: ReactNode
    cell?: TableColumnCell<Row>
    children?: TableColumnConfig<Row>[]
    columnProps?: Partial<ColumnsType<Row>[number]>
    shouldCellUpdate?: ColumnsType<Row>[number]["shouldCellUpdate"]
    exportLabel?: string
    exportEnabled?: boolean
    // Only ColumnType carries dataIndex (group columns don't), so index off ColumnType.
    exportDataIndex?: ColumnType<Row>["dataIndex"]
    exportValue?: (row: Row, column?: ColumnsType<Row>[number], columnIndex?: number) => unknown
    exportFormatter?: (
        value: unknown,
        row: Row,
        column?: ColumnsType<Row>[number],
        columnIndex?: number,
    ) => string | undefined
    exportMetadata?: unknown
}

export type TableColumnGroup<Row extends object> = TableColumnConfig<Row> | TableColumnConfig<Row>[]

export type TableColumnsBuilder<Row extends object> = (
    config: TableColumnGroup<Row>[],
) => ColumnsType<Row>
