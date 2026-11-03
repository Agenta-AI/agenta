import type {CSSProperties, HTMLAttributes, Key, ReactNode, TdHTMLAttributes} from "react"

/**
 * The table's own column model. It is structurally the shape `<Table>` consumes but owns no
 * antd types, so the rest of the table can be ported off antd one piece at a time. The antd
 * bridge lives in `./antdColumns`.
 *
 * Function-valued props are declared with METHOD syntax on purpose: method params are checked
 * bivariantly, so a column may annotate `render(value: string, …)` and still be assignable
 * here. That is what antd buys with `any`, without the `any`.
 */

export type ColumnAlign = "start" | "end" | "left" | "right" | "center" | "justify" | "match-parent"

export type ColumnFixed = "start" | "end" | "left" | "right" | boolean

export type ColumnEllipsis = boolean | {showTitle?: boolean}

export type ColumnRowScope = "row" | "rowgroup"

export type ColumnDataIndex = string | number | readonly (string | number)[]

export type ColumnSortOrder = "descend" | "ascend" | null

/** Props a column hands to a header or body cell — the `<td>`/`<th>` attribute bag. */
export type ColumnCellProps = HTMLAttributes<HTMLElement> & TdHTMLAttributes<HTMLElement>

/** A cell renderer may return a node, or a node plus cell overrides (colSpan, style, …). */
export interface RenderedColumnCell {
    props?: {
        key?: Key
        className?: string
        style?: CSSProperties
        colSpan?: number
        rowSpan?: number
    }
    children?: ReactNode
}

export type ColumnRenderResult = ReactNode | RenderedColumnCell

export interface ColumnFilterItem {
    text: ReactNode
    value: Key | boolean
    children?: ColumnFilterItem[]
}

/** Argument passed to the function form of `title`. Sort state is opaque — the virtual table
 * never sorts, and typing the column here would make every title contravariantly fragile. */
export interface ColumnTitleContext {
    sortOrder?: ColumnSortOrder
    sortColumns?: {column: unknown; order: ColumnSortOrder}[]
    filters?: Record<string, (Key | boolean)[]>
}

export type ColumnTitle = ReactNode | ((context: ColumnTitleContext) => ReactNode)

export type ColumnCompareFn<RecordType> = (
    a: RecordType,
    b: RecordType,
    sortOrder?: ColumnSortOrder,
) => number

export interface ColumnSorterConfig<RecordType> {
    compare?: ColumnCompareFn<RecordType>
    multiple?: number
}

interface ColumnDefBase<RecordType> {
    title?: ColumnTitle
    key?: Key
    className?: string
    hidden?: boolean
    fixed?: ColumnFixed
    ellipsis?: ColumnEllipsis
    align?: ColumnAlign
    rowScope?: ColumnRowScope
    width?: number | string
    minWidth?: number
    colSpan?: number
    rowSpan?: number
    onHeaderCell?(column: ColumnDefs<RecordType>[number], index?: number): ColumnCellProps
    onCell?(record: RecordType, index?: number): ColumnCellProps
    /** Sorting/filtering are declared for shape compatibility; the virtual table does not use them. */
    sorter?: boolean | ColumnCompareFn<RecordType> | ColumnSorterConfig<RecordType>
    sortOrder?: ColumnSortOrder
    defaultSortOrder?: ColumnSortOrder
    sortDirections?: ColumnSortOrder[]
    filtered?: boolean
    filters?: ColumnFilterItem[]
    filterMultiple?: boolean
    filteredValue?: (Key | boolean)[] | null
    defaultFilteredValue?: (Key | boolean)[] | null
    filterIcon?: ReactNode | ((filtered: boolean) => ReactNode)
    filterMode?: "menu" | "tree"
    onFilter?(value: Key | boolean, record: RecordType): boolean
    render?(value: unknown, record: RecordType, index: number): ColumnRenderResult
    shouldCellUpdate?(record: RecordType, prevRecord: RecordType): boolean
}

/** A leaf column: it maps a record to a cell. */
export interface ColumnDef<RecordType> extends ColumnDefBase<RecordType> {
    dataIndex?: ColumnDataIndex
}

/** A header group: it owns nested columns instead of a `dataIndex`. */
export interface ColumnGroupDef<RecordType> extends ColumnDefBase<RecordType> {
    children: ColumnDefs<RecordType>
}

/** The `columns` prop shape — leaves and groups, in render order. */
export type ColumnDefs<RecordType> = (ColumnDef<RecordType> | ColumnGroupDef<RecordType>)[]

export const isColumnGroupDef = <RecordType>(
    column: ColumnDefs<RecordType>[number],
): column is ColumnGroupDef<RecordType> =>
    "children" in column && Array.isArray((column as ColumnGroupDef<RecordType>).children)
