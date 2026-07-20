/**
 * VirtualTileGrid — a windowed fixed-column tile grid for the drive surfaces. The drives list whole
 * folders (thousands of immediate children for a repo the agent cloned into its cwd), so the folder
 * view MUST NOT render one DOM node per file — that alone froze the main thread (issue #5367), before
 * any per-tile thumbnail work.
 *
 * Only the visible rows (+ overscan) mount. Rows are chunked into `columns` cells and virtualized on
 * the vertical axis via `@tanstack/react-virtual`, measuring real heights (tiles are `aspect-[4/3]`,
 * so their height tracks the responsive column width). Scrolling binds to this component's own
 * `overflow-auto` element — drop it into a `min-h-0 flex-1` parent and it fills the space. Tile size
 * tracks the container width purely via CSS grid `1fr`, so a pane resize (the tree pane collapsing)
 * resizes the tiles smoothly; the column COUNT changes discretely at each threshold.
 *
 * KEYBOARD: 2D roving focus over the cells (↑/↓/←/→, Home/End) — virtualization-aware, so moving past
 * the visible window SCROLLS the target cell in and focuses it (a plain offsetTop scan can't, and
 * miscounts columns because each row is its own positioned box). Cmd/Ctrl+↓ activates the focused cell
 * ("open"), Cmd/Ctrl+↑ steps out — both delegated to the consumer, which owns folder semantics.
 */
import {type KeyboardEvent, type ReactNode, useEffect, useRef, useState} from "react"

import {useVirtualizer} from "@tanstack/react-virtual"

const NAV_KEYS = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]

export function VirtualTileGrid<T>({
    items,
    columns,
    minColumnWidth,
    getKey,
    renderTile,
    estimateRowHeight = 180,
    gap = 8,
    overscanRows = 4,
    className = "",
    onKeyDown,
    onMetaActivate,
    onMetaBack,
    onEndReached,
    endReachedThreshold = 6,
    footer,
    autoFocus,
    autoFocusKey,
}: {
    items: T[]
    /** Fixed column count. Ignored when `minColumnWidth` is set (responsive). */
    columns?: number
    /** Responsive: fit as many columns as the measured container allows, each ≥ this px. Keeps tiles
     * a sensible size in both the narrow config drawer and the wide chat drawer. */
    minColumnWidth?: number
    getKey: (item: T, index: number) => string
    renderTile: (item: T, index: number) => ReactNode
    /** Rough row height (incl. gap) for the initial scrollbar; real heights are measured after mount. */
    estimateRowHeight?: number
    gap?: number
    /** Rows mounted beyond the viewport on each side. For tile grids whose cells fetch a thumbnail,
     * this is the prefetch window — the mounted overscan tiles fetch ahead of scroll (see FileThumb).
     * Default 4 ≈ ~600px each way, matched to the thumbnail prefetch margin. */
    overscanRows?: number
    className?: string
    /** Fallback keydown for non-navigation keys (nav keys are handled internally). */
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
    /** Cmd/Ctrl+ArrowDown on the focused cell — "open / drill in". Gets the focused item + index. */
    onMetaActivate?: (item: T, index: number) => void
    /** Cmd/Ctrl+ArrowUp — "go out" to the parent. Level-based, so it takes no item. */
    onMetaBack?: () => void
    /** Infinite scroll: called when the last rows come within `endReachedThreshold` of the end. Must be
     * idempotent (guard re-entrancy in the caller) — it can fire on every scroll tick near the bottom. */
    onEndReached?: () => void
    endReachedThreshold?: number
    /** Rendered in normal flow BELOW the virtual rows (scrolls with them) — a load-more spinner / end
     * marker for infinite lists. */
    footer?: ReactNode
    /** Focus the first cell once the grid has content — so arrow-key nav works on open WITHOUT tabbing
     * in or clicking (which opens a tile). Pass true ONLY when the grid is the primary nav surface
     * (single-pane grid/flat), not the list view's right pane (the tree owns focus there). */
    autoFocus?: boolean
    /** Identity of the current listing (e.g. the folder path). When it CHANGES, focus jumps back to
     * the first cell — so opening a folder lands on its first item, even if focus was on the tile you
     * just activated. Same key = focus once. */
    autoFocusKey?: string | number
}) {
    const parentRef = useRef<HTMLDivElement>(null)
    const [width, setWidth] = useState(0)
    useEffect(() => {
        const el = parentRef.current
        if (!el || !minColumnWidth) return
        const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [minColumnWidth])

    const cols =
        minColumnWidth && width > 0
            ? Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)))
            : (columns ?? 3)
    const rowCount = Math.ceil(items.length / cols)
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateRowHeight + gap,
        overscan: overscanRows,
    })

    // Infinite scroll: fire when the last MOUNTED row is within `endReachedThreshold` rows of the end.
    const virtualRows = virtualizer.getVirtualItems()
    const lastRowIndex = virtualRows.length ? virtualRows[virtualRows.length - 1].index : -1
    useEffect(() => {
        if (onEndReached && rowCount > 0 && lastRowIndex >= rowCount - endReachedThreshold) {
            onEndReached()
        }
    }, [onEndReached, lastRowIndex, rowCount, endReachedThreshold])

    // Which cell has focus, read from the DOM (roving focus lives on the consumer's tile buttons, so
    // there's no React state to drift). -1 when focus is outside the grid.
    const focusedIndex = (): number => {
        const cell = (document.activeElement as HTMLElement | null)?.closest?.("[data-grid-cell]")
        const raw = (cell as HTMLElement | null)?.dataset.gridCell
        return raw != null ? Number(raw) : -1
    }

    // Focus a cell by flat index: scroll its ROW into view first (virtualized — the cell may not be
    // mounted yet), then focus the tile's control once it lands (retry a few frames).
    const focusCell = (index: number) => {
        if (!items.length) return
        const target = Math.min(Math.max(index, 0), items.length - 1)
        virtualizer.scrollToIndex(Math.floor(target / cols), {align: "auto"})
        let tries = 0
        const run = () => {
            const cell = parentRef.current?.querySelector<HTMLElement>(
                `[data-grid-cell="${target}"]`,
            )
            const focusable = cell?.querySelector<HTMLElement>(
                "button, [href], [tabindex]:not([tabindex='-1'])",
            )
            if (focusable) focusable.focus()
            else if (tries++ < 4) requestAnimationFrame(run)
        }
        requestAnimationFrame(run)
    }

    // Focus the first cell when the LISTING changes (opening the drawer, or drilling into a folder →
    // `autoFocusKey` changes), so arrow-key nav works without tabbing in or clicking (a click OPENS a
    // tile). Focuses per key, even if focus was on a tile of the previous folder (those tiles are gone).
    // The ONLY bail is an active text field — never interrupt typing (e.g. the search box).
    const lastFocusKey = useRef<string | number | undefined>(undefined)
    useEffect(() => {
        if (!autoFocus || !items.length || lastFocusKey.current === autoFocusKey) return
        lastFocusKey.current = autoFocusKey
        const active = document.activeElement as HTMLElement | null
        if (active && /^(input|textarea|select)$/i.test(active.tagName)) return
        focusCell(0)
        // focusCell is a fresh closure each render; calling the current one is intentional.
    }, [autoFocus, autoFocusKey, items.length])

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        // Finder-style step in/out (Cmd on macOS, Ctrl elsewhere).
        if ((e.metaKey || e.ctrlKey) && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            if (e.key === "ArrowDown") {
                const cur = focusedIndex()
                if (cur >= 0 && onMetaActivate) {
                    e.preventDefault()
                    onMetaActivate(items[cur], cur)
                }
            } else if (onMetaBack) {
                e.preventDefault()
                onMetaBack()
            }
            return
        }
        if (!NAV_KEYS.includes(e.key)) {
            onKeyDown?.(e)
            return
        }
        const cur = focusedIndex()
        e.preventDefault()
        switch (e.key) {
            case "Home":
                return focusCell(0)
            case "End":
                return focusCell(items.length - 1)
            case "ArrowLeft":
                return focusCell(cur < 0 ? 0 : cur - 1)
            case "ArrowRight":
                return focusCell(cur < 0 ? 0 : cur + 1)
            case "ArrowUp":
                return focusCell(cur < 0 ? 0 : cur - cols)
            case "ArrowDown":
                return focusCell(cur < 0 ? 0 : cur + cols)
        }
    }

    return (
        // `tabIndex={0}` makes the scroll region itself focusable, so CLICKING the empty grid area (not
        // a tile) puts focus here — then an arrow key starts nav from the first cell (the handler treats
        // "no cell focused" as index 0). `outline-none`: no ring on the container (focus moves to a real
        // tile, which shows its own ring, the moment you press a key).
        <div
            ref={parentRef}
            tabIndex={0}
            className={`min-h-0 flex-1 overflow-auto outline-none ${className}`}
            onKeyDown={handleKeyDown}
        >
            <div style={{height: virtualizer.getTotalSize(), position: "relative", width: "100%"}}>
                {virtualRows.map((row) => {
                    const start = row.index * cols
                    const cells = items.slice(start, start + cols)
                    return (
                        <div
                            key={row.key}
                            data-index={row.index}
                            ref={virtualizer.measureElement}
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                transform: `translateY(${row.start}px)`,
                            }}
                        >
                            <div
                                className="grid auto-rows-min"
                                style={{
                                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                                    gap,
                                    paddingBottom: gap,
                                }}
                            >
                                {cells.map((item, i) => (
                                    // `data-grid-cell` (flat index) is the roving-focus anchor: keyboard
                                    // nav finds the current/target cell by it. `min-w-0` keeps the cell a
                                    // shrinkable grid track so tiles don't overflow.
                                    <div
                                        key={getKey(item, start + i)}
                                        data-grid-cell={start + i}
                                        className="min-w-0"
                                    >
                                        {renderTile(item, start + i)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                })}
            </div>
            {footer}
        </div>
    )
}
