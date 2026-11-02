import type {Key, ReactNode} from "react"

import type {ColumnDef, ColumnDefs} from "../columnDef"

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
    columnProps?: Partial<ColumnDefs<Row>[number]>
    shouldCellUpdate?: ColumnDefs<Row>[number]["shouldCellUpdate"]
    exportLabel?: string
    exportEnabled?: boolean
    exportDataIndex?: ColumnDef<Row>["dataIndex"]
    exportValue?: (row: Row, column?: ColumnDefs<Row>[number], columnIndex?: number) => unknown
    exportFormatter?: (
        value: unknown,
        row: Row,
        column?: ColumnDefs<Row>[number],
        columnIndex?: number,
    ) => string | undefined
    exportMetadata?: unknown
}

export type TableColumnGroup<Row extends object> = TableColumnConfig<Row> | TableColumnConfig<Row>[]

export type TableColumnsBuilder<Row extends object> = (
    config: TableColumnGroup<Row>[],
) => ColumnDefs<Row>
