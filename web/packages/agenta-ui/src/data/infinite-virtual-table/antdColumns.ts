import type {ColumnsType as AntdColumnsType} from "antd/es/table"

import type {ColumnCellProps, ColumnDefs} from "./columnDef"
import {isColumnGroupDef} from "./columnDef"
import {AVT} from "./tableDom"

/**
 * The one place the table's own column model meets antd's.
 *
 * `ColumnDef` is deliberately narrower than antd's `ColumnType` in two spots — `dataIndex`
 * excludes antd's `SpecialString<RecordType>` arm (which admits the whole record type), and the
 * cell-props bags are keyed to `HTMLElement` rather than `any` — so the crossing is asserted
 * rather than inferred. Keep the assertion here; do not import antd column types elsewhere in
 * this directory.
 */

const withClass = (props: ColumnCellProps | undefined, className: string): ColumnCellProps => ({
    ...props,
    className: props?.className ? `${props.className} ${className}` : className,
})

/**
 * Stamps the stable cell hooks. Cells are recycled by virtualization, so they cannot be
 * stamped from a mount effect the way the structural nodes are.
 */
const withCellHooks = <RecordType>(columns: ColumnDefs<RecordType>): ColumnDefs<RecordType> =>
    columns.map((column) => {
        const next = {
            ...column,
            onCell: (record: RecordType, index?: number) =>
                withClass(column.onCell?.(record, index), AVT.cell),
            onHeaderCell: (col: ColumnDefs<RecordType>[number], index?: number) =>
                withClass(column.onHeaderCell?.(col, index), AVT.headerCell),
        }
        return isColumnGroupDef(column) ? {...next, children: withCellHooks(column.children)} : next
    }) as ColumnDefs<RecordType>

export const toAntdColumns = <RecordType>(columns: ColumnDefs<RecordType>) =>
    withCellHooks(columns) as unknown as AntdColumnsType<RecordType>

/** Columns arriving from an antd-typed call site, on their way into the table. */
export const fromAntdColumns = <RecordType>(columns: AntdColumnsType<RecordType>) =>
    columns as unknown as ColumnDefs<RecordType>
