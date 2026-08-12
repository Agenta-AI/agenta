import {useCallback, useMemo, useRef, useState} from "react"

import {useAtom} from "jotai"

import {getColumnWidthsAtom} from "../atoms/columnWidths"
import type {ColumnDef, ColumnDefs} from "../columnDef"
import {ResizableTitle, type ResizableTitleProps} from "../components/common/ResizableTitle"

const DEFAULT_MIN_WIDTH = 48

type ColumnEntry<RowType> = ColumnDefs<RowType>[number]
type ColumnWithChildren<RowType> = ColumnDef<RowType> & {children?: ColumnDefs<RowType>}

const getColumnChildren = <RowType>(column: ColumnEntry<RowType>) =>
    (column as ColumnWithChildren<RowType>).children

const collectLeafColumns = <RowType>(columns: ColumnDefs<RowType>): ColumnDef<RowType>[] => {
    const result: ColumnDef<RowType>[] = []
    const visit = (cols: ColumnDefs<RowType>) => {
        cols.forEach((col) => {
            const children = getColumnChildren(col)
            if (children && children.length) {
                visit(children)
            } else {
                result.push(col as ColumnDef<RowType>)
            }
        })
    }
    visit(columns)
    return result
}

const computeTotalWidth = <RowType>(
    columns: ColumnDefs<RowType>,
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
    columns: ColumnDefs<RowType>
    enabled?: boolean
    minWidth?: number
    scopeId?: string | null
}

export interface UseResizableColumnsResult<RowType> {
    columns: ColumnDefs<RowType>
    headerComponents: {
        cell: typeof ResizableTitle
    } | null
    getTotalWidth: (cols?: ColumnDefs<RowType>) => number
    isResizing: boolean
}

export const useResizableColumns = <RowType>({
    columns,
    enabled = false,
    minWidth = DEFAULT_MIN_WIDTH,
    scopeId = null,
}: UseResizableColumnsArgs<RowType>): UseResizableColumnsResult<RowType> => {
    const widthsAtom = useMemo(() => getColumnWidthsAtom(scopeId), [scopeId])
    const [columnWidths, setColumnWidths] = useAtom(widthsAtom)
    const [isResizing, setIsResizing] = useState(false)
    const columnMetaRef = useRef<Record<string, {minWidth: number}>>({})

    const commitWidth = useCallback(
        (colKey: string, width: number) => {
            const metaMinWidth = columnMetaRef.current[colKey]?.minWidth ?? minWidth
            const clamped = Math.max(width, metaMinWidth)
            setColumnWidths((prev) => {
                if (prev[colKey] === clamped) {
                    return prev
                }
                return {
                    ...prev,
                    [colKey]: clamped,
                }
            })
        },
        [minWidth, setColumnWidths],
    )

    const handleResize = useCallback(
        (colKey: string) =>
            (_: unknown, {size}: {size: {width: number}}) => {
                commitWidth(colKey, size.width)
            },
        [commitWidth],
    )

    const handleResizeStart = useCallback(() => {
        setIsResizing(true)
    }, [])

    const handleResizeStop = useCallback(
        (colKey: string) =>
            (_: unknown, {size}: {size: {width: number}}) => {
                commitWidth(colKey, size.width)
                setIsResizing(false)
            },
        [commitWidth],
    )

    const buildHeaderCellProps = useCallback(
        // Cast needed: Ant Design's onHeaderCell expects HTMLAttributes but we pass ResizableTitleProps
        (columnKey: string, width: number | undefined, minValue: number): ResizableTitleProps => ({
            width,
            minWidth: minValue,
            onResizeStart: handleResizeStart,
            onResize: handleResize(columnKey),
            onResizeStop: handleResizeStop(columnKey),
        }),
        [handleResize, handleResizeStart, handleResizeStop],
    )

    const makeColumnsResizable = useCallback(
        (cols: ColumnDefs<RowType>): ColumnDefs<RowType> =>
            cols.map((colEntry) => {
                const column = colEntry as ColumnDef<RowType> & {
                    children?: ColumnDefs<RowType>
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
                        column.children as ColumnDefs<RowType>,
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
        (cols: ColumnDefs<RowType> = resizableColumns) =>
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
