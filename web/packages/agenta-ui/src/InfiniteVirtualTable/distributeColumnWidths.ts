import type {ColumnSizingState} from "@tanstack/react-table"

/**
 * Shares the container's width across columns.
 *
 * TanStack has no equivalent: its column sizing is per-column sizes plus a resize handler,
 * with no notion of filling available space. This is the one piece of the old
 * `useSmartResizableColumns` that had to be ported rather than deleted, so the rules below
 * are its rules, kept deliberately: changing them changes how every table lays out.
 *
 * The invariant is that the total is never LESS than the container. When space is short the
 * table overflows and scrolls horizontally rather than squeezing columns below the width
 * they declared.
 */

export interface DistributableColumn {
    key: string
    /** Declared width. Doubles as the proportional weight and the floor when space is short. */
    width: number
    minWidth: number
    /** Present means the column is capped and never absorbs leftover space. */
    maxWidth?: number
    /** Pinned columns keep their declared width; they never flex. */
    isFixed?: boolean
}

export interface DistributeArgs {
    columns: DistributableColumn[]
    containerWidth: number
    /** Widths the user produced by dragging. These always win over the auto-layout. */
    userWidths?: Record<string, number>
    /** The selection column, which is reserved before anything is shared out. */
    leadingColumnWidth?: number
}

export const distributeColumnWidths = ({
    columns,
    containerWidth,
    userWidths = {},
    leadingColumnWidth = 0,
}: DistributeArgs): ColumnSizingState => {
    const result: ColumnSizingState = {}

    const fixed = columns.filter((column) => column.isFixed)
    const capped = columns.filter((column) => !column.isFixed && column.maxWidth !== undefined)
    const flexible = columns.filter((column) => !column.isFixed && column.maxWidth === undefined)

    let reserved = leadingColumnWidth

    // Pinned columns take their user width if dragged, else what they declared.
    for (const column of fixed) {
        const dragged = userWidths[column.key]
        const width = dragged !== undefined ? Math.max(dragged, column.minWidth) : column.width
        result[column.key] = width
        reserved += width
    }

    // A capped column sits at its cap until dragged; dragging opts out of the cap entirely.
    for (const column of capped) {
        const dragged = userWidths[column.key]
        const width =
            dragged !== undefined ? Math.max(dragged, column.minWidth) : (column.maxWidth as number)
        result[column.key] = width
        reserved += width
    }

    if (flexible.length === 0) return result

    const available = Math.max(0, containerWidth - reserved)

    const dragged = flexible.filter((column) => userWidths[column.key] !== undefined)
    const untouched = flexible.filter((column) => userWidths[column.key] === undefined)

    let draggedTotal = 0
    for (const column of dragged) {
        const width = Math.max(userWidths[column.key] as number, column.minWidth)
        result[column.key] = width
        draggedTotal += width
    }

    const remaining = available - draggedTotal

    if (untouched.length === 0) {
        // Everything was dragged. If that leaves a gap, the last one stretches to close it,
        // because the total must still reach the container.
        if (draggedTotal < available && dragged.length > 0) {
            const last = dragged[dragged.length - 1]
            result[last.key] = (result[last.key] ?? 0) + (available - draggedTotal)
        }
        return result
    }

    const totalWeight = untouched.reduce((sum, column) => sum + column.width, 0)

    if (remaining <= 0 || remaining < totalWeight) {
        // Not enough room to give everyone their declared width. Hand out declared widths
        // anyway and let the table scroll — squeezing columns is worse than scrolling.
        for (const column of untouched) result[column.key] = column.width
        return result
    }

    // Enough room: share it out by weight.
    //
    // Widths MUST be integers. The body positions cells from the raw values while the
    // header's colgroup rounds each column on its own, so fractions make the two tables'
    // dividers drift apart left to right. Floor each column and give the accumulated
    // remainder to the last one, so the total still lands exactly on `available`.
    let distributed = 0
    untouched.forEach((column, index) => {
        if (index === untouched.length - 1) {
            result[column.key] = Math.max(Math.round(remaining - distributed), column.width)
            return
        }
        const width = Math.max(Math.floor(remaining * (column.width / totalWeight)), column.width)
        result[column.key] = width
        distributed += width
    })

    return result
}
