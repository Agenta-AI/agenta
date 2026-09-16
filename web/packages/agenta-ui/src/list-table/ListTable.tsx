import {Fragment} from "react"
import type {KeyboardEvent} from "react"

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
 * The sticky stack, under `stickyHeader`: the column header pins at the top and a group heading
 * pins directly beneath it.
 *
 * `height` and `groupTop` are ONE measurement written twice, because Tailwind cannot derive the
 * second from the first. Change either and you must change the other — a heading pinned at the
 * wrong offset leaves a sliver of rows showing through the gap above it.
 */
const STICKY = {height: "h-9", groupTop: "top-9"} as const

/** With no visible header, a stuck group heading sits at the scroller's own top. */
const groupTop = (hideHeader: boolean) => (hideHeader ? "top-0" : STICKY.groupTop)

/**
 * The card's box, shared by a tile and its skeleton so the two are one shape. A card is a bordered
 * surface, not a fill, because a grid of fills reads as one slab; the border is what says "this
 * one opens on its own".
 */
const CARD_CHROME =
    "box-border flex min-w-0 flex-col gap-2 rounded-lg border border-solid border-border bg-card p-3 text-left text-card-foreground"

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
    view = "list",
    renderCard,
    cardMinWidth = 240,
    groupActions,
    onOpenRow,
    wrapRow,
    minWidth = 572,
    loading = false,
    skeletonRows = 5,
    collapsedKeys,
    onToggleGroup,
    empty,
    stickyHeader = false,
    hideHeader = false,
    density = "default",
    className,
}: ListTableProps<Row>) => {
    const isGrid = view === "grid"
    const grid = gridTemplate(columns)
    // `min(100%, …)`, so a container narrower than one card still gets one card, not a scroller.
    const cardGrid = `repeat(auto-fill, minmax(min(100%, ${cardMinWidth}px), 1fr))`
    // One value for the rows AND their skeleton, so loading holds the rhythm the rows arrive in.
    const rowPad = density === "compact" ? "py-2" : "py-[13px]"
    const isEmpty = groups.every((group) => group.rows.length === 0)
    // A grid has no column header, so a stuck heading sits at the scroller's own top.
    const headingTop = groupTop(hideHeader || isGrid)

    const openHandlers = (row: Row) =>
        onOpenRow
            ? {
                  role: "button" as const,
                  tabIndex: 0,
                  onClick: () => onOpenRow(row),
                  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      onOpenRow(row)
                  },
              }
            : {}

    return (
        // The horizontal scroller and a sticky header are mutually exclusive, and not by choice:
        // `overflow-x: auto` computes `overflow-y` to `auto` too, which makes this box a scrollport
        // with no vertical range of its own — a `sticky` header inside it has nothing to stick to
        // and never moves. So a sticky table hands the overflow up to the page's own scroller,
        // which already scrolls both axes, and the header sticks to THAT.
        // `-mx-3 px-3` is net zero on the content box — the header and the tracks do not move —
        // but it is what a row's bleed has to land in. A scrollport is clipped at its PADDING
        // box, so without the padding here the 12px a row reaches past its text is cut flat on
        // both sides, and the hover fill ends in a square edge instead of a rounded one.
        // A grid never scrolls sideways — its columns are however many fit — so it keeps the
        // wrapper (the headings align to it) and drops the scroller.
        <div className={cn("-mx-3 px-3", !stickyHeader && !isGrid && "overflow-x-auto", className)}>
            <div style={isGrid ? undefined : {minWidth}}>
                {isGrid ? null : (
                    <div
                        role="row"
                        // The sr-only header carries none of the visual classes: `sticky`/`h-9`
                        // would win over its `absolute` and leave a 36px blank strip.
                        className={cn(
                            hideHeader
                                ? "sr-only"
                                : [
                                      // No horizontal inset, here or on the rows or the group headings: every
                                      // one of them reads from the table's own edge, which is the line the page
                                      // title and the toolbar above already keep. Dropping it from ALL of them
                                      // together is what matters — the header's content box has to stay
                                      // identical to a row's, or their grid tracks resolve differently and
                                      // every column but the first drifts off its cells.
                                      "grid gap-3 border-0 border-b border-solid border-border/40 text-[13px] font-medium text-muted-foreground",
                                      // Opaque, or the rows read straight through it as they pass under. A
                                      // stated height rather than padding, so the group headings below can be
                                      // stuck directly beneath it without measuring anything — and the margin
                                      // goes, or a 4px slot of rows would show through the gap.
                                      stickyHeader
                                          ? `sticky top-0 z-20 ${STICKY.height} items-center bg-background`
                                          : "mb-1 py-2",
                                  ],
                        )}
                        style={{gridTemplateColumns: grid}}
                    >
                        {columns.map((column) => (
                            // The cell stays in the grid flow (`sr-only` is absolute) so tracks line up.
                            <span
                                key={column.key}
                                role="columnheader"
                                className={column.headerClassName}
                            >
                                {column.srOnly ? (
                                    <span className="sr-only">{column.label}</span>
                                ) : (
                                    column.label
                                )}
                            </span>
                        ))}
                    </div>
                )}

                {loading ? (
                    isGrid ? (
                        // Card-shaped, in the real grid: a mark, a name and two lines of description,
                        // so the cards arrive into the slots the skeleton was already holding.
                        <div aria-hidden className="grid gap-3" style={{gridTemplateColumns: cardGrid}}>
                            {Array.from({length: skeletonRows}, (_, tile) => (
                                <div key={tile} className={CARD_CHROME}>
                                    <div className="flex items-center gap-2">
                                        <SkeletonBlock active className="size-7 shrink-0 rounded-md" />
                                        <SkeletonBlock active className="h-4 w-1/2 rounded" />
                                    </div>
                                    <SkeletonBlock active className="h-3.5 w-full rounded" />
                                    <SkeletonBlock
                                        active
                                        className={cn(
                                            "h-3.5 rounded",
                                            SKELETON_WIDTHS[tile % SKELETON_WIDTHS.length],
                                        )}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        // The real columns, in the real row rhythm: a list that loads as a spinner and
                        // then snaps into a table moves everything under the reader's cursor. Bars
                        // vary in width down each column so the block reads as text, not as a grid of
                        // identical pills.
                        <div aria-hidden>
                            {Array.from({length: skeletonRows}, (_, row) => (
                                <div
                                    key={row}
                                    className={cn("grid w-full items-center gap-3", rowPad)}
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
                                                // The height of the line the cell's text will sit on,
                                                // not a hair less: a thinner bar reads as a rule
                                                // between rows rather than as text on its way.
                                                "h-5 rounded",
                                                SKELETON_WIDTHS[(row + index) % SKELETON_WIDTHS.length],
                                                // A control column holds an icon, not a phrase.
                                                column.srOnly && "w-full",
                                            )}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    )
                ) : isEmpty ? (
                    empty
                ) : (
                    groups.map((group, groupIndex) => {
                        const collapsed = collapsedKeys?.has(group.key) ?? false
                        const actions = groupActions?.(group)
                        const rows = collapsed ? [] : group.rows
                        return (
                            // A box per group, not a Fragment: `sticky` is bounded by the
                            // element's CONTAINING BLOCK, so headings sharing one flat parent
                            // stick for the rest of the TABLE — they pile up at the same offset,
                            // paint over each other, and leave a hole where each was pulled out
                            // of the flow. A box per group makes each heading hand off to the
                            // next as its own run ends. Layout is unchanged: every row is its own
                            // grid, and this parent is a plain block either way.
                            <div
                                key={group.key}
                                // The sticky header drops its own bottom margin (a gap there
                                // would let rows show through as they pass under), so the first
                                // run pays it back as padding instead — without it the first
                                // row's hover fill sits flush on the header's rule. A grid has no
                                // header to pay back.
                                className={cn(
                                    stickyHeader && !isGrid && groupIndex === 0 && "pt-1",
                                )}
                            >
                                {group.label === null && !actions ? null : (
                                    // The heading is a ROW — the collapse control on the left, the
                                    // group's action on the right — so an action is never a button
                                    // inside the collapse button.
                                    <div
                                        className={cn(
                                            "flex items-center gap-2 pb-1.5 pt-3.5",
                                            // Stuck directly under the column header, so a long
                                            // run still says which group you are reading.
                                            stickyHeader && `sticky ${headingTop} z-10 bg-background`,
                                        )}
                                    >
                                        {group.label === null ? null : onToggleGroup ? (
                                            <button
                                                type="button"
                                                onClick={() => onToggleGroup(group.key)}
                                                aria-expanded={!collapsed}
                                                className={cn(
                                                    "box-border flex min-w-0 cursor-pointer appearance-none items-center gap-1.5",
                                                    "border-0 bg-transparent p-0 text-left font-[inherit]",
                                                    "text-[13px] text-muted-foreground hover:text-foreground",
                                                    FOCUS_RING,
                                                )}
                                            >
                                                {/* A heading names a run, it does not wrap: a
                                                    long repository truncates so the group's
                                                    action keeps its place on the right. */}
                                                <span className="truncate">{group.label}</span>
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
                                            <p className="m-0 min-w-0 truncate text-[13px] text-muted-foreground">
                                                {group.label}
                                            </p>
                                        )}
                                        {actions ? <span className="ml-auto flex shrink-0 items-center">{actions}</span> : null}
                                    </div>
                                )}

                                {isGrid ? (
                                    rows.length ? (
                                        // Cards sit on the content edge — none of a row's bleed:
                                        // a tile that reached past its track would overflow the
                                        // `auto-fill` columns it was measured into.
                                        <div className="grid gap-3 pb-2" style={{gridTemplateColumns: cardGrid}}>
                                            {rows.map((row) => {
                                                const tile = (
                                                    <div
                                                        key={rowKey(row)}
                                                        {...openHandlers(row)}
                                                        className={cn(
                                                            "group",
                                                            CARD_CHROME,
                                                            // Lifts a touch on hover — a lighter
                                                            // edge and a soft shadow — so the tile
                                                            // reads as the thing about to open. A
                                                            // shadow is nearly invisible on a dark
                                                            // surface, so dark mode adds the fill
                                                            // lift a row gets and a deeper shadow.
                                                            onOpenRow &&
                                                                "cursor-pointer transition-[border-color,box-shadow,background-color] hover:border-foreground/30 hover:shadow-[0_3px_14px_rgb(0_0_0/0.07)] dark:hover:bg-accent/40 dark:hover:shadow-[0_4px_16px_rgb(0_0_0/0.5)]",
                                                            onOpenRow && FOCUS_RING,
                                                        )}
                                                    >
                                                        {renderCard?.(row)}
                                                    </div>
                                                )
                                                // A wrapper has to be `display: contents` (as the
                                                // drive's context-menu trigger is) to leave the
                                                // tile a grid item of its own.
                                                return wrapRow ? (
                                                    <Fragment key={rowKey(row)}>{wrapRow(row, tile)}</Fragment>
                                                ) : (
                                                    tile
                                                )
                                            })}
                                        </div>
                                    ) : null
                                ) : (
                                    rows.map((row) => {
                                        // Not a <button>: a row often carries a control of its own,
                                        // and a button inside a button is invalid HTML that browsers
                                        // repair by dropping one of them.
                                        const rowNode = (
                                            <div
                                                key={rowKey(row)}
                                                {...openHandlers(row)}
                                                className={cn(
                                                    // `group`, so a cell can reveal a control on the
                                                    // ROW's hover rather than on its own — a pin that
                                                    // appears only while the pointer is inside its own
                                                    // cell is one you have to find before you can see it.
                                                    // The fill reaches 12px past the text on each side
                                                    // while the text itself stays on the table's edge:
                                                    // the row's BOX grows by the same 12px its padding
                                                    // gives back, so its content box — and so its grid
                                                    // tracks — stay identical to the header's.
                                                    "group grid w-full items-center gap-3 rounded-md border-0 bg-transparent text-left",
                                                    rowPad,
                                                    "-mx-3 w-[calc(100%+1.5rem)] px-3",
                                                    onOpenRow && "cursor-pointer hover:bg-accent/60",
                                                    onOpenRow && FOCUS_RING,
                                                )}
                                                style={{gridTemplateColumns: grid}}
                                            >
                                                {renderRow(row)}
                                            </div>
                                        )
                                        return wrapRow ? (
                                            <Fragment key={rowKey(row)}>
                                                {wrapRow(row, rowNode)}
                                            </Fragment>
                                        ) : (
                                            rowNode
                                        )
                                    })
                                )}
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
