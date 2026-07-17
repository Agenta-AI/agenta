/**
 * VirtualTileGrid — a windowed fixed-column tile grid for the drive surfaces. The drives list the
 * WHOLE flat tree (11k+ entries for a repo the agent cloned into its cwd), so the chat Files grid and
 * the explorer folder view MUST NOT render one DOM node per file — that alone froze the main thread
 * (issue #5367), before any per-tile thumbnail work.
 *
 * Only the visible rows (+ overscan) mount. Rows are chunked into `columns` cells and virtualized on
 * the vertical axis via `@tanstack/react-virtual`, measuring real heights (tiles are `aspect-[4/3]`,
 * so their height tracks the responsive column width). Scrolling binds to this component's own
 * `overflow-auto` element — drop it into a `min-h-0 flex-1` parent and it fills the space.
 */
import {Fragment, type ReactNode, useRef} from "react"

import {useVirtualizer} from "@tanstack/react-virtual"

export function VirtualTileGrid<T>({
    items,
    columns,
    getKey,
    renderTile,
    estimateRowHeight = 180,
    gap = 8,
    overscanRows = 4,
    className = "",
    onKeyDown,
}: {
    items: T[]
    /** Fixed column count — the grids are `grid-cols-3`, so 3. */
    columns: number
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
    onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>
}) {
    const parentRef = useRef<HTMLDivElement>(null)
    const rowCount = Math.ceil(items.length / columns)
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => estimateRowHeight + gap,
        overscan: overscanRows,
    })

    return (
        <div
            ref={parentRef}
            className={`min-h-0 flex-1 overflow-auto ${className}`}
            onKeyDown={onKeyDown}
        >
            <div style={{height: virtualizer.getTotalSize(), position: "relative", width: "100%"}}>
                {virtualizer.getVirtualItems().map((row) => {
                    const start = row.index * columns
                    const cells = items.slice(start, start + columns)
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
                                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                    gap,
                                    paddingBottom: gap,
                                }}
                            >
                                {cells.map((item, i) => (
                                    <Fragment key={getKey(item, start + i)}>
                                        {renderTile(item, start + i)}
                                    </Fragment>
                                ))}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
