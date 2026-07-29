/**
 * VirtualTileGrid — a windowed responsive tile grid for the drive surfaces. The drives list whole
 * folders (thousands of immediate children for a repo the agent cloned into its cwd), so the folder
 * view MUST NOT render one DOM node per file — that alone froze the main thread (issue #5367).
 * Only the visible rows (+ overscan) mount; `@tanstack/react-virtual` windows the rows exactly as
 * before (mounting stays FileThumb's "in view" signal).
 *
 * GEOMETRY HAS ONE OWNER: MOTION. There is no CSS grid — each visible tile is an absolutely
 * positioned `motion.div` whose `x / y / width` this component computes from the measured pane width.
 * That single ownership is what makes the column reflow animatable without fighting:
 *   - Same column count (the normal case, incl. while the tree pane is sliding): targets update per
 *     resize tick with `{duration: 0}` — tiles track the pane 1:1, exactly like CSS `1fr` did.
 *   - Column count CHANGES (e.g. 3→4 as the pane widens): that render opens a short window where the
 *     transition is a SPRING — springs retarget smoothly toward moving targets, so tiles glide into
 *     their new slots while the pane keeps sliding, and settle when it settles. The flip is detected
 *     DURING render (setState-in-render), so the very first frame of the new layout already animates —
 *     an effect would paint one snapped frame first.
 * (The earlier `layout`-prop attempts fought CSS: motion FLIPped from stale snapshots while CSS
 * resized the same boxes between renders — two owners, permanent disagreement.)
 *
 * Tiles are uniform: the thumb is aspect 4/3 of the tile width plus a fixed text block, so
 * height = width × 3/4 + K. K is measured once from a real tile and feeds the virtualizer's
 * `estimateSize`, keeping the windowing math exact without per-row measurement.
 *
 * KEYBOARD: 2D roving focus over the cells (↑/↓/←/→, Home/End) — virtualization-aware, so moving past
 * the visible window SCROLLS the target cell in and focuses it. Cmd/Ctrl+↓ activates the focused cell
 * ("open"), Cmd/Ctrl+↑ steps out — both delegated to the consumer, which owns folder semantics.
 */
import {
    type KeyboardEvent,
    type ReactNode,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react"

import {useVirtualizer} from "@tanstack/react-virtual"
import {motion, useReducedMotion} from "motion/react"

const NAV_KEYS = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]

// Reflow springs — both slightly OVERdamped (past critical damping, 2·√stiffness), so tiles glide
// into their slots and stop dead: no overshoot, no bounce. Two tempos for two situations:
//  - ANTICIPATED (a tree-pane toggle → one known final target): softer, settles ~250ms to read as one
//    motion with the pane's 240ms tween.
//  - LIVE (a column threshold crossed mid-DRAG → the target keeps moving with the pointer): tighter,
//    settles ~150ms so tiles stay on the pointer's heels instead of rubber-banding behind it.
const REFLOW_SPRING = {type: "spring", stiffness: 400, damping: 46} as const
const LIVE_SPRING = {type: "spring", stiffness: 700, damping: 60} as const
// Outside a reflow, targets apply instantly — 1:1 tracking of the pane, no animation.
const INSTANT = {duration: 0}
// How long after a column flip the spring stays active (outlasts the pane tween so the chase settles).
const REFLOW_MS = 350
// A LIVE column flip needs the width clearly past the boundary (px) — parking the drag handle ON a
// threshold otherwise flip-flops the layout every pixel. Anticipated (frozen) widths skip this: the
// final width is exact, not sweeping.
const COL_HYSTERESIS = 12
// Tile thumb is aspect-[4/3] of the tile width (see FileThumb).
const THUMB_ASPECT = 3 / 4

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
    anticipateShift,
}: {
    items: T[]
    /** Fixed column count. Ignored when `minColumnWidth` is set (responsive). */
    columns?: number
    /** Responsive: fit as many columns as the measured container allows, each ≥ this px. Keeps tiles
     * a sensible size in both the narrow config drawer and the wide chat drawer. */
    minColumnWidth?: number
    getKey: (item: T, index: number) => string
    renderTile: (item: T, index: number) => ReactNode
    /** Rough row height (incl. gap) for the initial scrollbar; corrected once a real tile is measured. */
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
     * in or clicking (which opens a tile). Pass true ONLY when the grid is the primary nav surface,
     * not the list view's right pane (the tree owns focus there). */
    autoFocus?: boolean
    /** Identity of the current listing (e.g. the folder path). When it CHANGES, focus jumps back to
     * the first cell — so opening a folder lands on its first item, even if focus was on the tile you
     * just activated. Same key = focus once. */
    autoFocusKey?: string | number
    /** Announced width shift: the host is ANIMATING this pane's width by `delta` px (each announcement
     * bumps `seq`). The grid then lays out for the FINAL width immediately and springs there in one
     * monotonic motion — deriving columns from the live mid-animation width would grow tiles toward
     * the column threshold and then shrink them past it. */
    anticipateShift?: {delta: number; seq: number} | null
}) {
    const parentRef = useRef<HTMLDivElement>(null)
    const reducedMotion = useReducedMotion()

    // Pane CONTENT width (padding excluded — the tile math runs on it). Synchronously measured before
    // first paint so the grid never renders a blank frame, then tracked by the ResizeObserver.
    const [width, setWidth] = useState(0)
    useLayoutEffect(() => {
        const el = parentRef.current
        if (!el) return
        const cs = getComputedStyle(el)
        const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        if (w > 0) setWidth(w)
    }, [])
    useEffect(() => {
        const el = parentRef.current
        if (!el) return
        const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    // ANTICIPATED layout width. When the host announces a width shift (`anticipateShift` — the tree
    // pane toggling), the final width is (current or in-flight target) + delta: freeze the LAYOUT on
    // that final width so every tile gets ONE target (its final rest slot) and springs there
    // monotonically, instead of chasing the sweeping live width through a column flip (which grew
    // tiles toward the threshold and then shrank them past it). Unfrozen the moment the live width
    // arrives (render-phase check) or via the safety timeout below. Chained announcements (rapid
    // re-toggles) add onto the in-flight target, resolving back to the original layout.
    const [frozenWidth, setFrozenWidth] = useState<number | null>(null)
    const [shiftSeq, setShiftSeq] = useState(anticipateShift?.seq ?? 0)
    if (anticipateShift && anticipateShift.seq !== shiftSeq) {
        setShiftSeq(anticipateShift.seq)
        if (width > 0) setFrozenWidth((frozenWidth ?? width) + anticipateShift.delta)
    }
    const arrived = frozenWidth !== null && width > 0 && Math.abs(width - frozenWidth) < 2

    // Layout runs on the frozen (final) width while a shift is in flight, else the live width.
    const layoutWidth = frozenWidth ?? width
    const [prevCols, setPrevCols] = useState<number | null>(null)
    const [reflowing, setReflowing] = useState(false)
    let cols =
        minColumnWidth && layoutWidth > 0
            ? Math.max(1, Math.floor((layoutWidth + gap) / (minColumnWidth + gap)))
            : (columns ?? 3)
    // LIVE flips get hysteresis: keep the current count unless the width is clearly past the boundary,
    // so parking the drag handle right on a threshold doesn't flip-flop the layout every pixel.
    // (Anticipated/frozen widths skip this — the final width is exact, not sweeping.)
    if (minColumnWidth && frozenWidth === null && prevCols !== null && cols !== prevCols) {
        // Minimum width at which `n` columns fit.
        const minWidthFor = (n: number) => n * (minColumnWidth + gap) - gap
        const clearlyPast =
            cols > prevCols
                ? layoutWidth >= minWidthFor(cols) + COL_HYSTERESIS
                : layoutWidth <= minWidthFor(prevCols) - COL_HYSTERESIS
        if (!clearlyPast) cols = prevCols
    }
    // Tile width from the layout width — outside a shift it updates every resize tick and applies
    // instantly, so tiles track a pane resize 1:1 just as CSS `1fr` would.
    const tileW = layoutWidth > 0 ? (layoutWidth - (cols - 1) * gap) / cols : 0

    // Column-flip detection DURING render: the same render that lays tiles out in the new columns also
    // carries the spring transition, so the first frame animates instead of snapping (an effect would
    // flip the flag one paint too late). The first width measurement is the initial layout, not a reflow.
    if (layoutWidth > 0 && prevCols === null) {
        setPrevCols(cols)
    } else if (layoutWidth > 0 && prevCols !== null && cols !== prevCols) {
        setPrevCols(cols)
        setReflowing(true)
    }
    // The live width caught up with the frozen target → unfreeze, keeping the spring window open so
    // the in-flight settle (and the ≤2px residual retarget) stays springy instead of snapping.
    if (arrived) {
        setFrozenWidth(null)
        if (!reflowing) setReflowing(true)
    }
    // Close the spring window after the chase settles; re-arms on further flips/unfreezes.
    useEffect(() => {
        if (!reflowing) return
        const t = setTimeout(() => setReflowing(false), REFLOW_MS)
        return () => clearTimeout(t)
    }, [reflowing, prevCols, frozenWidth])
    // Safety: never stay frozen if the pane's animation was interrupted and the width never arrives.
    useEffect(() => {
        if (frozenWidth === null) return
        const t = setTimeout(() => setFrozenWidth(null), 600)
        return () => clearTimeout(t)
    }, [frozenWidth])

    // Uniform tile height = width × 3/4 (thumb) + K (the fixed text block: name + meta + paddings).
    // K is measured from a real tile at rest (not mid-spring, when heights are transient) and only
    // corrects the initial estimate — windowing stays exact without per-row measureElement.
    const [textBlockK, setTextBlockK] = useState(() => Math.max(estimateRowHeight - 150, 24))
    useEffect(() => {
        if (reflowing || frozenWidth !== null || tileW <= 0) return
        const el = parentRef.current?.querySelector<HTMLElement>("[data-grid-cell]")
        if (!el) return
        const h = el.offsetHeight
        const w = el.offsetWidth
        if (h > 0 && w > 0) {
            const next = h - w * THUMB_ASPECT
            setTextBlockK((prev) => (Math.abs(prev - next) > 1 ? next : prev))
        }
    }, [tileW, reflowing, items.length])
    const tileH = tileW > 0 ? tileW * THUMB_ASPECT + textBlockK : estimateRowHeight
    const rowStep = tileH + gap

    const rowCount = Math.ceil(items.length / cols)
    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => rowStep,
        overscan: overscanRows,
    })
    // Geometry inputs changed → refresh the virtualizer's cached row sizes.
    useEffect(() => {
        virtualizer.measure()
    }, [rowStep, cols, virtualizer])

    const virtualRows = virtualizer.getVirtualItems()
    const firstRow = virtualRows.length ? virtualRows[0].index : 0
    const lastRow = virtualRows.length ? virtualRows[virtualRows.length - 1].index : -1
    const startIndex = firstRow * cols
    const endIndex = Math.min(items.length, (lastRow + 1) * cols)

    // Infinite scroll: fire when the last MOUNTED row is within `endReachedThreshold` rows of the end.
    useEffect(() => {
        if (onEndReached && rowCount > 0 && lastRow >= rowCount - endReachedThreshold) {
            onEndReached()
        }
    }, [onEndReached, lastRow, rowCount, endReachedThreshold])

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
    // tile). The ONLY bail is an active text field — never interrupt typing (e.g. the search box).
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

    // Spring choice by cause: anticipated shift (frozen — one known final target) rides the softer
    // pane-matched spring; a live flip (mid-drag — the target keeps moving) rides the tighter one.
    const springActive = reflowing || frozenWidth !== null
    const transition =
        !springActive || reducedMotion
            ? INSTANT
            : frozenWidth !== null
              ? REFLOW_SPRING
              : LIVE_SPRING

    return (
        // `tabIndex={0}` makes the scroll region itself focusable, so CLICKING the empty grid area (not
        // a tile) puts focus here — then an arrow key starts nav from the first cell (the handler treats
        // "no cell focused" as index 0). `outline-none`: no ring on the container (focus moves to a real
        // tile, which shows its own ring, the moment you press a key).
        <div
            ref={parentRef}
            tabIndex={0}
            // `overflow-x-hidden`: tiles always fit the width at rest, so horizontal scroll is never
            // legitimate — and during an anticipated widen, tiles already sit at their FINAL (wider)
            // slots, which would otherwise flash a horizontal scrollbar until the pane catches up.
            className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none ${className}`}
            onKeyDown={handleKeyDown}
        >
            <div
                style={{
                    height: rowCount > 0 ? rowCount * rowStep : 0,
                    position: "relative",
                    width: "100%",
                }}
            >
                {tileW > 0
                    ? items.slice(startIndex, endIndex).map((item, k) => {
                          const index = startIndex + k
                          const row = Math.floor(index / cols)
                          const col = index % cols
                          return (
                              // The tile's slot — computed here, applied by motion. `initial={false}`:
                              // a tile mounts AT its slot (windowing in/out never animates); only a
                              // column flip (spring window) animates existing tiles between slots.
                              <motion.div
                                  key={getKey(item, index)}
                                  initial={false}
                                  animate={{
                                      x: col * (tileW + gap),
                                      y: row * rowStep,
                                      width: tileW,
                                  }}
                                  transition={transition}
                                  data-grid-cell={index}
                                  style={{position: "absolute", top: 0, left: 0}}
                              >
                                  {renderTile(item, index)}
                              </motion.div>
                          )
                      })
                    : null}
            </div>
            {footer}
        </div>
    )
}
