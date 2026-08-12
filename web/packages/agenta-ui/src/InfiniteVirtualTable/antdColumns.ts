import type {ColumnsType as AntdColumnsType} from "antd/es/table"

import type {ColumnDefs} from "./columnDef"

/**
 * The one place the table's own column model meets antd's.
 *
 * `ColumnDef` is deliberately narrower than antd's `ColumnType` in two spots — `dataIndex`
 * excludes antd's `SpecialString<RecordType>` arm (which admits the whole record type), and the
 * cell-props bags are keyed to `HTMLElement` rather than `any` — so the crossing is asserted
 * rather than inferred. Keep the assertion here; do not import antd column types elsewhere in
 * this directory.
 */
export const toAntdColumns = <RecordType>(columns: ColumnDefs<RecordType>) =>
    columns as unknown as AntdColumnsType<RecordType>

/** Columns arriving from an antd-typed call site, on their way into the table. */
export const fromAntdColumns = <RecordType>(columns: AntdColumnsType<RecordType>) =>
    columns as unknown as ColumnDefs<RecordType>
