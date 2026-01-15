import {useCallback, useMemo, useRef, useState, type HTMLAttributes} from "react"

import type {ColumnsType, ColumnType} from "antd/es/table"
import {useAtom} from "jotai"

import {getColumnWidthsAtom} from "../atoms/columnWidths"
import {ResizableTitle} from "../components/common/ResizableTitle"

const DEFAULT_MIN_WIDTH = 150
const DEFAULT_COLUMN_WIDTH = 200

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

interface ColumnMeta {
    key: string
    isFixed: boolean // left/right fixed positioning
    hasMaxWidth: boolean // has maxWidth constraint
    width: number
    minWidth: number
    maxWidth?: number
}

export interface UseSmartResizableColumnsArgs<RowType> {
    columns: ColumnsType<RowType>
    enabled?: boolean
    minWidth?: number
    scopeId?: string | null
    containerWidth: number
    selectionColumnWidth: number
}

export interface UseSmartResizableColumnsResult<RowType> {
    columns: ColumnsType<RowType>
    headerComponents: {
        cell: typeof ResizableTitle
    } | null
    getTotalWidth: (cols?: ColumnsType<RowType>) => number
    isResizing: boolean
    /** Whether any column has been manually resized by the user */
    hasUserResizedAny: boolean
}

/**
 * Smart resizable columns hook that intelligently distributes available space
 *
 * Rules:
 * 1. Columns with maxWidth stay at maxWidth (fixed size)
 * 2. Columns without maxWidth (flexible) share remaining space proportionally
 * 3. On user resize: only resize that column, allow horizontal scroll if needed
 * 4. On container resize: redistribute space among flexible columns
 */
export const useSmartResizableColumns = <RowType>({
    columns,
    enabled = false,
    minWidth = DEFAULT_MIN_WIDTH,
    scopeId = null,
    containerWidth,
    selectionColumnWidth,
}: UseSmartResizableColumnsArgs<RowType>): UseSmartResizableColumnsResult<RowType> => {
    const widthsAtom = useMemo(() => getColumnWidthsAtom(scopeId), [scopeId])
    const [userResizedWidths, setUserResizedWidths] = useAtom(widthsAtom)
    const [isResizing, setIsResizing] = useState(false)
    const columnMetaRef = useRef<Record<string, ColumnMeta>>({})

    // Extract column metadata
    const analyzeColumns = useCallback(
        (cols: ColumnsType<RowType>): ColumnMeta[] => {
            const leafColumns = collectLeafColumns(cols)
            return leafColumns.map((col) => {
                const key = (col?.key ?? col?.dataIndex ?? "") as string
                const isFixed = Boolean(col.fixed)
                const hasMaxWidth =
                    typeof (col as any).maxWidth === "number" && (col as any).maxWidth > 0

                const defaultWidth =
                    typeof col.width === "number"
                        ? col.width
                        : typeof col.minWidth === "number"
                          ? col.minWidth
                          : DEFAULT_COLUMN_WIDTH

                const resolvedMinWidth = typeof col.minWidth === "number" ? col.minWidth : minWidth

                const maxWidthValue = hasMaxWidth ? (col as any).maxWidth : undefined

                return {
                    key,
                    isFixed,
                    hasMaxWidth,
                    width: defaultWidth,
                    minWidth: resolvedMinWidth,
                    maxWidth: maxWidthValue,
                }
            })
        },
        [minWidth],
    )

    // Compute smart widths based on available space
    // KEY CONSTRAINT: Total width must always >= containerWidth
    const computeSmartWidths = useCallback(
        (columnsMeta: ColumnMeta[]): Record<string, number> => {
            const result: Record<string, number> = {}

            // 1. Separate columns by type
            const fixedPositionCols = columnsMeta.filter((c) => c.isFixed)
            const constrainedCols = columnsMeta.filter((c) => !c.isFixed && c.hasMaxWidth)
            const flexibleCols = columnsMeta.filter((c) => !c.isFixed && !c.hasMaxWidth)

            // 2. Calculate fixed widths (these NEVER change)
            let fixedWidth = selectionColumnWidth

            // Fixed position columns use their ORIGINAL width (never user-resized)
            for (const col of fixedPositionCols) {
                result[col.key] = col.width
                fixedWidth += col.width
            }

            // Constrained columns use their maxWidth
            for (const col of constrainedCols) {
                const width = col.maxWidth!
                result[col.key] = width
                fixedWidth += width
            }

            // 3. Calculate widths for flexible columns
            if (flexibleCols.length === 0) {
                return result
            }

            // Available space for flexible columns (must be filled!)
            const availableForFlexible = Math.max(0, containerWidth - fixedWidth)

            // Separate user-resized and non-resized flexible columns
            const userResizedFlexCols = flexibleCols.filter(
                (c) => userResizedWidths[c.key] !== undefined,
            )
            const nonResizedFlexCols = flexibleCols.filter(
                (c) => userResizedWidths[c.key] === undefined,
            )

            // Calculate space taken by user-resized columns
            let userResizedTotal = 0
            for (const col of userResizedFlexCols) {
                const width = Math.max(userResizedWidths[col.key]!, col.minWidth)
                result[col.key] = width
                userResizedTotal += width
            }

            // Remaining space for non-resized columns
            const remainingForNonResized = availableForFlexible - userResizedTotal

            if (nonResizedFlexCols.length === 0) {
                // All flexible columns have been user-resized
                // If total < available, we need to expand the last resized column
                // to maintain the sum constraint
                if (userResizedTotal < availableForFlexible && userResizedFlexCols.length > 0) {
                    const lastCol = userResizedFlexCols[userResizedFlexCols.length - 1]
                    const deficit = availableForFlexible - userResizedTotal
                    result[lastCol.key] = (result[lastCol.key] ?? 0) + deficit
                }
                return result
            }

            // Distribute remaining space among non-resized columns
            // Use default width as floor to ensure readability, allow horizontal scroll if needed
            const totalDefaultWeight = nonResizedFlexCols.reduce((sum, col) => sum + col.width, 0)

            if (remainingForNonResized <= 0) {
                // User-resized columns take all space, use default width for others
                // This may cause total > container, enabling horizontal scroll
                for (const col of nonResizedFlexCols) {
                    result[col.key] = col.width
                }
            } else if (remainingForNonResized < totalDefaultWeight) {
                // Not enough space for all at default width - use default widths
                // and allow horizontal scrolling rather than squeezing columns
                for (const col of nonResizedFlexCols) {
                    result[col.key] = col.width
                }
            } else {
                // Enough space - distribute proportionally
                for (const col of nonResizedFlexCols) {
                    const proportion = col.width / totalDefaultWeight
                    const computedWidth = remainingForNonResized * proportion
                    // Use default width as floor, not minWidth
                    result[col.key] = Math.max(computedWidth, col.width)
                }
            }

            return result
        },
        [containerWidth, selectionColumnWidth, userResizedWidths, minWidth],
    )

    const commitWidth = useCallback(
        (colKey: string, width: number) => {
            const meta = columnMetaRef.current[colKey]
            if (!meta) return

            const clamped = Math.max(
                width,
                meta.minWidth,
                meta.maxWidth ? Math.min(width, meta.maxWidth) : width,
            )

            setUserResizedWidths((prev) => {
                if (prev[colKey] === clamped) return prev
                return {
                    ...prev,
                    [colKey]: clamped,
                }
            })
        },
        [setUserResizedWidths],
    )

    const handleResize = useCallback(
        (_colKey: string) => (_: unknown, _size: {size: {width: number}}) => {
            // During drag, don't commit to state to avoid jank
            // ResizableTitle handles visual feedback
        },
        [],
    )

    const handleResizeStart = useCallback(() => {
        setIsResizing(true)
    }, [])

    const handleResizeStop = useCallback(
        (colKey: string) =>
            (_: unknown, {size}: {size: {width: number}}) => {
                // Only commit width when drag ends for smooth performance
                commitWidth(colKey, size.width)
                setIsResizing(false)
            },
        [commitWidth],
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
        (
            cols: ColumnsType<RowType>,
            computedWidths: Record<string, number>,
        ): ColumnsType<RowType> =>
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
                        computedWidths,
                    )
                    return {
                        ...column,
                        key: colKey,
                        children: nextChildren,
                    } as typeof colEntry
                }

                const width = computedWidths[colKey]
                if (!width) {
                    // No computed width, use original
                    return {
                        ...column,
                        key: colKey,
                    } as typeof colEntry
                }

                const meta = columnMetaRef.current[colKey]
                if (!meta) {
                    return {
                        ...column,
                        key: colKey,
                        width,
                    } as typeof colEntry
                }

                if (isFixed) {
                    // Fixed position columns - keep their width but don't make resizable
                    return {
                        ...column,
                        key: colKey,
                        width,
                    } as typeof colEntry
                }

                return {
                    ...column,
                    key: colKey,
                    width,
                    minWidth: meta.minWidth,
                    onHeaderCell: () => buildHeaderCellProps(colKey, width, meta.minWidth),
                } as typeof colEntry
            }),
        [buildHeaderCellProps],
    )

    const resizableColumns = useMemo(() => {
        if (!enabled) return columns

        // Analyze columns to build metadata
        const meta = analyzeColumns(columns)
        columnMetaRef.current = meta.reduce(
            (acc, m) => {
                acc[m.key] = m
                return acc
            },
            {} as Record<string, ColumnMeta>,
        )

        // Compute smart widths
        const computedWidths = computeSmartWidths(meta)

        // Apply widths to columns
        return makeColumnsResizable(columns, computedWidths)
    }, [columns, enabled, analyzeColumns, computeSmartWidths, makeColumnsResizable])

    const getTotalWidth = useCallback(
        (cols: ColumnsType<RowType> = resizableColumns) => {
            const leafColumns = collectLeafColumns(cols)
            return leafColumns.reduce((sum, col) => {
                const width = typeof col.width === "number" ? col.width : minWidth
                return sum + width
            }, 0)
        },
        [minWidth, resizableColumns],
    )

    // Check if any column has been user-resized
    const hasUserResizedAny = useMemo(
        () => Object.keys(userResizedWidths).length > 0,
        [userResizedWidths],
    )

    return {
        columns: resizableColumns,
        headerComponents: enabled ? {cell: ResizableTitle} : null,
        getTotalWidth,
        isResizing,
        hasUserResizedAny,
    }
}

export default useSmartResizableColumns
