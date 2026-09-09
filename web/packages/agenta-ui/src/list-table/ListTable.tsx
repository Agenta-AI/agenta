import {ChevronDown} from "lucide-react"

import {SkeletonBlock} from "../components/ui/skeleton"
import {cn} from "../components/ui/utils"

import type {ListTableColumn, ListTableProps} from "./types"

/**
 * Drawn INSIDE the box: rows are full-bleed inside the scroller, so an outward ring is clipped
 * at the viewport edges.
 *
 * `outline-solid` is not redundant — Tailwind v4's `outline-none` sets `--tw-outline-style:
 * none`, which `outline-2` then reads back, so the pair alone renders NO ring at all.
 */
const FOCUS_RING =
    "outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"

const gridTemplate = (columns: ListTableColumn[]): string =>
    columns.map((column) => column.width).join(" ")

/** Cycled per cell so the skeleton has the ragged right edge a column of text has. */
const SKELETON_WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2", "w-3/4"]

/**
 * The list frame every table-shaped screen in this app shares: a header row, optional group
 * headings that collapse, and rows that open.
 *
 * Presentational and column-agnostic. It knows a list has columns of some width, that rows sit
 * under headings, and that a row opens something; it never learns what the rows ARE. That is why
 * `renderRow` is a prop and not a set of cell types — an automation's status pill and a session's
 * last message have nothing in common but their position in the grid.
 *
 * A CSS grid rather than a `<table>`: the columns are `minmax()`/`fr`, the rows carry no cell
 * borders, and a group heading has to span the full width between two runs of rows. A real table
 * was tried and gives none of that without fighting its layout — and it turns every cell into a
 * `<td>` the consumer has to remember to wrap.
 */
export const ListTable = <Row,>({
    columns,
    groups,
    rowKey,
    renderRow,
    onOpenRow,
    minWidth = 572,
    loading = false,
    skeletonRows = 5,
    collapsedKeys,
    onToggleGroup,
    empty,
    stickyHeader = false,
    className,
}: ListTableProps<Row>) => {
    const grid = gridTemplate(columns)
    const isEmpty = groups.every((group) => group.rows.length === 0)

    return (
        // The horizontal scroller and a sticky header are mutually exclusive, and not by choice:
        // `overflow-x: auto` computes `overflow-y` to `auto` too, which makes this box a scrollport
        // with no vertical range of its own — a `sticky` header inside it has nothing to stick to
        // and never moves. So a sticky table hands the overflow up to the page's own scroller,
        // which already scrolls both axes, and the header sticks to THAT.
        <div className={cn(!stickyHeader && "overflow-x-auto", className)}>
            <div style={{minWidth}}>
                <div
                    role="row"
                    className={cn(
                        "grid gap-3 border-0 border-b border-solid border-border px-2 text-[12px] font-medium text-muted-foreground",
                        // Opaque, or the rows read straight through it as they pass under. A
                        // stated height rather than padding, so the group headings below can be
                        // stuck directly beneath it without measuring anything — and the margin
                        // goes, or a 4px slot of rows would show through the gap.
                        stickyHeader
                            ? "sticky top-0 z-20 h-9 items-center bg-background"
                            : "mb-1 py-2",
                    )}
                    style={{gridTemplateColumns: grid}}
                >
                    {columns.map((column) => (
                        <span
                            key={column.key}
                            role="columnheader"
                            className={cn(column.srOnly && "sr-only", column.headerClassName)}
                        >
                            {column.label}
                        </span>
                    ))}
                </div>

                {loading ? (
                    // The real columns, in the real row rhythm: a list that loads as a spinner and
                    // then snaps into a table moves everything under the reader's cursor. Bars
                    // vary in width down each column so the block reads as text, not as a grid of
                    // identical pills.
                    <div aria-hidden>
                        {Array.from({length: skeletonRows}, (_, row) => (
                            <div
                                key={row}
                                className="grid w-full items-center gap-3 px-2 py-[13px]"
                                style={{gridTemplateColumns: grid}}
                            >
                                {columns.map((column, index) => (
                                    // `SkeletonBlock`, not `Skeleton`: the latter is antd's
                                    // composite (avatar + title + paragraph) and paints nothing
                                    // of its own — a bare one renders a transparent box.
                                    <SkeletonBlock
                                        active
                                        key={column.key}
                                        className={cn(
                                            "h-3.5",
                                            SKELETON_WIDTHS[(row + index) % SKELETON_WIDTHS.length],
                                            // A control column holds an icon, not a phrase.
                                            column.srOnly && "w-full",
                                        )}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                ) : isEmpty ? (
                    empty
                ) : (
                    groups.map((group) => {
                        const collapsed = collapsedKeys?.has(group.key) ?? false
                        return (
                            // A box per group, not a Fragment: `sticky` is bounded by the
                            // element's CONTAINING BLOCK, so headings sharing one flat parent
                            // stick for the rest of the TABLE — they pile up at the same offset,
                            // paint over each other, and leave a hole where each was pulled out
                            // of the flow. A box per group makes each heading hand off to the
                            // next as its own run ends. Layout is unchanged: every row is its own
                            // grid, and this parent is a plain block either way.
                            <div key={group.key}>
                                {group.label === null ? null : onToggleGroup ? (
                                    <button
                                        type="button"
                                        onClick={() => onToggleGroup(group.key)}
                                        aria-expanded={!collapsed}
                                        className={cn(
                                            "box-border flex w-full cursor-pointer appearance-none items-center gap-1.5",
                                            "border-0 bg-transparent px-2 pb-1.5 pt-3.5 text-left font-[inherit]",
                                            "text-[13px] text-muted-foreground hover:text-foreground",
                                            // Stuck directly under the column header, so a long
                                            // run still says which group you are reading.
                                            stickyHeader && "sticky top-9 z-10 bg-background",
                                            FOCUS_RING,
                                        )}
                                    >
                                        <span>{group.label}</span>
                                        <ChevronDown
                                            size={12}
                                            aria-hidden
                                            className={cn(
                                                "shrink-0 transition-transform",
                                                collapsed && "-rotate-90",
                                            )}
                                        />
                                    </button>
                                ) : (
                                    <p
                                        className={cn(
                                            "m-0 px-2 pb-1.5 pt-3.5 text-[13px] text-muted-foreground",
                                            stickyHeader && "sticky top-9 z-10 bg-background",
                                        )}
                                    >
                                        {group.label}
                                    </p>
                                )}

                                {(collapsed ? [] : group.rows).map((row) => (
                                    // Not a <button>: a row often carries a control of its own,
                                    // and a button inside a button is invalid HTML that browsers
                                    // repair by dropping one of them.
                                    <div
                                        key={rowKey(row)}
                                        role={onOpenRow ? "button" : undefined}
                                        tabIndex={onOpenRow ? 0 : undefined}
                                        onClick={onOpenRow ? () => onOpenRow(row) : undefined}
                                        onKeyDown={
                                            onOpenRow
                                                ? (event) => {
                                                      if (
                                                          event.key !== "Enter" &&
                                                          event.key !== " "
                                                      )
                                                          return
                                                      event.preventDefault()
                                                      onOpenRow(row)
                                                  }
                                                : undefined
                                        }
                                        className={cn(
                                            // `group`, so a cell can reveal a control on the
                                            // ROW's hover rather than on its own — a pin that
                                            // appears only while the pointer is inside its own
                                            // cell is one you have to find before you can see it.
                                            "group grid w-full items-center gap-3 rounded-md border-0 bg-transparent px-2 py-[13px] text-left",
                                            onOpenRow && "cursor-pointer hover:bg-accent/60",
                                            onOpenRow && FOCUS_RING,
                                        )}
                                        style={{gridTemplateColumns: grid}}
                                    >
                                        {renderRow(row)}
                                    </div>
                                ))}
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
