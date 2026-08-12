import type {ColumnDef as TanstackColumnDef, RowData} from "@tanstack/react-table"

import type {ColumnDef, ColumnDefs} from "./columnDef"
import {isColumnGroupDef} from "./columnDef"
import type {VirtualTableFeatures} from "./tableFeatures"

/**
 * The one place the table's public column model meets TanStack's.
 *
 * `ColumnDef` stays the shape every call site writes — `dataIndex` / `title` / `render`, the
 * antd vocabulary 82 files already speak. TanStack's model lives behind this function, exactly
 * the way antd's lived behind `toAntdColumns`. Swapping the engine must not reach the callers.
 */

/** What the renderer needs that TanStack has no opinion about. */
export interface ColumnMeta<RecordType> {
    source: ColumnDef<RecordType>
}

const valueAt = <RecordType>(record: RecordType, column: ColumnDef<RecordType>): unknown => {
    const path = column.dataIndex
    if (path == null) return undefined
    const keys = Array.isArray(path) ? path : [path]
    return keys.reduce<unknown>(
        (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[String(key)]),
        record,
    )
}

const idOf = <RecordType>(column: ColumnDef<RecordType>, index: number): string =>
    String(
        column.key ??
            (Array.isArray(column.dataIndex) ? column.dataIndex.join(".") : column.dataIndex) ??
            index,
    )

/**
 * Widths: antd's `width` is a hard size, so it maps to TanStack `size` with `minSize` from
 * `minWidth`. TanStack needs a number, so a percentage width falls back to the min.
 */
const sizeOf = <RecordType>(column: ColumnDef<RecordType>): number =>
    typeof column.width === "number" ? column.width : (column.minWidth ?? 160)

export const toTanstackColumns = <RecordType extends RowData>(
    columns: ColumnDefs<RecordType>,
): TanstackColumnDef<VirtualTableFeatures, RecordType, unknown>[] =>
    columns.map((column, index) => {
        const id = idOf(column as ColumnDef<RecordType>, index)

        if (isColumnGroupDef(column)) {
            return {
                id,
                header: () =>
                    typeof column.title === "function" ? column.title({}) : column.title,
                columns: toTanstackColumns(column.children),
                meta: {source: column as unknown as ColumnDef<RecordType>},
            } as TanstackColumnDef<VirtualTableFeatures, RecordType, unknown>
        }

        const leaf = column as ColumnDef<RecordType>

        return {
            id,
            // accessorFn rather than accessorKey: dataIndex may be a path array, and a column
            // with only `render` has no accessor at all.
            accessorFn: (record: RecordType) => valueAt(record, leaf),
            header: () => (typeof leaf.title === "function" ? leaf.title({}) : leaf.title),
            size: sizeOf(leaf),
            minSize: leaf.minWidth ?? 40,
            enableHiding: true,
            enableResizing: true,
            meta: {source: leaf} satisfies ColumnMeta<RecordType>,
        } as TanstackColumnDef<VirtualTableFeatures, RecordType, unknown>
    })

/** Reads the original column back off a TanStack column, for rendering. */
export const sourceOf = <RecordType>(meta: unknown): ColumnDef<RecordType> | undefined =>
    (meta as ColumnMeta<RecordType> | undefined)?.source
