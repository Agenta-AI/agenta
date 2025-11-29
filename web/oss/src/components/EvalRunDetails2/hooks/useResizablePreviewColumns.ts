import {useCallback, useMemo, useState} from "react"

import type {ColumnsType, ColumnType} from "antd/es/table"

import {ResizableTitle} from "@/oss/components/EnhancedUIs/Table/assets/CustomCells"

interface UseResizablePreviewColumnsArgs<RowType> {
    baseColumns: ColumnsType<RowType>
}

interface UseResizablePreviewColumnsResult<RowType> {
    columns: ColumnsType<RowType>
    totalWidth: number
    components: {
        header: {
            cell: typeof ResizableTitle
        }
    }
}

const MIN_WIDTH = 80

const collectLeafColumns = <RowType>(columns: ColumnsType<RowType>): ColumnType<RowType>[] => {
    const result: ColumnType<RowType>[] = []
    const visit = (cols: ColumnsType<RowType>) => {
        cols.forEach((col) => {
            if (col?.children && col.children.length) {
                visit(col.children as ColumnsType<RowType>)
            } else {
                result.push(col)
            }
        })
    }
    visit(columns)
    return result
}

const computeTotalWidth = <RowType>(
    columns: ColumnsType<RowType>,
    widthOverrides: Record<string, number>,
): number => {
    const leafColumns = collectLeafColumns(columns)
    return leafColumns.reduce((sum, col) => {
        const key = (col?.key ?? col?.dataIndex ?? "") as string
        const width = widthOverrides[key] ?? (typeof col.width === "number" ? col.width : MIN_WIDTH)
        return sum + width
    }, 0)
}

export const useResizablePreviewColumns = <RowType>({
    baseColumns,
}: UseResizablePreviewColumnsArgs<RowType>): UseResizablePreviewColumnsResult<RowType> => {
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})

    const commitWidth = useCallback((colKey: string, width: number) => {
        const clamped = Math.max(width, MIN_WIDTH)
        setColumnWidths((prev) => {
            if (prev[colKey] === clamped) {
                return prev
            }
            return {
                ...prev,
                [colKey]: clamped,
            }
        })
    }, [])

    const handleResize = useCallback(
        (colKey: string) =>
            (_: any, {size}: {size: {width: number}}) => {
                commitWidth(colKey, size.width)
            },
        [commitWidth],
    )

    const handleResizeStop = useCallback(
        (colKey: string) =>
            (_: any, {size}: {size: {width: number}}) => {
                commitWidth(colKey, size.width)
            },
        [commitWidth],
    )

    const makeColumnsResizable = useCallback(
        (cols: ColumnsType<RowType>): ColumnsType<RowType> =>
            cols.map((col) => {
                const colKey = (col?.key ?? col?.dataIndex ?? Math.random().toString(36)) as string

                if (col?.children && col.children.length) {
                    const nextChildren = makeColumnsResizable(col.children as ColumnsType<RowType>)
                    const baseWidth =
                        typeof col.width === "number"
                            ? col.width
                            : typeof col.minWidth === "number"
                              ? col.minWidth
                              : undefined
                    const resolvedMinWidth =
                        typeof col.minWidth === "number" ? col.minWidth : MIN_WIDTH
                    const width = columnWidths[colKey] ?? baseWidth ?? resolvedMinWidth
                    return {
                        ...col,
                        key: colKey,
                        width,
                        minWidth:
                            typeof col.minWidth === "number" ? col.minWidth : resolvedMinWidth,
                        children: nextChildren,
                        onHeaderCell: () => ({
                            width: width ?? undefined,
                            minWidth: resolvedMinWidth,
                            onResize: handleResize(colKey),
                            onResizeStop: handleResizeStop(colKey),
                        }),
                    }
                }

                const baseWidth =
                    typeof col.width === "number"
                        ? col.width
                        : typeof col.minWidth === "number"
                          ? col.minWidth
                          : MIN_WIDTH
                const resolvedMinWidth = typeof col.minWidth === "number" ? col.minWidth : MIN_WIDTH
                const width = columnWidths[colKey] ?? baseWidth
                return {
                    ...col,
                    key: colKey,
                    width,
                    minWidth: resolvedMinWidth,
                    onHeaderCell: () => ({
                        width,
                        minWidth: resolvedMinWidth,
                        onResize: handleResize(colKey),
                        onResizeStop: handleResizeStop(colKey),
                    }),
                }
            }),
        [columnWidths, handleResize, handleResizeStop],
    )

    const resizableColumns = useMemo(
        () => makeColumnsResizable(baseColumns),
        [baseColumns, makeColumnsResizable],
    )

    const totalWidth = useMemo(() => {
        const computed = computeTotalWidth(resizableColumns, columnWidths)
        const leafCount = collectLeafColumns(resizableColumns).length
        return Math.max(computed, leafCount * MIN_WIDTH)
    }, [resizableColumns, columnWidths])

    const components = useMemo(
        () => ({
            header: {
                cell: ResizableTitle,
            },
        }),
        [],
    )

    return {columns: resizableColumns, totalWidth, components}
}

export default useResizablePreviewColumns
