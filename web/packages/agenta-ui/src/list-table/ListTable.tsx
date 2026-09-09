import {Fragment} from "react"

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
    className,
}: ListTableProps<Row>) => {
    const grid = gridTemplate(columns)
    const isEmpty = groups.every((group) => group.rows.length === 0)

    return (
        <div className={cn("overflow-x-auto", className)}>
            <div style={{minWidth}}>
                <div
                    role="row"
                    className="mb-1 grid gap-3 border-0 border-b border-solid border-border px-2 py-2 text-[12px] font-medium text-muted-foreground"
                    style={{gridTemplateColumns: grid}}
                >
                    {columns.map((column) => (
                        <span
                            key={column.key}
                            role="columnheader"
                            className={column.srOnly ? "sr-only" : undefined}
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
                            <Fragment key={group.key}>
                                {group.label === null ? null : onToggleGroup ? (
                                    <button
                                        type="button"
                                        onClick={() => onToggleGroup(group.key)}
                                        aria-expanded={!collapsed}
                                        className={cn(
                                            "box-border flex w-full cursor-pointer appearance-none items-center gap-1.5",
                                            "border-0 bg-transparent px-2 pb-1.5 pt-3.5 text-left font-[inherit]",
                                            "text-[13px] text-muted-foreground hover:text-foreground",
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
                                    <p className="m-0 px-2 pb-1.5 pt-3.5 text-[13px] text-muted-foreground">
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
                                            "grid w-full items-center gap-3 rounded-md border-0 bg-transparent px-2 py-[13px] text-left",
                                            onOpenRow && "cursor-pointer hover:bg-accent/60",
                                            onOpenRow && FOCUS_RING,
                                        )}
                                        style={{gridTemplateColumns: grid}}
                                    >
                                        {renderRow(row)}
                                    </div>
                                ))}
                            </Fragment>
                        )
                    })
                )}
            </div>
        </div>
    )
}
