import type {ReactNode} from "react"

/**
 * One column of the frame. The label is the consumer's — this package never learns what an
 * automation or a session is, only that a list has columns of some width in some order.
 */
export interface ListTableColumn {
    key: string
    /** Header text. Set `srOnly` when the column carries controls rather than a heading. */
    label: string
    srOnly?: boolean
    /**
     * A CSS grid track: `"minmax(140px,2fr)"`, `"24px"`, `"1fr"`. `minmax`/`fr` rather than
     * fixed widths, because a fixed column among flexible siblings hands all the surplus to
     * its neighbours and the table looks unevenly spaced at every width but one.
     */
    width: string
    /**
     * Extra classes on the HEADER cell — in practice the alignment, for a column whose body cells
     * are not left-aligned. The header has to follow the cells or the two read as different
     * columns.
     */
    headerClassName?: string
}

/**
 * A run of rows under one heading. `label: null` is the ungrouped case — the frame draws no
 * heading at all, so a list with grouping switched off is byte-for-byte the list without it.
 */
export interface ListTableGroup<Row> {
    key: string
    label: string | null
    rows: Row[]
}

export interface ListTableProps<Row> {
    columns: ListTableColumn[]
    groups: ListTableGroup<Row>[]
    /** Stable per row — the frame keys on it and reports it back for collapse and clicks. */
    rowKey: (row: Row) => string
    /** The cells, in column order. The frame owns the grid; the consumer owns what is in it. */
    renderRow: (row: Row) => ReactNode
    /** Opening a row. Absent ⇒ rows are not clickable and take no focus. */
    onOpenRow?: (row: Row) => void
    /**
     * Below this the table scrolls sideways rather than crushing its columns. In px; the frame
     * owns the horizontal scroller so a consumer cannot forget one.
     */
    minWidth?: number
    /** Collapsed group keys. Absent ⇒ headings are labels, not buttons. */
    collapsedKeys?: ReadonlySet<string>
    onToggleGroup?: (key: string) => void
    /**
     * Rows are still on their way. The frame draws its own skeleton in the real columns rather
     * than a spinner, so the list arrives into the shape it was already occupying.
     */
    loading?: boolean
    skeletonRows?: number
    /** Drawn in place of the rows when every group is empty. */
    empty?: ReactNode
    /**
     * Pin the header row to the top of the page's scroller.
     *
     * Costs the frame its own horizontal scroller: `overflow-x: auto` makes this box a scrollport
     * in BOTH axes, and a `sticky` header inside one with no vertical range never moves. The page
     * scroller absorbs the overflow instead, so a table wider than the viewport scrolls the column
     * beside it rather than only itself.
     */
    stickyHeader?: boolean
    className?: string
}
