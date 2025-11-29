import {useCallback, useMemo, useRef, useState, type HTMLAttributes} from "react"

import type {ColumnsType, ColumnType} from "antd/es/table"
import {useAtom} from "jotai"

import {ResizableTitle} from "@/oss/components/EnhancedUIs/Table/assets/CustomCells"

import {getColumnWidthsAtom} from "../atoms/columnWidths"

const DEFAULT_MIN_WIDTH = 80

type ColumnEntry<RowType> = ColumnsType<RowType>[number]
type ColumnWithChildren<RowType> = ColumnType<RowType> & {children?: ColumnsType<RowType>}

const getColumnChildren = <RowType>(column: ColumnEntry<RowType>) =>
    (column as ColumnWithChildren<RowType>).children

const collectLeafColumns = <RowType>(columns: ColumnsType<RowType>): ColumnType<RowType>[] => {
    const result: ColumnType<RowType>[] = []
    const visit = (cols: ColumnsType<RowType>) => {
        cols.forEach((col) => {
            const children = getColumnChildren(col)
            if (children && children.length) {
                visit(children)
            } else {
                result.push(col as ColumnType<RowType>)
            }
        })
    }
    visit(columns)
    return result
}

const computeTotalWidth = <RowType>(
    columns: ColumnsType<RowType>,
    widthOverrides: Record<string, number>,
    minWidth: number,
): number => {
    const leafColumns = collectLeafColumns(columns)
    return leafColumns.reduce((sum, col) => {
        const key = (col?.key ?? col?.dataIndex ?? "") as string
        const width = widthOverrides[key] ?? (typeof col.width === "number" ? col.width : minWidth)
        return sum + width
    }, 0)
}

export interface UseResizableColumnsArgs<RowType> {
    columns: ColumnsType<RowType>
    enabled?: boolean
    minWidth?: number
    scopeId?: string | null
    onLiveResize?: (params: {columnKey: string; width: number; minWidth: number}) => void
}

export interface UseResizableColumnsResult<RowType> {
    columns: ColumnsType<RowType>
    headerComponents: {
        cell: typeof ResizableTitle
    } | null
    getTotalWidth: (cols?: ColumnsType<RowType>) => number
    isResizing: boolean
}

export const useResizableColumns = <RowType>({
    columns,
    enabled = false,
    minWidth = DEFAULT_MIN_WIDTH,
    scopeId = null,
    onLiveResize,
}: UseResizableColumnsArgs<RowType>): UseResizableColumnsResult<RowType> => {
    const widthsAtom = useMemo(() => getColumnWidthsAtom(scopeId), [scopeId])
    const [columnWidths, setColumnWidths] = useAtom(widthsAtom)
    const [isResizing, setIsResizing] = useState(false)
    const columnMetaRef = useRef<Record<string, {minWidth: number}>>({})
    const liveWidthsRef = useRef<Record<string, number>>({})

    const queueWidthUpdate = useCallback(
        (colKey: string, width: number) => {
            const metaMinWidth = columnMetaRef.current[colKey]?.minWidth ?? minWidth
            const clamped = Math.max(width, metaMinWidth)
            liveWidthsRef.current = {
                ...liveWidthsRef.current,
                [colKey]: clamped,
            }
            onLiveResize?.({columnKey: colKey, width: clamped, minWidth: metaMinWidth})
        },
        [minWidth, onLiveResize],
    )

    const handleResize = useCallback(
        (colKey: string) =>
            (_: unknown, {size}: {size: {width: number}}) => {
                queueWidthUpdate(colKey, size.width)
            },
        [queueWidthUpdate],
    )

    const handleResizeStart = useCallback(() => {
        setIsResizing(true)
    }, [])

    const handleResizeStop = useCallback(
        (colKey: string) =>
            (_: unknown, {size}: {size: {width: number}}) => {
                const metaMinWidth = columnMetaRef.current[colKey]?.minWidth ?? minWidth
                const clamped = Math.max(size.width, metaMinWidth)
                setColumnWidths((prev) => {
                    if (prev[colKey] === clamped) {
                        return prev
                    }
                    return {
                        ...prev,
                        [colKey]: clamped,
                    }
                })
                liveWidthsRef.current = {
                    ...liveWidthsRef.current,
                    [colKey]: clamped,
                }
                setIsResizing(false)
            },
        [minWidth, setColumnWidths],
    )

    const buildHeaderCellProps = useCallback(
        (columnKey: string, width: number | undefined, minValue: number) =>
            ({
                width,
                minWidth: minValue,
                onResizeStart: handleResizeStart,
                onResize: handleResize(columnKey),
                onResizeStop: handleResizeStop(columnKey),
            }) as unknown as HTMLAttributes<HTMLElement>,
        [handleResize, handleResizeStart, handleResizeStop],
    )

    const makeColumnsResizable = useCallback(
        (cols: ColumnsType<RowType>): ColumnsType<RowType> =>
            cols.map((colEntry) => {
                const column = colEntry as ColumnType<RowType> & {
                    children?: ColumnsType<RowType>
                }

                const colKey = (column.key ??
                    (Array.isArray(column.dataIndex)
                        ? column.dataIndex.join(".")
                        : typeof column.dataIndex === "string"
                          ? column.dataIndex
                          : Math.random().toString(36))) as string

                const hasChildren = Boolean(column.children && column.children.length)
                const isFixed = Boolean(column.fixed)

                if (hasChildren) {
                    const nextChildren = makeColumnsResizable(
                        column.children as ColumnsType<RowType>,
                    )
                    if (isFixed) {
                        return {
                            ...column,
                            key: colKey,
                            children: nextChildren,
                        } as typeof colEntry
                    }
                    const baseWidth =
                        typeof column.width === "number"
                            ? column.width
                            : typeof column.minWidth === "number"
                              ? column.minWidth
                              : undefined
                    const resolvedMinWidth =
                        typeof column.minWidth === "number" ? column.minWidth : minWidth
                    const width = columnWidths[colKey] ?? baseWidth ?? resolvedMinWidth
                    columnMetaRef.current[colKey] = {minWidth: resolvedMinWidth}
                    return {
                        ...column,
                        key: colKey,
                        width,
                        minWidth: resolvedMinWidth,
                        children: nextChildren,
                        onHeaderCell: () =>
                            buildHeaderCellProps(colKey, width ?? undefined, resolvedMinWidth),
                    } as typeof colEntry
                }

                if (isFixed) {
                    delete columnMetaRef.current[colKey]
                    return {
                        ...column,
                        key: colKey,
                    } as typeof colEntry
                }

                const baseWidth =
                    typeof column.width === "number"
                        ? column.width
                        : typeof column.minWidth === "number"
                          ? column.minWidth
                          : minWidth
                const resolvedMinWidth =
                    typeof column.minWidth === "number" ? column.minWidth : minWidth
                const width = columnWidths[colKey] ?? baseWidth
                columnMetaRef.current[colKey] = {minWidth: resolvedMinWidth}
                return {
                    ...column,
                    key: colKey,
                    width,
                    minWidth: resolvedMinWidth,
                    onHeaderCell: () => buildHeaderCellProps(colKey, width, resolvedMinWidth),
                } as typeof colEntry
            }),
        [buildHeaderCellProps, columnWidths, minWidth],
    )

    const resizableColumns = useMemo(() => {
        if (!enabled) return columns
        columnMetaRef.current = {}
        return makeColumnsResizable(columns)
    }, [columns, enabled, makeColumnsResizable])

    const getTotalWidth = useCallback(
        (cols: ColumnsType<RowType> = resizableColumns) =>
            computeTotalWidth(cols, columnWidths, minWidth),
        [columnWidths, minWidth, resizableColumns],
    )

    return {
        columns: resizableColumns,
        headerComponents: enabled ? {cell: ResizableTitle} : null,
        getTotalWidth,
        isResizing,
    }
}

export default useResizableColumns
