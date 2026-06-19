import {useCallback, useMemo, useRef, useState} from "react"

import type {ColumnsType, ColumnType} from "antd/es/table"
import {useAtom} from "jotai"

import {getColumnWidthsAtom} from "../atoms/columnWidths"
import {ResizableTitle, type ResizableTitleProps} from "../components/common/ResizableTitle"

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
    // Snapshot of every child of a column group at drag start. The delta is
    // then distributed proportionally across all children so the group expands
    // uniformly instead of one column absorbing the entire change.
    const groupResizeStartRef = useRef<{
        groupWidth: number
        children: {key: string; width: number; minWidth: number}[]
    } | null>(null)

    // Extract column metadata
    const analyzeColumns = useCallback(
        (cols: ColumnsType<RowType>): ColumnMeta[] => {
            const leafColumns = collectLeafColumns(cols)
            return leafColumns.map((col) => {
                const key = (col?.key ?? col?.dataIndex ?? "") as string
                const isFixed = Boolean(col.fixed)
                const colWithMaxWidth = col as {maxWidth?: number}
                const hasMaxWidth =
                    typeof colWithMaxWidth.maxWidth === "number" && colWithMaxWidth.maxWidth > 0

                const defaultWidth =
                    typeof col.width === "number"
                        ? col.width
                        : typeof col.minWidth === "number"
                          ? col.minWidth
                          : DEFAULT_COLUMN_WIDTH

                // For columns narrower than the default minWidth floor (e.g. a 61px
                // actions column) honor the smaller width so the user can still drag
                // them — otherwise the floor would exceed the column's intended size.
                const resolvedMinWidth =
                    typeof col.minWidth === "number"
                        ? col.minWidth
                        : Math.min(minWidth, defaultWidth)

                const maxWidthValue = hasMaxWidth ? colWithMaxWidth.maxWidth : undefined

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

            // 2. Calculate widths reserved before flexible distribution
            let fixedWidth = selectionColumnWidth

            // Fixed-position columns honor user-resized widths when present,
            // otherwise fall back to their declared width.
            for (const col of fixedPositionCols) {
                const userWidth = userResizedWidths[col.key]
                const width =
                    userWidth !== undefined ? Math.max(userWidth, col.minWidth) : col.width
                result[col.key] = width
                fixedWidth += width
            }

            // maxWidth columns use their maxWidth as the default "reserved" size
            // but a user drag overrides it (clamped only by minWidth — the user is
            // explicitly opting out of the auto-layout cap).
            for (const col of constrainedCols) {
                const userWidth = userResizedWidths[col.key]
                const width =
                    userWidth !== undefined ? Math.max(userWidth, col.minWidth) : col.maxWidth!
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
                // Enough space - distribute proportionally.
                //
                // Widths MUST be integers. The virtual body positions cells by
                // the raw width values while the header <table>'s <colgroup>
                // rounds each column independently; fractional widths make the
                // two diverge and the header/body dividers drift apart left-to-
                // right. We floor each column and hand the accumulated rounding
                // remainder to the last column so the total still fills exactly.
                let distributed = 0
                nonResizedFlexCols.forEach((col, index) => {
                    if (index === nonResizedFlexCols.length - 1) {
                        // Last column absorbs the remainder to keep the sum exact.
                        const remainder = remainingForNonResized - distributed
                        result[col.key] = Math.max(Math.round(remainder), col.width)
                        return
                    }
                    const proportion = col.width / totalDefaultWeight
                    // Use default width as floor, not minWidth
                    const computedWidth = Math.max(
                        Math.floor(remainingForNonResized * proportion),
                        col.width,
                    )
                    result[col.key] = computedWidth
                    distributed += computedWidth
                })
            }

            return result
        },
        [containerWidth, selectionColumnWidth, userResizedWidths, minWidth],
    )

    const commitWidth = useCallback(
        (colKey: string, width: number) => {
            const meta = columnMetaRef.current[colKey]
            if (!meta) return

            // Only enforce the minWidth floor on user drags. maxWidth is a layout
            // hint for the auto-distributor, not a hard ceiling — a deliberate
            // resize overrides it.
            const clamped = Math.max(width, meta.minWidth)

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
        (colKey: string) =>
            (_: unknown, {size}: {size: {width: number}}) => {
                // Write width on every drag frame so AntD's <colgroup> updates
                // and both header and body resize live together. The table uses
                // `table-layout: fixed`, so inline <th> width styles are ignored
                // — the colgroup is the only path to a visible resize.
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

    // Column-group resize: dragging the parent header distributes the drag
    // delta across every leaf child proportionally to their starting widths.
    const applyGroupDelta = useCallback(
        (newGroupWidth: number) => {
            const start = groupResizeStartRef.current
            if (!start || start.groupWidth <= 0) return
            const delta = newGroupWidth - start.groupWidth

            setUserResizedWidths((prev) => {
                const next = {...prev}
                for (const child of start.children) {
                    const share = (child.width / start.groupWidth) * delta
                    next[child.key] = Math.max(child.width + share, child.minWidth)
                }
                return next
            })
        },
        [setUserResizedWidths],
    )

    const buildGroupHeaderCellProps = useCallback(
        (
            groupWidth: number,
            children: {key: string; width: number; minWidth: number}[],
        ): ResizableTitleProps => {
            // Group floor is the sum of child minimums — the group can't shrink
            // smaller than every child being at its own minimum simultaneously.
            const minValue =
                children.length > 0
                    ? children.reduce((sum, c) => sum + c.minWidth, 0)
                    : DEFAULT_MIN_WIDTH

            return {
                width: groupWidth,
                minWidth: minValue,
                onResizeStart: () => {
                    groupResizeStartRef.current = {groupWidth, children}
                    setIsResizing(true)
                },
                onResize: (_: unknown, {size}: {size: {width: number}}) => {
                    applyGroupDelta(size.width)
                },
                onResizeStop: (_: unknown, {size}: {size: {width: number}}) => {
                    applyGroupDelta(size.width)
                    groupResizeStartRef.current = null
                    setIsResizing(false)
                },
            }
        },
        [applyGroupDelta],
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

                if (hasChildren) {
                    const nextChildren = makeColumnsResizable(
                        column.children as ColumnsType<RowType>,
                        computedWidths,
                    )

                    // Wire a resize handle on the group header. The drag delta
                    // is distributed proportionally across every leaf so the
                    // group expands uniformly.
                    const leafDescendants = collectLeafColumns(
                        nextChildren,
                    ) as ColumnType<RowType>[]
                    const childSnapshots = leafDescendants
                        .map((leaf) => {
                            const leafKey = (leaf?.key ?? "") as string
                            const meta = columnMetaRef.current[leafKey]
                            if (!leafKey || !meta) return null
                            return {
                                key: leafKey,
                                width: computedWidths[leafKey] ?? meta.width,
                                minWidth: meta.minWidth,
                            }
                        })
                        .filter((c): c is {key: string; width: number; minWidth: number} =>
                            Boolean(c),
                        )

                    if (childSnapshots.length === 0) {
                        return {
                            ...column,
                            key: colKey,
                            children: nextChildren,
                        } as typeof colEntry
                    }

                    const groupWidth = childSnapshots.reduce((sum, c) => sum + c.width, 0)

                    return {
                        ...column,
                        key: colKey,
                        children: nextChildren,
                        onHeaderCell: () => buildGroupHeaderCellProps(groupWidth, childSnapshots),
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

                return {
                    ...column,
                    key: colKey,
                    width,
                    minWidth: meta.minWidth,
                    onHeaderCell: () => buildHeaderCellProps(colKey, width, meta.minWidth),
                } as typeof colEntry
            }),
        [buildHeaderCellProps, buildGroupHeaderCellProps],
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
