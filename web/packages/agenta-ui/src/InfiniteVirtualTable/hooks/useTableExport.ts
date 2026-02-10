import {useCallback} from "react"

import type {ColumnsType} from "antd/es/table"

import type {InfiniteTableRowBase} from "../types"

export const EXPORT_RESOLVE_SKIP = Symbol("EXPORT_RESOLVE_SKIP")

// Extended column type with custom properties used in this codebase
interface ExtendedColumnProps {
    visibilityHidden?: boolean
    visibilityLocked?: boolean
    columnProps?: {hidden?: boolean}
    children?: ColumnsType<InfiniteTableRowBase>
    dataIndex?: string | number | readonly (string | number)[]
    key?: React.Key
    title?: React.ReactNode
    exportLabel?: string
    exportTitle?: string
    exportValue?: (row: unknown, column: unknown, index: number) => unknown
    exportDataIndex?: string | number | readonly (string | number)[]
    exportFormatter?: (value: unknown, row: unknown, column: unknown, index: number) => string
    exportEnabled?: boolean
}

type ColumnWithExtensions<Row> = ColumnsType<Row>[number] & ExtendedColumnProps

const columnIsHidden = <Row extends InfiniteTableRowBase>(
    column: ColumnsType<Row>[number],
): boolean => {
    const extColumn = column as ColumnWithExtensions<Row>
    if (extColumn?.visibilityHidden) return true
    if (extColumn?.visibilityLocked === false && extColumn?.columnProps?.hidden) return true
    return false
}

const flattenColumns = <Row extends InfiniteTableRowBase>(
    columns: ColumnsType<Row>,
): ColumnsType<Row> => {
    const flat: ColumnsType<Row> = []
    columns.forEach((column) => {
        if (!column) return
        const extColumn = column as ColumnWithExtensions<Row>
        if (extColumn.children && extColumn.children.length) {
            flat.push(...flattenColumns(extColumn.children as ColumnsType<Row>))
        } else {
            flat.push(column)
        }
    })
    return flat
}

const getColumnIdentifier = <Row extends InfiniteTableRowBase>(
    column: ColumnsType<Row>[number],
    index: number,
) => {
    const extColumn = column as ColumnWithExtensions<Row>
    const dataIndex = extColumn?.dataIndex
    if (Array.isArray(dataIndex)) {
        return dataIndex.join(".")
    }
    if (dataIndex !== undefined && dataIndex !== null) {
        return String(dataIndex)
    }
    if (extColumn?.key !== undefined && extColumn?.key !== null) {
        return String(extColumn.key)
    }
    return String(index)
}

const getColumnKey = <Row extends InfiniteTableRowBase>(
    column: ColumnsType<Row>[number],
    index: number,
) => {
    const extColumn = column as ColumnWithExtensions<Row>
    if (extColumn?.key !== undefined && extColumn?.key !== null) {
        return String(extColumn.key)
    }
    return getColumnIdentifier<Row>(column, index)
}

const getColumnLabel = <Row extends InfiniteTableRowBase>(
    column: ColumnsType<Row>[number],
    index: number,
) => {
    const extColumn = column as ColumnWithExtensions<Row>
    const title = extColumn?.exportLabel ?? extColumn?.exportTitle ?? extColumn?.title
    if (typeof title === "string") return title
    if (typeof title === "number") return String(title)
    return getColumnIdentifier<Row>(column, index)
}

const getCellText = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return JSON.stringify(value)
}

const createCsvRow = (values: string[]) =>
    values
        .map((value) => {
            if (value.includes(",") || value.includes('"') || value.includes("\n")) {
                return `"${value.replace(/"/g, '""')}"`
            }
            return value
        })
        .join(",")

const getValueFromRowDataIndex = (row: unknown, dataIndex: unknown): unknown => {
    if (Array.isArray(dataIndex)) {
        return dataIndex.reduce<unknown>((acc, segment) => {
            if (acc === null || acc === undefined) {
                return undefined
            }
            return (acc as Record<string, unknown>)[segment]
        }, row)
    }
    if (
        typeof dataIndex === "string" ||
        typeof dataIndex === "number" ||
        typeof dataIndex === "symbol"
    ) {
        return (row as Record<string | number | symbol, unknown>)?.[dataIndex]
    }
    return undefined
}

const getColumnValueFromMetadata = <Row extends InfiniteTableRowBase>({
    column,
    columnIndex,
    row,
}: TableExportValueArgs<Row>): unknown => {
    const extColumn = column as ColumnWithExtensions<Row>

    if (typeof extColumn?.exportValue === "function") {
        const value = extColumn.exportValue(row, column, columnIndex)
        if (value !== undefined) {
            return value
        }
    }

    const exportDataIndex = extColumn?.exportDataIndex ?? extColumn?.dataIndex
    const viaDataIndex = getValueFromRowDataIndex(row, exportDataIndex)
    if (viaDataIndex !== undefined) {
        return viaDataIndex
    }

    const rowRecord = row as Record<string, unknown>
    const key = extColumn?.key
    if (key !== undefined && typeof key === "string" && rowRecord?.[key] !== undefined) {
        return rowRecord[key]
    }

    const identifier = getColumnIdentifier<Row>(column, columnIndex)
    return rowRecord?.[identifier]
}

const formatExportValue = <Row extends InfiniteTableRowBase>(
    value: unknown,
    args: TableExportValueArgs<Row>,
    formatValue?: TableExportOptions<Row>["formatValue"],
): string => {
    const extColumn = args.column as ColumnWithExtensions<Row>
    if (typeof extColumn?.exportFormatter === "function") {
        const formatted = extColumn.exportFormatter(value, args.row, args.column, args.columnIndex)
        if (formatted !== undefined) {
            return formatted
        }
    }

    if (formatValue) {
        const formatted = formatValue(value, args)
        if (formatted !== undefined) {
            return formatted
        }
    }

    return getCellText(value)
}

const filterSkeletonRows = <Row extends InfiniteTableRowBase>(
    rows: Row[],
    includeSkeletonRows?: boolean,
) => {
    if (includeSkeletonRows) return rows
    return rows.filter((row) => !row.__isSkeleton)
}

export interface TableExportColumnContext<Row extends InfiniteTableRowBase> {
    column: ColumnsType<Row>[number]
    columnIndex: number
}

export interface TableExportValueArgs<
    Row extends InfiniteTableRowBase,
> extends TableExportColumnContext<Row> {
    row: Row
}

export interface TableExportOptions<Row extends InfiniteTableRowBase> {
    filename?: string
    isColumnExportable?: (context: TableExportColumnContext<Row>) => boolean
    getValue?: (args: TableExportValueArgs<Row>) => unknown
    formatValue?: (value: unknown, args: TableExportValueArgs<Row>) => string | undefined
    includeSkeletonRows?: boolean
    beforeExport?: (rows: Row[]) => void | Row[] | Promise<void | Row[]>
    resolveValue?: (args: TableExportResolveArgs<Row>) => unknown | Promise<unknown>
    resolveColumnLabel?: (context: TableExportColumnContext<Row>) => string | undefined
}

export interface TableExportParams<
    Row extends InfiniteTableRowBase,
> extends TableExportOptions<Row> {
    columns: ColumnsType<Row>
    rows: Row[]
}

export interface TableExportResolveArgs<
    Row extends InfiniteTableRowBase,
> extends TableExportValueArgs<Row> {
    rowIndex: number
    columnKey: string
    columnIdentifier: string
    currentValue: unknown
}

export const useTableExport = <Row extends InfiniteTableRowBase>() => {
    return useCallback(async (params: TableExportParams<Row>) => {
        const {
            columns,
            rows,
            filename = "table-export.csv",
            isColumnExportable,
            getValue,
            formatValue,
            includeSkeletonRows,
            beforeExport,
            resolveValue,
            resolveColumnLabel,
        } = params

        if (!columns.length || !rows.length) return

        let filteredRows = filterSkeletonRows(rows, includeSkeletonRows)
        if (!filteredRows.length) return

        if (beforeExport) {
            const result = await beforeExport(filteredRows)
            // If beforeExport returns rows, use those (allows beforeExport to load more data)
            if (result && Array.isArray(result)) {
                filteredRows = filterSkeletonRows(result as Row[], includeSkeletonRows)
                if (!filteredRows.length) return
            }
        }

        const flatColumns = flattenColumns(columns).filter((column, index) => {
            if (columnIsHidden<Row>(column)) return false
            const extColumn = column as ColumnWithExtensions<Row>
            if (extColumn?.exportEnabled === false) return false
            if (isColumnExportable) {
                return isColumnExportable({column, columnIndex: index})
            }
            return true
        })
        if (!flatColumns.length) return

        const headers = flatColumns.map((column, index) => {
            const override = resolveColumnLabel?.({column, columnIndex: index})
            return override ?? getColumnLabel(column, index)
        })

        const csvRows = [createCsvRow(headers)]

        // Build cell metadata for all cells
        interface CellMeta {
            rowIndex: number
            columnIndex: number
            column: (typeof flatColumns)[number]
            row: Row
            columnKey: string
            columnIdentifier: string
            initialValue: unknown
        }
        const cellMetas: CellMeta[] = []

        for (let rowIndex = 0; rowIndex < filteredRows.length; rowIndex += 1) {
            const row = filteredRows[rowIndex]
            for (let columnIndex = 0; columnIndex < flatColumns.length; columnIndex += 1) {
                const column = flatColumns[columnIndex]
                const columnKey = getColumnKey(column, columnIndex)
                const columnIdentifier = getColumnIdentifier(column, columnIndex)
                const context: TableExportValueArgs<Row> = {column, columnIndex, row}
                const override = getValue !== undefined ? getValue(context) : undefined
                const initialValue =
                    override !== undefined ? override : getColumnValueFromMetadata<Row>(context)

                cellMetas.push({
                    rowIndex,
                    columnIndex,
                    column,
                    row,
                    columnKey,
                    columnIdentifier,
                    initialValue,
                })
            }
        }

        // Resolve all cell values at once - the underlying batchers handle API batching
        const resolvedValues: unknown[] = new Array(cellMetas.length)

        if (resolveValue) {
            const allPromises = cellMetas.map((meta, i) => {
                const context: TableExportValueArgs<Row> = {
                    column: meta.column,
                    columnIndex: meta.columnIndex,
                    row: meta.row,
                }
                return Promise.resolve(
                    resolveValue({
                        ...context,
                        rowIndex: meta.rowIndex,
                        columnKey: meta.columnKey,
                        columnIdentifier: meta.columnIdentifier,
                        currentValue: meta.initialValue,
                    }),
                ).then((resolved: unknown) => ({index: i, value: resolved}))
            })

            const allResults = await Promise.all(allPromises)
            for (const {index, value} of allResults) {
                if (value === EXPORT_RESOLVE_SKIP) {
                    resolvedValues[index] = cellMetas[index].initialValue
                } else if (value !== undefined) {
                    resolvedValues[index] = value
                } else {
                    resolvedValues[index] = cellMetas[index].initialValue
                }
            }
        } else {
            // No resolver, use initial values
            for (let i = 0; i < cellMetas.length; i++) {
                resolvedValues[i] = cellMetas[i].initialValue
            }
        }

        // Build CSV rows from resolved values
        const numColumns = flatColumns.length
        for (let rowIndex = 0; rowIndex < filteredRows.length; rowIndex += 1) {
            const values: string[] = []
            for (let columnIndex = 0; columnIndex < numColumns; columnIndex += 1) {
                const cellIndex = rowIndex * numColumns + columnIndex
                const meta = cellMetas[cellIndex]
                const rawValue = resolvedValues[cellIndex]
                const context: TableExportValueArgs<Row> = {
                    column: meta.column,
                    columnIndex: meta.columnIndex,
                    row: meta.row,
                }
                values.push(formatExportValue(rawValue, context, formatValue))
            }
            csvRows.push(createCsvRow(values))
        }

        const blob = new Blob([csvRows.join("\n")], {type: "text/csv;charset=utf-8;"})
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.setAttribute("download", filename)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setTimeout(() => URL.revokeObjectURL(url), 500)
    }, [])
}

export default useTableExport
