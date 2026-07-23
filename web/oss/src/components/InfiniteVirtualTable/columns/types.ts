import type {Key, ReactNode} from "react"

import type {ExtendedColumn} from "@agenta/ui/table"
import type {ColumnsType, ColumnType} from "antd/es/table"

/**
 * Alias of the canonical extended column in @agenta/ui/table. This local copy
 * of InfiniteVirtualTable is being retired; consumers should move to the package.
 */
export type ExtendedColumnType<RecordType> = ExtendedColumn<RecordType>

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
